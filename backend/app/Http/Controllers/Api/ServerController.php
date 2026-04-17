<?php

namespace App\Http\Controllers\Api;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Menu;
use App\Models\Ingredient;
use App\Models\RestaurantTable;
use App\Models\Customer;
use App\Models\RawMaterial;
use App\Support\PreparationStation;
use App\Services\InventoryService;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;

class ServerController extends Controller
{
    private const RESERVATION_LOCK_MINUTES = 120;
    private const CACHE_TTL_TABLES_SECONDS = 5;
    private const CACHE_TTL_CUSTOMERS_SECONDS = 30;
    private const CACHE_TTL_MENUS_SECONDS = 12;
    private const CACHE_KEY_TABLES = 'server:snapshot:tables:v1';
    private const CACHE_KEY_CUSTOMERS = 'server:snapshot:customers:v1';
    private const CACHE_KEY_MENUS = 'server:snapshot:menus:v2';

    // Voir l'état des tables pour le serveur
    public function listAvailableTables()
    {
        return response()->json($this->getServerTablesSnapshot());
    }

    private function getServerTablesSnapshot(): array
    {
        return Cache::remember(
            self::CACHE_KEY_TABLES,
            now()->addSeconds(self::CACHE_TTL_TABLES_SECONDS),
            fn () => $this->buildServerTablesSnapshot()
        );
    }

