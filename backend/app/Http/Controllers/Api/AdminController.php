<?php

namespace App\Http\Controllers\Api;

use App\Models\User;
use App\Models\RestaurantTable;
use App\Models\RawMaterial;
use App\Models\RawMaterialPriceHistory;
use App\Models\Ingredient;
use App\Models\Menu;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Supplier;
use App\Services\InventoryService;
use App\Services\SupplierProcurementService;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Collection;
use Illuminate\Support\Carbon;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

class AdminController extends Controller
{
    private const RESERVATION_LOCK_MINUTES = 120;
    private const CACHE_KEY_SERVER_TABLES = 'server:snapshot:tables:v1';
    private const SYSTEM_ACCESS_ROLES = ['admin', 'kitchen', 'barman', 'cashier', 'server'];

    private const RAW_MATERIAL_ALLOWED_UNITS = [
        'kg', 'kilogramme', 'kilogrammes',
        'g', 'gr', 'gramme', 'grammes', 'mg',
        'L', 'l', 'litre', 'litres', 'cl', 'ml',
        'pièce', 'pièces', 'piece', 'pieces', 'pcs', 'pc',
        'unité', 'unités', 'unite', 'unites', 'u',
    ];
    private const INGREDIENT_ALLOWED_UNITS = self::RAW_MATERIAL_ALLOWED_UNITS;

    // ============ UTILISATEURS ============

    public function listUsers()
    {
        return response()->json(
            User::query()
                ->with(['salaryProfile:id,user_id,monthly_salary,payment_day,is_active,notes'])
                ->orderByDesc('id')
                ->get()
        );
    }

