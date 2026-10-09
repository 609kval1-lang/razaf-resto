<?php

namespace Tests\Feature;

use App\Models\CashMovement;
use App\Models\Menu;
use App\Models\RawMaterial;
use App\Models\Supplier;
use App\Models\SupplierPurchase;
use App\Models\User;
use App\Services\EmployeePayrollService;
use App\Services\SupplierProcurementService;
use App\Services\TreasuryService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class WholeAriaryTest extends TestCase
{
    use RefreshDatabase;

    private function supplierAndMaterial(): array
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        CashMovement::create([
            'direction' => 'in', 'status' => 'approved', 'amount' => 1000.25,
            'destination_account' => 'cash', 'reason' => 'Historical balance', 'approved_at' => now(),
        ]);
        return [Supplier::create(['name' => 'Supplier']), RawMaterial::create([
            'name' => 'Rice', 'stock' => 0, 'unit' => 'kg', 'cost' => 500,
        ])];
    }

    public function test_fractional_purchase_quantity_has_a_whole_total_without_rounding_stock(): void
    {
        [$supplier, $material] = $this->supplierAndMaterial();
        $response = $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases", [
            'raw_material_id' => $material->id, 'quantity' => 0.003, 'unit_price' => 500,
            'payment_mode' => 'credit', 'initial_paid_amount' => 1, 'payment_method' => 'cash',
            'due_date' => now()->addDay()->toDateString(),
        ])->assertCreated()->assertJsonPath('purchase.total_amount', '2.00')
            ->assertJsonPath('purchase.paid_amount', '1.00')->assertJsonPath('purchase.remaining_amount', '1.00');
        $id = $response->json('purchase.id');
        $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases/{$id}/payments", [
            'amount' => 1, 'method' => 'cash',
        ])->assertOk()->assertJsonPath('purchase.remaining_amount', '0.00');
        $this->assertEquals(0.003, (float) $material->fresh()->stock);
        $this->assertEquals(998.25, app(TreasuryService::class)->accountAvailableAmount('cash'));
        $this->assertDatabaseCount('supplier_purchase_payments', 2);
    }

    public static function invalidPurchaseAmounts(): array
    {
        return [['unit_price', 500.25], ['initial_paid_amount', 1.5]];
    }

    #[DataProvider('invalidPurchaseAmounts')]
    public function test_fractional_money_is_rejected_before_purchase_stock_or_payment(string $field, float $value): void
    {
        [$supplier, $material] = $this->supplierAndMaterial();
        $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases", array_replace([
            'raw_material_id' => $material->id, 'quantity' => 1, 'unit_price' => 500,
            'payment_mode' => 'cash', 'initial_paid_amount' => 500, 'payment_method' => 'cash',
        ], [$field => $value]))->assertUnprocessable()->assertJsonValidationErrors($field);
        $this->assertDatabaseCount('supplier_purchases', 0);
        $this->assertDatabaseCount('supplier_purchase_payments', 0);
        $this->assertDatabaseCount('raw_material_supplier', 0);
        $this->assertEquals(0, (float) $material->fresh()->stock);
        $this->assertSame(1, CashMovement::count());
    }

    public function test_an_old_fractional_debt_can_be_settled_exactly_without_rewriting_its_total(): void
    {
        [$supplier, $material] = $this->supplierAndMaterial();
        $purchase = SupplierPurchase::create([
            'supplier_id' => $supplier->id, 'raw_material_id' => $material->id, 'quantity' => 1,
            'unit_price' => 25.20, 'total_amount' => 25.20, 'paid_amount' => 10.10, 'remaining_amount' => 15.10,
            'payment_mode' => 'credit', 'payment_status' => 'partial', 'purchased_at' => now(),
        ]);
        $url = "/api/admin/suppliers/{$supplier->id}/purchases/{$purchase->id}/payments";
        $this->postJson($url, ['amount' => 5.10, 'method' => 'cash'])
            ->assertUnprocessable()->assertJsonValidationErrors('amount');
        $this->assertDatabaseCount('supplier_purchase_payments', 0);
        $this->postJson($url, ['amount' => 15.10, 'method' => 'cash'])->assertOk()
            ->assertJsonPath('purchase.total_amount', '25.20')
            ->assertJsonPath('purchase.paid_amount', '25.20')->assertJsonPath('purchase.remaining_amount', '0.00');
        $this->assertEquals(985.15, app(TreasuryService::class)->accountAvailableAmount('cash'));
        $this->assertDatabaseHas('cash_movements', ['amount' => 15.10, 'source_account' => 'cash']);
    }

    public function test_new_treasury_and_payroll_inputs_reject_decimals_without_financial_writes(): void
    {
        [$supplier, $material] = $this->supplierAndMaterial();
        $employee = User::factory()->create(['role' => 'employee', 'has_system_access' => false]);
        foreach (['transfers' => ['destination_account' => 'bank'], 'withdrawals' => []] as $action => $extra) {
            $this->postJson("/api/admin/treasury/{$action}", array_merge([
                'amount' => 10.5, 'source_account' => 'cash', 'reason' => 'Test expense',
            ], $extra))->assertUnprocessable()->assertJsonValidationErrors('amount');
        }
        $this->putJson("/api/admin/employees/{$employee->id}/salary-profile", ['monthly_salary' => 1000.5])
            ->assertUnprocessable()->assertJsonValidationErrors('monthly_salary');
        $this->postJson("/api/admin/employees/{$employee->id}/payroll/advances", [
            'amount' => 10.5, 'payment_method' => 'cash',
        ])->assertUnprocessable()->assertJsonValidationErrors('amount');
        foreach (['gross_amount' => 1000.5, 'advance_deduction_amount' => 10.5] as $field => $value) {
            $this->postJson("/api/admin/employees/{$employee->id}/payroll/salaries", [
                $field => $value, 'payment_method' => 'cash',
            ])->assertUnprocessable()->assertJsonValidationErrors($field);
        }
        $this->putJson("/api/admin/raw-materials/{$material->id}", ['cost' => 500.5])
            ->assertUnprocessable()->assertJsonValidationErrors('cost');
        $menu = Menu::create(['name' => 'Rice dish', 'price' => 1000, 'is_available' => true]);
        $this->putJson("/api/admin/menus/{$menu->id}", ['price' => 1000.5])
            ->assertUnprocessable()->assertJsonValidationErrors('price');
        $this->assertEquals(1000, (float) $menu->fresh()->price);
        Sanctum::actingAs(User::factory()->create(['role' => 'cashier']));
        $this->postJson('/api/cashier/cash-movements/withdrawals', ['amount' => 10.5, 'reason' => 'Test'])
            ->assertUnprocessable()->assertJsonValidationErrors('amount');
        $this->assertDatabaseCount('employee_salary_profiles', 0);
        $this->assertDatabaseCount('employee_payroll_transactions', 0);
        $this->assertSame(1, CashMovement::count());
        $this->assertEquals(1000.25, app(TreasuryService::class)->accountAvailableAmount('cash'));
    }

    public function test_services_also_reject_fractional_money_when_called_without_http_validation(): void
    {
        [$supplier, $material] = $this->supplierAndMaterial();
        $admin = User::where('role', 'admin')->firstOrFail();
        $employee = User::factory()->create(['role' => 'employee', 'has_system_access' => false]);
        $payroll = app(EmployeePayrollService::class);
        $actions = [
            'unit_price' => fn () => app(SupplierProcurementService::class)->registerPurchase($supplier, $material, 1, 500.5),
            'monthly_salary' => fn () => $payroll->upsertSalaryProfile($employee, ['monthly_salary' => 1000.5]),
            'amount' => fn () => $payroll->recordAdvance($employee, ['amount' => 10.5], $admin->id),
        ];
        foreach ($actions as $field => $action) {
            try {
                $action();
                $this->fail('Fractional money must be rejected.');
            } catch (ValidationException $error) {
                $this->assertArrayHasKey($field, $error->errors());
            }
        }
        $this->assertDatabaseCount('supplier_purchases', 0);
        $this->assertDatabaseCount('employee_salary_profiles', 0);
        $this->assertDatabaseCount('employee_payroll_transactions', 0);
        $this->assertSame(1, CashMovement::count());
        $payroll->upsertSalaryProfile($employee, ['monthly_salary' => 1000]);
        foreach (['gross_amount' => 1000.5, 'advance_deduction_amount' => 10.5] as $field => $value) {
            try {
                $payroll->recordSalaryPayment($employee->fresh(), [$field => $value], $admin->id);
                $this->fail('Fractional salary input must be rejected.');
            } catch (ValidationException $error) {
                $this->assertArrayHasKey($field, $error->errors());
            }
        }
        $this->assertDatabaseCount('employee_payroll_transactions', 0);
        $this->assertSame(1, CashMovement::count());
    }

    public function test_initial_material_purchase_uses_the_same_rounding_and_rejects_zero_totals_atomically(): void
    {
        [$supplier] = $this->supplierAndMaterial();
        $this->postJson('/api/admin/raw-materials', [
            'name' => 'Spice', 'stock' => 0.003, 'unit' => 'kg', 'cost' => 500,
            'supplier_id' => $supplier->id, 'purchase_payment_mode' => 'cash',
        ])->assertCreated();
        $this->assertDatabaseHas('supplier_purchases', ['quantity' => 0.003, 'total_amount' => 2, 'paid_amount' => 2]);
        $this->assertEquals(998.25, app(TreasuryService::class)->accountAvailableAmount('cash'));
        $this->postJson('/api/admin/raw-materials', [
            'name' => 'Zero total', 'stock' => 0.001, 'unit' => 'kg', 'cost' => 1,
            'new_supplier' => ['name' => 'Rolled back supplier'], 'purchase_payment_mode' => 'cash',
        ])->assertUnprocessable()->assertJsonValidationErrors('unit_price');
        $this->assertDatabaseMissing('raw_materials', ['name' => 'Zero total']);
        $this->assertDatabaseMissing('suppliers', ['name' => 'Rolled back supplier']);
        $this->assertDatabaseCount('supplier_purchases', 1);
        $this->assertEquals(998.25, app(TreasuryService::class)->accountAvailableAmount('cash'));
    }
}
