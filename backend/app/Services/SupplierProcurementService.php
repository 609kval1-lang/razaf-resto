<?php

namespace App\Services;

use App\Models\RawMaterial;
use App\Models\RawMaterialPriceHistory;
use App\Models\Supplier;
use App\Models\SupplierPurchase;
use App\Support\Ariary;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
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
     *   update_reference_cost?: bool,
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
        if (abs($quantity - $normalizedQuantity) > 0.000000001) {
            throw ValidationException::withMessages([
                'quantity' => ['La quantite d\'achat doit avoir au maximum trois decimales.'],
            ]);
        }
        if ($normalizedQuantity <= 0) {
            throw ValidationException::withMessages([
                'quantity' => ['La quantité doit être supérieure à 0.'],
            ]);
        }

        $normalizedUnitPrice = Ariary::requireWhole($unitPrice, 'unit_price');
        if ($normalizedUnitPrice < 0) {
            throw ValidationException::withMessages([
                'unit_price' => ['Le prix unitaire doit être positif.'],
            ]);
        }

        $totalAmount = Ariary::round($normalizedQuantity * $normalizedUnitPrice);
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
        $initialPaidAmount = Ariary::requireWhole($initialPaidAmount, 'initial_paid_amount');
        if ($initialPaidAmount < 0 || $initialPaidAmount > $totalAmount) {
            throw ValidationException::withMessages([
                'initial_paid_amount' => ['Le paiement initial doit etre compris entre 0 et le total de l\'achat.'],
            ]);
        }

        $remainingAmount = $totalAmount - $initialPaidAmount;
        $paymentMode = $remainingAmount > 0 ? 'credit' : 'cash';
        $paymentStatus = $this->resolvePurchaseStatus($remainingAmount, $totalAmount);
        $purchasedAt = $options['purchased_at'] ?? now()->toDateTimeString();
        $dueDate = $paymentMode === 'credit' ? ($options['due_date'] ?? null) : null;

        if ($paymentMode === 'credit' && empty($dueDate)) {
            throw ValidationException::withMessages([
                'due_date' => ['Une echeance est obligatoire tant que cet achat fournisseur n\'est pas totalement regle.'],
            ]);
        }

        $applyStockMovement = !array_key_exists('apply_stock_movement', $options)
            || (bool) $options['apply_stock_movement'] !== false;
        $updateReferenceCost = (bool) ($options['update_reference_cost'] ?? false);

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
            $applyStockMovement,
            $updateReferenceCost
        ) {
            $supplier->rawMaterials()->syncWithoutDetaching([(int) $rawMaterial->id]);

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

            if ($applyStockMovement || $updateReferenceCost) {
                $lockedRawMaterial = RawMaterial::query()
                    ->where('id', (int) $rawMaterial->id)
                    ->lockForUpdate()
                    ->firstOrFail();

                if ($applyStockMovement) {
                    $lockedRawMaterial->stock = round(
                        ((float) $lockedRawMaterial->stock) + $normalizedQuantity,
                        RawMaterial::STOCK_DECIMAL_PLACES
                    );
                }

                $previousCost = (float) $lockedRawMaterial->cost;
                if ($updateReferenceCost) {
                    $lockedRawMaterial->cost = $normalizedUnitPrice;
                }
                $lockedRawMaterial->save();

                if ($updateReferenceCost && abs($normalizedUnitPrice - $previousCost) >= 0.01
                    && Schema::hasTable('raw_material_price_histories')) {
                    $variationPercent = $previousCost > 0
                        ? (($normalizedUnitPrice - $previousCost) / $previousCost) * 100
                        : 100.0;
                    RawMaterialPriceHistory::query()->create([
                        'raw_material_id' => (int) $lockedRawMaterial->id,
                        'changed_by_user_id' => isset($options['actor_user_id']) ? (int) $options['actor_user_id'] : null,
                        'previous_cost' => round($previousCost, 2),
                        'new_cost' => round($normalizedUnitPrice, 2),
                        'variation_amount' => round($normalizedUnitPrice - $previousCost, 2),
                        'variation_percent' => round($variationPercent, 2),
                        'changed_at' => now(),
                    ]);
                }

                app(InventoryService::class)->syncIngredientsForRawMaterial($lockedRawMaterial->fresh());
            }

            return $purchase;
        });

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