    private function buildServerTablesSnapshot(): array
    {
        $activeOrderStatuses = $this->activeOrderStatuses();
        $activeOrderColumns = ['id', 'table_id', 'customer_id', 'user_id', 'total_amount', 'status', 'created_at'];
        if ($this->hasOrderColumn('bill_requested_at')) {
            $activeOrderColumns[] = 'bill_requested_at';
        }

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
            ->with([
                'currentOrder' => function ($orderQuery) use ($activeOrderColumns) {
                    $orderQuery
                        ->select($activeOrderColumns)
                        ->where('occupies_table', true)
                        ->with([
                            'customer:id,name',
                            'user:id,name',
                        ]);
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
                $displayStatus = $hasActiveOrders
                    ? 'occupied'
                    : ($isReserved ? 'reserved' : 'free');
                $serviceStatus = $hasActiveOrders
                    ? 'occupied'
                    : (($isReserved && $reservationLocked) ? 'reserved' : 'free');
                $isOrderableNow = !$hasActiveOrders && (!$isReserved || !$reservationLocked);

                $table->recorded_status = $recordedStatus;
                $table->status = $displayStatus;
                $table->service_status = $serviceStatus;
                $table->has_active_orders = $hasActiveOrders;
                $table->is_orderable_now = $isOrderableNow;
                $table->can_append_to_order = $hasActiveOrders && $table->currentOrder !== null;
                $table->server_block_reason = $hasActiveOrders
                    ? 'Commande active non payée'
                    : (($isReserved && $reservationLocked) ? 'Réservation verrouillée (T-2h)' : null);
                $table->reservation_usage_status = !$isReserved
                    ? null
                    : ($reservationLocked ? 'blocked' : 'usable');
                $table->reservation_usage_note = !$isReserved
                    ? null
                    : ($reservationLocked
                        ? 'Réservation atteinte: table indisponible côté serveur.'
                        : 'Table réservée mais encore utilisable jusqu’à la fenêtre T-2h.');
                $reservationAt = $table->reservation_at?->copy();
                $reservationLockAt = $reservationAt
                    ? $reservationAt->copy()->subMinutes(self::RESERVATION_LOCK_MINUTES)->toDateTimeString()
                    : null;

                $tableData = $table->toArray();
                unset($tableData['active_orders_count']);

                $tableData['recorded_status'] = $recordedStatus;
                $tableData['status'] = $displayStatus;
                $tableData['service_status'] = $serviceStatus;
                $tableData['has_active_orders'] = $hasActiveOrders;
                $tableData['is_orderable_now'] = $isOrderableNow;
                $tableData['can_append_to_order'] = $hasActiveOrders && $table->currentOrder !== null;
                $tableData['server_block_reason'] = $hasActiveOrders
                    ? 'Commande active non payée'
                    : (($isReserved && $reservationLocked) ? 'Réservation verrouillée (T-2h)' : null);
                $tableData['reservation_usage_status'] = !$isReserved
                    ? null
                    : ($reservationLocked ? 'blocked' : 'usable');
                $tableData['reservation_usage_note'] = !$isReserved
                    ? null
                    : ($reservationLocked
                        ? 'Réservation atteinte: table indisponible côté serveur.'
                        : 'Table réservée mais encore utilisable jusqu’à la fenêtre T-2h.');
                $tableData['reservation_locked'] = $reservationLocked;
                $tableData['reservation_lock_minutes'] = self::RESERVATION_LOCK_MINUTES;
                $tableData['reservation_at'] = $reservationAt?->toDateTimeString();
                $tableData['reservation_lock_at'] = $reservationLockAt;

                return $tableData;
            })
            ->values()
            ->all();

        return $tables;
    }

    // Voir clients fidèles
    public function listCustomers()
    {
        $hasNotes = $this->hasCustomerColumn('notes');
        $hasPreferredCooking = $this->hasCustomerColumn('preferred_cooking');
        $hasAllergies = $this->hasCustomerColumn('allergies');

        $selectColumns = ['id', 'name'];
        if ($hasNotes) {
            $selectColumns[] = 'notes';
        }
        if ($hasPreferredCooking) {
            $selectColumns[] = 'preferred_cooking';
        }
        if ($hasAllergies) {
            $selectColumns[] = 'allergies';
        }

        $customers = Cache::remember(
            self::CACHE_KEY_CUSTOMERS,
            now()->addSeconds(self::CACHE_TTL_CUSTOMERS_SECONDS),
            function () use ($selectColumns, $hasNotes, $hasPreferredCooking, $hasAllergies) {
                return Customer::query()
                    ->select($selectColumns)
                    ->orderBy('name')
                    ->get()
                    ->map(function (Customer $customer) use ($hasNotes, $hasPreferredCooking, $hasAllergies) {
                        $customer->name = $this->cleanCustomerDisplayName(
                            $customer->name,
                            $hasPreferredCooking ? $customer->preferred_cooking : null,
                        );

                        if (!$hasNotes) {
                            $customer->notes = null;
                        }

                        if (!$hasPreferredCooking) {
                            $customer->preferred_cooking = null;
                        }

                        if (!$hasAllergies) {
                            $customer->allergies = null;
                        }

                        return $customer;
                    })
                    ->filter(function (Customer $customer) {
                        return $customer->name !== '';
                    })
                    ->unique(function (Customer $customer) {
                        return $this->normalizeCustomerNameForComparison($customer->name);
                    })
                    ->values()
                    ->all();
            }
        );

        return response()->json($customers);
    }

    // Voir profil/habitudes d'un client
    public function getCustomerInsights(Customer $customer)
    {
        $favoriteMenus = DB::table('order_items')
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->join('menus', 'menus.id', '=', 'order_items.menu_id')
            ->where('orders.customer_id', $customer->id)
            ->whereNull('orders.deleted_at')
            ->whereNull('menus.deleted_at')
            ->whereIn('orders.status', ['ready', 'served', 'paid', 'archived'])
            ->selectRaw('
                order_items.menu_id as menu_id,
                menus.name as menu_name,
                menus.category as menu_category,
                menus.image_url as menu_image_url,
                COUNT(DISTINCT orders.id) as times_ordered,
                COALESCE(SUM(order_items.quantity), 0) as total_quantity,
                MAX(orders.created_at) as last_ordered_at
            ')
            ->groupBy('order_items.menu_id', 'menus.name', 'menus.category', 'menus.image_url')
            ->orderByDesc('times_ordered')
            ->orderByDesc('total_quantity')
            ->limit(8)
            ->get()
            ->map(function ($row) {
                $timesOrdered = max(1, (int) ($row->times_ordered ?? 0));
                $totalQuantity = max(0, (int) ($row->total_quantity ?? 0));
                $recommendedQuantity = max(1, (int) round($totalQuantity / $timesOrdered));

                return [
                    'menu_id' => (int) $row->menu_id,
                    'menu_name' => (string) $row->menu_name,
                    'menu_category' => (string) ($row->menu_category ?? ''),
                    'menu_image_url' => (string) ($row->menu_image_url ?? ''),
                    'times_ordered' => $timesOrdered,
                    'total_quantity' => $totalQuantity,
                    'recommended_quantity' => $recommendedQuantity,
                    'last_ordered_at' => $row->last_ordered_at,
                ];
            })
            ->values();

        $recentOrders = Order::query()
            ->select(['id', 'customer_id', 'table_id', 'total_amount', 'status', 'created_at'])
            ->where('customer_id', $customer->id)
            ->whereIn('status', ['ready', 'served', 'paid', 'archived'])
            ->with([
                'items:id,order_id,menu_id,quantity',
                'items.menu:id,name',
            ])
            ->orderByDesc('created_at')
            ->limit(3)
            ->get()
            ->map(function (Order $order) {
                return [
                    'order_id' => (int) $order->id,
                    'created_at' => $order->created_at,
                    'status' => (string) $order->status,
                    'total_amount' => (float) $order->total_amount,
                    'items' => collect($order->items)->map(function ($item) {
                        return [
                            'menu_id' => (int) $item->menu_id,
                            'menu_name' => (string) ($item->menu->name ?? "Menu #{$item->menu_id}"),
                            'quantity' => (int) $item->quantity,
                        ];
                    })->values(),
                ];
            })
            ->values();

        return response()->json([
            'customer' => [
                'id' => $customer->id,
                'name' => $customer->name,
                'notes' => $customer->notes,
                'preferred_cooking' => $this->hasCustomerColumn('preferred_cooking')
                    ? $customer->preferred_cooking
                    : null,
                'allergies' => $this->hasCustomerColumn('allergies')
                    ? $customer->allergies
                    : null,
            ],
            'favorite_menus' => $favoriteMenus,
            'recent_orders' => $recentOrders,
        ]);
    }

    // Voir menus disponibles avec portions
    public function listMenus()
    {
        $menus = Cache::remember(
            self::CACHE_KEY_MENUS,
            now()->addSeconds(self::CACHE_TTL_MENUS_SECONDS),
            function () {
                $menus = Menu::query()
                    ->select(['id', 'name', 'description', 'price', 'category', 'image_url', 'is_available'])
                    ->with([
                        'ingredients' => function ($query) {
                            $query->select([
                                'ingredients.id',
                                'ingredients.name',
                                'ingredients.portion_size',
                                'ingredients.portion_unit',
                                'ingredients.quantity_available',
                            ]);
                        },
                    ])
                    ->orderBy('name')
                    ->get();

                foreach ($menus as $menu) {
                    $maxPortionsAvailable = null;
                    $insufficientIngredients = [];

                    foreach ($menu->ingredients as $ingredient) {
                        $requiredPortionsPerMenu = max(0, (int) ($ingredient->pivot->quantity_needed ?? 0));
                        $availablePortions = max(0, (int) ($ingredient->quantity_available ?? 0));
                        $maxByIngredient = $requiredPortionsPerMenu > 0
                            ? intdiv($availablePortions, $requiredPortionsPerMenu)
                            : 0;

                        $maxPortionsAvailable = $maxPortionsAvailable === null
                            ? $maxByIngredient
                            : min($maxPortionsAvailable, $maxByIngredient);

                        $ingredient->required_portions_per_menu = $requiredPortionsPerMenu;
                        $ingredient->available_portions = $availablePortions;
                        $ingredient->max_menu_portions_available = $maxByIngredient;

                        if ($requiredPortionsPerMenu > 0 && $availablePortions < $requiredPortionsPerMenu) {
                            $insufficientIngredients[] = [
                                'ingredient_id' => (int) ($ingredient->id ?? 0),
                                'ingredient_name' => (string) ($ingredient->name ?? ''),
                                'required_portions_per_menu' => $requiredPortionsPerMenu,
                                'available_portions' => $availablePortions,
                                'missing_portions' => max(0, $requiredPortionsPerMenu - $availablePortions),
                            ];
                        }
                    }

                    $menu->max_portions_available = max(0, (int) ($maxPortionsAvailable ?? 0));
                    $menu->insufficient_ingredients = $insufficientIngredients;

                    $availabilityReasons = [];
                    if (!$menu->is_available) {
                        $availabilityReasons[] = 'Menu indisponible (saisonnier ou désactivé par l\'administration).';
                    }
                    if ($menu->max_portions_available <= 0) {
                        $availabilityReasons[] = 'Stock insuffisant pour au moins un ingrédient requis (information uniquement).';
                    }

                    $menu->availability_reasons = $availabilityReasons;
                    $menu->is_stock_limited = $menu->max_portions_available <= 0;
                    // Bypass stock: seule la disponibilité admin bloque la prise de commande.
                    $menu->is_orderable = (bool) $menu->is_available;
                    $menu->category_key = $this->normalizeMenuCategory((string) ($menu->category ?? ''));
                    $menu->prep_station = PreparationStation::stationForMenu($menu);
                }

                $alternativesByCategory = $menus
                    ->filter(function ($candidate) {
                        return (bool) $candidate->is_orderable;
                    })
                    ->groupBy(function ($candidate) {
                        return (string) $candidate->category_key;
                    })
                    ->map(function ($group) {
                        return $group
                            ->sortBy('name')
                            ->take(3)
                            ->values()
                            ->map(function ($candidate) {
                                return [
                                    'id' => (int) $candidate->id,
                                    'name' => (string) $candidate->name,
                                    'price' => (float) $candidate->price,
                                    'max_portions_available' => (int) ($candidate->max_portions_available ?? 0),
                                    'prep_station' => (string) ($candidate->prep_station ?? ''),
                                ];
                            })
                            ->all();
                    });

                foreach ($menus as $menu) {
                    if ($menu->is_orderable) {
                        $menu->alternative_menus = [];
                        continue;
                    }

                    $menu->alternative_menus = $alternativesByCategory->get((string) $menu->category_key, []);
                }

                return $menus->values()->all();
            }
        );

        return response()->json($menus);
    }

    public function getDashboardSnapshot(Request $request)
    {
        return response()->json([
            'tables' => $this->getServerTablesSnapshot(),
            'customers' => $this->listCustomers()->getData(true),
            'menus' => $this->listMenus()->getData(true),
            'orders' => $this->buildMyOrdersSnapshot((string) $request->query('scope', 'today')),
        ]);
    }

    // Créer nouvelle commande
    public function createOrder(Request $request)
    {
        $validated = $request->validate([
            'table_id' => 'nullable|exists:tables,id',
            'order_type' => 'nullable|in:dine_in,takeaway',
            'append_to_existing' => 'nullable|boolean',
            'confirm_other_server_append' => 'nullable|boolean',
            'with_packaging' => 'nullable|boolean',
            'packaging_quantity' => 'nullable|integer|min:0|max:100',
            'packaging_unit_price' => 'nullable|numeric|min:0',
            'allow_missing_ingredients' => 'nullable|boolean',
            'customer_id' => 'nullable|exists:customers,id',
            'customer_name' => 'nullable|string|max:120',
            'preferred_cooking' => 'nullable|string|max:120',
            'allergies' => 'nullable|string|max:500',
            'items' => 'required|array|min:1', // [{menu_id, quantity}...]
            'items.*.menu_id' => 'required|exists:menus,id',
            'items.*.quantity' => 'required|integer|min:1',
            'special_requests' => 'nullable|string|max:1000',
            'is_urgent' => 'boolean',
        ]);

        $orderType = (string) ($validated['order_type'] ?? 'dine_in');
        $isTakeawayOrder = $orderType === 'takeaway';
        $supportsTakeawayFields = $this->hasOrderColumn('order_type') && $this->hasOrderColumn('with_packaging');
        $supportsPackagingPricingFields = $this->hasOrderColumn('packaging_quantity') && $this->hasOrderColumn('packaging_unit_price');
        $tableId = $isTakeawayOrder ? null : ($validated['table_id'] ?? null);
        $appendToExisting = !$isTakeawayOrder && (bool) ($validated['append_to_existing'] ?? false);
        $confirmOtherServerAppend = !$isTakeawayOrder && (bool) ($validated['confirm_other_server_append'] ?? false);
        $withPackaging = $isTakeawayOrder ? (bool) ($validated['with_packaging'] ?? false) : false;
        $packagingQuantity = $isTakeawayOrder && $withPackaging
            ? max(0, (int) ($validated['packaging_quantity'] ?? 0))
            : 0;
        $packagingUnitPrice = $isTakeawayOrder && $withPackaging
            ? round(max(0.0, (float) ($validated['packaging_unit_price'] ?? 0)), 2)
            : 0.0;
        $allowMissingIngredients = (bool) ($validated['allow_missing_ingredients'] ?? false);
        $customerId = $validated['customer_id'] ?? null;
        $customerName = $this->sanitizeCustomerName($validated['customer_name'] ?? '');

        if ($isTakeawayOrder && !$supportsTakeawayFields) {
            return response()->json([
                'error' => 'Le mode à emporter nécessite une mise à jour de la base de données (migration).',
            ], 422);
        }

        if ($isTakeawayOrder && $withPackaging && !$supportsPackagingPricingFields) {
            return response()->json([
                'error' => 'La facturation des barquettes nécessite une mise à jour de la base de données (migration).',
            ], 422);
        }

        if (!$isTakeawayOrder && !$tableId) {
            return response()->json(['error' => 'La table est obligatoire pour une commande sur place.'], 422);
        }

        if ($appendToExisting && !$tableId) {
            return response()->json(['error' => 'Sélectionnez une table avec une commande active à compléter.'], 422);
        }

        if ($appendToExisting && $tableId) {
            $activeOrder = Order::query()
                ->select(['id', 'table_id', 'user_id'])
                ->where('table_id', $tableId)
                ->whereIn('status', $this->activeOrderStatuses())
                ->where('occupies_table', true)
                ->with(['user:id,name'])
                ->orderByDesc('created_at')
                ->first();

            if (
                $activeOrder
                && (int) $activeOrder->user_id !== (int) Auth::id()
                && !$confirmOtherServerAppend
            ) {
                $ownerName = trim((string) ($activeOrder->user->name ?? ''));

                return response()->json([
                    'error' => $ownerName !== ''
                        ? "Cette table est déjà rattachée au serveur {$ownerName}."
                        : 'Cette table est déjà rattachée à un autre serveur.',
                    'message' => $ownerName !== ''
                        ? "La commande #{$activeOrder->id} de cette table appartient au serveur {$ownerName}. Voulez-vous quand même y ajouter des articles ?"
                        : "La commande #{$activeOrder->id} de cette table appartient à un autre serveur. Voulez-vous quand même y ajouter des articles ?",
                    'require_confirmation' => true,
                    'confirmation_reason' => 'foreign_server_append',
                    'existing_order_id' => (int) $activeOrder->id,
                    'existing_server' => [
                        'id' => (int) $activeOrder->user_id,
                        'name' => $ownerName !== '' ? $ownerName : null,
                    ],
                ], 409);
            }
        }

        if ($withPackaging && $packagingQuantity <= 0) {
            return response()->json([
                'error' => 'Le nombre de barquettes doit être supérieur à 0.',
            ], 422);
        }

        if ($withPackaging && $packagingUnitPrice <= 0) {
            return response()->json([
                'error' => 'Le prix unitaire de la barquette doit être supérieur à 0.',
            ], 422);
        }

        if (!$customerId && $customerName !== '') {
            $createPayload = ['loyalty_points' => 0];
            if ($this->hasCustomerColumn('preferred_cooking')) {
                $createPayload['preferred_cooking'] = trim((string) ($validated['preferred_cooking'] ?? '')) ?: null;
            }
            if ($this->hasCustomerColumn('allergies')) {
                $createPayload['allergies'] = trim((string) ($validated['allergies'] ?? '')) ?: null;
            }

            $customer = Customer::firstOrCreate(
                ['name' => $customerName],
                $createPayload
            );
            $customerId = $customer->id;
        }

        $menuIds = collect($validated['items'])->pluck('menu_id')->unique()->values();
        $menus = Menu::with('ingredients.rawMaterial')
            ->whereIn('id', $menuIds)
            ->get()
            ->keyBy('id');

        if ($menus->count() !== $menuIds->count()) {
            return response()->json(['error' => 'Un ou plusieurs menus sont introuvables.'], 422);
        }

        $inventoryService = app(InventoryService::class);

        // Vérifier les besoins d'ingrédients en tenant compte des quantités commandées
        $ingredientRequirements = [];
        $rawMaterialRequirements = [];

        foreach ($validated['items'] as $item) {
            /** @var Menu $menu */
            $menu = $menus->get((int) $item['menu_id']);

            if (!$menu || !$menu->is_available) {
                return response()->json(['error' => 'Un menu sélectionné est indisponible.'], 422);
            }

            $quantity = (int) $item['quantity'];
            foreach ($menu->ingredients as $ingredient) {
                $requiredPortions = (int) $ingredient->pivot->quantity_needed * $quantity;

                if (!$ingredient->rawMaterial) {
                    if (!isset($ingredientRequirements[$ingredient->id])) {
                        $ingredientRequirements[$ingredient->id] = [
                            'name' => $ingredient->name,
                            'required' => 0,
                            'available' => 0,
                            'reason' => 'raw_material_missing',
                        ];
                    }

                    $ingredientRequirements[$ingredient->id]['required'] += $requiredPortions;
                    continue;
                }

                try {
                    $metrics = $inventoryService->calculateIngredientMetrics(
                        $ingredient->rawMaterial,
                        (float) $ingredient->portion_size,
                        (string) $ingredient->portion_unit
                    );
                    $requiredRawUsage = $inventoryService->calculateIngredientRawUsage($ingredient, $requiredPortions);
                } catch (InvalidArgumentException $exception) {
                    return response()->json(['error' => $exception->getMessage()], 422);
                }

                if (!isset($ingredientRequirements[$ingredient->id])) {
                    $ingredientRequirements[$ingredient->id] = [
                        'name' => $ingredient->name,
                        'required' => 0,
                        'available' => $metrics['quantity_available'],
                        'reason' => null,
                    ];
                }

                $ingredientRequirements[$ingredient->id]['required'] += $requiredPortions;

                $rawMaterialId = (int) $ingredient->rawMaterial->id;
                if (!isset($rawMaterialRequirements[$rawMaterialId])) {
                    $rawMaterialRequirements[$rawMaterialId] = [
                        'name' => $ingredient->rawMaterial->name,
                        'required' => 0.0,
                        'available' => (float) ($ingredient->rawMaterial->stock ?? 0),
                        'unit' => $ingredient->rawMaterial->unit,
                    ];
                }

                $rawMaterialRequirements[$rawMaterialId]['required'] += $requiredRawUsage;
            }
        }

        $insufficient = array_values(array_filter($ingredientRequirements, function ($ingredient) {
            return $ingredient['required'] > $ingredient['available'];
        }));
        $rawMaterialShortages = array_values(array_filter($rawMaterialRequirements, function ($rawMaterial) {
            return (float) ($rawMaterial['required'] ?? 0) > ((float) ($rawMaterial['available'] ?? 0) + 0.000001);
        }));
        $missingIngredientsNote = collect($insufficient)
            ->pluck('name')
            ->filter(function ($name) {
                return trim((string) $name) !== '';
            })
            ->unique()
            ->values()
            ->implode(', ');

        if ((!empty($insufficient) || !empty($rawMaterialShortages)) && !$allowMissingIngredients) {
            return response()->json([
                'error' => 'Des ingrédients sont insuffisants pour cette commande.',
                'message' => 'Des ingrédients manquent. Voulez-vous poursuivre la commande sans ces ingrédients ou l’annuler ?',
                'require_confirmation' => true,
                'insufficient' => $insufficient,
                'raw_materials' => $rawMaterialShortages,
                'missing_ingredients_note' => $missingIngredientsNote !== ''
                    ? "Adaptation stock: servir sans {$missingIngredientsNote}."
                    : null,
            ], 409);
        }

        try {
            [$order, $appendedToExisting, $billRequestReset] = DB::transaction(function () use (
                $validated,
                $menus,
                $ingredientRequirements,
                $rawMaterialRequirements,
                $tableId,
                $appendToExisting,
                $orderType,
                $isTakeawayOrder,
                $withPackaging,
                $supportsTakeawayFields,
                $supportsPackagingPricingFields,
                $packagingQuantity,
                $packagingUnitPrice,
                $customerId,
                $inventoryService
            ) {
                $selectedTable = null;
                $appendedToExisting = false;
                $billRequestReset = false;
                $order = null;
                if ($tableId) {
                    $activeOrderStatuses = $this->activeOrderStatuses();
                    $selectedTable = RestaurantTable::where('id', $tableId)
                        ->lockForUpdate()
                        ->first();

                    if (!$selectedTable) {
                        throw new InvalidArgumentException('Table introuvable.');
                    }

                    $this->expireReservationIfNeeded($selectedTable, false);

                    if ($selectedTable->status === 'reserved' && $this->isReservedTableLocked($selectedTable)) {
                        throw new InvalidArgumentException(
                            'Cette table est reservee et indisponible a partir de 2 heures avant l heure de reservation.'
                        );
                    }

                    $activeOrderQuery = Order::query()
                        ->where('table_id', $selectedTable->id)
                        ->lockForUpdate()
                        ->whereIn('status', $activeOrderStatuses)
                        ->where('occupies_table', true)
                        ->orderByDesc('created_at');

                    $activeOrder = $activeOrderQuery->first();

                    if ($appendToExisting) {
                        if (!$activeOrder) {
                            throw new InvalidArgumentException('Aucune commande active à compléter pour cette table.');
                        }
                    } elseif ($activeOrder) {
                        throw new InvalidArgumentException('Cette table n\'est pas libre. Une commande active existe deja.');
                    }

                    if (!$appendToExisting && $selectedTable->status !== 'free' && $selectedTable->status !== 'reserved') {
                        $selectedTable->setFree();
                        $selectedTable->refresh();
                    }

                    if ($appendToExisting) {
                        $order = $activeOrder;
                    }
                }

                $rawMaterialIds = array_keys($rawMaterialRequirements);
                $lockedRawMaterials = RawMaterial::whereIn('id', $rawMaterialIds)
                    ->lockForUpdate()
                    ->get()
                    ->keyBy('id');

                $ingredientIds = array_keys($ingredientRequirements);
                $lockedIngredients = Ingredient::whereIn('id', $ingredientIds)
                    ->lockForUpdate()
                    ->get()
                    ->keyBy('id');

                if (!$order) {
                    $orderPayload = [
                        'user_id' => Auth::id(),
                        'table_id' => $tableId,
                        'customer_id' => $customerId,
                        'special_requests' => $validated['special_requests'] ?? null,
                        'is_urgent' => $validated['is_urgent'] ?? false,
                        'status' => 'pending',
                        'occupies_table' => !$isTakeawayOrder,
                    ];

                    if ($supportsTakeawayFields) {
                        $orderPayload['order_type'] = $orderType;
                        $orderPayload['with_packaging'] = $withPackaging;
                        if ($supportsPackagingPricingFields) {
                            $orderPayload['packaging_quantity'] = $withPackaging ? $packagingQuantity : 0;
                            $orderPayload['packaging_unit_price'] = $withPackaging ? $packagingUnitPrice : 0;
                        }
                    }

                    $order = Order::create($orderPayload);
                } else {
                    $appendedToExisting = true;

                    if ($order->status === 'paid') {
                        throw new InvalidArgumentException('La commande de cette table est déjà payée.');
                    }

                    if (!$order->customer_id && $customerId) {
                        $order->customer_id = $customerId;
                    }

                    $mergedNotes = $this->mergeOrderNotes(
                        (string) ($order->special_requests ?? ''),
                        (string) ($validated['special_requests'] ?? '')
                    );

                    if ($mergedNotes !== '') {
                        $order->special_requests = $mergedNotes;
                    }

                    if (!empty($validated['is_urgent'])) {
                        $order->is_urgent = true;
                    }

                    if ($this->hasOrderColumn('bill_requested_at') && !empty($order->bill_requested_at)) {
                        $billRequestReset = true;
                        $order->bill_requested_at = null;
                        if ($this->hasOrderColumn('bill_requested_by_user_id')) {
                            $order->bill_requested_by_user_id = null;
                        }
                    }

                    $order->payments()
                        ->where('status', 'pending')
                        ->delete();

                    if (!empty($order->served_at)) {
                        $order->served_at = null;
                    }

                    $order->status = 'pending';
                    $order->occupies_table = !$isTakeawayOrder && $order->table_id !== null;
                    $order->save();
                }

                // Pour les clients enregistrés, conserver les notes de commande
                // (allergies, cuisson, préférences) dans la fiche client.
                $this->syncCustomerProfileFromOrder(
                    (int) ($order->customer_id ?? $customerId) ?: null,
                    $validated['preferred_cooking'] ?? null,
                    $validated['allergies'] ?? null,
                    $validated['special_requests'] ?? null
                );

                // Ajouter items
                foreach ($validated['items'] as $item) {
                    $menu = $menus->get((int) $item['menu_id']);
                    OrderItem::create([
                        'order_id' => $order->id,
                        'menu_id' => (int) $item['menu_id'],
                        'quantity' => (int) $item['quantity'],
                        'price_at_order' => $menu->price,
                        'status' => 'pending',
                        'station' => PreparationStation::stationForMenu($menu),
                    ]);
                }

                // Décrémenter le stock des ingrédients utilisés
                foreach ($ingredientRequirements as $ingredientId => $requirement) {
                    /** @var Ingredient|null $ingredient */
                    $ingredient = $lockedIngredients->get((int) $ingredientId);
                    if (!$ingredient) {
                        continue;
                    }

                    if (($requirement['reason'] ?? null) === 'raw_material_missing') {
                        continue;
                    }

                    $newQuantity = max(0, (int) $ingredient->quantity_available - (int) $requirement['required']);
                    $ingredient->quantity_available = $newQuantity;
                    $ingredient->save();
                }

                // Décrémenter le stock brut
                foreach ($rawMaterialRequirements as $rawMaterialId => $requirement) {
                    /** @var RawMaterial|null $rawMaterial */
                    $rawMaterial = $lockedRawMaterials->get((int) $rawMaterialId);
                    if (!$rawMaterial) {
                        continue;
                    }

                    $newStock = (float) $rawMaterial->stock - (float) $requirement['required'];
                    $rawMaterial->stock = round(max(0, $newStock), 4);
                    $rawMaterial->save();
                }

                // Recalculer automatiquement les portions de tous les ingrédients liés
                foreach ($lockedRawMaterials as $rawMaterial) {
                    $inventoryService->syncIngredientsForRawMaterial($rawMaterial);
                }

                // Calculer total
                $itemsTotal = (float) $order->calculateTotal();
                $packagingTotal = ($supportsPackagingPricingFields && (bool) ($order->with_packaging ?? false))
                    ? round(
                        ((int) ($order->packaging_quantity ?? 0))
                        * ((float) ($order->packaging_unit_price ?? 0)),
                        2
                    )
                    : 0.0;
                $order->total_amount = round($itemsTotal + $packagingTotal, 2);
                $order->save();

                $this->synchronizeOrderWorkflowStatus($order);
                $order->refresh();

                // Marquer table comme occupée
                if ($order->table_id) {
                    $selectedTable?->setOccupied();
                }

                return [$order, $appendedToExisting, $billRequestReset];
            });
        } catch (InvalidArgumentException $exception) {
            return response()->json(['error' => $exception->getMessage()], 422);
        }

        $this->flushServerSnapshotCaches();

        $responseOrder = $order->load('items.menu', 'table', 'customer', 'user');
        $responseOrder->stock_warnings = [
            'has_shortage' => !empty($insufficient) || !empty($rawMaterialShortages),
            'ingredients' => $insufficient,
            'raw_materials' => $rawMaterialShortages,
            'message' => (!empty($insufficient) || !empty($rawMaterialShortages))
                ? 'Commande acceptée avec stock insuffisant (bypass informatif).'
                : null,
        ];
        $responseOrder->appended_to_existing = $appendedToExisting;
        $responseOrder->bill_request_reset = $billRequestReset;

        return response()->json($responseOrder, 201);
    }

    // Voir commandes du serveur
    public function myOrders()
    {
        return response()->json(
            $this->buildMyOrdersSnapshot((string) request()->query('scope', 'today'))
        );
    }

    private function buildMyOrdersSnapshot(string $scope = 'today')
    {
        $selectColumns = [
            'id',
            'user_id',
            'table_id',
            'customer_id',
            'total_amount',
            'status',
            'special_requests',
            'is_urgent',
            'served_at',
            'created_at',
        ];
        if ($this->hasOrderColumn('order_type')) {
            $selectColumns[] = 'order_type';
        }
        if ($this->hasOrderColumn('with_packaging')) {
            $selectColumns[] = 'with_packaging';
        }
        if ($this->hasOrderColumn('packaging_quantity')) {
            $selectColumns[] = 'packaging_quantity';
        }
        if ($this->hasOrderColumn('packaging_unit_price')) {
            $selectColumns[] = 'packaging_unit_price';
        }
        if ($this->hasOrderColumn('bill_requested_at')) {
            $selectColumns[] = 'bill_requested_at';
        }
        if ($this->hasOrderColumn('bill_requested_by_user_id')) {
            $selectColumns[] = 'bill_requested_by_user_id';
        }

        $query = Order::query()
            ->select($selectColumns)
            ->where('user_id', Auth::id())
            ->with([
                'items' => function ($itemQuery) {
                    $itemQuery->select(['id', 'order_id', 'menu_id', 'quantity', 'price_at_order', 'status', 'station']);
                },
                'items.menu:id,name,price,category,image_url',
                'table:id,table_number',
                'customer:id,name',
                'latestPayment' => function ($paymentQuery) {
                    $paymentQuery->select([
                        'payments.id',
                        'payments.order_id',
                        'payments.method',
                    ]);
                },
            ]);

        if ($scope !== 'all') {
            $todayStart = now()->startOfDay();
            $todayEnd = now()->endOfDay();
            $activeStatuses = $this->activeOrderStatuses();
            $query->where(function ($scopeQuery) use ($todayStart, $todayEnd, $activeStatuses) {
                $scopeQuery
                    ->whereBetween('created_at', [$todayStart, $todayEnd])
                    ->orWhereIn('status', $activeStatuses);
            });
        }

        $orders = $query
            ->orderBy('created_at', 'desc')
            ->get();

        foreach ($orders as $order) {
            $this->synchronizeOrderWorkflowStatus($order, false);
        }

        return $orders;
    }

    public function requestBill(Request $request, Order $order)
    {
        $actorId = (int) Auth::id();
        $supportsBillRequest = $this->hasOrderColumn('bill_requested_at') && $this->hasOrderColumn('bill_requested_by_user_id');

        if (!$supportsBillRequest) {
            return response()->json([
                'error' => 'La demande d’addition nécessite une migration de la base de données.',
            ], 422);
        }

        if ((int) $order->user_id !== $actorId) {
            return response()->json(['error' => 'Vous ne pouvez demander l’addition que pour vos commandes.'], 403);
        }

        if ($order->status === 'paid') {
            return response()->json(['error' => 'Commande déjà payée.'], 422);
        }

        if ($order->table_id === null && (string) ($order->order_type ?? 'dine_in') !== 'takeaway') {
            return response()->json(['error' => 'Aucune table associée à cette commande.'], 422);
        }

        try {
            $order = DB::transaction(function () use ($order, $actorId) {
                $lockedOrder = Order::query()
                    ->where('id', $order->id)
                    ->lockForUpdate()
                    ->with(['items:id,order_id,status'])
                    ->firstOrFail();

                if ($lockedOrder->status === 'paid') {
                    throw new InvalidArgumentException('Commande déjà payée.');
                }

                $this->synchronizeOrderWorkflowStatus($lockedOrder);
                $lockedOrder->refresh();

                $hasPendingServiceItems = $lockedOrder->items->contains(function ($item) {
                    return !in_array($this->normalizePreparationStatus($item->status), ['ready', 'served', 'cancelled'], true);
                });

                if ($hasPendingServiceItems) {
                    throw new InvalidArgumentException('Tous les menus doivent être prêts ou servis avant la demande d’addition.');
                }

                if (!in_array((string) $lockedOrder->status, ['ready', 'served'], true)) {
                    throw new InvalidArgumentException('La commande doit être prête ou servie avant la demande d’addition.');
                }

                $lockedOrder->status = 'served';
                $lockedOrder->served_at = $lockedOrder->served_at ?? now();
                $lockedOrder->bill_requested_at = now();
                $lockedOrder->bill_requested_by_user_id = $actorId;
                $lockedOrder->save();

                return $lockedOrder->fresh(['items.menu', 'table', 'customer', 'user']);
            });
        } catch (InvalidArgumentException $exception) {
            return response()->json(['error' => $exception->getMessage()], 422);
        }

        Cache::forget(self::CACHE_KEY_TABLES);

        return response()->json([
            'message' => 'Demande d’addition transmise à la caisse.',
            'order' => $order,
        ]);
    }

    public function markOrderItemServed(OrderItem $item)
    {
        $actorId = (int) Auth::id();
        $item->loadMissing('order');

        if ((int) ($item->order->user_id ?? 0) !== $actorId) {
            return response()->json(['error' => 'Vous ne pouvez servir que les menus de vos commandes.'], 403);
        }

        try {
            $order = DB::transaction(function () use ($item, $actorId) {
                $lockedItem = OrderItem::query()
                    ->whereKey($item->id)
                    ->lockForUpdate()
                    ->firstOrFail();

                $lockedOrder = Order::query()
                    ->whereKey($lockedItem->order_id)
                    ->lockForUpdate()
                    ->with(['items:id,order_id,status'])
                    ->firstOrFail();

                if ((int) $lockedOrder->user_id !== $actorId) {
                    throw new InvalidArgumentException('Vous ne pouvez servir que les menus de vos commandes.');
                }

                if (in_array((string) $lockedOrder->status, ['paid', 'archived'], true)) {
                    throw new InvalidArgumentException('Cette commande ne peut plus être modifiée.');
                }

                if ($this->normalizePreparationStatus($lockedItem->status) !== 'ready') {
                    throw new InvalidArgumentException('Seuls les menus prêts peuvent être marqués comme servis.');
                }

                $lockedItem->status = 'served';
                $lockedItem->save();

                $this->synchronizeOrderWorkflowStatus($lockedOrder);

                return $lockedOrder->fresh(['items.menu', 'table', 'customer', 'user']);
            });
        } catch (InvalidArgumentException $exception) {
            $status = str_contains($exception->getMessage(), 'vos commandes') ? 403 : 422;

            return response()->json(['error' => $exception->getMessage()], $status);
        }

        Cache::forget(self::CACHE_KEY_TABLES);

        return response()->json([
            'message' => 'Menu marqué comme servie.',
            'order' => $order,
        ]);
    }

    private function mergeOrderNotes(string $existingNotes, string $newNotes): string
    {
        $existing = trim($existingNotes);
        $incoming = trim($newNotes);

        if ($incoming === '') {
            return $existing;
        }

        if ($existing === '') {
            return $incoming;
        }

        if (stripos($existing, $incoming) !== false) {
            return $existing;
        }

        return $existing . PHP_EOL . $incoming;
    }

    private function syncCustomerProfileFromOrder(
        ?int $customerId,
        ?string $preferredCooking,
        ?string $allergies,
        ?string $orderNotes
    ): void
    {
        if (!$customerId) {
            return;
        }

        $newNote = trim((string) $orderNotes);

        $customer = Customer::find($customerId);
        if (!$customer) {
            return;
        }

        $preferredCooking = trim((string) $preferredCooking);
        if ($preferredCooking !== '' && $this->hasCustomerColumn('preferred_cooking')) {
            $customer->preferred_cooking = $preferredCooking;
        }

        $allergies = trim((string) $allergies);
        if ($allergies !== '' && $this->hasCustomerColumn('allergies')) {
            $currentAllergies = trim((string) ($customer->allergies ?? ''));
            if ($currentAllergies === '') {
                $customer->allergies = $allergies;
            } elseif (stripos($currentAllergies, $allergies) === false) {
                $customer->allergies = $currentAllergies . ', ' . $allergies;
            }
        }

        if ($newNote !== '') {
            $currentNotes = trim((string) ($customer->notes ?? ''));
            if ($currentNotes === '') {
                $customer->notes = $newNote;
            } elseif (stripos($currentNotes, $newNote) === false) {
                $timestamp = now()->format('Y-m-d H:i');
                $customer->notes = $currentNotes . PHP_EOL . "- {$timestamp}: {$newNote}";
            }
        }

        if ($customer->isDirty()) {
            $customer->save();
        }
    }

    private function hasCustomerColumn(string $column): bool
    {
        static $cache = [];

        if (!array_key_exists($column, $cache)) {
            $cache[$column] = Schema::hasColumn('customers', $column);
        }

        return (bool) $cache[$column];
    }

    private function hasOrderColumn(string $column): bool
    {
        static $cache = [];

        if (!array_key_exists($column, $cache)) {
            $cache[$column] = Schema::hasColumn('orders', $column);
        }

        return (bool) $cache[$column];
    }

    private function activeOrderStatuses(): array
    {
        return ['pending', 'preparing', 'in_kitchen', 'ready', 'served'];
    }

    private function synchronizeOrderWorkflowStatus(Order $order, bool $persist = true): void
    {
        $currentOrderStatus = $this->normalizePreparationStatus($order->status);

        if (in_array($currentOrderStatus, ['paid', 'archived'], true)) {
            return;
        }

        $order->loadMissing('items:id,order_id,status');
        $items = $order->items;
        if ($items->isEmpty()) {
            return;
        }

        // Compatibilité historique/import: on normalise les statuts avant d'agréger le flux.
        $hasNormalizedItems = false;
        foreach ($items as $item) {
            $normalizedItemStatus = $this->normalizePreparationStatus($item->status);
            if ((string) $item->status !== $normalizedItemStatus) {
                $item->status = $normalizedItemStatus;
                if ($persist) {
                    $item->save();
                }
                $hasNormalizedItems = true;
            }
        }
        if ($hasNormalizedItems && $persist) {
            $order->load('items:id,order_id,status');
            $items = $order->items;
        }

        if ((string) $order->status !== $currentOrderStatus) {
            $order->status = $currentOrderStatus;
        }

        $allServed = $items->every(function ($item) {
            return in_array($this->normalizePreparationStatus($item->status), ['served', 'cancelled'], true);
        });

        $allReadyOrServed = $items->every(function ($item) {
            return in_array($this->normalizePreparationStatus($item->status), ['ready', 'served', 'cancelled'], true);
        });

        $nextStatus = $currentOrderStatus;
        if ($allServed) {
            $nextStatus = 'served';
            $order->ready_at = $order->ready_at ?? now();
            $order->served_at = $order->served_at ?? now();
        } elseif ($allReadyOrServed) {
            $hasBillRequest = $this->hasOrderColumn('bill_requested_at') && !empty($order->bill_requested_at);
            $nextStatus = $hasBillRequest || !empty($order->served_at) ? 'served' : 'ready';
            if ($nextStatus === 'ready') {
                $order->ready_at = $order->ready_at ?? now();
                $order->served_at = null;
            } else {
                $order->served_at = $order->served_at ?? now();
            }
        } else {
            $hasInProgress = $items->contains(fn ($item) => in_array($this->normalizePreparationStatus($item->status), ['in_kitchen', 'ready', 'served'], true));
            $nextStatus = $hasInProgress ? 'in_kitchen' : 'pending';
            $order->ready_at = null;
            $order->served_at = null;
        }

        if ($order->status !== $nextStatus) {
            $order->status = $nextStatus;
        }

        if ($persist && $order->isDirty()) {
            $order->save();
        }
    }

    private function isReservedTableLocked(RestaurantTable $table): bool
    {
        if ($table->status !== 'reserved') {
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

    private function normalizePreparationStatus(?string $status): string
    {
        $normalized = strtolower(trim((string) $status));

        return match ($normalized) {
            'preparing' => 'in_kitchen',
            default => $normalized,
        };
    }

    private function normalizeMenuCategory(string $category): string
    {
        $normalized = trim(strtolower($category));
        if ($normalized === '') {
            return 'autres';
        }

        return $normalized;
    }

    private function sanitizeCustomerName(?string $name): string
    {
        $trimmed = preg_replace('/\s+/u', ' ', trim((string) $name));
        if ($trimmed === null || $trimmed === '') {
            return '';
        }

        $normalized = $this->normalizeCustomerNameForComparison($trimmed);
        if (in_array($normalized, ['null', 'emporter', 'a emporter', 'aemporter', 'takeaway'], true)) {
            return '';
        }

        return $trimmed;
    }

    private function cleanCustomerDisplayName(?string $name, ?string $preferredCooking = null): string
    {
        $cleaned = $this->sanitizeCustomerName($name);
        if ($cleaned === '') {
            return '';
        }

        $detailCandidates = collect([
            $preferredCooking,
            'a point',
            'à point',
            'saignant',
            'bien cuit',
            'bien cuite',
            'bleu',
        ])
            ->filter(fn ($value) => trim((string) $value) !== '')
            ->map(fn ($value) => trim((string) $value))
            ->unique(fn ($value) => $this->normalizeCustomerNameForComparison($value))
            ->values();

        foreach ($detailCandidates as $detail) {
            $cleaned = $this->stripTrailingCustomerDetail($cleaned, $detail);
        }

        return $this->sanitizeCustomerName($cleaned);
    }

    private function stripTrailingCustomerDetail(string $name, string $detail): string
    {
        $detail = trim($detail);
        if ($detail === '') {
            return $name;
        }

        $variants = array_unique([
            $detail,
            str_replace('à', 'a', $detail),
            str_replace('a', 'à', $detail),
        ]);

        foreach ($variants as $variant) {
            $pattern = '/\s*(?:-|,|\/|\|)?\s*\(?'
                . preg_quote(trim($variant), '/')
                . '\)?\s*$/iu';

            if (preg_match($pattern, $name) !== 1) {
                continue;
            }

            $candidate = preg_replace($pattern, '', $name);
            $candidate = preg_replace('/\s+/u', ' ', trim((string) $candidate));
            if ($candidate !== null && $candidate !== '') {
                return $candidate;
            }
        }

        return $name;
    }

    private function normalizeCustomerNameForComparison(?string $name): string
    {
        $value = strtolower(trim((string) $name));
        $value = strtr($value, [
            'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
            'à' => 'a', 'â' => 'a',
            'î' => 'i', 'ï' => 'i',
            'ô' => 'o', 'ö' => 'o',
            'ù' => 'u', 'û' => 'u', 'ü' => 'u',
            '_' => ' ', '-' => ' ',
        ]);

        $collapsed = preg_replace('/\s+/u', ' ', $value);
        return $collapsed === null ? '' : trim($collapsed);
    }

    private function flushServerSnapshotCaches(): void
    {
        Cache::forget(self::CACHE_KEY_TABLES);
        Cache::forget(self::CACHE_KEY_CUSTOMERS);
        Cache::forget(self::CACHE_KEY_MENUS);
    }
}
