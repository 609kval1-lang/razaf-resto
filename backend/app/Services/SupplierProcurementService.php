<?php

namespace App\Services;

use App\Models\RawMaterial;
use App\Models\Supplier;
use App\Models\SupplierPurchase;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class SupplierProcurementService
{
    /**
     * Enregistre un achat fournisseur et incrémente le stock matière.
     *
     * @param array{
     *   payment_mode?: string,
     *   initial_paid_amount?: float|int|string|null,
     *   payment_method?: string|null,
     *   cash_source_account?: string|null,
     *   reference?: string|null,
     *   note?: string|null,
     *   purchased_at?: string|null,
     *   due_date?: string|null,
     *   apply_stock_movement?: bool,
     *   actor_user_id?: int|null
     * } $options
     */
    public function registerPurchase(
        Supplier $supplier,
        RawMaterial $rawMaterial,
        float $quantity,
        float $unitPrice,
        array $options = []
    ): SupplierPurchase {
        $normalizedQuantity = round($quantity, 3);
        if ($normalizedQuantity <= 0) {
            throw ValidationException::withMessages([
                'quantity' => ['La quantité doit être supérieure à 0.'],
            ]);
        }

        $normalizedUnitPrice = round($unitPrice, 2);
        if ($normalizedUnitPrice < 0) {
            throw ValidationException::withMessages([
                'unit_price' => ['Le prix unitaire doit être positif.'],
            ]);
        }

        $totalAmount = round($normalizedQuantity * $normalizedUnitPrice, 2);
        if ($totalAmount <= 0) {
            throw ValidationException::withMessages([
                'unit_price' => ['Le total de l\'achat doit etre superieur a 0.'],
            ]);
        }

        $requestedPaymentMode = in_array(($options['payment_mode'] ?? 'credit'), ['cash', 'credit'], true)
            ? (string) $options['payment_mode']
            : 'credit';

        $hasExplicitInitialPaidAmount = array_key_exists('initial_paid_amount', $options)
            && $options['initial_paid_amount'] !== null
            && $options['initial_paid_amount'] !== '';

        $initialPaidAmount = $hasExplicitInitialPaidAmount
            ? (float) $options['initial_paid_amount']
            : ($requestedPaymentMode === 'cash' ? $totalAmount : 0.0);
        $initialPaidAmount = round(max(0, min($initialPaidAmount, $totalAmount)), 2);

        $remainingAmount = round($totalAmount - $initialPaidAmount, 2);
        $paymentMode = $remainingAmount > 0 ? 'credit' : 'cash';
        $paymentStatus = $this->resolvePurchaseStatus($remainingAmount, $totalAmount);
        $purchasedAt = $options['purchased_at'] ?? now()->toDateTimeString();
        $dueDate = $paymentMode === 'credit' ? ($options['due_date'] ?? null) : null;

        if ($paymentMode === 'credit' && empty($dueDate)) {
            throw ValidationException::withMessages([
                'due_date' => ['Une echeance est obligatoire tant que cet achat fournisseur n\'est pas totalement regle.'],
            ]);
        }

        $supplier->rawMaterials()->syncWithoutDetaching([(int) $rawMaterial->id]);
        $applyStockMovement = !array_key_exists('apply_stock_movement', $options)
            || (bool) $options['apply_stock_movement'] !== false;

        /** @var SupplierPurchase $purchase */
        $purchase = DB::transaction(function () use (
            $supplier,
            $rawMaterial,
            $normalizedQuantity,
            $normalizedUnitPrice,
            $totalAmount,
            $initialPaidAmount,
            $remainingAmount,
            $paymentMode,
            $paymentStatus,
            $purchasedAt,
            $dueDate,
            $options,
            $applyStockMovement
        ) {
            $purchase = $supplier->purchases()->create([
                'raw_material_id' => (int) $rawMaterial->id,
                'quantity' => $normalizedQuantity,
                'unit_price' => $normalizedUnitPrice,
                'total_amount' => $totalAmount,
                'paid_amount' => $initialPaidAmount,
                'remaining_amount' => $remainingAmount,
                'payment_mode' => $paymentMode,
                'payment_status' => $paymentStatus,
                'purchased_at' => $purchasedAt,
                'due_date' => $dueDate,
                'note' => $options['note'] ?? null,
            ]);

            if ($initialPaidAmount > 0) {
                $paymentSourceAccount = app(TreasuryService::class)->resolveSupplierPaymentSourceAccount(
                    (string) ($options['payment_method'] ?? 'cash'),
                    $options['cash_source_account'] ?? null,
                );

                $payment = $purchase->payments()->create([
                    'amount' => $initialPaidAmount,
                    'method' => $options['payment_method'] ?? 'cash',
                    'source_account' => $paymentSourceAccount,
                    'reference' => $options['reference'] ?? null,
                    'note' => $paymentMode === 'cash'
                        ? 'Paiement initial (règlement comptant).'
                        : 'Paiement initial partiel.',
                    'paid_at' => $purchasedAt,
                ]);

                app(TreasuryService::class)->recordSupplierPaymentOutflow(
                    purchase: $purchase,
                    payment: $payment,
                    supplier: $supplier,
                    amount: $initialPaidAmount,
                    paymentMethod: (string) ($options['payment_method'] ?? 'cash'),
                    cashSourceAccount: $options['cash_source_account'] ?? null,
                    actorId: isset($options['actor_user_id']) ? (int) $options['actor_user_id'] : null,
                );
            }

            if ($applyStockMovement) {
                $lockedRawMaterial = RawMaterial::query()
                    ->where('id', (int) $rawMaterial->id)
                    ->lockForUpdate()
                    ->firstOrFail();

                $lockedRawMaterial->stock = round(((float) $lockedRawMaterial->stock) + $normalizedQuantity, 3);
                $lockedRawMaterial->save();
            }

            return $purchase;
        });

        if ($applyStockMovement) {
            app(InventoryService::class)->syncIngredientsForRawMaterial($rawMaterial->fresh());
        }

        return $purchase;
    }

    private function resolvePurchaseStatus(float $remainingAmount, float $totalAmount): string
    {
        if ($remainingAmount <= 0) {
            return 'paid';
        }

        if ($remainingAmount < $totalAmount) {
            return 'partial';
        }

        return 'unpaid';
    }
}
