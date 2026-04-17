<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CashMovement;
use App\Models\EmployeePayrollTransaction;
use App\Models\User;
use App\Services\EmployeePayrollService;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class EmployeePayrollController extends Controller
{
    public function index()
    {
        $currentPayrollMonth = now()->startOfMonth()->toDateString();

        $employees = User::query()
            ->with(['salaryProfile'])
            ->where('role', '!=', 'admin')
            ->orderBy('name')
            ->get();

        $transactions = EmployeePayrollTransaction::query()
            ->with([
                'user:id,name,job_title,has_system_access,role',
                'createdBy:id,name',
            ])
            ->orderByDesc('paid_at')
            ->orderByDesc('id')
            ->get();

        $salaryMonthlyTotals = EmployeePayrollTransaction::query()
            ->where('transaction_type', EmployeePayrollTransaction::TYPE_SALARY_PAYMENT)
            ->whereDate('payroll_month', $currentPayrollMonth)
            ->selectRaw('user_id, SUM(net_amount) as net_paid_total, SUM(gross_amount) as gross_covered_total')
            ->groupBy('user_id')
            ->get()
            ->keyBy('user_id');

        $payrollService = app(EmployeePayrollService::class);

        return response()->json([
            'employees' => $employees->map(function (User $user) use ($payrollService, $salaryMonthlyTotals) {
                $monthlySalary = round((float) ($user->salaryProfile?->monthly_salary ?? 0), 2);
                $outstandingAdvanceSummary = $payrollService->outstandingAdvanceSummary($user);
                $outstandingAdvance = round((float) ($outstandingAdvanceSummary['amount'] ?? 0), 2);
                $salaryTotals = $salaryMonthlyTotals->get($user->id);
                $salaryPaidThisMonth = round((float) ($salaryTotals?->net_paid_total ?? 0), 2);
                $salaryCoveredThisMonth = round((float) ($salaryTotals?->gross_covered_total ?? 0), 2);
                $salaryRemainingThisMonth = round(max(0, $monthlySalary - $salaryCoveredThisMonth - $outstandingAdvance), 2);

                return [
                    'id' => (int) $user->id,
                    'name' => (string) $user->name,
                    'email' => $user->email,
                    'role' => (string) ($user->role ?? 'employee'),
                    'job_title' => $user->job_title,
                    'has_system_access' => (bool) $user->has_system_access,
                    'employment_status' => (string) ($user->employment_status ?? 'active'),
                    'salary_profile' => $user->salaryProfile ? [
                        'id' => (int) $user->salaryProfile->id,
                        'monthly_salary' => $monthlySalary,
                        'payment_day' => $user->salaryProfile->payment_day,
                        'is_active' => (bool) $user->salaryProfile->is_active,
                        'notes' => $user->salaryProfile->notes,
                    ] : null,
                    'monthly_salary' => $monthlySalary,
                    'outstanding_advance_amount' => $outstandingAdvance,
                    'outstanding_advance_count' => (int) ($outstandingAdvanceSummary['count'] ?? 0),
                    'outstanding_advance_dates' => array_values($outstandingAdvanceSummary['dates'] ?? []),
                    'outstanding_advance_oldest_date' => $outstandingAdvanceSummary['oldest_date'] ?? null,
                    'outstanding_advance_latest_date' => $outstandingAdvanceSummary['latest_date'] ?? null,
                    'salary_paid_this_month' => $salaryPaidThisMonth,
                    'salary_covered_this_month' => $salaryCoveredThisMonth,
                    'salary_remaining_this_month' => $salaryRemainingThisMonth,
                ];
            })->values(),
            'transactions' => $transactions->map(fn (EmployeePayrollTransaction $transaction) => $this->formatTransaction($transaction))->values(),
            'config' => [
                'payment_methods' => ['cash', 'mobile_money', 'transfer', 'check'],
                'cash_source_accounts' => ['cash', 'safe'],
            ],
            'treasury_balances' => $this->treasuryBalances(),
        ]);
    }

    public function upsertSalaryProfile(Request $request, User $user)
    {
        $validated = $request->validate([
            'monthly_salary' => ['required', 'numeric', 'min:0'],
            'payment_day' => ['nullable', 'integer', 'min:1', 'max:31'],
            'is_active' => ['nullable', 'boolean'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);

        $profile = app(EmployeePayrollService::class)->upsertSalaryProfile($user, $validated);

        return response()->json([
            'message' => 'Profil salarial enregistre.',
            'profile' => $profile,
        ]);
    }

    public function storeAdvance(Request $request, User $user)
    {
        $validated = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.01'],
            'payment_method' => ['required', Rule::in(['cash', 'mobile_money', 'transfer', 'check'])],
            'cash_source_account' => ['nullable', Rule::in(['cash', 'safe'])],
            'reference' => ['nullable', 'string', 'max:120'],
            'note' => ['nullable', 'string', 'max:2000'],
            'paid_at' => ['nullable', 'date'],
        ]);

        $transaction = app(EmployeePayrollService::class)->recordAdvance($user, $validated, (int) $request->user()->id);

        return response()->json([
            'message' => 'Avance employee enregistree.',
            'transaction' => $this->formatTransaction($transaction->fresh(['user:id,name,job_title,has_system_access,role', 'createdBy:id,name'])),
        ], 201);
    }

    public function storeSalaryPayment(Request $request, User $user)
    {
        $validated = $request->validate([
            'gross_amount' => ['nullable', 'numeric', 'min:0.01'],
            'advance_deduction_amount' => ['nullable', 'numeric', 'min:0'],
            'payroll_month' => ['nullable', 'date'],
            'payment_method' => ['required', Rule::in(['cash', 'mobile_money', 'transfer', 'check'])],
            'cash_source_account' => ['nullable', Rule::in(['cash', 'safe'])],
            'reference' => ['nullable', 'string', 'max:120'],
            'note' => ['nullable', 'string', 'max:2000'],
            'paid_at' => ['nullable', 'date'],
        ]);

        $transaction = app(EmployeePayrollService::class)->recordSalaryPayment($user, $validated, (int) $request->user()->id);

        return response()->json([
            'message' => 'Paiement salaire enregistre.',
            'transaction' => $this->formatTransaction($transaction->fresh(['user:id,name,job_title,has_system_access,role', 'createdBy:id,name'])),
        ], 201);
    }

    private function formatTransaction(EmployeePayrollTransaction $transaction): array
    {
        return [
            'id' => (int) $transaction->id,
            'user_id' => (int) $transaction->user_id,
            'employee_name' => (string) ($transaction->user?->name ?? 'Employe'),
            'job_title' => $transaction->user?->job_title,
            'role' => $transaction->user?->role,
            'has_system_access' => (bool) ($transaction->user?->has_system_access ?? false),
            'transaction_type' => (string) $transaction->transaction_type,
            'gross_amount' => round((float) $transaction->gross_amount, 2),
            'advance_deduction_amount' => round((float) $transaction->advance_deduction_amount, 2),
            'net_amount' => round((float) $transaction->net_amount, 2),
            'payment_method' => $transaction->payment_method,
            'source_account' => $transaction->source_account,
            'payroll_month' => optional($transaction->payroll_month)->toDateString(),
            'reference' => $transaction->reference,
            'note' => $transaction->note,
            'paid_at' => optional($transaction->paid_at)->toDateTimeString(),
            'cash_movement_id' => $transaction->cash_movement_id,
            'created_by_name' => $transaction->createdBy?->name,
            'created_at' => optional($transaction->created_at)->toDateTimeString(),
        ];
    }

    private function treasuryBalances(): array
    {
        $accounts = array_fill_keys(CashMovement::treasuryAccounts(), 0.0);

        $rows = CashMovement::query()
            ->where('status', 'approved')
            ->select(['amount', 'source_account', 'destination_account'])
            ->get();

        foreach ($rows as $row) {
            $amount = round((float) ($row->amount ?? 0), 2);
            $sourceAccount = (string) ($row->source_account ?? '');
            $destinationAccount = (string) ($row->destination_account ?? '');

            if ($sourceAccount !== '' && array_key_exists($sourceAccount, $accounts)) {
                $accounts[$sourceAccount] -= $amount;
            }

            if ($destinationAccount !== '' && array_key_exists($destinationAccount, $accounts)) {
                $accounts[$destinationAccount] += $amount;
            }
        }

        return array_map(fn ($value) => round((float) $value, 2), $accounts);
    }
}
