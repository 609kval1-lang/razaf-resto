<?php

namespace App\Http\Controllers;

use App\Models\CashMovement;
use App\Models\Supplier;
use App\Models\SupplierPurchase;
use App\Models\RawMaterial;
use App\Services\SupplierProcurementService;
use App\Services\TreasuryService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class SupplierController extends Controller
{
    private const RAW_MATERIAL_ALLOWED_UNITS = [
        'kg', 'kilogramme', 'kilogrammes',
        'g', 'gr', 'gramme', 'grammes', 'mg',
        'L', 'l', 'litre', 'litres', 'cl', 'ml',
        'pièce', 'pièces', 'piece', 'pieces', 'pcs', 'pc',
        'unité', 'unités', 'unite', 'unites', 'u',
    ];

    public function index()
    {
        $this->authorize('viewAny', Supplier::class);

        $suppliers = Supplier::query()
            ->with([
                'rawMaterial:id,name,unit,stock',
                'rawMaterials:id,name,unit,stock',
            ])
            ->withSum([
                'purchases as outstanding_amount' => function ($query) {
                    $query->where('remaining_amount', '>', 0);
                },
            ], 'remaining_amount')
            ->withCount([
                'rawMaterials as raw_materials_count',
                'purchases as unpaid_purchases_count' => function ($query) {
                    $query->where('remaining_amount', '>', 0);
                },
                'purchases as overdue_purchases_count' => function ($query) {
                    $query
                        ->where('remaining_amount', '>', 0)
                        ->whereDate('due_date', '<', now()->toDateString());
                },
            ])
            ->orderByDesc('id')
            ->get()
            ->map(fn (Supplier $supplier) => $this->formatSupplierForResponse($supplier))
            ->values();

        return response()->json($suppliers);
    }

    public function create()
    {
        $this->authorize('create', Supplier::class);

        return response()->json(['message' => 'Formulaire de creation fournisseur']);
    }

    public function store(Request $request)
    {
        $this->authorize('create', Supplier::class);

        $validated = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['nullable', 'email', 'max:255', 'unique:suppliers,email'],
            'phone' => ['nullable', 'string', 'max:30'],
            'raw_material_id' => ['nullable', 'exists:raw_materials,id'],
            'raw_material_ids' => ['nullable', 'array', 'min:1'],
            'raw_material_ids.*' => ['required', 'integer', 'exists:raw_materials,id'],
            'new_raw_materials' => ['nullable', 'array', 'min:1'],
            'new_raw_materials.*.name' => ['required_with:new_raw_materials', 'string', 'max:255'],
            'new_raw_materials.*.description' => ['nullable', 'string', 'max:1000'],
            'new_raw_materials.*.stock' => ['required_with:new_raw_materials', 'numeric', 'min:0'],
            'new_raw_materials.*.unit' => ['required_with:new_raw_materials', 'string', Rule::in(self::RAW_MATERIAL_ALLOWED_UNITS)],
            'new_raw_materials.*.cost' => ['required_with:new_raw_materials', 'numeric', 'min:0.01'],
            'new_raw_materials.*.reorder_level' => ['nullable', 'numeric', 'min:0'],
        ]);

        $rawMaterialIds = $this->normalizeRawMaterialIds($validated);
        $newRawMaterials = is_array($validated['new_raw_materials'] ?? null) ? $validated['new_raw_materials'] : [];

        if (empty($rawMaterialIds) && empty($newRawMaterials)) {
            throw ValidationException::withMessages([
                'raw_material_ids' => ['Selectionnez ou creez au moins une matiere premiere.'],
            ]);
        }

        $supplier = DB::transaction(function () use ($validated, $rawMaterialIds, $newRawMaterials) {
            $supplier = Supplier::create([
                'name' => $validated['name'],
                'email' => $validated['email'] ?? null,
                'phone' => $validated['phone'] ?? null,
            ]);

            $createdRawMaterialIds = $this->createRawMaterialsFromPayload($newRawMaterials, $supplier);
            $linkedRawMaterialIds = collect($rawMaterialIds)
                ->merge($createdRawMaterialIds)
                ->map(fn ($id) => (int) $id)
                ->filter(fn ($id) => $id > 0)
                ->unique()
                ->values()
                ->all();

            if (empty($linkedRawMaterialIds)) {
                throw ValidationException::withMessages([
                    'raw_material_ids' => ['Selectionnez ou creez au moins une matiere premiere.'],
                ]);
            }

            $supplier->raw_material_id = $linkedRawMaterialIds[0] ?? null;
            $supplier->save();
            $supplier->rawMaterials()->sync($linkedRawMaterialIds);

            return $supplier;
        });

        $supplier = $this->loadSupplierDetails($supplier);

        return response()->json([
            'message' => 'Fournisseur cree avec succes',
            'supplier' => $supplier,
            'purchase_warnings' => [],
        ], 201);
    }

    public function show(Supplier $supplier)
    {
        $this->authorize('view', $supplier);

        return response()->json($this->loadSupplierDetails($supplier));
    }

    public function edit(Supplier $supplier)
    {
        $this->authorize('update', $supplier);

        return response()->json($this->loadSupplierDetails($supplier));
    }

    public function update(Request $request, Supplier $supplier)
    {
        $this->authorize('update', $supplier);

        $validated = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'email' => ['nullable', 'email', 'max:255', Rule::unique('suppliers', 'email')->ignore($supplier->id)],
            'phone' => ['nullable', 'string', 'max:30'],
            'raw_material_id' => ['nullable', 'exists:raw_materials,id'],
            'raw_material_ids' => ['nullable', 'array', 'min:1'],
            'raw_material_ids.*' => ['required', 'integer', 'exists:raw_materials,id'],
            'new_raw_materials' => ['nullable', 'array', 'min:1'],
            'new_raw_materials.*.name' => ['required_with:new_raw_materials', 'string', 'max:255'],
            'new_raw_materials.*.description' => ['nullable', 'string', 'max:1000'],
            'new_raw_materials.*.stock' => ['required_with:new_raw_materials', 'numeric', 'min:0'],
            'new_raw_materials.*.unit' => ['required_with:new_raw_materials', 'string', Rule::in(self::RAW_MATERIAL_ALLOWED_UNITS)],
            'new_raw_materials.*.cost' => ['required_with:new_raw_materials', 'numeric', 'min:0.01'],
            'new_raw_materials.*.reorder_level' => ['nullable', 'numeric', 'min:0'],
        ]);

        $rawMaterialIds = $this->normalizeRawMaterialIds($validated);
        $newRawMaterials = is_array($validated['new_raw_materials'] ?? null) ? $validated['new_raw_materials'] : [];
        $shouldSyncMaterials = array_key_exists('raw_material_id', $validated)
            || array_key_exists('raw_material_ids', $validated)
            || !empty($newRawMaterials);

        DB::transaction(function () use ($supplier, $validated, $rawMaterialIds, $newRawMaterials, $shouldSyncMaterials) {
            $payload = collect($validated)
                ->only(['name', 'email', 'phone'])
                ->toArray();

            $createdRawMaterialIds = $this->createRawMaterialsFromPayload($newRawMaterials, $supplier);
            $linkedRawMaterialIds = collect($rawMaterialIds)
                ->merge($createdRawMaterialIds)
                ->map(fn ($id) => (int) $id)
                ->filter(fn ($id) => $id > 0)
                ->unique()
                ->values()
                ->all();

            if ($shouldSyncMaterials && empty($linkedRawMaterialIds)) {
                throw ValidationException::withMessages([
                    'raw_material_ids' => ['Selectionnez ou creez au moins une matiere premiere.'],
                ]);
            }

            if ($shouldSyncMaterials) {
                $payload['raw_material_id'] = $linkedRawMaterialIds[0] ?? null;
            }

            $supplier->update($payload);

            if ($shouldSyncMaterials) {
                $supplier->rawMaterials()->sync($linkedRawMaterialIds);
            }
        });

        $supplier = $this->loadSupplierDetails($supplier);

        return response()->json([
            'message' => 'Fournisseur modifie avec succes',
            'supplier' => $supplier,
            'purchase_warnings' => [],
        ]);
    }

    public function destroy(Supplier $supplier)
    {
        $this->authorize('delete', $supplier);

        $supplier->delete();

        return response()->json([
            'message' => 'Fournisseur supprime avec succes',
        ]);
    }

    public function getPayablesAlerts()
    {
        $this->authorize('viewAny', Supplier::class);

        $today = now()->toDateString();
        $dueSoonDate = now()->addDays(3)->toDateString();

        $purchases = SupplierPurchase::query()
            ->with([
                'supplier:id,name',
                'rawMaterial:id,name,unit',
            ])
            ->where('remaining_amount', '>', 0)
            ->orderByRaw('CASE WHEN due_date IS NULL THEN 1 ELSE 0 END')
            ->orderBy('due_date')
            ->orderByDesc('remaining_amount')
            ->get();

        $alerts = $purchases->map(function (SupplierPurchase $purchase) use ($today, $dueSoonDate) {
            $dueDate = $purchase->due_date?->toDateString();
            $isOverdue = $dueDate && $dueDate < $today;
            $isDueSoon = $dueDate && $dueDate >= $today && $dueDate <= $dueSoonDate;

            return [
                'purchase_id' => $purchase->id,
                'supplier_id' => $purchase->supplier_id,
                'supplier_name' => (string) ($purchase->supplier?->name ?? 'Fournisseur inconnu'),
                'raw_material_name' => (string) ($purchase->rawMaterial?->name ?? "Matiere #{$purchase->raw_material_id}"),
                'remaining_amount' => round((float) $purchase->remaining_amount, 2),
                'due_date' => $purchase->due_date?->toDateString(),
                'purchased_at' => $purchase->purchased_at?->toDateTimeString(),
                'severity' => $isOverdue ? 'low' : ($isDueSoon ? 'warning' : 'warning'),
                'is_overdue' => $isOverdue,
            ];
        })->values();

        $summary = [
            'total_outstanding' => round((float) $purchases->sum('remaining_amount'), 2),
            'suppliers_with_balance' => (int) $purchases->pluck('supplier_id')->unique()->count(),
            'unpaid_purchases_count' => (int) $purchases->count(),
            'overdue_purchases_count' => (int) $alerts->where('is_overdue', true)->count(),
        ];

        return response()->json([
            'summary' => $summary,
            'alerts' => $alerts,
        ]);
    }

    public function getLedger(Supplier $supplier)
    {
        $this->authorize('view', $supplier);

        $supplier = $this->loadSupplierDetails($supplier);
        $today = now()->toDateString();

        $purchases = $supplier->purchases()
            ->with([
                'rawMaterial:id,name,unit',
                'payments:id,supplier_purchase_id,amount,method,source_account,reference,note,paid_at,created_at',
            ])
            ->orderByDesc('purchased_at')
            ->orderByDesc('id')
            ->get();

        $summary = [
            'purchases_count' => (int) $purchases->count(),
            'total_purchased' => round((float) $purchases->sum('total_amount'), 2),
            'total_paid' => round((float) $purchases->sum('paid_amount'), 2),
            'total_remaining' => round((float) $purchases->sum('remaining_amount'), 2),
            'unpaid_purchases_count' => (int) $purchases->where('remaining_amount', '>', 0)->count(),
            'overdue_purchases_count' => (int) $purchases
                ->filter(function (SupplierPurchase $purchase) use ($today) {
                    return (float) $purchase->remaining_amount > 0
                        && $purchase->due_date?->toDateString()
                        && $purchase->due_date->toDateString() < $today;
                })
                ->count(),
        ];

        return response()->json([
            'supplier' => $supplier,
            'summary' => $summary,
            'purchases' => $purchases,
        ]);
    }

    public function storePurchase(Request $request, Supplier $supplier)
    {
        $this->authorize('update', $supplier);

        $validated = $request->validate([
            'raw_material_id' => ['required', 'integer', 'exists:raw_materials,id'],
            'quantity' => ['required', 'numeric', 'min:0.001'],
            'unit_price' => ['required', 'numeric', 'min:0'],
            'payment_mode' => ['required', 'in:cash,credit'],
            'initial_paid_amount' => ['nullable', 'numeric', 'min:0'],
            'payment_method' => ['nullable', 'in:cash,mobile_money,card,transfer,check'],
            'cash_source_account' => ['nullable', Rule::in([CashMovement::ACCOUNT_CASH, CashMovement::ACCOUNT_SAFE])],
            'reference' => ['nullable', 'string', 'max:120'],
            'note' => ['nullable', 'string', 'max:1000'],
            'purchased_at' => ['nullable', 'date'],
            'due_date' => ['nullable', 'date'],
        ]);

        $rawMaterial = RawMaterial::query()->findOrFail((int) $validated['raw_material_id']);
        $purchase = app(SupplierProcurementService::class)->registerPurchase(
            $supplier,
            $rawMaterial,
            (float) $validated['quantity'],
            (float) $validated['unit_price'],
            [
                'payment_mode' => (string) $validated['payment_mode'],
                'initial_paid_amount' => $validated['initial_paid_amount'] ?? null,
                'payment_method' => isset($validated['payment_method'])
                    ? $this->normalizePaymentMethod((string) $validated['payment_method'])
                    : null,
                'cash_source_account' => $validated['cash_source_account'] ?? null,
                'reference' => $validated['reference'] ?? null,
                'note' => $validated['note'] ?? null,
                'purchased_at' => $validated['purchased_at'] ?? null,
                'due_date' => $validated['due_date'] ?? null,
                'actor_user_id' => (int) $request->user()->id,
            ]
        );

        $purchase->load([
            'rawMaterial:id,name,unit',
            'payments:id,supplier_purchase_id,amount,method,source_account,reference,note,paid_at,created_at',
        ]);

        return response()->json([
            'message' => 'Achat fournisseur enregistré avec succès.',
            'purchase' => $purchase,
        ], 201);
    }

    public function addPurchasePayment(Request $request, Supplier $supplier, SupplierPurchase $purchase)
    {
        $this->authorize('update', $supplier);

        if ((int) $purchase->supplier_id !== (int) $supplier->id) {
            return response()->json(['error' => 'Achat fournisseur invalide pour ce fournisseur.'], 404);
        }

        $validated = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.01'],
            'method' => ['required', 'in:cash,mobile_money,card,transfer,check'],
            'cash_source_account' => ['nullable', Rule::in([CashMovement::ACCOUNT_CASH, CashMovement::ACCOUNT_SAFE])],
            'reference' => ['nullable', 'string', 'max:120'],
            'note' => ['nullable', 'string', 'max:1000'],
            'paid_at' => ['nullable', 'date'],
        ]);
        $normalizedMethod = $this->normalizePaymentMethod((string) $validated['method']);
        $cashSourceAccount = $validated['cash_source_account'] ?? null;

        $paymentAmount = round((float) $validated['amount'], 2);

        $updatedPurchase = DB::transaction(function () use ($purchase, $supplier, $request, $validated, $paymentAmount, $normalizedMethod, $cashSourceAccount) {
            /** @var SupplierPurchase $lockedPurchase */
            $lockedPurchase = SupplierPurchase::query()
                ->where('id', $purchase->id)
                ->lockForUpdate()
                ->firstOrFail();

            $remainingBefore = round((float) $lockedPurchase->remaining_amount, 2);
            if ($remainingBefore <= 0) {
                throw ValidationException::withMessages([
                    'amount' => ['Cet achat est déjà totalement payé.'],
                ]);
            }

            if ($paymentAmount > $remainingBefore) {
                throw ValidationException::withMessages([
                    'amount' => ['Le montant dépasse le reste à payer pour cet achat.'],
                ]);
            }

            $paymentSourceAccount = app(TreasuryService::class)->resolveSupplierPaymentSourceAccount(
                $normalizedMethod,
                $cashSourceAccount,
            );

            $payment = $lockedPurchase->payments()->create([
                'amount' => $paymentAmount,
                'method' => $normalizedMethod,
                'source_account' => $paymentSourceAccount,
                'reference' => $validated['reference'] ?? null,
                'note' => $validated['note'] ?? null,
                'paid_at' => $validated['paid_at'] ?? now()->toDateTimeString(),
            ]);

            app(TreasuryService::class)->recordSupplierPaymentOutflow(
                purchase: $lockedPurchase,
                payment: $payment,
                supplier: $supplier,
                amount: $paymentAmount,
                paymentMethod: $normalizedMethod,
                cashSourceAccount: $cashSourceAccount,
                actorId: (int) $request->user()->id,
            );

            $newPaidAmount = round(((float) $lockedPurchase->paid_amount) + $paymentAmount, 2);
            $newRemaining = round(max(0, ((float) $lockedPurchase->total_amount) - $newPaidAmount), 2);
            $lockedPurchase->paid_amount = $newPaidAmount;
            $lockedPurchase->remaining_amount = $newRemaining;
            $lockedPurchase->payment_status = $this->resolvePurchaseStatus($newRemaining, (float) $lockedPurchase->total_amount);
            $lockedPurchase->save();

            return $lockedPurchase;
        });

        $updatedPurchase->load([
            'rawMaterial:id,name,unit',
            'payments:id,supplier_purchase_id,amount,method,source_account,reference,note,paid_at,created_at',
        ]);

        return response()->json([
            'message' => 'Paiement fournisseur enregistré.',
            'purchase' => $updatedPurchase,
        ]);
    }

    public function settleAllOutstandingPurchases(Request $request, Supplier $supplier)
    {
        $this->authorize('update', $supplier);

        $validated = $request->validate([
            'method' => ['required', 'in:cash,mobile_money,card,transfer,check'],
            'cash_source_account' => ['nullable', Rule::in([CashMovement::ACCOUNT_CASH, CashMovement::ACCOUNT_SAFE])],
            'reference' => ['nullable', 'string', 'max:120'],
            'note' => ['nullable', 'string', 'max:1000'],
            'paid_at' => ['nullable', 'date'],
        ]);

        $normalizedMethod = $this->normalizePaymentMethod((string) $validated['method']);
        $cashSourceAccount = $validated['cash_source_account'] ?? null;
        $paidAt = $validated['paid_at'] ?? now()->toDateTimeString();
        $reference = $validated['reference'] ?? null;
        $note = $validated['note'] ?? null;
        $paidPurchasesCount = 0;
        $totalPaidAmount = 0.0;

        DB::transaction(function () use (
            $supplier,
            $request,
            $normalizedMethod,
            $cashSourceAccount,
            $paidAt,
            $reference,
            $note,
            &$paidPurchasesCount,
            &$totalPaidAmount
        ) {
            $lockedPurchases = SupplierPurchase::query()
                ->where('supplier_id', $supplier->id)
                ->where('remaining_amount', '>', 0)
                ->orderByRaw('CASE WHEN due_date IS NULL THEN 1 ELSE 0 END')
                ->orderBy('due_date')
                ->orderBy('purchased_at')
                ->orderBy('id')
                ->lockForUpdate()
                ->get();

            if ($lockedPurchases->isEmpty()) {
                throw ValidationException::withMessages([
                    'supplier_id' => ['Aucune dette fournisseur à régler.'],
                ]);
            }

            foreach ($lockedPurchases as $lockedPurchase) {
                $remainingBefore = round((float) $lockedPurchase->remaining_amount, 2);
                if ($remainingBefore <= 0) {
                    continue;
                }

                $paymentSourceAccount = app(TreasuryService::class)->resolveSupplierPaymentSourceAccount(
                    $normalizedMethod,
                    $cashSourceAccount,
                );

                $payment = $lockedPurchase->payments()->create([
                    'amount' => $remainingBefore,
                    'method' => $normalizedMethod,
                    'source_account' => $paymentSourceAccount,
                    'reference' => $reference,
                    'note' => $note ?: 'Règlement global des dettes fournisseur.',
                    'paid_at' => $paidAt,
                ]);

                app(TreasuryService::class)->recordSupplierPaymentOutflow(
                    purchase: $lockedPurchase,
                    payment: $payment,
                    supplier: $supplier,
                    amount: $remainingBefore,
                    paymentMethod: $normalizedMethod,
                    cashSourceAccount: $cashSourceAccount,
                    actorId: (int) $request->user()->id,
                );

                $lockedPurchase->paid_amount = round(((float) $lockedPurchase->paid_amount) + $remainingBefore, 2);
                $lockedPurchase->remaining_amount = 0;
                $lockedPurchase->payment_status = 'paid';
                $lockedPurchase->save();

                $paidPurchasesCount++;
                $totalPaidAmount = round($totalPaidAmount + $remainingBefore, 2);
            }
        });

        return response()->json([
            'message' => 'Toutes les dettes fournisseur ont été réglées.',
            'paid_purchases_count' => $paidPurchasesCount,
            'total_paid_amount' => round($totalPaidAmount, 2),
        ]);
    }

    private function normalizeRawMaterialIds(array $validated): array
    {
        return collect($validated['raw_material_ids'] ?? [])
            ->merge([($validated['raw_material_id'] ?? null)])
            ->filter(fn ($id) => $id !== null && $id !== '')
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->unique()
            ->values()
            ->all();
    }

    private function createRawMaterialsFromPayload(array $newRawMaterials, Supplier $supplier): array
    {
        $createdIds = [];

        foreach ($newRawMaterials as $materialPayload) {
            $name = trim((string) ($materialPayload['name'] ?? ''));
            if ($name === '') {
                continue;
            }

            $description = isset($materialPayload['description'])
                ? trim((string) $materialPayload['description'])
                : null;
            $stock = max(0, (float) ($materialPayload['stock'] ?? 0));
            $unit = $this->canonicalizeUnit((string) ($materialPayload['unit'] ?? ''));
            $cost = max(0, (float) ($materialPayload['cost'] ?? 0));
            $hasReorderLevel = array_key_exists('reorder_level', $materialPayload) && $materialPayload['reorder_level'] !== null && $materialPayload['reorder_level'] !== '';

            $rawMaterialPayload = [
                'name' => $name,
                'description' => $description !== '' ? $description : null,
                'stock' => $stock,
                'unit' => $unit,
                'cost' => $cost,
            ];

            if ($hasReorderLevel) {
                $rawMaterialPayload['reorder_level'] = (float) $materialPayload['reorder_level'];
            }

            $material = RawMaterial::create($rawMaterialPayload);
            $supplier->rawMaterials()->syncWithoutDetaching([(int) $material->id]);

            $createdIds[] = (int) $material->id;
        }

        return $createdIds;
    }

    private function ensureSupplierMaterialPurchases(Supplier $supplier, array $rawMaterialIds): array
    {
        return [];
    }

    private function canonicalizeUnit(string $unit): string
    {
        $normalized = Str::lower(trim(Str::ascii($unit)));

        return match ($normalized) {
            'kg', 'kilogramme', 'kilogrammes' => 'kg',
            'g', 'gr', 'gramme', 'grammes' => 'g',
            'mg' => 'mg',
            'l', 'litre', 'litres' => 'L',
            'cl' => 'cl',
            'ml' => 'ml',
            'piece', 'pieces', 'pc', 'pcs' => 'pièce',
            'unite', 'unites', 'u' => 'unité',
            default => trim($unit),
        };
    }

    private function loadSupplierDetails(Supplier $supplier): Supplier
    {
        $hydrated = Supplier::query()
            ->with([
                'rawMaterial:id,name,unit,stock',
                'rawMaterials:id,name,unit,stock',
            ])
            ->withSum([
                'purchases as outstanding_amount' => function ($query) {
                    $query->where('remaining_amount', '>', 0);
                },
            ], 'remaining_amount')
            ->withCount([
                'rawMaterials as raw_materials_count',
                'purchases as unpaid_purchases_count' => function ($query) {
                    $query->where('remaining_amount', '>', 0);
                },
                'purchases as overdue_purchases_count' => function ($query) {
                    $query
                        ->where('remaining_amount', '>', 0)
                        ->whereDate('due_date', '<', now()->toDateString());
                },
            ])
            ->findOrFail($supplier->id);

        return $this->formatSupplierForResponse($hydrated);
    }

    private function formatSupplierForResponse(Supplier $supplier): Supplier
    {
        if ($supplier->relationLoaded('rawMaterials') && $supplier->rawMaterials->isEmpty() && $supplier->rawMaterial) {
            $supplier->setRelation('rawMaterials', collect([$supplier->rawMaterial]));
        }

        $supplier->outstanding_amount = round((float) ($supplier->outstanding_amount ?? 0), 2);
        $supplier->raw_materials_count = max(
            (int) ($supplier->raw_materials_count ?? 0),
            (int) ($supplier->rawMaterials?->count() ?? 0)
        );
        $supplier->unpaid_purchases_count = (int) ($supplier->unpaid_purchases_count ?? 0);
        $supplier->overdue_purchases_count = (int) ($supplier->overdue_purchases_count ?? 0);

        return $supplier;
    }

    private function normalizePaymentMethod(string $method): string
    {
        return $method === 'card' ? 'mobile_money' : $method;
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
