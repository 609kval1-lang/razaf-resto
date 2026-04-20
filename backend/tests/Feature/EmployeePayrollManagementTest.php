<?php

namespace Tests\Feature;

use App\Models\CashMovement;
use App\Models\EmployeeAdvanceSettlement;
use App\Models\EmployeePayrollTransaction;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class EmployeePayrollManagementTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        Carbon::setTestNow(Carbon::parse('2026-04-07 09:00:00'));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    public function test_admin_can_create_simple_employee_without_system_access_and_find_it_in_payroll(): void
    {
        $admin = User::factory()->create([
            'role' => 'admin',
            'has_system_access' => true,
        ]);

        Sanctum::actingAs($admin);

        $response = $this->postJson('/api/admin/users', [
            'name' => 'Aina Salle',
            'role' => 'employee',
            'has_system_access' => false,
            'job_title' => 'Fille de salle',
            'employment_status' => 'active',
        ]);

        $response->assertCreated()
            ->assertJsonPath('name', 'Aina Salle')
            ->assertJsonPath('role', 'employee')
            ->assertJsonPath('has_system_access', false)
            ->assertJsonPath('email', null);

        $employeeId = (int) $response->json('id');

        $snapshot = $this->getJson('/api/admin/employees/payroll');
        $snapshot->assertOk();

        $employee = collect($snapshot->json('employees'))->firstWhere('id', $employeeId);

        $this->assertNotNull($employee);
        $this->assertSame('Aina Salle', $employee['name']);
        $this->assertSame('employee', $employee['role']);
        $this->assertFalse((bool) $employee['has_system_access']);
        $this->assertSame('Fille de salle', $employee['job_title']);
    }

    public function test_advance_and_salary_payment_update_treasury_and_settle_employee_balance(): void
    {
        $admin = User::factory()->create([
            'role' => 'admin',
            'has_system_access' => true,
        ]);
        $employee = User::factory()->create([
            'name' => 'Toky Cuisine',
            'role' => 'employee',
            'has_system_access' => false,
            'job_title' => 'Cuisinier',
            'email' => null,
            'password' => null,
        ]);

        Sanctum::actingAs($admin);

        $this->seedApprovedBalance($admin, CashMovement::ACCOUNT_SAFE, 50000, 'cash');
        $this->seedApprovedBalance($admin, CashMovement::ACCOUNT_BANK, 200000, 'transfer');

        $this->putJson("/api/admin/employees/{$employee->id}/salary-profile", [
            'monthly_salary' => 100000,
            'payment_day' => 30,
            'is_active' => true,
            'notes' => 'Paiement fin de mois',
        ])->assertOk()
            ->assertJsonPath('profile.monthly_salary', '100000.00');

        $advanceResponse = $this->postJson("/api/admin/employees/{$employee->id}/payroll/advances", [
            'amount' => 30000,
            'payment_method' => 'cash',
            'cash_source_account' => CashMovement::ACCOUNT_SAFE,
            'paid_at' => '2026-04-08',
            'reference' => 'ADV-APR-01',
            'note' => 'Avance exceptionnelle',
        ]);

        $advanceResponse->assertCreated()
            ->assertJsonPath('transaction.transaction_type', EmployeePayrollTransaction::TYPE_ADVANCE)
            ->assertJsonPath('transaction.net_amount', 30000)
            ->assertJsonPath('transaction.payment_method', 'cash')
            ->assertJsonPath('transaction.source_account', CashMovement::ACCOUNT_SAFE);

        $salaryResponse = $this->postJson("/api/admin/employees/{$employee->id}/payroll/salaries", [
            'gross_amount' => 100000,
            'advance_deduction_amount' => 30000,
            'payroll_month' => '2026-04-01',
            'payment_method' => 'check',
            'paid_at' => '2026-04-30',
            'reference' => 'SAL-APR-01',
            'note' => 'Salaire avril 2026',
        ]);

        $salaryResponse->assertCreated()
            ->assertJsonPath('transaction.transaction_type', EmployeePayrollTransaction::TYPE_SALARY_PAYMENT)
            ->assertJsonPath('transaction.gross_amount', 100000)
            ->assertJsonPath('transaction.advance_deduction_amount', 30000)
            ->assertJsonPath('transaction.net_amount', 70000)
            ->assertJsonPath('transaction.payment_method', 'check')
            ->assertJsonPath('transaction.source_account', CashMovement::ACCOUNT_BANK);

        $this->assertDatabaseHas('cash_movements', [
            'flow_type' => 'employee_advance_payment',
            'source_account' => CashMovement::ACCOUNT_SAFE,
            'reason' => 'Avance sur salaire',
        ]);
        $this->assertDatabaseHas('cash_movements', [
            'flow_type' => 'employee_salary_payment',
            'source_account' => CashMovement::ACCOUNT_BANK,
            'reason' => 'Paiement salaire',
        ]);
        $this->assertDatabaseHas('employee_payroll_transactions', [
            'user_id' => $employee->id,
            'transaction_type' => EmployeePayrollTransaction::TYPE_ADVANCE,
            'payment_method' => 'cash',
            'source_account' => CashMovement::ACCOUNT_SAFE,
        ]);
        $this->assertDatabaseHas('employee_payroll_transactions', [
            'user_id' => $employee->id,
            'transaction_type' => EmployeePayrollTransaction::TYPE_SALARY_PAYMENT,
            'payment_method' => 'check',
            'source_account' => CashMovement::ACCOUNT_BANK,
        ]);

        $this->assertSame(1, EmployeeAdvanceSettlement::query()->count());
        $settlement = EmployeeAdvanceSettlement::query()->first();
        $this->assertNotNull($settlement);
        $this->assertSame(30000.0, (float) $settlement->amount);

        $payrollSnapshot = $this->getJson('/api/admin/employees/payroll');
        $payrollSnapshot->assertOk();

        $employeePayload = collect($payrollSnapshot->json('employees'))->firstWhere('id', $employee->id);

        $this->assertNotNull($employeePayload);
        $this->assertSame(0.0, (float) $employeePayload['outstanding_advance_amount']);

        $treasurySnapshot = $this->getJson('/api/admin/treasury');
        $treasurySnapshot->assertOk()
            ->assertJsonPath('summary.accounts.safe.balance', 20000)
            ->assertJsonPath('summary.accounts.bank.balance', 130000)
            ->assertJsonPath('summary.total_internal_balance', 150000);
    }

    public function test_admin_cannot_pay_more_than_the_remaining_salary_coverage_for_the_month(): void
    {
        $admin = User::factory()->create([
            'role' => 'admin',
            'has_system_access' => true,
        ]);
        $employee = User::factory()->create([
            'name' => 'Miora Service',
            'role' => 'employee',
            'has_system_access' => false,
            'email' => null,
            'password' => null,
        ]);

        Sanctum::actingAs($admin);

        $this->seedApprovedBalance($admin, CashMovement::ACCOUNT_BANK, 250000, 'transfer');

        $this->putJson("/api/admin/employees/{$employee->id}/salary-profile", [
            'monthly_salary' => 100000,
            'payment_day' => 30,
            'is_active' => true,
        ])->assertOk();

        $this->postJson("/api/admin/employees/{$employee->id}/payroll/salaries", [
            'gross_amount' => 100000,
            'advance_deduction_amount' => 0,
            'payroll_month' => '2026-04-01',
            'payment_method' => 'transfer',
            'paid_at' => '2026-04-30',
            'reference' => 'SAL-APR-UNIQUE',
        ])->assertCreated();

        $secondPayment = $this->postJson("/api/admin/employees/{$employee->id}/payroll/salaries", [
            'gross_amount' => 1000,
            'advance_deduction_amount' => 0,
            'payroll_month' => '2026-04-01',
            'payment_method' => 'transfer',
            'paid_at' => '2026-04-30',
            'reference' => 'SAL-APR-DOUBLE',
        ]);

        $secondPayment->assertStatus(422)
            ->assertJsonValidationErrors(['gross_amount']);

        $this->assertSame(1, EmployeePayrollTransaction::query()
            ->where('user_id', $employee->id)
            ->where('transaction_type', EmployeePayrollTransaction::TYPE_SALARY_PAYMENT)
            ->count());

        $this->assertSame(1, CashMovement::query()
            ->where('flow_type', 'employee_salary_payment')
            ->where('source_account', CashMovement::ACCOUNT_BANK)
            ->count());

        $this->getJson('/api/admin/treasury')
            ->assertOk()
            ->assertJsonPath('summary.accounts.bank.balance', 150000)
            ->assertJsonPath('summary.total_internal_balance', 150000);
    }

    private function seedApprovedBalance(User $admin, string $account, float $amount, ?string $paymentMethod = null): void
    {
        CashMovement::query()->create([
            'direction' => 'in',
            'status' => 'approved',
            'movement_type' => 'sale',
            'amount' => $amount,
            'payment_method' => $paymentMethod,
            'destination_account' => $account,
            'description' => "Solde initial {$account}",
            'reason' => 'Base de départ',
            'requested_by_user_id' => $admin->id,
            'approved_by_user_id' => $admin->id,
            'approved_at' => now(),
        ]);
    }
}