    public function createUser(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string',
            'email' => 'nullable|email|unique:users',
            'password' => 'nullable|min:6',
            'role' => 'required|in:admin,kitchen,barman,cashier,server,employee',
            'has_system_access' => 'nullable|boolean',
            'job_title' => 'nullable|string|max:120',
            'employment_status' => 'nullable|in:active,inactive',
            'monthly_salary' => 'nullable|numeric|min:0',
            'payment_day' => 'nullable|integer|min:1|max:31',
        ]);

        $hasSystemAccess = array_key_exists('has_system_access', $validated)
            ? (bool) $validated['has_system_access']
            : true;

        if ($hasSystemAccess && empty($validated['email'])) {
            throw ValidationException::withMessages([
                'email' => ['Un email est obligatoire pour un utilisateur avec acces au systeme.'],
            ]);
        }

        if ($hasSystemAccess && empty($validated['password'])) {
            throw ValidationException::withMessages([
                'password' => ['Un mot de passe est obligatoire pour un utilisateur avec acces au systeme.'],
            ]);
        }

        if ($hasSystemAccess && !in_array($validated['role'], self::SYSTEM_ACCESS_ROLES, true)) {
            throw ValidationException::withMessages([
                'role' => ['Choisissez un role avec acces ecran valide.'],
            ]);
        }

        $role = $hasSystemAccess ? $validated['role'] : 'employee';

        $resolvedJobTitle = $this->resolveUserJobTitle(
            role: $role,
            hasSystemAccess: $hasSystemAccess,
            jobTitle: $validated['job_title'] ?? null
        );

        $user = DB::transaction(function () use ($validated, $role, $hasSystemAccess, $resolvedJobTitle) {
            $user = User::create([
                'name' => $validated['name'],
                'email' => $validated['email'] ?? null,
                'password' => !empty($validated['password']) ? Hash::make($validated['password']) : null,
                'role' => $role,
                'has_system_access' => $hasSystemAccess,
                'job_title' => $resolvedJobTitle,
                'employment_status' => $validated['employment_status'] ?? 'active',
            ]);

            if (array_key_exists('monthly_salary', $validated) && $validated['monthly_salary'] !== null) {
                app(\App\Services\EmployeePayrollService::class)->upsertSalaryProfile($user, [
                    'monthly_salary' => $validated['monthly_salary'],
                    'payment_day' => $validated['payment_day'] ?? null,
                    'is_active' => ($validated['employment_status'] ?? 'active') !== 'inactive',
                ]);
            }

            return $user;
        });

        return response()->json($user->load('salaryProfile'), 201);
    }

    public function updateUser(Request $request, User $user)
    {
        $validated = $request->validate([
            'name' => 'sometimes|string',
            'email' => 'nullable|email|unique:users,email,' . $user->id,
            'password' => 'nullable|min:6',
            'role' => 'sometimes|in:admin,kitchen,barman,cashier,server,employee',
            'has_system_access' => 'nullable|boolean',
            'job_title' => 'nullable|string|max:120',
            'employment_status' => 'nullable|in:active,inactive',
            'monthly_salary' => 'nullable|numeric|min:0',
            'payment_day' => 'nullable|integer|min:1|max:31',
        ]);

        $nextHasSystemAccess = array_key_exists('has_system_access', $validated)
            ? (bool) $validated['has_system_access']
            : (bool) $user->has_system_access;
        $nextRole = $nextHasSystemAccess
            ? ($validated['role'] ?? $user->role)
            : 'employee';

        if ($nextHasSystemAccess && !in_array($nextRole, self::SYSTEM_ACCESS_ROLES, true)) {
            throw ValidationException::withMessages([
                'role' => ['Choisissez un role avec acces ecran valide.'],
            ]);
        }

        if ($nextHasSystemAccess && empty($validated['email'] ?? $user->email)) {
            throw ValidationException::withMessages([
                'email' => ['Un email est obligatoire pour un utilisateur avec acces au systeme.'],
            ]);
        }

        if ($nextHasSystemAccess && empty($validated['password']) && empty($user->password)) {
            throw ValidationException::withMessages([
                'password' => ['Definissez un mot de passe pour activer l\'acces au systeme.'],
            ]);
        }

        $validated['role'] = $nextRole;
        $validated['has_system_access'] = $nextHasSystemAccess;
        $validated['job_title'] = $this->resolveUserJobTitle(
            role: $nextRole,
            hasSystemAccess: $nextHasSystemAccess,
            jobTitle: $validated['job_title'] ?? $user->job_title
        );

        if (array_key_exists('password', $validated)) {
            $validated['password'] = !empty($validated['password'])
                ? Hash::make($validated['password'])
                : $user->password;
        }

        DB::transaction(function () use ($user, $validated) {
            $user->update(collect($validated)->except(['monthly_salary', 'payment_day'])->toArray());

            if (array_key_exists('monthly_salary', $validated) && $validated['monthly_salary'] !== null) {
                app(\App\Services\EmployeePayrollService::class)->upsertSalaryProfile($user->fresh(), [
                    'monthly_salary' => $validated['monthly_salary'],
                    'payment_day' => $validated['payment_day'] ?? $user->salaryProfile?->payment_day,
                    'is_active' => ($validated['employment_status'] ?? $user->employment_status ?? 'active') !== 'inactive',
                    'notes' => $user->salaryProfile?->notes,
                ]);
            }
        });

        return response()->json($user->fresh()->load('salaryProfile'));
    }

    private function resolveUserJobTitle(string $role, bool $hasSystemAccess, ?string $jobTitle): ?string
    {
        $normalizedJobTitle = trim((string) ($jobTitle ?? ''));
        if ($normalizedJobTitle !== '') {
            return $normalizedJobTitle;
        }

        if (!$hasSystemAccess) {
            return null;
        }

        return match ($role) {
            'admin' => 'Administrateur',
            'server' => 'Serveur',
            'kitchen' => 'Cuisine',
            'barman' => 'Bar',
            'cashier' => 'Caisse',
            default => 'Utilisateur système',
        };
    }

    public function deleteUser(User $user)
    {
        $user->delete();
        return response()->json(['message' => 'User deleted']);
    }

    // ============ TABLES ============

    public function listTables()
    {
        $activeOrderStatuses = $this->activeOrderStatuses();

        $tables = RestaurantTable::query()
            ->select([
                'id',
                'table_number',
                'capacity',
                'section',
                'status',
                'reservation_name',
                'reservation_phone',
                'reservation_at',
                'reservation_notes',
            ])
            ->withCount([
                'orders as active_orders_count' => function ($orderQuery) use ($activeOrderStatuses) {
                    $orderQuery
                        ->whereIn('status', $activeOrderStatuses)
                        ->where('occupies_table', true);
                },
            ])
            ->orderBy('table_number')
            ->get()
            ->map(function (RestaurantTable $table) {
                $hasActiveOrders = (int) ($table->active_orders_count ?? 0) > 0;
                $this->expireReservationIfNeeded($table, $hasActiveOrders);

                $rawRecordedStatus = (string) ($table->status ?? 'free');
                $recordedStatus = in_array($rawRecordedStatus, ['free', 'reserved'], true) ? $rawRecordedStatus : 'free';
                $isReserved = $recordedStatus === 'reserved';
                $reservationLocked = $isReserved && $this->isReservedTableLocked($table);

                if ($hasActiveOrders) {
                    $effectiveStatus = 'occupied';
                } elseif ($isReserved && $reservationLocked) {
                    $effectiveStatus = 'reserved';
                } else {
                    $effectiveStatus = 'free';
                }

                $reservationAt = $table->reservation_at?->copy();
                $reservationLockAt = $reservationAt
                    ? $reservationAt->copy()->subMinutes(self::RESERVATION_LOCK_MINUTES)->toDateTimeString()
                    : null;

                $tableData = $table->toArray();
                unset($tableData['active_orders_count']);

                $tableData['recorded_status'] = $recordedStatus;
                $tableData['status'] = $recordedStatus; // Statut configuré par l'admin
                $tableData['service_status'] = $effectiveStatus; // Statut opérationnel côté serveur
                $tableData['has_active_orders'] = $hasActiveOrders;
                $tableData['is_orderable_now'] = $effectiveStatus === 'free';
                $tableData['server_block_reason'] = $hasActiveOrders
                    ? 'Commande active non payée'
                    : (($isReserved && $reservationLocked) ? 'Réservation verrouillée (T-2h)' : null);
                $tableData['reservation_locked'] = $reservationLocked;
                $tableData['reservation_lock_minutes'] = self::RESERVATION_LOCK_MINUTES;
                $tableData['reservation_at'] = $reservationAt?->toDateTimeString();
                $tableData['reservation_lock_at'] = $reservationLockAt;

                return $tableData;
            })
            ->values()
            ->all();

        return response()->json($tables);
    }

    public function createTable(Request $request)
    {
        $validated = $request->validate([
            'table_number' => [
                'required',
                'integer',
                'min:1',
                Rule::unique('tables', 'table_number')->whereNull('deleted_at'),
            ],
            'capacity' => 'required|integer|min:1',
            'section' => 'string|nullable',
            'status' => 'in:free,occupied,reserved',
            'reservation_name' => 'nullable|string|max:120|required_if:status,reserved',
            'reservation_phone' => 'nullable|string|max:40',
            'reservation_at' => 'nullable|date|required_if:status,reserved',
            'reservation_notes' => 'nullable|string|max:500',
        ]);

        if (($validated['status'] ?? 'free') === 'occupied') {
            // Le statut occupé est piloté automatiquement par les commandes actives.
            $validated['status'] = 'free';
        }

        if (($validated['status'] ?? 'free') !== 'reserved') {
            $validated['reservation_name'] = null;
            $validated['reservation_phone'] = null;
            $validated['reservation_at'] = null;
            $validated['reservation_notes'] = null;
        }

        $table = RestaurantTable::create($validated);
        $this->flushServerTableCache();
        return response()->json($table, 201);
    }

    public function updateTable(Request $request, RestaurantTable $table)
    {
        $validated = $request->validate([
            'capacity' => 'integer|min:1',
            'section' => 'string|nullable',
            'status' => 'in:free,occupied,reserved',
            'reservation_name' => 'nullable|string|max:120|required_if:status,reserved',
            'reservation_phone' => 'nullable|string|max:40',
            'reservation_at' => 'nullable|date|required_if:status,reserved',
            'reservation_notes' => 'nullable|string|max:500',
        ]);

        if (($validated['status'] ?? null) === 'occupied') {
            // Le statut occupé est calculé depuis les commandes non payées.
            $validated['status'] = 'free';
        }

        if (($validated['status'] ?? null) === 'reserved' && $this->tableHasActiveOrders($table)) {
            throw ValidationException::withMessages([
                'status' => ['Impossible de réserver une table qui a déjà une commande active.'],
            ]);
        }

        if (array_key_exists('status', $validated) && $validated['status'] !== 'reserved') {
            $validated['reservation_name'] = null;
            $validated['reservation_phone'] = null;
            $validated['reservation_at'] = null;
            $validated['reservation_notes'] = null;
        }

        $table->update($validated);
        $this->flushServerTableCache();
        return response()->json($table);
    }

    public function deleteTable(RestaurantTable $table)
    {
        $table->delete();
        $this->flushServerTableCache();
        return response()->json(['message' => 'Table deleted']);
    }

    // ============ MATIÈRES PREMIÈRES ============

    public function listRawMaterials()
    {
        $materials = RawMaterial::query()
            ->with([
                'suppliers:id,name,email,phone',
                'ingredients:id,raw_material_id,name,portion_size,portion_unit,quantity_available,cost_per_portion',
            ])
            ->get();

        $this->attachDerivedPortionMetricsToRawMaterials($materials);

        return response()->json($materials);
    }

    public function getRawMaterialPriceVariations()
    {
        $rawMaterials = RawMaterial::query()
            ->select('id', 'name', 'unit', 'cost')
            ->orderBy('name')
            ->get();

        $variationData = $this->buildRawMaterialPriceVariationData($rawMaterials);

        return response()->json([
            'variations' => $variationData['variations'],
        ]);
    }

    public function createRawMaterial(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string',
            'description' => 'string|nullable',
            'stock' => 'required|numeric|min:0.001',
            'unit' => ['required', 'string', Rule::in(self::RAW_MATERIAL_ALLOWED_UNITS)],
            'cost' => 'required|numeric|min:0.01',
            'reorder_level' => 'numeric|nullable',
            'supplier_id' => ['nullable', 'integer', Rule::exists('suppliers', 'id')],
            'new_supplier' => ['nullable', 'array'],
            'new_supplier.name' => ['required_with:new_supplier', 'string', 'max:255'],
            'new_supplier.email' => ['nullable', 'email', 'max:255', Rule::unique('suppliers', 'email')],
            'new_supplier.phone' => ['nullable', 'string', 'max:30'],
            'purchase_payment_mode' => ['nullable', Rule::in(['cash', 'credit'])],
            'purchase_initial_paid_amount' => ['nullable', 'numeric', 'min:0'],
            'purchase_payment_method' => ['nullable', Rule::in(['cash', 'mobile_money', 'card', 'transfer', 'check'])],
            'purchase_cash_source_account' => ['nullable', Rule::in(['cash', 'safe'])],
            'purchase_due_date' => ['nullable', 'date'],
            'purchase_reference' => ['nullable', 'string', 'max:120'],
            'purchase_note' => ['nullable', 'string', 'max:1000'],
        ]);

        $hasExistingSupplier = !empty($validated['supplier_id']);
        $hasNewSupplier = is_array($validated['new_supplier'] ?? null);
        $validated['unit'] = $this->canonicalizeUnit((string) $validated['unit']);

        if (!$hasExistingSupplier && !$hasNewSupplier) {
            throw ValidationException::withMessages([
                'supplier' => ['Selectionnez un fournisseur existant ou creez-en un nouveau.'],
            ]);
        }

        if ($hasExistingSupplier && $hasNewSupplier) {
            throw ValidationException::withMessages([
                'supplier' => ['Choisissez soit un fournisseur existant, soit un nouveau fournisseur.'],
            ]);
        }

        $newSupplierName = trim((string) ($validated['new_supplier']['name'] ?? ''));
        if ($hasNewSupplier && $newSupplierName === '') {
            throw ValidationException::withMessages([
                'new_supplier.name' => ['Le nom du nouveau fournisseur est obligatoire.'],
            ]);
        }

        $initialStock = round((float) $validated['stock'], 3);
        $initialUnitPrice = round((float) $validated['cost'], 2);
        $requestedPaymentModeInput = (string) ($validated['purchase_payment_mode'] ?? 'credit');
        $requestedPaymentMode = in_array($requestedPaymentModeInput, ['cash', 'credit'], true)
            ? $requestedPaymentModeInput
            : 'credit';
        $initialDueDate = $validated['purchase_due_date']
            ?? ($requestedPaymentMode === 'credit' ? Carbon::now()->addDays(30)->toDateString() : null);

        $materialAttributes = collect($validated)
            ->only(['name', 'description', 'stock', 'unit', 'cost', 'reorder_level'])
            ->merge(['stock' => 0])
            ->toArray();

        $material = DB::transaction(function () use (
            $materialAttributes,
            $validated,
            $hasExistingSupplier,
            $newSupplierName,
            $initialStock,
            $initialUnitPrice,
            $requestedPaymentMode,
            $initialDueDate,
            $request
        ) {
            $material = RawMaterial::create($materialAttributes);

            if ($hasExistingSupplier) {
                $supplier = Supplier::query()->findOrFail((int) $validated['supplier_id']);
            } else {
                $supplier = Supplier::query()->create([
                    'name' => $newSupplierName,
                    'email' => isset($validated['new_supplier']['email']) ? trim((string) $validated['new_supplier']['email']) : null,
                    'phone' => isset($validated['new_supplier']['phone']) ? trim((string) $validated['new_supplier']['phone']) : null,
                    'raw_material_id' => $material->id,
                ]);
            }

            $this->linkSupplierToMaterial($material, $supplier);
            app(SupplierProcurementService::class)->registerPurchase(
                $supplier,
                $material,
                $initialStock,
                $initialUnitPrice,
                [
                    'payment_mode' => $requestedPaymentMode,
                    'initial_paid_amount' => $validated['purchase_initial_paid_amount'] ?? null,
                    'payment_method' => $validated['purchase_payment_method'] ?? 'cash',
                    'cash_source_account' => $validated['purchase_cash_source_account'] ?? null,
                    'reference' => $validated['purchase_reference'] ?? null,
                    'note' => $validated['purchase_note'] ?? 'Achat initial à la création de matière première.',
                    'due_date' => $initialDueDate,
                    'actor_user_id' => (int) optional($request->user())->id,
                ]
            );

            return $material;
        });

        $material = $material->fresh();
        app(InventoryService::class)->syncIngredientsForRawMaterial($material);
        $material->load(['suppliers:id,name,email,phone']);

        return response()->json($material, 201);
    }

    public function updateRawMaterial(Request $request, RawMaterial $rawMaterial)
    {
        $validated = $request->validate([
            'name' => 'string',
            'description' => 'string|nullable',
            'unit' => ['sometimes', 'string', Rule::in(self::RAW_MATERIAL_ALLOWED_UNITS)],
            'stock' => 'numeric',
            'cost' => 'numeric',
            'reorder_level' => 'numeric|nullable',
            'supplier_id' => ['nullable', 'integer', Rule::exists('suppliers', 'id')],
            'stock_update_mode' => ['nullable', Rule::in(['manual', 'purchase'])],
            'purchase_unit_price' => ['nullable', 'numeric', 'min:0'],
        ]);

        if (array_key_exists('unit', $validated)) {
            $validated['unit'] = $this->canonicalizeUnit((string) $validated['unit']);
        }

        $actorUserId = optional($request->user())->id;

        $rawMaterial = DB::transaction(function () use ($rawMaterial, $validated, $actorUserId) {
            $lockedRawMaterial = RawMaterial::query()
                ->where('id', $rawMaterial->id)
                ->lockForUpdate()
                ->firstOrFail();
            $previousCost = (float) $lockedRawMaterial->cost;

            $requestedStock = array_key_exists('stock', $validated)
                ? (float) $validated['stock']
                : (float) $lockedRawMaterial->stock;
            $stockDelta = round($requestedStock - (float) $lockedRawMaterial->stock, 3);
            $stockUpdateMode = (string) ($validated['stock_update_mode'] ?? ($stockDelta > 0 ? 'purchase' : 'manual'));

            $supplier = $this->resolveSupplierForMaterial(
                $lockedRawMaterial,
                isset($validated['supplier_id']) ? (int) $validated['supplier_id'] : null
            );

            if ($supplier) {
                $this->linkSupplierToMaterial($lockedRawMaterial, $supplier);
            }

            $payload = collect($validated)
                ->except(['stock_update_mode', 'purchase_unit_price', 'supplier_id'])
                ->toArray();

            if ($stockDelta > 0 && $stockUpdateMode === 'purchase') {
                unset($payload['stock']);
                $lockedRawMaterial->update($payload);

                $purchaseUnitPrice = array_key_exists('purchase_unit_price', $validated)
                    ? (float) $validated['purchase_unit_price']
                    : (array_key_exists('cost', $payload)
                        ? (float) $payload['cost']
                        : (float) $lockedRawMaterial->cost);

                $supplierForPurchase = $supplier
                    ?? $this->resolveSupplierForMaterial($lockedRawMaterial, null);

                if (!$supplierForPurchase) {
                    throw ValidationException::withMessages([
                        'supplier_id' => [
                            'Selectionnez un fournisseur pour enregistrer l\'ajout de stock comme achat.',
                        ],
                    ]);
                }

                app(SupplierProcurementService::class)->registerPurchase(
                    $supplierForPurchase,
                    $lockedRawMaterial,
                    $stockDelta,
                    $purchaseUnitPrice,
                    [
                        'payment_mode' => 'credit',
                        'initial_paid_amount' => 0,
                        'due_date' => Carbon::now()->addDays(30)->toDateString(),
                        'note' => 'Réapprovisionnement enregistré depuis la gestion des matières premières.',
                    ]
                );
            } else {
                $lockedRawMaterial->update($payload);
            }

            $updatedRawMaterial = $lockedRawMaterial->fresh();
            $newCost = (float) $updatedRawMaterial->cost;

            if (Schema::hasTable('raw_material_price_histories') && abs($newCost - $previousCost) >= 0.01) {
                $variationAmount = round($newCost - $previousCost, 2);
                $variationPercent = 0.0;

                if (abs($previousCost) > 0.00001) {
                    $variationPercent = (($newCost - $previousCost) / $previousCost) * 100;
                } elseif (abs($newCost) > 0.00001) {
                    $variationPercent = 100.0;
                }

                RawMaterialPriceHistory::query()->create([
                    'raw_material_id' => (int) $updatedRawMaterial->id,
                    'changed_by_user_id' => $actorUserId ? (int) $actorUserId : null,
                    'previous_cost' => round($previousCost, 2),
                    'new_cost' => round($newCost, 2),
                    'variation_amount' => $variationAmount,
                    'variation_percent' => round($variationPercent, 2),
                    'changed_at' => now(),
                ]);
            }

            return $updatedRawMaterial;
        });

        if (!$this->isVolumeUnit((string) $rawMaterial->unit)) {
            $rawMaterial->ingredients()->where('is_cocktail_ingredient', true)->update([
                'is_cocktail_ingredient' => false,
            ]);
        }

        app(InventoryService::class)->syncIngredientsForRawMaterial($rawMaterial);
        return response()->json($rawMaterial);
    }

    public function deleteRawMaterial(RawMaterial $rawMaterial)
    {
        $rawMaterial->delete();
        return response()->json(['message' => 'Raw material deleted']);
    }

    // ============ INGRÉDIENTS (PORTIONS) ============

    public function listIngredients(Request $request)
    {
        $ingredients = Ingredient::query()
            ->select([
                'id',
                'raw_material_id',
                'name',
                'portion_size',
                'portion_unit',
                'quantity_available',
                'cost_per_portion',
                'is_cocktail_ingredient',
                'created_at',
                'updated_at',
            ])
            ->with('rawMaterial:id,name,unit,stock,cost,reorder_level')
            ->get();

        if ($request->boolean('resync', false)) {
            $inventoryService = app(InventoryService::class);

            foreach ($ingredients as $ingredient) {
                try {
                    $inventoryService->syncIngredient($ingredient);
                } catch (InvalidArgumentException $exception) {
                    // Garder la valeur actuelle si unité invalide sur une donnée historique
                }
            }
        }

        return response()->json($ingredients->load('rawMaterial'));
    }

    public function createIngredient(Request $request)
    {
        $validated = $request->validate([
            'raw_material_id' => 'required|exists:raw_materials,id',
            'name' => 'required|string',
            'portion_size' => 'required|numeric|min:0.01',
            'portion_unit' => ['required', 'string', Rule::in(self::INGREDIENT_ALLOWED_UNITS)],
            'quantity_available' => 'integer|nullable',
            'cost_per_portion' => 'numeric|nullable',
            'is_cocktail_ingredient' => 'boolean|nullable',
        ]);
        $validated['portion_unit'] = $this->canonicalizeUnit((string) $validated['portion_unit']);

        $rawMaterial = RawMaterial::findOrFail($validated['raw_material_id']);
        $this->validateLinkedPortionUnitForRawMaterial($rawMaterial, (string) $validated['portion_unit']);

        try {
            $metrics = app(InventoryService::class)->calculateIngredientMetrics(
                $rawMaterial,
                (float) $validated['portion_size'],
                (string) $validated['portion_unit']
            );
        } catch (InvalidArgumentException $exception) {
            return response()->json(['error' => $exception->getMessage()], 422);
        }

        $ingredient = Ingredient::create([
            'raw_material_id' => $validated['raw_material_id'],
            'name' => $validated['name'],
            'portion_size' => $validated['portion_size'],
            'portion_unit' => $validated['portion_unit'],
            'quantity_available' => $metrics['quantity_available'],
            'cost_per_portion' => $metrics['cost_per_portion'],
            'is_cocktail_ingredient' => $this->resolveCocktailIngredientEligibility(
                $rawMaterial,
                (string) $validated['portion_unit'],
                (bool) ($validated['is_cocktail_ingredient'] ?? false)
            ),
        ]);

        return response()->json($ingredient->load('rawMaterial'), 201);
    }

    public function updateIngredient(Request $request, Ingredient $ingredient)
    {
        $validated = $request->validate([
            'raw_material_id' => 'exists:raw_materials,id',
            'name' => 'string',
            'portion_size' => 'numeric|min:0.01',
            'portion_unit' => ['sometimes', 'string', Rule::in(self::INGREDIENT_ALLOWED_UNITS)],
            'quantity_available' => 'integer|nullable',
            'cost_per_portion' => 'numeric|nullable',
            'is_cocktail_ingredient' => 'boolean|nullable',
        ]);
        if (array_key_exists('portion_unit', $validated)) {
            $validated['portion_unit'] = $this->canonicalizeUnit((string) $validated['portion_unit']);
        }

        $rawMaterial = RawMaterial::findOrFail($validated['raw_material_id'] ?? $ingredient->raw_material_id);
        $portionSize = (float) ($validated['portion_size'] ?? $ingredient->portion_size);
        $portionUnit = (string) ($validated['portion_unit'] ?? $ingredient->portion_unit);
        $this->validateLinkedPortionUnitForRawMaterial($rawMaterial, $portionUnit);

        try {
            $metrics = app(InventoryService::class)->calculateIngredientMetrics(
                $rawMaterial,
                $portionSize,
                $portionUnit
            );
        } catch (InvalidArgumentException $exception) {
            return response()->json(['error' => $exception->getMessage()], 422);
        }

        $ingredient->update([
            'raw_material_id' => $validated['raw_material_id'] ?? $ingredient->raw_material_id,
            'name' => $validated['name'] ?? $ingredient->name,
            'portion_size' => $portionSize,
            'portion_unit' => $portionUnit,
            'quantity_available' => $metrics['quantity_available'],
            'cost_per_portion' => $metrics['cost_per_portion'],
            'is_cocktail_ingredient' => $this->resolveCocktailIngredientEligibility(
                $rawMaterial,
                $portionUnit,
                array_key_exists('is_cocktail_ingredient', $validated)
                    ? (bool) $validated['is_cocktail_ingredient']
                    : (bool) $ingredient->is_cocktail_ingredient
            ),
        ]);

        return response()->json($ingredient->load('rawMaterial'));
    }

    public function deleteIngredient(Ingredient $ingredient)
    {
        $ingredient->delete();
        return response()->json(['message' => 'Ingredient deleted']);
    }

    // ============ MENUS ============

    public function listMenus()
    {
        return response()->json(
            Menu::query()
                ->select(['id', 'name', 'description', 'price', 'category', 'image_url', 'is_available', 'created_at', 'updated_at'])
                ->with([
                    'ingredients' => function ($query) {
                        $query->select([
                            'ingredients.id',
                            'ingredients.raw_material_id',
                            'ingredients.name',
                            'ingredients.portion_size',
                            'ingredients.portion_unit',
                            'ingredients.quantity_available',
                            'ingredients.cost_per_portion',
                        ]);
                    },
                ])
                ->get()
        );
    }

    public function getSummary()
    {
        $activeOrderStatuses = $this->activeOrderStatuses();

        return response()->json([
            'users' => User::count(),
            'tables' => RestaurantTable::count(),
            'raw_materials' => RawMaterial::count(),
            'ingredients' => Ingredient::count(),
            'menus' => Menu::count(),
            'stock_alert_count' => RawMaterial::query()
                ->where(function ($query) {
                    $query
                        ->where(function ($withThreshold) {
                            $withThreshold
                                ->whereNotNull('reorder_level')
                                ->where('reorder_level', '>', 0)
                                ->whereColumn('stock', '<=', 'reorder_level');
                        })
                        ->orWhere(function ($withoutThreshold) {
                            $withoutThreshold
                                ->where(function ($inner) {
                                    $inner
                                        ->whereNull('reorder_level')
                                        ->orWhere('reorder_level', '<=', 0);
                                })
                                ->where('stock', '<=', 0);
                        });
                })
                ->count(),
            'occupied_tables_count' => RestaurantTable::query()
                ->whereHas('orders', function ($orderQuery) use ($activeOrderStatuses) {
                    $orderQuery
                        ->whereIn('status', $activeOrderStatuses)
                        ->where('occupies_table', true);
                })
                ->count(),
        ]);
    }

    public function createMenu(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string',
            'description' => 'string|nullable',
            'price' => 'required|numeric',
            'category' => 'string|nullable',
            'image_url' => 'nullable|string|max:2048',
            'image_file' => 'nullable|image|mimes:jpeg,jpg,png,webp,gif|max:5120',
            'is_available' => 'boolean',
            'ingredients' => 'array', // [{ingredient_id, quantity_needed}]
            'ingredients.*.ingredient_id' => ['required', Rule::exists('ingredients', 'id')->whereNull('deleted_at')],
            'ingredients.*.quantity_needed' => 'required|integer|min:1',
        ]);

        $this->validateMenuIngredientAvailability($validated['ingredients'] ?? []);
        if ($this->isCocktailCategory($validated['category'] ?? null)) {
            $this->validateCocktailIngredientRules($validated['ingredients'] ?? []);
        }

        $uploadedImageUrl = $this->storeMenuImageIfUploaded($request);
        if ($uploadedImageUrl) {
            $validated['image_url'] = $uploadedImageUrl;
        }
        unset($validated['image_file']);
        $ingredientPayload = array_key_exists('ingredients', $validated) ? (array) $validated['ingredients'] : [];
        unset($validated['ingredients']);

        $menu = DB::transaction(function () use ($validated, $ingredientPayload) {
            $menu = Menu::create($validated);

            if (!empty($ingredientPayload)) {
                foreach ($ingredientPayload as $ingredient) {
                    $menu->ingredients()->attach(
                        $ingredient['ingredient_id'],
                        ['quantity_needed' => $ingredient['quantity_needed']]
                    );
                }
            }

            $menu->load([
                'ingredients' => function ($query) {
                    $query->select(
                        'ingredients.id',
                        'ingredients.raw_material_id',
                        'ingredients.name',
                        'ingredients.portion_size',
                        'ingredients.portion_unit',
                        'ingredients.cost_per_portion'
                    );
                },
            ]);

            [$baselineCatalogPrice, $baselineUnitCost, $baselineMarginPercent] = $this->resolveMenuBaselineSnapshot($menu);

            $menu->update([
                'baseline_catalog_price' => $baselineCatalogPrice,
                'baseline_unit_cost' => $baselineUnitCost,
                'baseline_margin_percent' => $baselineMarginPercent,
            ]);

            return $menu->fresh()->load('ingredients');
        });

        return response()->json($menu, 201);
    }

    public function updateMenu(Request $request, Menu $menu)
    {
        $validated = $request->validate([
            'name' => 'string',
            'description' => 'string',
            'price' => 'numeric',
            'category' => 'string|nullable',
            'image_url' => 'nullable|string|max:2048',
            'image_file' => 'nullable|image|mimes:jpeg,jpg,png,webp,gif|max:5120',
            'is_available' => 'boolean',
            'ingredients' => 'array',
            'ingredients.*.ingredient_id' => ['required_with:ingredients', Rule::exists('ingredients', 'id')->whereNull('deleted_at')],
            'ingredients.*.quantity_needed' => 'required_with:ingredients|integer|min:1',
        ]);

        if (array_key_exists('ingredients', $validated)) {
            $this->validateMenuIngredientAvailability($validated['ingredients'] ?? []);
        }

        $nextCategory = $validated['category'] ?? $menu->category;
        if ($this->isCocktailCategory($nextCategory)) {
            $cocktailIngredients = array_key_exists('ingredients', $validated)
                ? ($validated['ingredients'] ?? [])
                : $menu->ingredients()
                    ->select(['ingredients.id'])
                    ->get()
                    ->map(function ($ingredient) {
                        return [
                            'ingredient_id' => (int) $ingredient->id,
                            'quantity_needed' => (int) ($ingredient->pivot->quantity_needed ?? 0),
                        ];
                    })
                    ->all();

            $this->validateCocktailIngredientRules($cocktailIngredients);
        }

        $uploadedImageUrl = $this->storeMenuImageIfUploaded($request, (string) ($menu->image_url ?? ''));
        if ($uploadedImageUrl) {
            $validated['image_url'] = $uploadedImageUrl;
        }
        unset($validated['image_file']);

        $menu->update($validated);

        if (array_key_exists('ingredients', $validated)) {
            $menu->ingredients()->sync(
                collect($validated['ingredients'])->mapWithKeys(function ($ing) {
                    return [$ing['ingredient_id'] => ['quantity_needed' => $ing['quantity_needed']]];
                })->toArray()
            );
        }

        if (
            $menu->baseline_catalog_price === null
            || $menu->baseline_unit_cost === null
            || $menu->baseline_margin_percent === null
        ) {
            $menu->load([
                'ingredients' => function ($query) {
                    $query->select(
                        'ingredients.id',
                        'ingredients.raw_material_id',
                        'ingredients.name',
                        'ingredients.portion_size',
                        'ingredients.portion_unit',
                        'ingredients.cost_per_portion'
                    );
                },
            ]);

            [$baselineCatalogPrice, $baselineUnitCost, $baselineMarginPercent] = $this->resolveMenuBaselineSnapshot($menu);

            $menu->update([
                'baseline_catalog_price' => $baselineCatalogPrice,
                'baseline_unit_cost' => $baselineUnitCost,
                'baseline_margin_percent' => $baselineMarginPercent,
            ]);
        }

        return response()->json($menu->load('ingredients'));
    }

    public function deleteMenu(Menu $menu)
    {
        $this->deleteStoredMenuImage((string) ($menu->image_url ?? ''));
        $menu->delete();
        return response()->json(['message' => 'Menu deleted']);
    }

    private function resolveMenuBaselineSnapshot(Menu $menu): array
    {
        if (!$menu->relationLoaded('ingredients')) {
            $menu->load([
                'ingredients' => function ($query) {
                    $query->select(
                        'ingredients.id',
                        'ingredients.raw_material_id',
                        'ingredients.name',
                        'ingredients.portion_size',
                        'ingredients.portion_unit',
                        'ingredients.cost_per_portion'
                    );
                },
            ]);
        }

        $baselineCatalogPrice = round((float) ($menu->price ?? 0), 2);
        $baselineUnitCost = round((float) $menu->ingredients->sum(function ($ingredient) {
            return (float) ($ingredient->pivot->quantity_needed ?? 0) * (float) ($ingredient->cost_per_portion ?? 0);
        }), 2);

        $baselineMarginPercent = 0.0;
        if ($baselineCatalogPrice > 0) {
            $baselineMarginPercent = (($baselineCatalogPrice - $baselineUnitCost) / $baselineCatalogPrice) * 100;
        }

        return [
            $baselineCatalogPrice,
            $baselineUnitCost,
            round($baselineMarginPercent, 2),
        ];
    }

    private function storeMenuImageIfUploaded(Request $request, ?string $previousImageUrl = null): ?string
    {
        if (!$request->hasFile('image_file')) {
            return null;
        }

        $path = $request->file('image_file')->store('menu-images', 'public');
        $this->deleteStoredMenuImage($previousImageUrl);

        return rtrim($request->root(), '/') . '/api/media/public/' . ltrim($path, '/');
    }

    private function deleteStoredMenuImage(?string $imageUrl): void
    {
        $imageUrl = trim((string) $imageUrl);
        if ($imageUrl === '') {
            return;
        }

        foreach (['/api/media/public/', '/storage/'] as $pathFragment) {
            $position = strpos($imageUrl, $pathFragment);

            if ($position === false) {
                continue;
            }

            $relativePath = ltrim(substr($imageUrl, $position + strlen($pathFragment)), '/');
            if ($relativePath === '') {
                return;
            }

            Storage::disk('public')->delete($relativePath);
            return;
        }
    }

    // ============ ANALYTICS RECETTES ============

    public function getRevenueReport(Request $request)
    {
        $validated = $request->validate([
            'scope' => 'nullable|in:day,week,month,rolling_week,rolling_month',
            'user_id' => 'nullable|integer|exists:users,id',
            'top_limit' => 'nullable|integer|in:3,5,10',
        ]);

        $scope = $validated['scope'] ?? 'day';
        $userId = $validated['user_id'] ?? null;
        $topLimit = (int) ($validated['top_limit'] ?? 5);
        [$periodStart, $periodEnd] = $this->resolveReportPeriod($scope);
        $supportsPackagingPricingFields = Schema::hasColumn('orders', 'with_packaging')
            && Schema::hasColumn('orders', 'packaging_quantity')
            && Schema::hasColumn('orders', 'packaging_unit_price');

        $users = User::query()
            ->select('id', 'name', 'role')
            ->orderBy('name')
            ->get();

        $paymentsQuery = Payment::query()
            ->with('order:id,user_id,total_amount')
            ->where('status', 'completed')
            ->whereBetween(DB::raw('COALESCE(encashed_at, created_at)'), [$periodStart, $periodEnd]);

        if ($userId) {
            $paymentsQuery->whereHas('order', function ($query) use ($userId) {
                $query->where('user_id', $userId);
            });
        }

        $payments = $paymentsQuery->get();
        $orderIds = $payments->pluck('order_id')->filter()->unique()->values();

        $totalRevenueNet = (float) $payments->sum(fn ($payment) => (float) $payment->amount);
        $totalDiscount = (float) $payments->sum(fn ($payment) => (float) ($payment->discount_amount ?? 0));
        $paymentsCount = $payments->count();
        $paidOrdersCount = $orderIds->count();
        $orderGrossTotals = [];
        $orderNetTotals = [];

        foreach ($payments as $payment) {
            $paymentOrderId = (int) ($payment->order_id ?? 0);
            if ($paymentOrderId <= 0) {
                continue;
            }

            $orderNetTotals[$paymentOrderId] = ($orderNetTotals[$paymentOrderId] ?? 0.0) + (float) ($payment->amount ?? 0);

            if (!array_key_exists($paymentOrderId, $orderGrossTotals)) {
                $orderGrossTotals[$paymentOrderId] = (float) ($payment->order?->total_amount ?? 0);
            }
        }

        $packagingQuantityTotal = 0;
        $packagingRevenueGross = 0.0;
        $packagingRevenueNet = 0.0;

        if ($supportsPackagingPricingFields && $orderIds->isNotEmpty()) {
            $packagingByOrderId = [];

            $packagingRows = DB::table('orders')
                ->whereIn('id', $orderIds)
                ->select(['id', 'with_packaging', 'packaging_quantity', 'packaging_unit_price'])
                ->get();

            foreach ($packagingRows as $packagingRow) {
                $rowOrderId = (int) ($packagingRow->id ?? 0);
                $hasPackaging = (bool) ($packagingRow->with_packaging ?? false);
                $packagingQuantity = max(0, (int) ($packagingRow->packaging_quantity ?? 0));
                $packagingUnitPrice = round(max(0.0, (float) ($packagingRow->packaging_unit_price ?? 0)), 2);

                if (!$hasPackaging || $packagingQuantity <= 0 || $packagingUnitPrice <= 0) {
                    continue;
                }

                $packagingTotal = round($packagingQuantity * $packagingUnitPrice, 2);
                $packagingByOrderId[$rowOrderId] = $packagingTotal;
                $packagingQuantityTotal += $packagingQuantity;
                $packagingRevenueGross += $packagingTotal;
            }

            foreach ($packagingByOrderId as $orderId => $orderPackagingTotal) {
                $grossOrderTotal = max(0.0, (float) ($orderGrossTotals[$orderId] ?? 0));
                $netOrderTotal = max(0.0, (float) ($orderNetTotals[$orderId] ?? 0));

                if ($grossOrderTotal > 0) {
                    $discountRatio = min(1.0, $netOrderTotal / $grossOrderTotal);
                    $packagingRevenueNet += $orderPackagingTotal * $discountRatio;
                } else {
                    $packagingRevenueNet += min($orderPackagingTotal, $netOrderTotal);
                }
            }
        }

        $orderItems = OrderItem::query()
            ->with('menu:id,name,category,price')
            ->whereIn('order_id', $orderIds)
            ->get();

        $menus = Menu::query()
            ->with([
                'ingredients' => function ($query) {
                    $query->select(
                        'ingredients.id',
                        'ingredients.raw_material_id',
                        'ingredients.name',
                        'ingredients.portion_size',
                        'ingredients.portion_unit',
                        'ingredients.cost_per_portion'
                    );
                },
                'ingredients.rawMaterial:id,name,stock,unit,cost',
            ])
            ->get()
            ->keyBy('id');

        $menuStatsMap = [];
        $inventoryService = app(InventoryService::class);
        foreach ($menus as $menu) {
            $menuUnitCost = (float) $menu->ingredients->sum(function ($ingredient) use ($inventoryService) {
                return (float) ($ingredient->pivot->quantity_needed ?? 0)
                    * $this->resolveCurrentIngredientCostPerPortion($ingredient, $inventoryService);
            });

            $menuStatsMap[(int) $menu->id] = [
                'menu_id' => (int) $menu->id,
                'menu_name' => (string) $menu->name,
                'menu_category' => (string) ($menu->category ?: 'autres'),
                'current_catalog_price' => round((float) ($menu->price ?? 0), 2),
                'unit_estimated_cost' => round($menuUnitCost, 2),
                'total_quantity' => 0,
                'total_revenue' => 0,
                'total_cost' => 0,
                'total_profit' => 0,
            ];
        }

        foreach ($orderItems as $item) {
            $menuId = (int) ($item->menu_id ?? 0);
            if ($menuId <= 0) {
                continue;
            }

            if (!isset($menuStatsMap[$menuId])) {
                $menuStatsMap[$menuId] = [
                    'menu_id' => $menuId,
                    'menu_name' => $item->menu?->name ? (string) $item->menu->name : "Menu #{$menuId}",
                    'menu_category' => $item->menu?->category ? (string) $item->menu->category : 'autres',
                    'current_catalog_price' => round((float) ($item->menu?->price ?? $item->price_at_order ?? 0), 2),
                    'unit_estimated_cost' => 0.0,
                    'total_quantity' => 0,
                    'total_revenue' => 0,
                    'total_cost' => 0,
                    'total_profit' => 0,
                ];
            }

            $quantity = (int) ($item->quantity ?? 0);
            $lineRevenue = (float) ($item->price_at_order ?? 0) * $quantity;
            $lineCost = (float) ($menuStatsMap[$menuId]['unit_estimated_cost'] ?? 0) * $quantity;

            $menuStatsMap[$menuId]['total_quantity'] += $quantity;
            $menuStatsMap[$menuId]['total_revenue'] += $lineRevenue;
            $menuStatsMap[$menuId]['total_cost'] += $lineCost;
            $menuStatsMap[$menuId]['total_profit'] += ($lineRevenue - $lineCost);
        }

        $menuStats = collect($menuStatsMap)
            ->map(function ($row) {
                $profitOnCostPercent = (float) ($row['unit_estimated_cost'] ?? 0) > 0
                    ? ((((float) ($row['current_catalog_price'] ?? 0)) - ((float) ($row['unit_estimated_cost'] ?? 0))) / ((float) ($row['unit_estimated_cost'] ?? 0))) * 100
                    : 0;

                return [
                    'menu_id' => $row['menu_id'],
                    'menu_name' => $row['menu_name'],
                    'menu_category' => $row['menu_category'] ?? 'autres',
                    'current_catalog_price' => round((float) ($row['current_catalog_price'] ?? 0), 2),
                    'unit_estimated_cost' => round((float) ($row['unit_estimated_cost'] ?? 0), 2),
                    'total_quantity' => (int) $row['total_quantity'],
                    'total_revenue' => round((float) $row['total_revenue'], 2),
                    'total_cost' => round((float) $row['total_cost'], 2),
                    'total_profit' => round((float) $row['total_profit'], 2),
                    'margin_percent' => round((float) $profitOnCostPercent, 1),
                ];
            })
            ->sortBy('menu_name')
            ->values();

        $soldMenuStats = $menuStats
            ->filter(fn ($row) => (int) ($row['total_quantity'] ?? 0) > 0)
            ->values();

        $rankings = $soldMenuStats->isEmpty()
            ? [
                'most_demanded' => [],
                'least_demanded' => [],
                'most_profitable' => [],
                'least_profitable' => [],
                'highest_margin' => [],
                'lowest_margin' => [],
                'highest_revenue' => [],
                'lowest_revenue' => [],
            ]
            : [
                'most_demanded' => $this->selectRankedMenusByCategory($soldMenuStats, 'total_quantity', 'desc', $topLimit),
                'least_demanded' => $this->selectRankedMenusByCategory($menuStats, 'total_quantity', 'asc', $topLimit),
                'most_profitable' => $this->selectRankedMenusByCategory($soldMenuStats, 'total_profit', 'desc', $topLimit),
                'least_profitable' => $this->selectRankedMenusByCategory($soldMenuStats, 'total_profit', 'asc', $topLimit),
                'highest_margin' => $this->selectRankedMenusByCategory($soldMenuStats, 'margin_percent', 'desc', $topLimit),
                'lowest_margin' => $this->selectRankedMenusByCategory($soldMenuStats, 'margin_percent', 'asc', $topLimit),
                'highest_revenue' => $this->selectRankedMenusByCategory($soldMenuStats, 'total_revenue', 'desc', $topLimit),
                'lowest_revenue' => $this->selectRankedMenusByCategory($soldMenuStats, 'total_revenue', 'asc', $topLimit),
            ];

        $categorySummary = $menuStats
            ->groupBy(function ($row) {
                $category = trim((string) ($row['menu_category'] ?? 'autres'));
                return $category !== '' ? $category : 'autres';
            })
            ->map(function (Collection $group, string $category) {
                return [
                    'category' => $category,
                    'menus_count' => (int) $group->count(),
                    'menus_sold_count' => (int) $group->filter(fn ($row) => (int) ($row['total_quantity'] ?? 0) > 0)->count(),
                    'total_quantity' => (int) $group->sum('total_quantity'),
                    'total_revenue' => round((float) $group->sum('total_revenue'), 2),
                    'total_cost' => round((float) $group->sum('total_cost'), 2),
                    'total_profit' => round((float) $group->sum('total_profit'), 2),
                ];
            })
            ->sortBy('category')
            ->values()
            ->all();

        $menuPricingImpact = $this->buildMenuPricingImpact($menus->values(), $menuStats);

        $totalRevenueGross = (float) $menuStats->sum('total_revenue');
        $totalEstimatedCost = (float) $menuStats->sum('total_cost');
        $totalEstimatedProfit = (float) $menuStats->sum('total_profit');

        return response()->json([
            'filters' => [
                'scope' => $scope,
                'scope_label' => $this->scopeLabel($scope),
                'user_id' => $userId,
                'top_limit' => $topLimit,
                'from' => $periodStart->toDateTimeString(),
                'to' => $periodEnd->toDateTimeString(),
                'selected_user_name' => $userId ? optional($users->firstWhere('id', $userId))->name : 'Tous les utilisateurs',
            ],
            'summary' => [
                'total_revenue_net' => round($totalRevenueNet, 2),
                'total_discount' => round($totalDiscount, 2),
                'total_revenue_gross' => round($totalRevenueGross, 2),
                'total_estimated_cost' => round($totalEstimatedCost, 2),
                'total_estimated_profit' => round($totalEstimatedProfit, 2),
                'payments_count' => $paymentsCount,
                'paid_orders_count' => $paidOrdersCount,
                'avg_ticket_net' => $paidOrdersCount > 0 ? round($totalRevenueNet / $paidOrdersCount, 2) : 0,
                'packaging_quantity_total' => (int) $packagingQuantityTotal,
                'packaging_revenue_gross' => round($packagingRevenueGross, 2),
                'packaging_revenue_net' => round($packagingRevenueNet, 2),
            ],
            'category_summary' => $categorySummary,
            'menu_stats' => $menuStats->all(),
            'menu_pricing_impact' => $menuPricingImpact,
            'rankings' => $rankings,
            'top_demanded' => $rankings['most_demanded'],
            'top_profitable' => $rankings['most_profitable'],
            'top_grossing' => $rankings['highest_revenue'],
            'users' => $users,
        ]);
    }

    private function resolveReportPeriod(string $scope): array
    {
        $now = now();

        return match ($scope) {
            'rolling_week' => [$now->copy()->subDays(6)->startOfDay(), $now->copy()->endOfDay()],
            'rolling_month' => [$now->copy()->subDays(29)->startOfDay(), $now->copy()->endOfDay()],
            'week' => [$now->copy()->startOfWeek(), $now->copy()->endOfDay()],
            'month' => [$now->copy()->startOfMonth(), $now->copy()->endOfDay()],
            default => [$now->copy()->startOfDay(), $now->copy()->endOfDay()],
        };
    }

    private function scopeLabel(string $scope): string
    {
        return match ($scope) {
            'rolling_week' => '7 derniers jours',
            'rolling_month' => '30 derniers jours',
            'week' => 'Semaine en cours',
            'month' => 'Mois en cours',
            default => "Aujourd'hui",
        };
    }

    private function selectRankedMenusByCategory(
        Collection $menuStats,
        string $metric,
        string $direction = 'desc',
        int $limitPerCategory = 5
    ): array
    {
        $normalizedDirection = strtolower($direction) === 'asc' ? 'asc' : 'desc';

        return $menuStats
            ->groupBy(function ($row) {
                $category = trim((string) ($row['menu_category'] ?? 'autres'));
                return $category !== '' ? $category : 'autres';
            })
            ->flatMap(function (Collection $group, string $category) use ($metric, $limitPerCategory, $normalizedDirection) {
                $sorted = $group
                    ->sort(function (array $left, array $right) use ($metric, $normalizedDirection) {
                        $leftMetric = (float) ($left[$metric] ?? 0);
                        $rightMetric = (float) ($right[$metric] ?? 0);

                        if ($leftMetric === $rightMetric) {
                            return strcmp((string) ($left['menu_name'] ?? ''), (string) ($right['menu_name'] ?? ''));
                        }

                        return $normalizedDirection === 'asc'
                            ? ($leftMetric <=> $rightMetric)
                            : ($rightMetric <=> $leftMetric);
                    })
                    ->values()
                    ->take($limitPerCategory)
                    ->values();

                return $sorted->map(function ($row, int $index) use ($metric, $normalizedDirection, $category) {
                    $row['rank_in_category'] = $index + 1;
                    $row['rank_category'] = $category;
                    $row['rank_metric'] = $metric;
                    $row['rank_direction'] = $normalizedDirection;
                    return $row;
                });
            })
            ->values()
            ->all();
    }

    private function buildRawMaterialPriceVariationData(Collection $rawMaterials): array
    {
        $materialIds = $rawMaterials
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->values();

        $priceChangesByRawMaterial = collect();
        if (Schema::hasTable('raw_material_price_histories')) {
            $priceChangesByRawMaterial = RawMaterialPriceHistory::query()
                ->select([
                    'id',
                    'raw_material_id',
                    'changed_by_user_id',
                    'previous_cost',
                    'new_cost',
                    'variation_amount',
                    'variation_percent',
                    'changed_at',
                ])
                ->with('changedByUser:id,name')
                ->when(
                    $materialIds->isNotEmpty(),
                    fn ($query) => $query->whereIn('raw_material_id', $materialIds->all()),
                    fn ($query) => $query->whereRaw('1 = 0')
                )
                ->orderByDesc('changed_at')
                ->orderByDesc('id')
                ->get()
                ->groupBy(fn (RawMaterialPriceHistory $history) => (int) $history->raw_material_id);
        }

        $latestPriceMap = [];
        $trendMap = [];
        $variations = [];

        foreach ($rawMaterials as $rawMaterial) {
            $rawMaterialId = (int) $rawMaterial->id;
            /** @var Collection $history */
            $history = $priceChangesByRawMaterial->get($rawMaterialId, collect());
            $latestChange = $history->first();

            $latestUnitPrice = round((float) ($rawMaterial->cost ?? 0), 2);
            $previousUnitPrice = $latestChange
                ? round((float) ($latestChange->previous_cost ?? $latestUnitPrice), 2)
                : $latestUnitPrice;
            $variationAmount = $latestChange
                ? round((float) ($latestChange->variation_amount ?? ($latestUnitPrice - $previousUnitPrice)), 2)
                : 0.0;
            $variationPercent = $latestChange
                ? round((float) ($latestChange->variation_percent ?? 0), 2)
                : 0.0;

            $trend = abs($variationAmount) < 0.01
                ? 'stable'
                : ($variationAmount > 0 ? 'up' : 'down');

            $comparisonBasis = $latestChange
                ? 'Dernière modification de prix par admin'
                : 'Aucune modification de prix enregistrée';

            $latestPriceMap[$rawMaterialId] = round((float) ($rawMaterial->cost ?? 0), 4);
            $trendMap[$rawMaterialId] = [
                'trend' => $trend,
                'variation_amount' => $variationAmount,
                'variation_percent' => $variationPercent,
            ];

            $variations[] = [
                'raw_material_id' => $rawMaterialId,
                'raw_material_name' => (string) $rawMaterial->name,
                'unit' => (string) ($rawMaterial->unit ?? ''),
                'latest_unit_price' => $latestUnitPrice,
                'previous_unit_price' => $previousUnitPrice,
                'variation_amount' => $variationAmount,
                'variation_percent' => $variationPercent,
                'trend' => $trend,
                'latest_change_at' => $latestChange?->changed_at?->toDateTimeString(),
                'changed_by_name' => $latestChange?->changedByUser?->name,
                'changes_count' => (int) $history->count(),
                'comparison_basis' => $comparisonBasis,
            ];
        }

        usort($variations, function (array $left, array $right) {
            $leftAbsolute = abs((float) ($left['variation_percent'] ?? 0));
            $rightAbsolute = abs((float) ($right['variation_percent'] ?? 0));

            if ($leftAbsolute === $rightAbsolute) {
                return strcasecmp((string) ($left['raw_material_name'] ?? ''), (string) ($right['raw_material_name'] ?? ''));
            }

            return $rightAbsolute <=> $leftAbsolute;
        });

        return [
            'variations' => $variations,
            'latest_price_map' => $latestPriceMap,
            'trend_map' => $trendMap,
        ];
    }

    private function buildMenuPricingImpact(Collection $menus, Collection $menuStats): array
    {
        $menuStatsById = $menuStats->keyBy(fn ($row) => (int) ($row['menu_id'] ?? 0));
        $impactRows = [];

        foreach ($menus as $menu) {
            $menuId = (int) ($menu->id ?? 0);
            if ($menuId <= 0) {
                continue;
            }

            $menuStat = $menuStatsById->get($menuId, []);
            $catalogPrice = round((float) ($menu->price ?? 0), 2);
            $currentUnitCost = round((float) ($menuStat['unit_estimated_cost'] ?? 0), 2);
            $baselineUnitCost = round((float) ($menu->baseline_unit_cost ?? $currentUnitCost), 2);
            $currentProfitOnCostPercent = $currentUnitCost > 0
                ? round((($catalogPrice - $currentUnitCost) / $currentUnitCost) * 100, 2)
                : 0.0;
            $targetProfitOnCostPercent = 100.0;

            $unitCostChangeAmount = round($currentUnitCost - $baselineUnitCost, 2);
            if (abs($unitCostChangeAmount) < 0.01) {
                continue;
            }

            $suggestedCatalogPrice = $this->calculateCatalogPriceForTargetProfitOnCost(
                $currentUnitCost,
                $targetProfitOnCostPercent,
                $catalogPrice
            );

            [$action, $actionLabel] = $this->resolveProfitBasedPricingAdjustment(
                $currentProfitOnCostPercent,
                $targetProfitOnCostPercent,
                $suggestedCatalogPrice,
                $catalogPrice
            );

            $priceChangeAmount = round($suggestedCatalogPrice - $catalogPrice, 2);

            $priceChangePercent = $catalogPrice > 0
                ? round(($priceChangeAmount / $catalogPrice) * 100, 2)
                : 0.0;

            $impactRows[] = [
                'menu_id' => $menuId,
                'menu_name' => (string) ($menu->name ?? "Menu #{$menuId}"),
                'menu_category' => (string) ($menuStat['menu_category'] ?? ($menu->category ?? 'autres')),
                'current_catalog_price' => $catalogPrice,
                'suggested_catalog_price' => $suggestedCatalogPrice,
                'baseline_unit_cost' => $baselineUnitCost,
                'current_unit_cost' => $currentUnitCost,
                'current_profit_on_cost_percent' => $currentProfitOnCostPercent,
                'target_profit_on_cost_percent' => $targetProfitOnCostPercent,
                'unit_cost_change_amount' => $unitCostChangeAmount,
                'price_change_amount' => $priceChangeAmount,
                'price_change_percent' => $priceChangePercent,
                'recommended_action' => $action,
                'recommended_action_label' => $actionLabel,
            ];
        }

        usort($impactRows, function (array $left, array $right) {
            $leftAction = (string) ($left['recommended_action'] ?? '');
            $rightAction = (string) ($right['recommended_action'] ?? '');
            $actionPriority = [
                'increase' => 0,
                'decrease' => 1,
                'keep' => 2,
            ];

            if ($leftAction !== $rightAction) {
                return ($actionPriority[$leftAction] ?? 99) <=> ($actionPriority[$rightAction] ?? 99);
            }

            $leftDelta = abs((float) ($left['unit_cost_change_amount'] ?? 0));
            $rightDelta = abs((float) ($right['unit_cost_change_amount'] ?? 0));

            if ($leftDelta === $rightDelta) {
                $leftPercent = abs((float) ($left['price_change_amount'] ?? 0));
                $rightPercent = abs((float) ($right['price_change_amount'] ?? 0));

                if ($leftPercent === $rightPercent) {
                    return strcasecmp((string) ($left['menu_name'] ?? ''), (string) ($right['menu_name'] ?? ''));
                }

                return $rightPercent <=> $leftPercent;
            }

            return $rightDelta <=> $leftDelta;
        });

        return $impactRows;
    }

    private function attachDerivedPortionMetricsToRawMaterials(Collection $materials): void
    {
        $inventoryService = app(InventoryService::class);

        foreach ($materials as $material) {
            $ingredients = $material->relationLoaded('ingredients')
                ? $material->ingredients
                : collect();

            $availablePortionsTotal = 0;

            foreach ($ingredients as $ingredient) {
                try {
                    $metrics = $inventoryService->calculateIngredientMetrics(
                        $material,
                        (float) ($ingredient->portion_size ?? 0),
                        (string) ($ingredient->portion_unit ?? '')
                    );

                    $ingredient->quantity_available = $metrics['quantity_available'];
                    $ingredient->cost_per_portion = $metrics['cost_per_portion'];
                } catch (InvalidArgumentException $exception) {
                    $ingredient->quantity_available = (int) ($ingredient->quantity_available ?? 0);
                    $ingredient->cost_per_portion = round((float) ($ingredient->cost_per_portion ?? 0), 2);
                }

                $availablePortionsTotal += (int) ($ingredient->quantity_available ?? 0);
            }

            $material->available_portions_total = $availablePortionsTotal;
            $material->ingredients_count = $ingredients->count();
        }
    }

    private function resolveCurrentIngredientCostPerPortion(Ingredient $ingredient, InventoryService $inventoryService): float
    {
        $rawMaterial = $ingredient->rawMaterial;
        if (!$rawMaterial) {
            return round((float) ($ingredient->cost_per_portion ?? 0), 2);
        }

        try {
            $metrics = $inventoryService->calculateIngredientMetrics(
                $rawMaterial,
                (float) ($ingredient->portion_size ?? 0),
                (string) ($ingredient->portion_unit ?? '')
            );

            return round((float) ($metrics['cost_per_portion'] ?? 0), 2);
        } catch (InvalidArgumentException $exception) {
            return round((float) ($ingredient->cost_per_portion ?? 0), 2);
        }
    }

    private function calculateCatalogPriceForTargetProfitOnCost(
        float $unitCost,
        float $targetProfitOnCostPercent,
        float $fallbackCatalogPrice
    ): float
    {
        if ($unitCost <= 0) {
            return round(max($fallbackCatalogPrice, 0), 2);
        }

        $targetProfitRatio = max(0, $targetProfitOnCostPercent / 100);
        return round($unitCost * (1 + $targetProfitRatio), 2);
    }

    private function resolveProfitBasedPricingAdjustment(
        float $currentProfitOnCostPercent,
        float $targetProfitOnCostPercent,
        float $suggestedCatalogPrice,
        float $catalogPrice
    ): array
    {
        if (abs(round($suggestedCatalogPrice, 2) - round($catalogPrice, 2)) < 0.01) {
            return ['keep', 'Prix aligné'];
        }

        if ($currentProfitOnCostPercent < $targetProfitOnCostPercent) {
            return ['increase', 'Hausse proposée'];
        }

        if (round($suggestedCatalogPrice, 2) < round($catalogPrice, 2)) {
            return ['decrease', 'Baisse proposée'];
        }

        return ['keep', 'Prix aligné'];
    }

    private function isCocktailCategory(?string $category): bool
    {
        return $this->normalizeKeyword($category) === 'cocktail';
    }

    private function validateCocktailIngredientRules(array $ingredients): void
    {
        if (empty($ingredients)) {
            throw ValidationException::withMessages([
                'ingredients' => ['Un cocktail doit contenir au moins un ingrédient boisson.'],
            ]);
        }

        $ingredientIds = collect($ingredients)
            ->pluck('ingredient_id')
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->unique()
            ->values();

        $ingredientMap = Ingredient::query()
            ->with('rawMaterial:id,name,unit')
            ->whereIn('id', $ingredientIds)
            ->get()
            ->keyBy('id');

        $errors = [];

        foreach ($ingredients as $index => $item) {
            $ingredientId = (int) ($item['ingredient_id'] ?? 0);
            $quantityNeeded = (int) ($item['quantity_needed'] ?? 0);
            /** @var Ingredient|null $ingredient */
            $ingredient = $ingredientMap->get($ingredientId);

            if (!$ingredient) {
                continue;
            }

            $portionUnit = $this->normalizeKeyword($ingredient->portion_unit);
            $isCocktailIngredient = (bool) ($ingredient->is_cocktail_ingredient ?? false);
            $isVolumeRawMaterial = $this->isVolumeUnit((string) ($ingredient->rawMaterial?->unit ?? ''));

            if (!$isCocktailIngredient || $portionUnit !== 'ml' || !$isVolumeRawMaterial) {
                $errors["ingredients.$index.ingredient_id"] = [
                    "L'ingrédient {$ingredient->name} n'est pas valide pour un cocktail (liquide en ml requis).",
                ];
            }

            if ($quantityNeeded <= 0) {
                $errors["ingredients.$index.quantity_needed"] = [
                    "La quantité en ml doit être supérieure à 0 pour {$ingredient->name}.",
                ];
            }
        }

        if (!empty($errors)) {
            throw ValidationException::withMessages($errors);
        }
    }

    private function resolveCocktailIngredientEligibility(
        RawMaterial $rawMaterial,
        string $portionUnit,
        bool $requestedCocktailFlag
    ): bool {
        if (!$requestedCocktailFlag) {
            return false;
        }

        if (!$this->isVolumeUnit((string) $rawMaterial->unit)) {
            throw ValidationException::withMessages([
                'is_cocktail_ingredient' => [
                    "Cet ingrédient ne peut pas être cocktail: la matière première doit être liquide.",
                ],
            ]);
        }

        if ($this->normalizeKeyword($portionUnit) !== 'ml') {
            throw ValidationException::withMessages([
                'portion_unit' => [
                    "Les ingrédients cocktail doivent être définis en ml.",
                ],
            ]);
        }

        return true;
    }

    private function isVolumeUnit(string $unit): bool
    {
        return in_array($this->normalizeKeyword($unit), ['l', 'litre', 'litres', 'cl', 'ml'], true);
    }

    private function resolveLinkedPortionUnitForRawMaterial(RawMaterial $rawMaterial): string
    {
        $normalizedRawUnit = $this->normalizeKeyword((string) $rawMaterial->unit);

        if (in_array($normalizedRawUnit, ['kg', 'kilogramme', 'kilogrammes', 'g', 'gr', 'gramme', 'grammes', 'mg'], true)) {
            return 'g';
        }

        if (in_array($normalizedRawUnit, ['l', 'litre', 'litres', 'cl', 'ml'], true)) {
            return 'ml';
        }

        return 'pièce';
    }

    private function validateLinkedPortionUnitForRawMaterial(RawMaterial $rawMaterial, string $portionUnit): void
    {
        $expectedPortionUnit = $this->resolveLinkedPortionUnitForRawMaterial($rawMaterial);

        if ($this->normalizeKeyword($portionUnit) === $this->normalizeKeyword($expectedPortionUnit)) {
            return;
        }

        throw ValidationException::withMessages([
            'portion_unit' => [
                "Unité de portion invalide pour {$rawMaterial->name}: utilisez {$expectedPortionUnit} avec une matière en {$rawMaterial->unit}.",
            ],
        ]);
    }

    private function canonicalizeUnit(string $unit): string
    {
        $normalized = $this->normalizeKeyword($unit);

        return match ($normalized) {
            'kg', 'kilogramme', 'kilogrammes' => 'kg',
            'g', 'gr', 'gramme', 'grammes' => 'g',
            'mg' => 'mg',
            'l', 'litre', 'litres' => 'L',
            'cl' => 'cl',
            'ml' => 'ml',
            'piece', 'pieces', 'pièce', 'pièces', 'pcs', 'pc' => 'pièce',
            'unite', 'unites', 'unité', 'unités', 'u' => 'unité',
            default => trim($unit),
        };
    }

    private function linkSupplierToMaterial(RawMaterial $material, Supplier $supplier): void
    {
        if (empty($supplier->raw_material_id)) {
            $supplier->raw_material_id = $material->id;
            $supplier->save();
        }

        $supplier->rawMaterials()->syncWithoutDetaching([(int) $material->id]);
    }

    private function resolveSupplierForMaterial(RawMaterial $material, ?int $supplierId): ?Supplier
    {
        if ($supplierId && $supplierId > 0) {
            return Supplier::query()->findOrFail($supplierId);
        }

        return $material->suppliers()->orderBy('suppliers.id')->first();
    }

    private function normalizeKeyword(?string $value): string
    {
        $normalized = strtolower(trim((string) $value));
        return strtr($normalized, [
            'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
            'à' => 'a', 'â' => 'a',
            'î' => 'i', 'ï' => 'i',
            'ô' => 'o', 'ö' => 'o',
            'ù' => 'u', 'û' => 'u', 'ü' => 'u',
        ]);
    }

    private function validateMenuIngredientAvailability(array $ingredients): void
    {
        if (empty($ingredients)) {
            return;
        }

        $ingredientIds = collect($ingredients)
            ->pluck('ingredient_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values();

        $ingredientMap = Ingredient::query()
            ->whereIn('id', $ingredientIds)
            ->get()
            ->keyBy('id');

        $errors = [];

        foreach ($ingredients as $index => $item) {
            $ingredientId = (int) ($item['ingredient_id'] ?? 0);
            $quantityNeeded = (int) ($item['quantity_needed'] ?? 0);
            $ingredient = $ingredientMap->get($ingredientId);

            if (!$ingredient) {
                continue;
            }

            $available = (int) ($ingredient->quantity_available ?? 0);

            if ($available <= 0) {
                $errors["ingredients.$index.ingredient_id"] = [
                    "L'ingrédient {$ingredient->name} n'est pas disponible.",
                ];
                continue;
            }

            if ($quantityNeeded > $available) {
                $errors["ingredients.$index.quantity_needed"] = [
                    "Quantité demandée trop élevée pour {$ingredient->name} (disponible: {$available}).",
                ];
            }
        }

        if (!empty($errors)) {
            throw ValidationException::withMessages($errors);
        }
    }

    private function activeOrderStatuses(): array
    {
        return ['pending', 'preparing', 'in_kitchen', 'ready', 'served'];
    }

    private function tableHasActiveOrders(RestaurantTable $table): bool
    {
        return $table->orders()
            ->whereIn('status', $this->activeOrderStatuses())
            ->where('occupies_table', true)
            ->exists();
    }

    private function isReservedTableLocked(RestaurantTable $table): bool
    {
        if ((string) $table->status !== 'reserved') {
            return false;
        }

        if (!$table->reservation_at) {
            // Une table marquée "réservée" sans heure explicite reste indisponible.
            return true;
        }

        $lockAt = $table->reservation_at->copy()->subMinutes(self::RESERVATION_LOCK_MINUTES);
        return now()->greaterThanOrEqualTo($lockAt);
    }

    private function expireReservationIfNeeded(RestaurantTable $table, bool $hasActiveOrders): void
    {
        if ((string) $table->status !== 'reserved' || $hasActiveOrders || !$table->reservation_at) {
            return;
        }

        if (now()->lessThan($table->reservation_at)) {
            return;
        }

        $table->status = 'free';
        $table->clearReservationData();
        $table->save();
    }

    private function flushServerTableCache(): void
    {
        Cache::forget(self::CACHE_KEY_SERVER_TABLES);
    }
}
