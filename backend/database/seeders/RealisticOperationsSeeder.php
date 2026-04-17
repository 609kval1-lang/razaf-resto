<?php

namespace Database\Seeders;

use App\Models\ActionLog;
use App\Models\CashMovement;
use App\Models\Customer;
use App\Models\Ingredient;
use App\Models\Menu;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\RawMaterial;
use App\Models\RestaurantTable;
use App\Models\StockAdjustment;
use App\Models\Supplier;
use App\Models\SupplierPurchase;
use App\Models\SupplierPurchasePayment;
use App\Models\User;
use App\Services\InventoryService;
use App\Support\PreparationStation;
use Carbon\Carbon;
use Faker\Generator;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Seeder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class RealisticOperationsSeeder extends Seeder
{
    private Generator $faker;
    private InventoryService $inventoryService;
    private array $volumeProfile = [];

    /** @var Collection<int, RawMaterial> */
    private Collection $rawMaterials;

    /** @var Collection<int, Ingredient> */
    private Collection $ingredients;

    /** @var array<int, array<int>> */
    private array $rawIngredientIds = [];

    public function run(): void
    {
        $this->faker = fake('fr_FR');
        $this->faker->seed(20260328);
        $this->inventoryService = app(InventoryService::class);
        $this->volumeProfile = $this->resolveVolumeProfile();

        $this->call(RazafRestoSeeder::class);
        $this->resetTransactionalData();

        $users = $this->resolveUsers();
        $tables = RestaurantTable::query()->orderBy('table_number')->get();
        $customers = $this->seedExtraCustomers();

        $this->ensureCocktailCatalog();
        $this->refreshInventoryMaps();

        $suppliers = Supplier::query()->with('rawMaterials')->orderBy('id')->get();
        $purchaseCount = $this->seedSupplierPurchases($suppliers, $users['admin']);

        $menus = Menu::query()
            ->where('is_available', true)
            ->with('ingredients')
            ->orderBy('id')
            ->get();
        $orderStats = $this->seedOrdersAndPayments($menus, $tables, $customers, $users);

        $cashOutStats = $this->seedCashWithdrawals($users);
        $this->seedTableReservations($tables);

        $this->command?->info('Dataset opérationnel généré avec succès:');
        $this->command?->line("- profil: {$this->datasetProfile()}");
        $this->command?->line("- achats fournisseurs: {$purchaseCount}");
        $this->command?->line("- commandes: {$orderStats['orders']}");
        $this->command?->line("- paiements: {$orderStats['payments']}");
        $this->command?->line("- entrées caisse: {$orderStats['cash_in']}");
        $this->command?->line("- sorties caisse approuvées: {$cashOutStats['approved']}");
        $this->command?->line("- sorties caisse en attente: {$cashOutStats['pending']}");
        $this->command?->line("- sorties caisse rejetées: {$cashOutStats['rejected']}");
    }

    protected function datasetProfile(): string
    {
        $profile = strtolower((string) env('RAZAF_SEED_PROFILE', 'realistic'));
        return in_array($profile, ['light', 'realistic'], true) ? $profile : 'realistic';
    }

    private function resolveVolumeProfile(): array
    {
        $profiles = [
            'realistic' => [
                'extra_customers_count' => 8,
                'supplier_purchases_count' => 72,
                'supplier_purchases_days_min' => 6,
                'supplier_purchases_days_max' => 60,
                'orders_count' => 240,
                'orders_days_max' => 35,
                'max_items_per_order' => 4,
                'cash_out_approved_count' => 10,
                'cash_out_pending_count' => 7,
                'cash_out_rejected_count' => 5,
                'table_reservation_count' => 2,
            ],
            'light' => [
                'extra_customers_count' => 4,
                'supplier_purchases_count' => 18,
                'supplier_purchases_days_min' => 2,
                'supplier_purchases_days_max' => 18,
                'orders_count' => 54,
                'orders_days_max' => 12,
                'max_items_per_order' => 3,
                'cash_out_approved_count' => 4,
                'cash_out_pending_count' => 2,
                'cash_out_rejected_count' => 1,
                'table_reservation_count' => 1,
            ],
        ];

        return $profiles[$this->datasetProfile()] ?? $profiles['realistic'];
    }

    private function volumeInt(string $key, int $fallback = 0): int
    {
        if (array_key_exists($key, $this->volumeProfile)) {
            return (int) $this->volumeProfile[$key];
        }

        return $fallback;
    }

    private function resetTransactionalData(): void
    {
        DB::transaction(function () {
            DB::table('action_logs')->delete();
            DB::table('cash_movements')->delete();
            DB::table('supplier_purchase_payments')->delete();
            DB::table('supplier_purchases')->delete();
            DB::table('stock_adjustments')->delete();
            DB::table('payments')->delete();
            DB::table('order_items')->delete();
            DB::table('orders')->delete();

            DB::table('tables')->update([
                'status' => 'free',
                'reservation_name' => null,
                'reservation_phone' => null,
                'reservation_at' => null,
                'reservation_notes' => null,
                'updated_at' => now(),
            ]);
        });
    }

    /**
     * @return array{
     *   admin: User,
     *   cashier: User,
     *   kitchen: User,
     *   servers: Collection<int, User>
     * }
     */
    private function resolveUsers(): array
    {
        $admin = User::query()->where('role', 'admin')->first();
        $cashier = User::query()->where('role', 'cashier')->first();
        $kitchen = User::query()->where('role', 'kitchen')->first();
        $servers = User::query()->where('role', 'server')->orderBy('id')->get();

        if (!$admin) {
            $admin = User::query()->firstOrCreate(
                ['email' => 'admin@razaf.com'],
                ['name' => 'Admin Razaf', 'password' => bcrypt('admin123'), 'role' => 'admin']
            );
        }

        if (!$cashier) {
            $cashier = User::query()->firstOrCreate(
                ['email' => 'cashier@razaf.com'],
                ['name' => 'Caisse Razaf', 'password' => bcrypt('cashier123'), 'role' => 'cashier']
            );
        }

        if (!$kitchen) {
            $kitchen = User::query()->firstOrCreate(
                ['email' => 'kitchen@razaf.com'],
                ['name' => 'Cuisine Razaf', 'password' => bcrypt('kitchen123'), 'role' => 'kitchen']
            );
        }

        if ($servers->isEmpty()) {
            $server = User::query()->firstOrCreate(
                ['email' => 'server@razaf.com'],
                ['name' => 'Serveur Razaf', 'password' => bcrypt('server123'), 'role' => 'server']
            );
            $servers = collect([$server]);
        }

        return [
            'admin' => $admin,
            'cashier' => $cashier,
            'kitchen' => $kitchen,
            'servers' => $servers,
        ];
    }

    /**
     * @return Collection<int, Customer>
     */
    private function seedExtraCustomers(): Collection
    {
        $profiles = [
            ['name' => 'Rina Randria', 'email' => 'rina.randria@demo.local', 'phone' => '+261340001001', 'notes' => 'Préfère service rapide', 'preferred_cooking' => 'À point', 'allergies' => 'Aucune'],
            ['name' => 'Mbola Rakoto', 'email' => 'mbola.rakoto@demo.local', 'phone' => '+261340001002', 'notes' => 'Client régulier du midi', 'preferred_cooking' => 'Bien cuit', 'allergies' => 'Arachides'],
            ['name' => 'Soa Hanta', 'email' => 'soa.hanta@demo.local', 'phone' => '+261340001003', 'notes' => 'Souvent en groupe', 'preferred_cooking' => 'Moyenne', 'allergies' => 'Fruits de mer'],
            ['name' => 'Toky Raman', 'email' => 'toky.raman@demo.local', 'phone' => '+261340001004', 'notes' => 'Préférence table terrasse', 'preferred_cooking' => 'À point', 'allergies' => 'Aucune'],
            ['name' => 'Noro Lalaina', 'email' => 'noro.lalaina@demo.local', 'phone' => '+261340001005', 'notes' => 'Sans sucre ajouté quand possible', 'preferred_cooking' => 'Moyenne', 'allergies' => 'Lactose'],
            ['name' => 'Jean Claude M.', 'email' => 'jean.claude@demo.local', 'phone' => '+261340001006', 'notes' => 'Réservation fréquente soirée', 'preferred_cooking' => 'Bien cuit', 'allergies' => 'Aucune'],
            ['name' => 'Sarah Razafy', 'email' => 'sarah.razafy@demo.local', 'phone' => '+261340001007', 'notes' => 'Commande souvent cocktails', 'preferred_cooking' => 'À point', 'allergies' => 'Aucune'],
            ['name' => 'Hery N.', 'email' => 'hery.n@demo.local', 'phone' => '+261340001008', 'notes' => 'Allergie légère au piment', 'preferred_cooking' => 'Moyenne', 'allergies' => 'Piments forts'],
        ];

        $limit = min(count($profiles), max(1, $this->volumeInt('extra_customers_count', count($profiles))));
        $profiles = array_slice($profiles, 0, $limit);

        foreach ($profiles as $profile) {
            Customer::query()->updateOrCreate(
                ['email' => $profile['email']],
                [
                    'name' => $profile['name'],
                    'phone' => $profile['phone'],
                    'notes' => $profile['notes'],
                    'preferred_cooking' => $profile['preferred_cooking'],
                    'allergies' => $profile['allergies'],
                    'loyalty_points' => $this->faker->numberBetween(0, 180),
                ]
            );
        }

        return Customer::query()->orderBy('id')->get();
    }

    private function ensureCocktailCatalog(): void
    {
        $barSupplier = Supplier::query()->updateOrCreate(
            ['email' => 'spirit.import@suppliers.local'],
            [
                'name' => 'Spirit Import Madagascar',
                'phone' => '+261 34 100 9010',
            ]
        );

        $rawDefinitions = [
            ['name' => 'Rhum blanc', 'stock' => 95, 'unit' => 'L', 'cost' => 18500, 'reorder_level' => 12],
            ['name' => 'Vodka premium', 'stock' => 85, 'unit' => 'L', 'cost' => 21000, 'reorder_level' => 10],
            ['name' => 'Gin london dry', 'stock' => 72, 'unit' => 'L', 'cost' => 24500, 'reorder_level' => 9],
            ['name' => 'Triple sec', 'stock' => 50, 'unit' => 'L', 'cost' => 19500, 'reorder_level' => 8],
            ['name' => 'Jus d\'ananas concentré', 'stock' => 140, 'unit' => 'L', 'cost' => 7200, 'reorder_level' => 16],
            ['name' => 'Sirop de grenadine', 'stock' => 120, 'unit' => 'L', 'cost' => 6400, 'reorder_level' => 14],
            ['name' => 'Tonic', 'stock' => 180, 'unit' => 'L', 'cost' => 4200, 'reorder_level' => 25],
        ];

        $rawByName = [];
        foreach ($rawDefinitions as $definition) {
            $raw = RawMaterial::query()->updateOrCreate(
                ['name' => $definition['name']],
                [
                    'description' => 'Matière première boisson pour bar/cocktails.',
                    'stock' => $definition['stock'],
                    'unit' => $definition['unit'],
                    'cost' => $definition['cost'],
                    'reorder_level' => $definition['reorder_level'],
                ]
            );

            $rawByName[$definition['name']] = $raw;
            $barSupplier->rawMaterials()->syncWithoutDetaching([$raw->id]);
        }

        if (!$barSupplier->raw_material_id) {
            $barSupplier->raw_material_id = array_values($rawByName)[0]->id ?? null;
            $barSupplier->save();
        }

        $ingredientDefinitions = [
            ['name' => 'Rhum blanc 10ml', 'raw_name' => 'Rhum blanc'],
            ['name' => 'Vodka premium 10ml', 'raw_name' => 'Vodka premium'],
            ['name' => 'Gin london dry 10ml', 'raw_name' => 'Gin london dry'],
            ['name' => 'Triple sec 10ml', 'raw_name' => 'Triple sec'],
            ['name' => 'Jus ananas 10ml', 'raw_name' => 'Jus d\'ananas concentré'],
            ['name' => 'Sirop grenadine 10ml', 'raw_name' => 'Sirop de grenadine'],
            ['name' => 'Tonic 10ml', 'raw_name' => 'Tonic'],
            ['name' => 'Eau cocktail 10ml', 'raw_name' => 'Eau potable'],
            ['name' => 'Lait coco cocktail 10ml', 'raw_name' => 'Lait de coco'],
        ];

        $ingredientsByName = [];
        foreach ($ingredientDefinitions as $definition) {
            $raw = $rawByName[$definition['raw_name']] ?? RawMaterial::query()->where('name', $definition['raw_name'])->first();
            if (!$raw) {
                continue;
            }

            $metrics = $this->inventoryService->calculateIngredientMetrics($raw, 10, 'ml');

            $ingredient = Ingredient::query()->updateOrCreate(
                ['name' => $definition['name']],
                [
                    'raw_material_id' => $raw->id,
                    'portion_size' => 10,
                    'portion_unit' => 'ml',
                    'quantity_available' => $metrics['quantity_available'],
                    'cost_per_portion' => $metrics['cost_per_portion'],
                    'is_cocktail_ingredient' => true,
                ]
            );

            $ingredientsByName[$definition['name']] = $ingredient;
        }

        $cocktails = [
            [
                'name' => 'Mojito Tropical',
                'description' => 'Rhum blanc, tonic, sirop de grenadine et touche ananas.',
                'price' => 12000,
                'image_url' => 'https://loremflickr.com/900/600/mojito,cocktail,bar?lock=301',
                'ingredients' => [
                    'Rhum blanc 10ml' => 5,
                    'Tonic 10ml' => 12,
                    'Sirop grenadine 10ml' => 2,
                    'Jus ananas 10ml' => 3,
                ],
            ],
            [
                'name' => 'Madagascar Sunset',
                'description' => 'Vodka, triple sec, jus ananas et grenadine.',
                'price' => 13500,
                'image_url' => 'https://loremflickr.com/900/600/sunset,cocktail,drink?lock=302',
                'ingredients' => [
                    'Vodka premium 10ml' => 5,
                    'Triple sec 10ml' => 2,
                    'Jus ananas 10ml' => 8,
                    'Sirop grenadine 10ml' => 2,
                ],
            ],
            [
                'name' => 'Gin Coco Fizz',
                'description' => 'Gin, lait de coco, tonic et eau fraîche.',
                'price' => 14500,
                'image_url' => 'https://loremflickr.com/900/600/gin,coconut,cocktail?lock=303',
                'ingredients' => [
                    'Gin london dry 10ml' => 5,
                    'Lait coco cocktail 10ml' => 3,
                    'Tonic 10ml' => 10,
                    'Eau cocktail 10ml' => 3,
                ],
            ],
            [
                'name' => 'Vodka Island',
                'description' => 'Vodka, jus ananas, tonic, douceur tropicale.',
                'price' => 13000,
                'image_url' => 'https://loremflickr.com/900/600/vodka,tropical,cocktail?lock=304',
                'ingredients' => [
                    'Vodka premium 10ml' => 4,
                    'Jus ananas 10ml' => 10,
                    'Tonic 10ml' => 8,
                ],
            ],
            [
                'name' => 'Virgin Pine Cooler',
                'description' => 'Mocktail frais ananas, grenadine et tonic.',
                'price' => 9000,
                'image_url' => 'https://loremflickr.com/900/600/mocktail,pineapple,drink?lock=305',
                'ingredients' => [
                    'Jus ananas 10ml' => 10,
                    'Sirop grenadine 10ml' => 2,
                    'Tonic 10ml' => 8,
                    'Eau cocktail 10ml' => 3,
                ],
            ],
        ];

        foreach ($cocktails as $definition) {
            $menu = Menu::query()->updateOrCreate(
                ['name' => $definition['name']],
                [
                    'description' => $definition['description'],
                    'price' => $definition['price'],
                    'category' => 'cocktail',
                    'image_url' => $definition['image_url'],
                    'is_available' => true,
                ]
            );

            $syncPayload = [];
            foreach ($definition['ingredients'] as $ingredientName => $quantityNeeded) {
                $ingredient = $ingredientsByName[$ingredientName] ?? null;
                if (!$ingredient) {
                    continue;
                }
                $syncPayload[$ingredient->id] = ['quantity_needed' => $quantityNeeded];
            }

            if (!empty($syncPayload)) {
                $menu->ingredients()->sync($syncPayload);
            }
        }
    }

    private function refreshInventoryMaps(): void
    {
        $this->rawMaterials = RawMaterial::query()->orderBy('id')->get()->keyBy('id');
        $this->ingredients = Ingredient::query()->orderBy('id')->get()->keyBy('id');

        $this->rawIngredientIds = [];
        foreach ($this->ingredients as $ingredient) {
            $rawId = (int) $ingredient->raw_material_id;
            if ($rawId <= 0) {
                continue;
            }

            if (!isset($this->rawIngredientIds[$rawId])) {
                $this->rawIngredientIds[$rawId] = [];
            }

            $this->rawIngredientIds[$rawId][] = (int) $ingredient->id;
        }
    }

    private function seedSupplierPurchases(Collection $suppliers, User $admin): int
    {
        if ($suppliers->isEmpty()) {
            return 0;
        }

        $count = max(1, $this->volumeInt('supplier_purchases_count', 72));
        $daysMin = max(0, $this->volumeInt('supplier_purchases_days_min', 6));
        $daysMax = max($daysMin, $this->volumeInt('supplier_purchases_days_max', 60));
        $timestamps = collect(range(1, $count))
            ->map(function () use ($daysMin, $daysMax) {
                return now()
                    ->subDays($this->faker->numberBetween($daysMin, $daysMax))
                    ->setTime(
                        $this->faker->numberBetween(6, 19),
                        $this->faker->numberBetween(0, 59),
                        $this->faker->numberBetween(0, 59)
                    );
            })
            ->sort()
            ->values();

        $created = 0;

        foreach ($timestamps as $purchasedAt) {
            $supplier = $this->pickSupplierWithRawMaterials($suppliers);
            if (!$supplier) {
                continue;
            }

            $materialPool = $supplier->rawMaterials->isNotEmpty()
                ? $supplier->rawMaterials
                : collect([$supplier->rawMaterial])->filter();
            if ($materialPool->isEmpty()) {
                continue;
            }

            /** @var RawMaterial|null $rawMaterial */
            $rawMaterial = $materialPool->random();
            if (!$rawMaterial || !$this->rawMaterials->has($rawMaterial->id)) {
                continue;
            }

            [$quantity, $unitPrice] = $this->purchaseFiguresForRawMaterial($this->rawMaterials->get($rawMaterial->id));
            $totalAmount = round($quantity * $unitPrice, 2);
            if ($totalAmount <= 0) {
                continue;
            }

            $paymentMode = $this->weightedPick([
                'cash' => 45,
                'credit' => 55,
            ]);

            $status = $paymentMode === 'cash'
                ? $this->weightedPick(['paid' => 88, 'partial' => 12])
                : $this->weightedPick(['paid' => 22, 'partial' => 48, 'unpaid' => 30]);

            $paidAmount = match ($status) {
                'paid' => $totalAmount,
                'partial' => round($totalAmount * $this->faker->randomFloat(2, 0.2, 0.8), 2),
                default => 0.0,
            };
            $paidAmount = min($totalAmount, max(0, $paidAmount));
            $remainingAmount = round($totalAmount - $paidAmount, 2);

            if ($remainingAmount <= 0) {
                $status = 'paid';
            }

            $dueDate = $paymentMode === 'credit'
                ? $purchasedAt->copy()->addDays($this->faker->numberBetween(7, 24))->startOfDay()
                : null;

            $purchase = SupplierPurchase::query()->create([
                'supplier_id' => (int) $supplier->id,
                'raw_material_id' => (int) $rawMaterial->id,
                'quantity' => round($quantity, 3),
                'unit_price' => round($unitPrice, 2),
                'total_amount' => $totalAmount,
                'paid_amount' => $paidAmount,
                'remaining_amount' => $remainingAmount,
                'payment_mode' => $paymentMode,
                'payment_status' => $status,
                'purchased_at' => $purchasedAt,
                'due_date' => $dueDate,
                'note' => $paymentMode === 'credit'
                    ? 'Achat crédit - règlement progressif.'
                    : 'Achat comptant.',
            ]);
            $this->stamp($purchase, $purchasedAt);

            if ($paidAmount > 0) {
                $splits = $this->splitAmount($paidAmount, $this->faker->numberBetween(1, 3), 1000);
                foreach ($splits as $index => $splitAmount) {
                    $paidAt = $purchasedAt
                        ->copy()
                        ->addDays($this->faker->numberBetween(0, 15))
                        ->addMinutes($this->faker->numberBetween(10, 420));

                    $payment = SupplierPurchasePayment::query()->create([
                        'supplier_purchase_id' => (int) $purchase->id,
                        'amount' => $splitAmount,
                        'method' => $this->weightedPick([
                            'cash' => 58,
                            'transfer' => 25,
                            'mobile_money' => 12,
                            'check' => 5,
                        ]),
                        'reference' => sprintf('SUPP-%d-%02d', $purchase->id, $index + 1),
                        'note' => $index === 0 ? 'Paiement initial fournisseur.' : 'Paiement complémentaire.',
                        'paid_at' => $paidAt,
                    ]);
                    $this->stamp($payment, $paidAt);
                }
            }

            $this->applyRawStockChange(
                rawMaterialId: (int) $rawMaterial->id,
                deltaInRawUnit: $quantity,
                reason: 'restock',
                notes: "Réapprovisionnement fournisseur #{$purchase->id} - {$supplier->name}",
                userId: (int) $admin->id,
                occurredAt: $purchasedAt
            );

            $this->createAction(
                userId: (int) $admin->id,
                action: 'supplier_purchase_created',
                entityType: 'SupplierPurchase',
                entityId: (int) $purchase->id,
                at: $purchasedAt,
                changes: [
                    'supplier' => $supplier->name,
                    'raw_material' => $rawMaterial->name,
                    'quantity' => round($quantity, 3),
                    'unit_price' => round($unitPrice, 2),
                    'total_amount' => $totalAmount,
                    'status' => $status,
                ]
            );

            $created++;
        }

        return $created;
    }

    /**
     * @return array{orders:int,payments:int,cash_in:int}
     */
    private function seedOrdersAndPayments(
        Collection $menus,
        Collection $tables,
        Collection $customers,
        array $users
    ): array {
        if ($menus->isEmpty()) {
            return ['orders' => 0, 'payments' => 0, 'cash_in' => 0];
        }

        $serverUsers = $users['servers'];
        $cashier = $users['cashier'];
        $kitchen = $users['kitchen'];

        $tableIds = $tables->pluck('id')->values()->all();
        $customerIds = $customers->pluck('id')->values()->all();

        $targetOrders = max(1, $this->volumeInt('orders_count', 240));
        $ordersDaysMax = max(0, $this->volumeInt('orders_days_max', 35));
        $maxItemsPerOrder = max(1, $this->volumeInt('max_items_per_order', 4));
        $orderTimes = collect(range(1, $targetOrders))
            ->map(function () use ($ordersDaysMax) {
                return now()
                    ->subDays($this->faker->numberBetween(0, $ordersDaysMax))
                    ->setTime(
                        $this->faker->numberBetween(10, 22),
                        $this->faker->numberBetween(0, 59),
                        $this->faker->numberBetween(0, 59)
                    );
            })
            ->sort()
            ->values();

        $orderCount = 0;
        $paymentCount = 0;
        $cashInCount = 0;
        $activeTableIds = [];

        foreach ($orderTimes as $orderAt) {
            $status = $this->pickOrderStatus($orderAt);
            $desiredItems = $this->faker->numberBetween(1, $maxItemsPerOrder);
            $lines = $this->buildOrderLines($menus, $desiredItems);
            if (empty($lines)) {
                continue;
            }

            /** @var User $server */
            $server = $serverUsers->random();
            $tableId = !empty($tableIds) && $this->faker->boolean(82)
                ? $tableIds[array_rand($tableIds)]
                : null;
            $customerId = !empty($customerIds) && $this->faker->boolean(74)
                ? $customerIds[array_rand($customerIds)]
                : null;

            $specialRequests = $this->faker->boolean(35)
                ? $this->faker->randomElement([
                    'Sans piment',
                    'Service rapide',
                    'Peu salé',
                    'Sans glaçons',
                    'Mettre de côté la sauce',
                    'Allergie signalée au serveur',
                ])
                : null;

            $order = Order::query()->create([
                'user_id' => (int) $server->id,
                'table_id' => $tableId,
                'customer_id' => $customerId,
                'total_amount' => 0,
                'status' => $status,
                'special_requests' => $specialRequests,
                'is_urgent' => $this->faker->boolean(14),
                'prepared_at' => null,
                'ready_at' => null,
                'served_at' => null,
                'paid_at' => null,
            ]);

            $total = 0.0;
            foreach ($lines as $line) {
                /** @var Menu $menu */
                $menu = $line['menu'];
                $quantity = $line['quantity'];
                $itemStatus = $this->itemStatusForOrder($status);
                $lineTotal = round((float) $menu->price * $quantity, 2);
                $total += $lineTotal;

                $orderItem = OrderItem::query()->create([
                    'order_id' => (int) $order->id,
                    'menu_id' => (int) $menu->id,
                    'quantity' => $quantity,
                    'price_at_order' => (float) $menu->price,
                    'status' => $itemStatus,
                    'station' => PreparationStation::stationForMenu($menu),
                ]);
                $this->stamp($orderItem, $orderAt->copy()->addMinutes($this->faker->numberBetween(1, 20)));
            }

            $preparedAt = in_array($status, ['in_kitchen', 'ready', 'served', 'paid', 'archived'], true)
                ? $orderAt->copy()->addMinutes($this->faker->numberBetween(5, 25))
                : null;
            $readyAt = in_array($status, ['ready', 'served', 'paid', 'archived'], true) && $preparedAt
                ? $preparedAt->copy()->addMinutes($this->faker->numberBetween(8, 35))
                : null;
            $servedAt = in_array($status, ['served', 'paid', 'archived'], true) && $readyAt
                ? $readyAt->copy()->addMinutes($this->faker->numberBetween(3, 18))
                : null;
            $paidAt = in_array($status, ['paid', 'archived'], true) && $servedAt
                ? $servedAt->copy()->addMinutes($this->faker->numberBetween(4, 22))
                : null;

            $consumedAt = $preparedAt ?? $orderAt->copy()->addMinutes(8);
            $this->consumeInventoryForOrder($lines, (int) $order->id, $consumedAt, (int) $kitchen->id);

            $order->total_amount = round($total, 2);
            $order->prepared_at = $preparedAt;
            $order->ready_at = $readyAt;
            $order->served_at = $servedAt;
            $order->paid_at = $paidAt;
            $order->save();

            $updatedAt = $paidAt ?? $servedAt ?? $readyAt ?? $preparedAt ?? $orderAt;
            $this->stamp($order, $orderAt, $updatedAt);

            if (in_array($status, ['paid', 'archived'], true) && $paidAt) {
                $discountPercent = $this->weightedPick([
                    0 => 74,
                    5 => 18,
                    10 => 8,
                ]);
                $discountAmount = round((($total) * ((int) $discountPercent)) / 100, 2);
                $paidAmount = round(max(0, $total - $discountAmount), 2);

                $method = $this->weightedPick([
                    'cash' => 55,
                    'mobile_money' => 23,
                    'transfer' => 16,
                    'check' => 6,
                ]);

                $payment = Payment::query()->create([
                    'order_id' => (int) $order->id,
                    'amount' => $paidAmount,
                    'discount_percent' => (int) $discountPercent,
                    'discount_amount' => $discountAmount,
                    'method' => $method,
                    'status' => 'completed',
                    'reference' => $method === 'cash'
                        ? null
                        : sprintf('%s-%s-%d', strtoupper($method), $paidAt->format('ymdHis'), $order->id),
                ]);
                $this->stamp($payment, $paidAt);

                $cashMovement = CashMovement::query()->create([
                    'direction' => 'in',
                    'status' => 'approved',
                    'amount' => $paidAmount,
                    'payment_method' => $method,
                    'description' => "Encaissement commande #{$order->id}",
                    'reason' => (int) $discountPercent > 0
                        ? "Encaissement avec réduction {$discountPercent}%."
                        : 'Encaissement standard.',
                    'requested_by_user_id' => (int) $cashier->id,
                    'approved_by_user_id' => (int) $cashier->id,
                    'payment_id' => (int) $payment->id,
                    'order_id' => (int) $order->id,
                    'metadata' => [
                        'source' => 'payment',
                        'discount_percent' => (int) $discountPercent,
                        'discount_amount' => $discountAmount,
                    ],
                    'approved_at' => $paidAt,
                    'rejected_at' => null,
                ]);
                $this->stamp($cashMovement, $paidAt, $paidAt, ['approved_at' => $paidAt]);

                $this->createAction(
                    userId: (int) $cashier->id,
                    action: 'cash_payment_recorded',
                    entityType: 'CashMovement',
                    entityId: (int) $cashMovement->id,
                    at: $paidAt,
                    changes: [
                        'order_id' => (int) $order->id,
                        'payment_id' => (int) $payment->id,
                        'amount' => $paidAmount,
                        'method' => $method,
                    ]
                );

                $paymentCount++;
                $cashInCount++;
            }

            if ($tableId && in_array($status, ['pending', 'in_kitchen', 'ready', 'served'], true)) {
                $activeTableIds[] = (int) $tableId;
            }

            $orderCount++;
        }

        DB::table('tables')->update([
            'status' => 'free',
            'updated_at' => now(),
        ]);

        $activeTableIds = array_values(array_unique($activeTableIds));
        if (!empty($activeTableIds)) {
            DB::table('tables')
                ->whereIn('id', $activeTableIds)
                ->update([
                    'status' => 'occupied',
                    'updated_at' => now(),
                ]);
        }

        return [
            'orders' => $orderCount,
            'payments' => $paymentCount,
            'cash_in' => $cashInCount,
        ];
    }

    /**
     * @return array{approved:int,pending:int,rejected:int}
     */
    private function seedCashWithdrawals(array $users): array
    {
        $cashier = $users['cashier'];
        $admin = $users['admin'];

        $cashInCash = (float) CashMovement::query()
            ->where('direction', 'in')
            ->where('status', 'approved')
            ->where('payment_method', 'cash')
            ->sum('amount');

        if ($cashInCash <= 0) {
            return ['approved' => 0, 'pending' => 0, 'rejected' => 0];
        }

        $approvedBudget = round($cashInCash * 0.22, 2);
        $approvedAmounts = $this->splitAmount(
            $approvedBudget,
            max(1, $this->volumeInt('cash_out_approved_count', 10)),
            2500
        );
        $pendingAmounts = $this->splitAmount(
            round($cashInCash * 0.08, 2),
            max(1, $this->volumeInt('cash_out_pending_count', 7)),
            2000
        );
        $rejectedAmounts = $this->splitAmount(
            round($cashInCash * 0.05, 2),
            max(1, $this->volumeInt('cash_out_rejected_count', 5)),
            1800
        );

        $approved = 0;
        foreach ($approvedAmounts as $index => $amount) {
            $at = now()
                ->subDays($this->faker->numberBetween(0, 24))
                ->setTime($this->faker->numberBetween(9, 20), $this->faker->numberBetween(0, 59));

            $movement = CashMovement::query()->create([
                'direction' => 'out',
                'status' => 'approved',
                'amount' => $amount,
                'payment_method' => 'cash',
                'description' => 'Sortie exceptionnelle admin',
                'reason' => $this->faker->randomElement([
                    'Achat urgence maintenance',
                    'Décaissement petit matériel',
                    'Remboursement client exceptionnel',
                    'Achat consommables bar',
                ]),
                'requested_by_user_id' => (int) $cashier->id,
                'approved_by_user_id' => (int) $admin->id,
                'metadata' => [
                    'source' => 'admin_exception',
                    'batch' => 'seed_approved',
                ],
                'approved_at' => $at,
                'rejected_at' => null,
            ]);
            $this->stamp($movement, $at, $at, ['approved_at' => $at]);

            $this->createAction(
                userId: (int) $admin->id,
                action: 'cash_withdrawal_approved',
                entityType: 'CashMovement',
                entityId: (int) $movement->id,
                at: $at,
                changes: ['amount' => $amount, 'seed' => true, 'index' => $index + 1]
            );

            $approved++;
        }

        $pending = 0;
        foreach ($pendingAmounts as $index => $amount) {
            $at = now()
                ->subDays($this->faker->numberBetween(0, 6))
                ->setTime($this->faker->numberBetween(10, 22), $this->faker->numberBetween(0, 59));

            $movement = CashMovement::query()->create([
                'direction' => 'out',
                'status' => 'pending',
                'amount' => $amount,
                'payment_method' => 'cash',
                'description' => 'Demande sortie caisse',
                'reason' => $this->faker->randomElement([
                    'Approvisionnement urgent du bar',
                    'Achat de dépannage en cuisine',
                    'Transport fournisseur',
                    'Petite caisse événement',
                ]),
                'requested_by_user_id' => (int) $cashier->id,
                'approved_by_user_id' => null,
                'metadata' => [
                    'source' => 'cashier_request',
                    'batch' => 'seed_pending',
                ],
                'approved_at' => null,
                'rejected_at' => null,
            ]);
            $this->stamp($movement, $at);

            $this->createAction(
                userId: (int) $cashier->id,
                action: 'cash_withdrawal_requested',
                entityType: 'CashMovement',
                entityId: (int) $movement->id,
                at: $at,
                changes: ['amount' => $amount, 'seed' => true, 'index' => $index + 1]
            );

            $pending++;
        }

        $rejected = 0;
        foreach ($rejectedAmounts as $index => $amount) {
            $at = now()
                ->subDays($this->faker->numberBetween(3, 18))
                ->setTime($this->faker->numberBetween(9, 18), $this->faker->numberBetween(0, 59));
            $rejectAt = $at->copy()->addMinutes($this->faker->numberBetween(40, 300));

            $movement = CashMovement::query()->create([
                'direction' => 'out',
                'status' => 'rejected',
                'amount' => $amount,
                'payment_method' => 'cash',
                'description' => 'Demande sortie caisse',
                'reason' => $this->faker->randomElement([
                    'Montant trop élevé pour la caisse disponible',
                    'Justificatif incomplet',
                    'Demande reportée à validation mensuelle',
                ]),
                'requested_by_user_id' => (int) $cashier->id,
                'approved_by_user_id' => (int) $admin->id,
                'metadata' => [
                    'source' => 'cashier_request',
                    'batch' => 'seed_rejected',
                    'admin_note' => 'Refusé dans ce scénario de test.',
                ],
                'approved_at' => null,
                'rejected_at' => $rejectAt,
            ]);
            $this->stamp($movement, $at, $rejectAt, ['rejected_at' => $rejectAt]);

            $this->createAction(
                userId: (int) $admin->id,
                action: 'cash_withdrawal_rejected',
                entityType: 'CashMovement',
                entityId: (int) $movement->id,
                at: $rejectAt,
                changes: ['amount' => $amount, 'seed' => true, 'index' => $index + 1]
            );

            $rejected++;
        }

        return [
            'approved' => $approved,
            'pending' => $pending,
            'rejected' => $rejected,
        ];
    }

    private function seedTableReservations(Collection $tables): void
    {
        $freeTables = RestaurantTable::query()
            ->where('status', 'free')
            ->orderBy('table_number')
            ->get();

        if ($freeTables->isEmpty()) {
            return;
        }

        $reserveCount = min(max(1, $this->volumeInt('table_reservation_count', 2)), $freeTables->count());
        $reserved = $freeTables->shuffle()->take($reserveCount)->values();

        foreach ($reserved as $index => $table) {
            $reservationAt = now()
                ->addDays($index + 1)
                ->setTime($this->faker->numberBetween(18, 21), $this->faker->randomElement([0, 15, 30, 45]));

            $table->update([
                'status' => 'reserved',
                'reservation_name' => $this->faker->name(),
                'reservation_phone' => '+261 ' . $this->faker->numerify('3# ### ####'),
                'reservation_at' => $reservationAt,
                'reservation_notes' => $this->faker->randomElement([
                    'Anniversaire - préparer dessert surprise.',
                    'Table calme souhaitée.',
                    'Groupe entreprise, service rapide demandé.',
                ]),
            ]);
        }
    }

    private function pickSupplierWithRawMaterials(Collection $suppliers): ?Supplier
    {
        $eligible = $suppliers->filter(function (Supplier $supplier) {
            if ($supplier->rawMaterials->isNotEmpty()) {
                return true;
            }

            return $supplier->rawMaterial !== null;
        })->values();

        if ($eligible->isEmpty()) {
            return null;
        }

        /** @var Supplier $supplier */
        $supplier = $eligible->random();

        return $supplier;
    }

    /**
     * @return array{0:float,1:float}
     */
    private function purchaseFiguresForRawMaterial(RawMaterial $rawMaterial): array
    {
        $unit = strtolower((string) $rawMaterial->unit);

        if (in_array($unit, ['l', 'litre', 'litres', 'ml', 'cl'], true)) {
            $quantity = $this->faker->randomFloat(3, 6, 45);
        } elseif (in_array($unit, ['kg', 'g', 'gramme', 'grammes'], true)) {
            $quantity = $this->faker->randomFloat(3, 4, 30);
        } else {
            $quantity = (float) $this->faker->numberBetween(25, 260);
        }

        $baseCost = max(1.0, (float) $rawMaterial->cost);
        $unitPrice = $this->faker->randomFloat(2, $baseCost * 0.82, $baseCost * 1.28);

        return [round($quantity, 3), round($unitPrice, 2)];
    }

    /**
     * @return array<int, array{menu: Menu, quantity: int}>
     */
    private function buildOrderLines(Collection $menus, int $desiredItems): array
    {
        $lines = [];
        $alreadyUsed = [];

        $pool = $menus->shuffle()->values();
        foreach ($pool as $menu) {
            if (count($lines) >= $desiredItems) {
                break;
            }

            if (isset($alreadyUsed[$menu->id])) {
                continue;
            }

            $quantity = $this->weightedPick([
                1 => 58,
                2 => 31,
                3 => 11,
            ]);

            if (!$this->canPrepareMenu($menu, (int) $quantity)) {
                continue;
            }

            $lines[] = [
                'menu' => $menu,
                'quantity' => (int) $quantity,
            ];
            $alreadyUsed[$menu->id] = true;
        }

        return $lines;
    }

    private function canPrepareMenu(Menu $menu, int $menuQuantity): bool
    {
        if ($menuQuantity <= 0) {
            return false;
        }

        foreach ($menu->ingredients as $ingredientRef) {
            $ingredient = $this->ingredients->get((int) $ingredientRef->id);
            if (!$ingredient) {
                return false;
            }

            $requiredPortions = (int) ($ingredientRef->pivot->quantity_needed ?? 0) * $menuQuantity;
            if ($requiredPortions <= 0) {
                continue;
            }

            if ((int) $ingredient->quantity_available < $requiredPortions) {
                return false;
            }

            $rawMaterial = $this->rawMaterials->get((int) $ingredient->raw_material_id);
            if (!$rawMaterial) {
                return false;
            }

            $requiredRaw = $this->inventoryService->calculateIngredientRawUsage($ingredient, $requiredPortions);
            if ((float) $rawMaterial->stock + 0.000001 < $requiredRaw) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param array<int, array{menu: Menu, quantity: int}> $lines
     */
    private function consumeInventoryForOrder(array $lines, int $orderId, Carbon $consumedAt, int $userId): void
    {
        $rawUsageById = [];
        $trackedIngredientsByRaw = [];

        foreach ($lines as $line) {
            /** @var Menu $menu */
            $menu = $line['menu'];
            $quantity = $line['quantity'];

            foreach ($menu->ingredients as $ingredientRef) {
                $ingredientId = (int) $ingredientRef->id;
                $ingredient = $this->ingredients->get($ingredientId);
                if (!$ingredient) {
                    continue;
                }

                $requiredPortions = (int) ($ingredientRef->pivot->quantity_needed ?? 0) * $quantity;
                if ($requiredPortions <= 0) {
                    continue;
                }

                $rawUsage = $this->inventoryService->calculateIngredientRawUsage($ingredient, $requiredPortions);
                $rawId = (int) $ingredient->raw_material_id;

                if (!isset($rawUsageById[$rawId])) {
                    $rawUsageById[$rawId] = 0.0;
                }
                $rawUsageById[$rawId] += $rawUsage;

                if (!isset($trackedIngredientsByRaw[$rawId])) {
                    $trackedIngredientsByRaw[$rawId] = [];
                }
                $trackedIngredientsByRaw[$rawId][$ingredientId] = true;
            }
        }

        foreach ($rawUsageById as $rawId => $usage) {
            $delta = -1 * (float) $usage;
            if (abs($delta) < 0.000001) {
                continue;
            }

            $trackedIds = array_keys($trackedIngredientsByRaw[$rawId] ?? []);

            $this->applyRawStockChange(
                rawMaterialId: (int) $rawId,
                deltaInRawUnit: $delta,
                reason: 'usage',
                notes: "Consommation de production commande #{$orderId}",
                userId: $userId,
                occurredAt: $consumedAt,
                trackedIngredientIds: $trackedIds
            );
        }
    }

    /**
     * @param array<int>|null $trackedIngredientIds
     */
    private function applyRawStockChange(
        int $rawMaterialId,
        float $deltaInRawUnit,
        string $reason,
        string $notes,
        int $userId,
        Carbon $occurredAt,
        ?array $trackedIngredientIds = null
    ): void {
        /** @var RawMaterial|null $rawMaterial */
        $rawMaterial = $this->rawMaterials->get($rawMaterialId);
        if (!$rawMaterial) {
            return;
        }

        $oldRawStock = (float) $rawMaterial->stock;
        $effectiveDelta = $deltaInRawUnit;
        if ($effectiveDelta < 0 && abs($effectiveDelta) > $oldRawStock) {
            $effectiveDelta = -1 * $oldRawStock;
        }

        $newRawStock = round(max(0, $oldRawStock + $effectiveDelta), 4);
        $rawMaterial->stock = $newRawStock;
        $rawMaterial->save();

        $ingredientIds = $this->rawIngredientIds[$rawMaterialId] ?? [];
        foreach ($ingredientIds as $ingredientId) {
            /** @var Ingredient|null $ingredient */
            $ingredient = $this->ingredients->get((int) $ingredientId);
            if (!$ingredient) {
                continue;
            }

            $oldQuantity = (float) $ingredient->quantity_available;

            $metrics = $this->inventoryService->calculateIngredientMetrics(
                $rawMaterial,
                (float) $ingredient->portion_size,
                (string) $ingredient->portion_unit
            );

            $newQuantity = (float) $metrics['quantity_available'];
            $ingredient->quantity_available = (int) $newQuantity;
            $ingredient->cost_per_portion = (float) $metrics['cost_per_portion'];
            $ingredient->save();

            $shouldTrack = $trackedIngredientIds === null
                || in_array((int) $ingredient->id, $trackedIngredientIds, true);
            $deltaQuantity = round($newQuantity - $oldQuantity, 2);

            if ($shouldTrack && abs($deltaQuantity) >= 0.01) {
                $adjustment = StockAdjustment::query()->create([
                    'adjustable_type' => Ingredient::class,
                    'adjustable_id' => (int) $ingredient->id,
                    'user_id' => $userId,
                    'type' => 'ingredient',
                    'quantity' => $deltaQuantity,
                    'reason' => $reason,
                    'notes' => $notes,
                    'old_stock' => round($oldQuantity, 2),
                    'new_stock' => round($newQuantity, 2),
                ]);
                $this->stamp($adjustment, $occurredAt);
            }
        }
    }

    private function pickOrderStatus(Carbon $orderAt): string
    {
        if ($orderAt->lessThan(now()->subDays(2))) {
            return $this->weightedPick([
                'paid' => 79,
                'served' => 10,
                'ready' => 6,
                'archived' => 5,
            ]);
        }

        return $this->weightedPick([
            'paid' => 38,
            'served' => 16,
            'ready' => 16,
            'in_kitchen' => 14,
            'pending' => 10,
            'archived' => 6,
        ]);
    }

    private function itemStatusForOrder(string $orderStatus): string
    {
        return match ($orderStatus) {
            'paid', 'served', 'archived' => 'served',
            'ready' => 'ready',
            'in_kitchen' => $this->weightedPick(['in_kitchen' => 72, 'pending' => 28]),
            default => 'pending',
        };
    }

    /**
     * @param array<string|int, int> $weightedValues
     * @return mixed
     */
    private function weightedPick(array $weightedValues)
    {
        $total = array_sum($weightedValues);
        $rand = $this->faker->numberBetween(1, max(1, $total));
        $cursor = 0;

        foreach ($weightedValues as $value => $weight) {
            $cursor += (int) $weight;
            if ($rand <= $cursor) {
                return is_numeric($value) ? (int) $value : $value;
            }
        }

        $first = array_key_first($weightedValues);
        return is_numeric($first) ? (int) $first : $first;
    }

    /**
     * @return array<int, float>
     */
    private function splitAmount(float $total, int $count, float $minPerChunk): array
    {
        $total = round(max(0, $total), 2);
        if ($total <= 0) {
            return [];
        }

        $count = max(1, $count);
        $maxPossible = (int) floor($total / max(1.0, $minPerChunk));
        if ($maxPossible > 0) {
            $count = min($count, $maxPossible);
        }

        if ($count <= 1) {
            return [round($total, 2)];
        }

        $remaining = $total;
        $parts = [];

        for ($i = 1; $i < $count; $i++) {
            $remainingParts = $count - $i;
            $minLeft = $remainingParts * $minPerChunk;
            $maxCurrent = max($minPerChunk, $remaining - $minLeft);

            if ($maxCurrent <= $minPerChunk) {
                $chunk = $minPerChunk;
            } else {
                $chunk = round($this->faker->randomFloat(2, $minPerChunk, $maxCurrent), 2);
            }

            $chunk = min($chunk, $remaining - $minLeft);
            $chunk = round(max($minPerChunk, $chunk), 2);

            $parts[] = $chunk;
            $remaining = round($remaining - $chunk, 2);
        }

        $parts[] = round(max(0, $remaining), 2);

        $normalized = array_values(array_filter($parts, fn ($value) => $value > 0));
        $sum = round(array_sum($normalized), 2);

        if ($sum !== $total && !empty($normalized)) {
            $normalized[count($normalized) - 1] = round($normalized[count($normalized) - 1] + ($total - $sum), 2);
        }

        return $normalized;
    }

    /**
     * @param array<string, mixed> $changes
     */
    private function createAction(
        int $userId,
        string $action,
        string $entityType,
        int $entityId,
        Carbon $at,
        array $changes
    ): void {
        ActionLog::query()->create([
            'user_id' => $userId,
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'changes' => $changes,
            'action_at' => $at,
        ]);
    }

    /**
     * @param array<string, mixed> $extra
     */
    private function stamp(Model $model, Carbon $createdAt, ?Carbon $updatedAt = null, array $extra = []): void
    {
        $payload = array_merge(
            [
                'created_at' => $createdAt,
                'updated_at' => $updatedAt ?? $createdAt,
            ],
            $extra
        );

        $model->forceFill($payload)->saveQuietly();
    }
}
