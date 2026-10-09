<?php

namespace Tests\Feature;

use App\Models\CashMovement;
use App\Models\Ingredient;
use App\Models\Menu;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\RawMaterial;
use App\Models\Supplier;
use App\Models\User;
use App\Services\EmployeePayrollService;
use App\Services\TreasuryService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class MoneyCalculationTest extends TestCase
{
    use RefreshDatabase;

    private function fund(string $account, float $amount): void
    {
        CashMovement::create([
            'direction' => 'in', 'status' => 'approved', 'amount' => $amount,
            'destination_account' => $account, 'reason' => 'Test balance', 'approved_at' => now(),
        ]);
    }

    public static function transfers(): array
    {
        $cases = [];
        foreach (CashMovement::treasuryAccounts() as $source) {
            foreach (CashMovement::treasuryAccounts() as $destination) {
                if ($source !== $destination) {
                    $cases["{$source} to {$destination}"] = [$source, $destination];
                }
            }
        }
        return $cases;
    }

    #[DataProvider('transfers')]
    public function test_transfers_debit_one_account_credit_the_other_and_preserve_total(string $source, string $destination): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->fund($source, 1000.25);
        $this->postJson('/api/admin/treasury/transfers', [
            'amount' => 400, 'source_account' => $source,
            'destination_account' => $destination, 'reason' => 'Transfer test',
        ])->assertCreated();

        $snapshot = $this->getJson('/api/admin/treasury')->assertOk();
        $this->assertEquals(1000.25, $snapshot->json('summary.total_internal_balance'));
        foreach (CashMovement::treasuryAccounts() as $account) {
            $expected = $account === $source ? 600.25 : ($account === $destination ? 400 : 0);
            $this->assertEquals($expected, $snapshot->json("summary.accounts.{$account}.balance"));
            $this->assertEquals($expected, app(TreasuryService::class)->accountAvailableAmount($account));
        }
    }

    public function test_insufficient_funds_and_same_account_transfers_leave_balances_unchanged(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->fund('mobile_money', 100);
        $payload = ['amount' => 101, 'source_account' => 'mobile_money', 'destination_account' => 'bank', 'reason' => 'Test'];
        $this->postJson('/api/admin/treasury/transfers', $payload)->assertUnprocessable();
        $this->postJson('/api/admin/treasury/transfers', array_replace($payload, [
            'amount' => 1, 'destination_account' => 'mobile_money',
        ]))->assertUnprocessable();
        $this->postJson('/api/admin/treasury/withdrawals', [
            'amount' => 101, 'source_account' => 'mobile_money', 'reason' => 'Test',
        ])->assertUnprocessable();
        $this->assertSame(1, CashMovement::count());
        $this->assertEquals(100, app(TreasuryService::class)->accountAvailableAmount('mobile_money'));
    }

    public function test_supplier_initial_overpayment_is_rejected_instead_of_silently_reduced(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->fund('cash', 10000);
        [$supplier, $material] = $this->supplierAndMaterial();

        $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases", [
            'raw_material_id' => $material->id, 'quantity' => 1, 'unit_price' => 500,
            'payment_mode' => 'cash', 'initial_paid_amount' => 501, 'payment_method' => 'cash',
        ])->assertUnprocessable()->assertJsonValidationErrors('initial_paid_amount');

        $this->assertDatabaseCount('supplier_purchases', 0);
        $this->assertEquals(0, (float) $material->fresh()->stock);
        $this->assertEquals(10000, app(TreasuryService::class)->accountAvailableAmount('cash'));
    }

    public function test_pending_cash_request_does_not_spend_money_and_is_rechecked_on_approval(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs(User::factory()->create(['role' => 'cashier']));
        $this->fund('cash', 100.20);
        $request = $this->postJson('/api/cashier/cash-movements/withdrawals', [
            'amount' => 80, 'reason' => 'Pending expense',
        ])->assertCreated();
        $id = $request->json('movement.id');
        $this->assertEquals(100.20, app(TreasuryService::class)->accountAvailableAmount('cash'));

        Sanctum::actingAs($admin);
        $this->postJson('/api/admin/treasury/withdrawals', [
            'amount' => 50, 'source_account' => 'cash', 'reason' => 'Immediate expense',
        ])->assertCreated();
        $this->postJson("/api/admin/cash-movements/{$id}/approve")->assertUnprocessable();
        $this->assertDatabaseHas('cash_movements', ['id' => $id, 'status' => 'pending']);
        $this->assertEquals(50.20, app(TreasuryService::class)->accountAvailableAmount('cash'));
        $this->postJson("/api/admin/cash-movements/{$id}/reject")->assertOk();
        $this->assertEquals(50.20, app(TreasuryService::class)->accountAvailableAmount('cash'));
        $this->getJson('/api/admin/treasury')->assertOk()->assertJsonPath('summary.cash_out_pending', 0);
    }

    public function test_failed_purchase_rolls_back_stock_payment_and_supplier_link(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        [$supplier, $material] = $this->supplierAndMaterial();

        $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases", [
            'raw_material_id' => $material->id, 'quantity' => 1, 'unit_price' => 500,
            'payment_mode' => 'cash', 'payment_method' => 'cash',
        ])->assertUnprocessable();

        $this->assertDatabaseCount('supplier_purchases', 0);
        $this->assertDatabaseCount('supplier_purchase_payments', 0);
        $this->assertDatabaseCount('cash_movements', 0);
        $this->assertDatabaseCount('raw_material_supplier', 0);
        $this->assertEquals(0, (float) $material->fresh()->stock);
    }

    public static function supplierPaymentMethods(): array
    {
        return [
            'cash register' => ['cash', 'cash', 'cash'],
            'safe cash' => ['cash', 'safe', 'cash'],
            'mobile money' => ['mobile_money', 'mobile_money', 'mobile_money'],
            'bank transfer' => ['transfer', 'bank', 'transfer'],
            'bank check' => ['check', 'bank', 'check'],
            'legacy card alias' => ['card', 'mobile_money', 'mobile_money'],
        ];
    }

    #[DataProvider('supplierPaymentMethods')]
    public function test_supplier_partial_and_final_payments_debit_only_the_selected_account(
        string $method, string $account, string $storedMethod
    ): void {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->fund($account, 100.75);
        [$supplier, $material] = $this->supplierAndMaterial();
        $cashSource = in_array($account, ['cash', 'safe'], true) ? $account : null;
        $purchase = $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases", [
            'raw_material_id' => $material->id, 'quantity' => 1, 'unit_price' => 25,
            'payment_mode' => 'credit', 'initial_paid_amount' => 10, 'payment_method' => $method,
            'cash_source_account' => $cashSource, 'due_date' => now()->addDay()->toDateString(),
        ])->assertCreated()->assertJsonPath('purchase.payment_status', 'partial');
        $id = $purchase->json('purchase.id');
        $this->assertEquals(15, (float) $purchase->json('purchase.remaining_amount'));

        $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases/{$id}/payments", [
            'amount' => 15, 'method' => $method, 'cash_source_account' => $cashSource,
        ])->assertOk()->assertJsonPath('purchase.payment_status', 'paid')
            ->assertJsonPath('purchase.remaining_amount', '0.00');

        $this->assertDatabaseCount('supplier_purchase_payments', 2);
        $this->assertDatabaseHas('supplier_purchase_payments', [
            'supplier_purchase_id' => $id, 'method' => $storedMethod, 'source_account' => $account,
        ]);
        foreach (CashMovement::treasuryAccounts() as $key) {
            $this->assertEquals($key === $account ? 75.75 : 0, app(TreasuryService::class)->accountAvailableAmount($key));
        }
        $this->assertEquals(1, (float) $material->fresh()->stock);
    }

    public function test_salary_fully_covered_by_advances_does_not_debit_money_twice(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $employee = User::factory()->create(['role' => 'employee', 'has_system_access' => false]);
        $this->fund('mobile_money', 1000);
        $service = app(EmployeePayrollService::class);
        $service->upsertSalaryProfile($employee, ['monthly_salary' => 1000]);
        $service->recordAdvance($employee, ['amount' => 1000, 'payment_method' => 'mobile_money'], $admin->id);
        $salary = $service->recordSalaryPayment($employee->fresh(), ['gross_amount' => 1000], $admin->id);

        $this->assertEquals(1000, (float) $salary->advance_deduction_amount);
        $this->assertEquals(0, (float) $salary->net_amount);
        $this->assertNull($salary->cash_movement_id);
        $this->assertEquals(0, $service->outstandingAdvanceAmount($employee));
        $this->assertEquals(0, app(TreasuryService::class)->accountAvailableAmount('mobile_money'));
        $this->assertSame(2, CashMovement::count());
    }

    public function test_supplier_bulk_payment_is_fully_rolled_back_if_total_funds_are_insufficient(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->fund('mobile_money', 250);
        [$supplier, $material] = $this->supplierAndMaterial();
        for ($i = 0; $i < 2; $i++) {
            $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases", [
                'raw_material_id' => $material->id, 'quantity' => 0.3, 'unit_price' => 500,
                'payment_mode' => 'credit', 'due_date' => now()->addDay()->toDateString(),
            ])->assertCreated();
        }

        $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases/settle-all", [
            'method' => 'mobile_money',
        ])->assertUnprocessable();

        $this->assertDatabaseCount('supplier_purchase_payments', 0);
        $this->assertEquals(300, (float) $supplier->purchases()->sum('remaining_amount'));
        $this->assertEquals(0, (float) $supplier->purchases()->sum('paid_amount'));
        $this->assertEquals(250, app(TreasuryService::class)->accountAvailableAmount('mobile_money'));
        $this->assertSame(1, CashMovement::count());
        $this->assertEquals(0.6, (float) $material->fresh()->stock);
    }

    public function test_revenue_profit_subtracts_discounts_and_includes_packaging(): void
    {
        $this->freezeTime();
        $order = $this->sale();
        $this->payment($order, 9900, 1100, now());

        $report = $this->getJson('/api/admin/revenue-report')->assertOk();
        $this->assertEquals(11000, $report->json('summary.total_revenue_gross'));
        $this->assertEquals(9900, $report->json('summary.total_revenue_net'));
        $this->assertEquals(1100, $report->json('summary.total_discount'));
        $this->assertEquals(2000, $report->json('summary.total_estimated_cost'));
        $this->assertEquals(7900, $report->json('summary.total_estimated_profit'));
        $this->assertEquals(1000, $report->json('summary.packaging_revenue_gross'));
        $this->assertEquals(900, $report->json('summary.packaging_revenue_net'));
        $this->assertEquals(7000, $report->json('menu_stats.0.total_profit'));
    }

    public function test_split_payments_on_different_days_do_not_repeat_full_revenue_and_cost(): void
    {
        $this->freezeTime();
        $order = $this->sale();
        $this->payment($order, 4500, 500, now()->subDay());
        $this->payment($order, 5400, 600, now());

        $report = $this->getJson('/api/admin/revenue-report')->assertOk();
        $this->assertEquals(6000, $report->json('summary.total_revenue_gross'));
        $this->assertEquals(5400, $report->json('summary.total_revenue_net'));
        $this->assertEqualsWithDelta(1090.91, $report->json('summary.total_estimated_cost'), 0.01);
        $this->assertEqualsWithDelta(4309.09, $report->json('summary.total_estimated_profit'), 0.01);
        $this->assertEquals(545, $report->json('summary.packaging_revenue_gross'));
        $this->assertEquals(491, $report->json('summary.packaging_revenue_net'));
    }

    private function supplierAndMaterial(): array
    {
        return [Supplier::create(['name' => 'Supplier']), RawMaterial::create([
            'name' => 'Rice', 'stock' => 0, 'unit' => 'kg', 'cost' => 500, 'reorder_level' => 0,
        ])];
    }

    public function test_cashier_sales_breakdown_does_not_invent_an_ariary_when_allocating_a_discount(): void
    {
        $this->freezeTime();
        $cashier = User::factory()->create(['role' => 'cashier']);
        Sanctum::actingAs($cashier);
        $menu = Menu::create(['name' => 'Meal', 'price' => 2, 'category' => 'main', 'is_available' => true]);
        $order = Order::create(['user_id' => $cashier->id, 'total_amount' => 6, 'status' => 'paid']);
        for ($i = 0; $i < 3; $i++) {
            OrderItem::create([
                'order_id' => $order->id, 'menu_id' => $menu->id, 'quantity' => 1, 'price_at_order' => 2, 'status' => 'served',
            ]);
        }
        $this->payment($order, 5, 1, now());

        $report = $this->getJson('/api/cashier/stats')->assertOk();
        $this->assertEquals(5, $report->json('total_revenue'));
        $this->assertEquals(5, $report->json('sales_breakdown.total'));
        $this->assertEquals(5, $report->json('sales_breakdown.restaurant'));
    }

    private function sale(): Order
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);
        $material = RawMaterial::create([
            'name' => 'Rice', 'stock' => 10, 'unit' => 'kg', 'cost' => 2000, 'reorder_level' => 0,
        ]);
        $ingredient = Ingredient::create([
            'name' => 'Rice portion', 'raw_material_id' => $material->id,
            'portion_size' => 1000, 'portion_unit' => 'g', 'quantity_available' => 10, 'cost_per_portion' => 2000,
        ]);
        $menu = Menu::create(['name' => 'Meal', 'price' => 10000, 'category' => 'main', 'is_available' => true]);
        $menu->ingredients()->attach($ingredient->id, ['quantity_needed' => 1]);
        $order = Order::create([
            'user_id' => $admin->id, 'total_amount' => 11000, 'status' => 'paid',
            'order_type' => 'takeaway', 'with_packaging' => true, 'packaging_quantity' => 2, 'packaging_unit_price' => 500,
        ]);
        OrderItem::create([
            'order_id' => $order->id, 'menu_id' => $menu->id, 'quantity' => 1, 'price_at_order' => 10000, 'status' => 'served',
        ]);
        return $order;
    }

    private function payment(Order $order, float $amount, float $discount, $date): void
    {
        Payment::create([
            'order_id' => $order->id, 'amount' => $amount, 'discount_percent' => 10,
            'discount_amount' => $discount, 'method' => 'cash', 'status' => 'completed', 'encashed_at' => $date,
        ]);
    }
}
