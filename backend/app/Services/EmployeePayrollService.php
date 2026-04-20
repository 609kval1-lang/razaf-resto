<?php

namespace App\Services;

use App\Models\CashMovement;
use App\Models\EmployeeAdvanceSettlement;
use App\Models\EmployeePayrollTransaction;
use App\Models\EmployeeSalaryProfile;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class EmployeePayrollService
{
    public function upsertSalaryProfile(User $user, array $payload): EmployeeSalaryProfile
    {
        return DB::transaction(function () use ($user, $payload) {
            /** @var EmployeeSalaryProfile $profile */
            $profile = EmployeeSalaryProfile::query()->firstOrNew([
                'user_id' => (int) $user->id,
            ]);

            $profile->fill([
                'monthly_salary' => round((float) ($payload['monthly_salary'] ?? 0), 2),
                'payment_day' => $payload['payment_day'] ?? null,
                'is_active' => array_key_exists('is_active', $payload) ? (bool) $payload['is_active'] : true,
                'notes' => $payload['notes'] ?? null,
            ]);
            $profile->save();

            return $profile->fresh();
        });
    }

    public function outstandingAdvanceAmount(User $user): float
    {
        $advanceTotal = (float) EmployeePayrollTransaction::query()
            ->where('user_id', $user->id)
            ->where('transaction_type', EmployeePayrollTransaction::TYPE_ADVANCE)
            ->sum('net_amount');

        $settledTotal = (float) EmployeeAdvanceSettlement::query()
            ->whereHas('advanceTransaction', function ($query) use ($user) {
                $query->where('user_id', $user->id);
            })
            ->sum('amount');

        return round(max(0, $advanceTotal - $settledTotal), 2);
    }

    public function outstandingAdvanceSummary(User $user): array
    {
        $advances = EmployeePayrollTransaction::query()
            ->where('user_id', $user->id)
            ->where('transaction_type', EmployeePayrollTransaction::TYPE_ADVANCE)
            ->withSum('advanceSettlements as settled_amount', 'amount')
            ->orderBy('paid_at')
            ->orderBy('id')
            ->get(['id', 'net_amount', 'paid_at', 'created_at']);

        $openAdvances = $advances->map(function (EmployeePayrollTransaction $advance) {
            $settled = round((float) ($advance->settled_amount ?? 0), 2);
            $remaining = round(max(0, (float) $advance->net_amount - $settled), 2);
            $date = $advance->paid_at?->toDateString() ?? $advance->created_at?->toDateString();

            return [
                'remaining' => $remaining,
                'date' => $date,
            ];
        })->filter(fn (array $item) => $item['remaining'] > 0)->values();

        $dates = $openAdvances
            ->pluck('date')
            ->filter()
            ->unique()
            ->values();

        return [
            'amount' => round((float) $openAdvances->sum('remaining'), 2),
            'count' => $openAdvances->count(),
            'dates' => $dates->all(),
            'oldest_date' => $dates->first(),
            'latest_date' => $dates->last(),
        ];
    }

    public function recordAdvance(User $user, array $payload, int $actorId): EmployeePayrollTransaction
    {
        $amount = round((float) ($payload['amount'] ?? 0), 2);
        if ($amount <= 0) {
            throw ValidationException::withMessages([
                'amount' => ['Le montant de l\'avance doit etre superieur a 0.'],
            ]);
        }

        $paymentMethod = (string) ($payload['payment_method'] ?? 'cash');
        $cashSourceAccount = $payload['cash_source_account'] ?? null;

        return DB::transaction(function () use ($user, $payload, $actorId, $amount, $paymentMethod, $cashSourceAccount) {
            $lockedUser = $this->lockPayrollUser($user);
            $lockedProfile = $this->lockSalaryProfile($lockedUser);

            $movement = $this->createPayrollOutflow(
                user: $lockedUser,
                actorId: $actorId,
                amount: $amount,
                paymentMethod: $paymentMethod,
                cashSourceAccount: $cashSourceAccount,
                flowType: 'employee_advance_payment',
                reason: 'Avance sur salaire',
                description: "Avance employee {$lockedUser->name}",
                note: $payload['note'] ?? null,
                reference: $payload['reference'] ?? null,
                paidAt: $payload['paid_at'] ?? null,
            );

            return EmployeePayrollTransaction::query()->create([
                'user_id' => (int) $lockedUser->id,
                'salary_profile_id' => $lockedProfile?->id,
                'transaction_type' => EmployeePayrollTransaction::TYPE_ADVANCE,
                'gross_amount' => $amount,
                'advance_deduction_amount' => 0,
                'net_amount' => $amount,
                'payment_method' => $paymentMethod,
                'source_account' => $movement->source_account,
                'reference' => $payload['reference'] ?? null,
                'note' => $payload['note'] ?? null,
                'paid_at' => $payload['paid_at'] ?? now(),
                'cash_movement_id' => (int) $movement->id,
                'created_by_user_id' => $actorId,
                'metadata' => [
                    'source' => 'employee_payroll',
                    'flow_type' => 'employee_advance_payment',
                ],
            ]);
        });
    }

    public function recordSalaryPayment(User $user, array $payload, int $actorId): EmployeePayrollTransaction
    {
        $profile = $user->salaryProfile;
        if (!$profile || (float) ($profile->monthly_salary ?? 0) <= 0) {
            throw ValidationException::withMessages([
                'user_id' => ['Configurez d\'abord le salaire mensuel de cet employe.'],
            ]);
        }

        $requestedGrossAmount = array_key_exists('gross_amount', $payload)
            ? round((float) $payload['gross_amount'], 2)
            : null;
        $grossAmount = round((float) ($requestedGrossAmount ?? $profile->monthly_salary), 2);
        if ($grossAmount <= 0) {
            throw ValidationException::withMessages([
                'gross_amount' => ['Le salaire brut doit etre superieur a 0.'],
            ]);
        }

        $payrollMonth = !empty($payload['payroll_month'])
            ? Carbon::parse((string) $payload['payroll_month'])->startOfMonth()
            : now()->startOfMonth();
        $this->validateRemainingSalaryCoverage($user, $profile, $payrollMonth, $grossAmount);

        $requestedDeduction = array_key_exists('advance_deduction_amount', $payload)
            ? round(max(0, (float) $payload['advance_deduction_amount']), 2)
            : null;
        $paymentMethod = (string) ($payload['payment_method'] ?? 'cash');
        $cashSourceAccount = $payload['cash_source_account'] ?? null;

        return DB::transaction(function () use (
            $user,
            $payload,
            $actorId,
            $requestedGrossAmount,
            $requestedDeduction,
            $paymentMethod,
            $cashSourceAccount,
            $payrollMonth
        ) {
            $lockedUser = $this->lockPayrollUser($user);
            $lockedProfile = $this->lockSalaryProfile($lockedUser);

            if (!$lockedProfile || (float) ($lockedProfile->monthly_salary ?? 0) <= 0) {
                throw ValidationException::withMessages([
                    'user_id' => ['Configurez d\'abord le salaire mensuel de cet employe.'],
                ]);
            }

            $grossAmount = round((float) ($requestedGrossAmount ?? $lockedProfile->monthly_salary), 2);
            if ($grossAmount <= 0) {
                throw ValidationException::withMessages([
                    'gross_amount' => ['Le salaire brut doit etre superieur a 0.'],
                ]);
            }

            $this->validateRemainingSalaryCoverage($lockedUser, $lockedProfile, $payrollMonth, $grossAmount);

            $outstandingAdvance = $this->outstandingAdvanceAmount($lockedUser);
            $effectiveRequestedDeduction = $requestedDeduction ?? $outstandingAdvance;
            $advanceDeductionAmount = round(min($grossAmount, $outstandingAdvance, $effectiveRequestedDeduction), 2);
            $netAmount = round(max(0, $grossAmount - $advanceDeductionAmount), 2);

            $movement = null;
            if ($netAmount > 0) {
                $movement = $this->createPayrollOutflow(
                    user: $lockedUser,
                    actorId: $actorId,
                    amount: $netAmount,
                    paymentMethod: $paymentMethod,
                    cashSourceAccount: $cashSourceAccount,
                    flowType: 'employee_salary_payment',
                    reason: 'Paiement salaire',
                    description: "Salaire employee {$lockedUser->name}",
                    note: $payload['note'] ?? null,
                    reference: $payload['reference'] ?? null,
                    paidAt: $payload['paid_at'] ?? null,
                );
            }

            /** @var EmployeePayrollTransaction $salaryTransaction */
            $salaryTransaction = EmployeePayrollTransaction::query()->create([
                'user_id' => (int) $lockedUser->id,
                'salary_profile_id' => (int) $lockedProfile->id,
                'transaction_type' => EmployeePayrollTransaction::TYPE_SALARY_PAYMENT,
                'gross_amount' => $grossAmount,
                'advance_deduction_amount' => $advanceDeductionAmount,
                'net_amount' => $netAmount,
                'payment_method' => $netAmount > 0 ? $paymentMethod : null,
                'source_account' => $movement?->source_account,
                'payroll_month' => $payrollMonth->toDateString(),
                'reference' => $payload['reference'] ?? null,
                'note' => $payload['note'] ?? null,
                'paid_at' => $payload['paid_at'] ?? now(),
                'cash_movement_id' => $movement?->id,
                'created_by_user_id' => $actorId,
                'metadata' => [
                    'source' => 'employee_payroll',
                    'flow_type' => 'employee_salary_payment',
                ],
            ]);

            if ($advanceDeductionAmount > 0) {
                $this->applyAdvanceSettlements($lockedUser, $salaryTransaction, $advanceDeductionAmount);
            }

            return $salaryTransaction->fresh();
        });
    }

    private function validateRemainingSalaryCoverage(
        User $user,
        EmployeeSalaryProfile $profile,
        Carbon $payrollMonth,
        float $grossAmount
    ): void {
        $alreadyCoveredGross = $this->coveredSalaryAmountForMonth($user, $payrollMonth);
        $remainingGrossCoverage = round(max(0, (float) $profile->monthly_salary - $alreadyCoveredGross), 2);

        if ($remainingGrossCoverage <= 0) {
            throw ValidationException::withMessages([
                'gross_amount' => ['Le salaire de ce mois est déjà entièrement couvert.'],
            ]);
        }

        if ($grossAmount > $remainingGrossCoverage) {
            throw ValidationException::withMessages([
                'gross_amount' => ["Le salaire brut dépasse le reliquat du mois ({$remainingGrossCoverage})."],
            ]);
        }
    }

    private function coveredSalaryAmountForMonth(User $user, Carbon $payrollMonth): float
    {
        return round((float) EmployeePayrollTransaction::query()
            ->where('user_id', $user->id)
            ->where('transaction_type', EmployeePayrollTransaction::TYPE_SALARY_PAYMENT)
            ->whereDate('payroll_month', $payrollMonth->toDateString())
            ->sum('gross_amount'), 2);
    }

    private function applyAdvanceSettlements(User $user, EmployeePayrollTransaction $salaryTransaction, float $targetAmount): void
    {
        $remaining = round($targetAmount, 2);
        if ($remaining <= 0) {
            return;
        }

        $advances = EmployeePayrollTransaction::query()
            ->where('user_id', $user->id)
            ->where('transaction_type', EmployeePayrollTransaction::TYPE_ADVANCE)
            ->orderBy('paid_at')
            ->orderBy('id')
            ->get();

        foreach ($advances as $advance) {
            if ($remaining <= 0) {
                break;
            }

            $alreadySettled = (float) EmployeeAdvanceSettlement::query()
                ->where('advance_transaction_id', $advance->id)
                ->sum('amount');
            $available = round(max(0, (float) $advance->net_amount - $alreadySettled), 2);

            if ($available <= 0) {
                continue;
            }

            $applied = round(min($available, $remaining), 2);

            EmployeeAdvanceSettlement::query()->create([
                'advance_transaction_id' => (int) $advance->id,
                'salary_transaction_id' => (int) $salaryTransaction->id,
                'amount' => $applied,
            ]);

            $remaining = round($remaining - $applied, 2);
        }
    }

    private function lockPayrollUser(User $user): User
    {
        /** @var User $lockedUser */
        $lockedUser = User::query()
            ->whereKey($user->id)
            ->lockForUpdate()
            ->firstOrFail();

        return $lockedUser;
    }

    private function lockSalaryProfile(User $user): ?EmployeeSalaryProfile
    {
        return EmployeeSalaryProfile::query()
            ->where('user_id', $user->id)
            ->lockForUpdate()
            ->first();
    }

    private function createPayrollOutflow(
        User $user,
        int $actorId,
        float $amount,
        string $paymentMethod,
        ?string $cashSourceAccount,
        string $flowType,
        string $reason,
        string $description,
        ?string $note,
        ?string $reference,
        ?string $paidAt
    ): CashMovement {
        $treasuryService = app(TreasuryService::class);
        $sourceAccount = $treasuryService->resolveOutgoingSourceAccount($paymentMethod, $cashSourceAccount);

        $available = DB::transaction(function () use ($sourceAccount) {
            $accounts = array_fill_keys(CashMovement::treasuryAccounts(), 0.0);

            $rows = CashMovement::query()
                ->where('status', 'approved')
                ->select(['amount', 'source_account', 'destination_account'])
                ->lockForUpdate()
                ->get();

            foreach ($rows as $row) {
                $rowAmount = round((float) ($row->amount ?? 0), 2);
                $rowSource = (string) ($row->source_account ?? '');
                $rowDestination = (string) ($row->destination_account ?? '');

                if ($rowSource !== '' && array_key_exists($rowSource, $accounts)) {
                    $accounts[$rowSource] -= $rowAmount;
                }

                if ($rowDestination !== '' && array_key_exists($rowDestination, $accounts)) {
                    $accounts[$rowDestination] += $rowAmount;
                }
            }

            return round((float) ($accounts[$sourceAccount] ?? 0), 2);
        });

        if ($amount > $available) {
            $label = CashMovement::treasuryAccountLabels()[$sourceAccount] ?? $sourceAccount;
            throw ValidationException::withMessages([
                'amount' => ["Le montant depasse le solde disponible du compte {$label}."],
            ]);
        }

        return CashMovement::query()->create([
            'direction' => 'out',
            'status' => 'approved',
            'movement_type' => 'withdrawal',
            'flow_type' => $flowType,
            'amount' => $amount,
            'payment_method' => $paymentMethod,
            'source_account' => $sourceAccount,
            'description' => $description,
            'reason' => $reason,
            'requested_by_user_id' => $actorId,
            'approved_by_user_id' => $actorId,
            'approved_at' => $paidAt ? Carbon::parse($paidAt) : now(),
            'metadata' => [
                'source' => 'employee_payroll',
                'beneficiary_name' => $user->name,
                'employee_user_id' => (int) $user->id,
                'job_title' => $user->job_title,
                'note' => $note,
                'reference' => $reference,
            ],
        ]);
    }
}
