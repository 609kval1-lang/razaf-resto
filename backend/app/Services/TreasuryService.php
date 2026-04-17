<?php

namespace App\Services;

use App\Models\CashMovement;
use App\Models\Supplier;
use App\Models\SupplierPurchase;
use App\Models\SupplierPurchasePayment;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class TreasuryService
{
    public function resolveOutgoingSourceAccount(string $paymentMethod, ?string $cashSourceAccount = null): string
    {
        $normalizedMethod = $this->normalizePaymentMethod($paymentMethod);

        return match ($normalizedMethod) {
            'transfer', 'check' => CashMovement::ACCOUNT_BANK,
            'mobile_money' => CashMovement::ACCOUNT_MOBILE_MONEY,
            'cash' => $this->normalizeCashSourceAccount($cashSourceAccount) ?? CashMovement::ACCOUNT_CASH,
            default => throw ValidationException::withMessages([
                'method' => ['Mode de paiement fournisseur invalide.'],
            ]),
        };
    }

    public function resolveSupplierPaymentSourceAccount(string $paymentMethod, ?string $cashSourceAccount = null): string
    {
        return $this->resolveOutgoingSourceAccount($paymentMethod, $cashSourceAccount);
    }

    public function recordSupplierPaymentOutflow(
        SupplierPurchase $purchase,
        SupplierPurchasePayment $payment,
        Supplier $supplier,
        float $amount,
        string $paymentMethod,
        ?string $cashSourceAccount = null,
        ?int $actorId = null
    ): CashMovement {
        $normalizedAmount = round($amount, 2);
        if ($normalizedAmount <= 0) {
            throw ValidationException::withMessages([
                'amount' => ['Le montant du paiement fournisseur doit etre superieur a 0.'],
            ]);
        }

        $normalizedMethod = $this->normalizePaymentMethod($paymentMethod);
        $sourceAccount = $this->resolveSupplierPaymentSourceAccount($normalizedMethod, $cashSourceAccount);
        $available = $this->accountAvailableAmount($sourceAccount, true);
        $accountLabels = CashMovement::treasuryAccountLabels();
        $accountLabel = $accountLabels[$sourceAccount] ?? $sourceAccount;

        if ($normalizedAmount > $available) {
            throw ValidationException::withMessages([
                'amount' => ["Le montant depasse le solde disponible du compte {$accountLabel}."],
            ]);
        }

        $description = trim(implode(' · ', array_filter([
            $supplier->name ? "Fournisseur {$supplier->name}" : 'Paiement fournisseur',
            "Achat #{$purchase->id}",
        ])));

        return CashMovement::query()->create([
            'direction' => 'out',
            'status' => 'approved',
            'movement_type' => 'withdrawal',
            'flow_type' => 'supplier_payment',
            'amount' => $normalizedAmount,
            'payment_method' => $normalizedMethod,
            'source_account' => $sourceAccount,
            'destination_account' => null,
            'description' => $description,
            'reason' => 'Paiement fournisseur',
            'requested_by_user_id' => $actorId,
            'approved_by_user_id' => $actorId,
            'approved_at' => $payment->paid_at ? Carbon::parse($payment->paid_at) : now(),
            'supplier_purchase_id' => (int) $purchase->id,
            'supplier_purchase_payment_id' => (int) $payment->id,
            'metadata' => [
                'source' => 'supplier_payment',
                'reason_label' => 'Paiement fournisseur',
                'beneficiary_name' => $supplier->name ?: null,
                'supplier_id' => (int) $supplier->id,
                'supplier_purchase_id' => (int) $purchase->id,
                'supplier_purchase_payment_id' => (int) $payment->id,
                'raw_material_id' => (int) ($purchase->raw_material_id ?? 0),
                'reference' => $payment->reference ?: null,
                'note' => $payment->note ?: null,
                'paid_at' => optional($payment->paid_at)->toDateTimeString(),
            ],
        ]);
    }

    private function normalizePaymentMethod(string $paymentMethod): string
    {
        $normalized = strtolower(trim($paymentMethod));

        return $normalized === 'card' ? 'mobile_money' : $normalized;
    }

    private function normalizeCashSourceAccount(?string $account): ?string
    {
        $normalized = strtolower(trim((string) $account));

        return in_array($normalized, [CashMovement::ACCOUNT_CASH, CashMovement::ACCOUNT_SAFE], true)
            ? $normalized
            : null;
    }

    private function accountAvailableAmount(string $account, bool $lockForUpdate = false): float
    {
        $balances = $this->accountBalances($lockForUpdate);

        return round((float) ($balances[$account] ?? 0), 2);
    }

    private function accountBalances(bool $lockForUpdate = false): array
    {
        $accounts = array_fill_keys(CashMovement::treasuryAccounts(), 0.0);

        $query = CashMovement::query()
            ->where('status', 'approved')
            ->select(['amount', 'source_account', 'destination_account']);

        $rows = $lockForUpdate
            ? $query->lockForUpdate()->get()
            : $query->get();

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
