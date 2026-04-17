<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CashMovement extends Model
{
    public const ACCOUNT_CASH = 'cash';
    public const ACCOUNT_SAFE = 'safe';
    public const ACCOUNT_BANK = 'bank';
    public const ACCOUNT_MOBILE_MONEY = 'mobile_money';

    protected $fillable = [
        'direction',
        'status',
        'movement_type',
        'flow_type',
        'amount',
        'payment_method',
        'source_account',
        'destination_account',
        'description',
        'reason',
        'requested_by_user_id',
        'approved_by_user_id',
        'payment_id',
        'order_id',
        'supplier_purchase_id',
        'supplier_purchase_payment_id',
        'metadata',
        'approved_at',
        'rejected_at',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'metadata' => 'array',
        'approved_at' => 'datetime',
        'rejected_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::saving(function (CashMovement $movement) {
            $movement->applyDerivedTreasuryFields();
        });
    }

    public static function treasuryAccountLabels(): array
    {
        return [
            self::ACCOUNT_CASH => 'Caisse',
            self::ACCOUNT_SAFE => 'Coffre',
            self::ACCOUNT_BANK => 'Banque',
            self::ACCOUNT_MOBILE_MONEY => 'Mobile Money',
        ];
    }

    public static function treasuryAccounts(): array
    {
        return array_keys(self::treasuryAccountLabels());
    }

    public static function flowTypeLabels(): array
    {
        return [
            'customer_payment' => 'Encaissement client',
            'customer_voucher_settlement' => 'Encaissement bon client',
            'supplier_payment' => 'Paiement fournisseur',
            'employee_advance_payment' => 'Avance employee',
            'employee_salary_payment' => 'Paiement salaire',
            'treasury_transfer' => 'Transfert de tresorerie',
            'treasury_withdrawal' => 'Decaissement de tresorerie',
            'cash_withdrawal_request' => 'Demande sortie caisse',
            'cash_withdrawal' => 'Sortie de caisse',
        ];
    }

    public static function accountFromPaymentMethod(?string $paymentMethod): ?string
    {
        $normalized = strtolower(trim((string) $paymentMethod));

        return match ($normalized) {
            'cash' => self::ACCOUNT_CASH,
            'mobile_money', 'card' => self::ACCOUNT_MOBILE_MONEY,
            'transfer', 'check' => self::ACCOUNT_BANK,
            default => null,
        };
    }

    public function applyDerivedTreasuryFields(): void
    {
        $sourceAccount = $this->normalizeTreasuryAccount($this->source_account);
        $destinationAccount = $this->normalizeTreasuryAccount($this->destination_account);

        if (!$sourceAccount && (string) $this->direction === 'out') {
            $sourceAccount = self::ACCOUNT_CASH;
        }

        if (!$destinationAccount && (string) $this->direction === 'in') {
            $destinationAccount = self::accountFromPaymentMethod($this->payment_method) ?? self::ACCOUNT_CASH;
        }

        $this->source_account = $sourceAccount;
        $this->destination_account = $destinationAccount;
        $this->movement_type = $this->inferMovementType();
    }

    public function inferMovementType(): string
    {
        if ($this->normalizeTreasuryAccount($this->source_account) && $this->normalizeTreasuryAccount($this->destination_account)) {
            return 'transfer';
        }

        if ((string) $this->direction === 'in') {
            return 'sale';
        }

        return 'withdrawal';
    }

    private function normalizeTreasuryAccount(?string $account): ?string
    {
        $normalized = strtolower(trim((string) $account));

        return in_array($normalized, self::treasuryAccounts(), true)
            ? $normalized
            : null;
    }

    public function requestedBy()
    {
        return $this->belongsTo(User::class, 'requested_by_user_id');
    }

    public function approvedBy()
    {
        return $this->belongsTo(User::class, 'approved_by_user_id');
    }

    public function payment()
    {
        return $this->belongsTo(Payment::class);
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function supplierPurchase()
    {
        return $this->belongsTo(SupplierPurchase::class);
    }

    public function supplierPurchasePayment()
    {
        return $this->belongsTo(SupplierPurchasePayment::class);
    }
}
