<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Menu;
use App\Models\Customer;
use App\Models\Order;
use App\Models\ActionLog;
use App\Models\RestaurantTable;
use App\Models\User;
use App\Services\OrderTableService;
use App\Services\OrderStockService;
use App\Support\Ariary;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class CashierOrderEntryController extends Controller
{
    public function __construct(private OrderStockService $stock) {}

    public function tables(): JsonResponse
    {
        $tableService = app(OrderTableService::class);
        $activeOrders = $tableService->activeOrders()->select(['id', 'table_id', 'total_amount',
            ...(Schema::hasColumn('orders', 'order_label') ? ['order_label', 'linked_table_ids'] : [])])
            ->withSum('items', 'quantity')->orderBy('id')->get();
        $tables = RestaurantTable::query()
            ->select(['id', 'table_number', 'capacity', 'section', 'status', 'reservation_at', 'reservation_name'])
            ->orderBy('table_number')
            ->get()
            ->map(function (RestaurantTable $table) use ($activeOrders, $tableService) {
                $active = $activeOrders->filter(fn ($order) => in_array($table->id, $tableService->ids($order), true));
                $current = $active->first();
                return [
                'id' => $table->id,
                'table_number' => $table->table_number,
                'capacity' => $table->capacity,
                'section' => $table->section,
                'status' => $current
                    ? 'occupied'
                    : ($table->status === 'reserved' ? 'reserved' : 'free'),
                'active_order_id' => $current?->id,
                'active_orders' => $active->map(fn ($order) => ['id' => $order->id, 'order_label' => $order->order_label,
                    'total_amount' => Ariary::round($order->total_amount)])->values(),
                'active_order' => $current ? [
                    'id' => $current->id,
                    'total_amount' => Ariary::round($current->total_amount),
                    'item_count' => (int) ($current->items_sum_quantity ?? 0),
                ] : null,
                'reservation_at' => $table->reservation_at?->toDateTimeString(),
                'reservation_name' => $table->reservation_name,
                'reservation_locked' => $this->reservationLocked($table),
            ]; });

        return response()->json($tables);
    }

    public function menus(Request $request): JsonResponse
    {
        $request->validate([
            'search' => 'nullable|string|max:100', 'category' => 'nullable|string|max:100',
            'ids' => 'nullable|array|max:100', 'ids.*' => 'integer|min:1',
            'page' => 'nullable|integer|min:1',
        ]);
        $query = Menu::query()
            ->select(['id', 'name', 'description', 'price', 'category', 'image_url', 'is_available'])
            ->with('ingredients.rawMaterial')->orderBy('name')->orderBy('id');
        if ($request->filled('search')) $query->where('name', 'like', '%'.$request->string('search')->trim().'%');
        if ($request->filled('category')) $query->where('category', $request->input('category'));
        if ($request->has('ids')) $query->whereIn('id', $request->input('ids'));

        if ($request->boolean('paginate')) {
            $page = $query->paginate(12);
            return response()->json([
                'data' => $page->getCollection()->map(fn ($menu) => $this->presentMenu($menu)),
                'page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total(),
                'categories' => Menu::query()->whereNotNull('category')->distinct()->orderBy('category')->pluck('category'),
            ]);
        }
        return response()->json($query->get()->map(fn ($menu) => $this->presentMenu($menu)));
    }

    public function availability(): JsonResponse
    {
        return response()->json([
            'updated_at' => now()->toIso8601String(),
            'menus' => Menu::query()->with('ingredients.rawMaterial')->orderBy('name')->get()->map(fn ($menu) => [
                'id' => $menu->id, 'name' => $menu->name, 'category' => $menu->category,
                ...$this->stock->availability($menu),
                'portions' => $menu->ingredients->map(function ($ingredient) {
                    $raw = $ingredient->rawMaterial;
                    $available = 0;
                    if ($raw) {
                        try {
                            $available = app(\App\Services\InventoryService::class)->calculateIngredientMetrics(
                                $raw, (float) $ingredient->portion_size, (string) $ingredient->portion_unit
                            )['quantity_available'];
                        } catch (\InvalidArgumentException $exception) {
                            $available = 0;
                        }
                    }
                    return ['name' => $ingredient->name, 'available' => $available];
                }),
            ]),
        ]);
    }

    public function customers(): JsonResponse
    {
        $customers = Customer::query()->select(['id', 'name', 'preferred_cooking'])->orderBy('name')->get()
            ->map(function ($customer) {
                $name = preg_replace('/\s+/u', ' ', trim((string) $customer->name));
                foreach (array_filter([$customer->preferred_cooking, 'a point', 'saignant', 'bien cuit', 'bien cuite', 'bleu']) as $detail) {
                    $name = preg_replace('/\s*(?:-|,|\/|\|)?\s*\(?'.preg_quote($detail, '/').'\)?\s*$/iu', '', $name);
                }
                return ['id' => $customer->id, 'name' => trim($name)];
            })->filter(fn ($customer) => !in_array(Str::lower(Str::ascii($customer['name'])), ['', 'null', 'emporter', 'a emporter', 'takeaway'], true))
            ->unique(fn ($customer) => Str::lower(Str::ascii($customer['name'])))->values();
        return response()->json($customers);
    }

    public function store(Request $request): JsonResponse
    {
        abort_unless(Schema::hasColumn('orders', 'checkout_source'), 503, 'Appliquez la migration du nouveau flux caisse avant de creer une commande.');
        $data = $request->validate([
            'order_type' => 'nullable|in:dine_in,takeaway,other',
            'table_id' => 'required_if:order_type,dine_in|nullable|integer|exists:tables,id', 'checkout_token' => 'required|uuid',
            'order_label' => 'required_if:order_type,other|nullable|string|max:120',
            'notes' => 'nullable|string|max:5000', 'items' => 'required|array|min:1|max:100',
            'items.*.menu_id' => 'required|integer|distinct', 'items.*.quantity' => 'required|integer|min:1|max:100000',
        ]);
        $type = $data['order_type'] ?? 'dine_in';
        if (($type === 'dine_in' && empty($data['table_id'])) || ($type !== 'dine_in' && !empty($data['table_id']))) {
            throw ValidationException::withMessages(['table_id' => ['Selectionnez une table uniquement pour une commande sur place.']]);
        }
        if ($type === 'other' && trim($data['order_label'] ?? '') === '') {
            throw ValidationException::withMessages(['order_label' => ['Saisissez le nom de cette addition.']]);
        }
        if ($type === 'other') abort_unless(Schema::hasColumn('orders', 'order_label'), 503, 'Appliquez la migration des operations de caisse.');
        $order = DB::transaction(function () use ($data, $request, $type) {
            User::whereKey($request->user()->id)->lockForUpdate()->firstOrFail();
            $table = $type === 'dine_in' ? RestaurantTable::query()->whereKey($data['table_id'])->lockForUpdate()->firstOrFail() : null;
            $existing = Order::query()->where('checkout_token', $data['checkout_token'])->lockForUpdate()->first();
            if ($existing) {
                $expected = collect($data['items'])->pluck('quantity', 'menu_id')->map(fn ($quantity) => (int) $quantity)->sortKeys()->all();
                $actual = $existing->items()->pluck('quantity', 'menu_id')->map(fn ($quantity) => (int) $quantity)->sortKeys()->all();
                if ($existing->user_id !== $request->user()->id || $existing->table_id !== $table?->id || $existing->order_type !== $type
                    || (string) $existing->order_label !== (string) ($data['order_label'] ?? '')
                    || $expected !== $actual || (string) $existing->special_requests !== (string) ($data['notes'] ?? '')) {
                    throw ValidationException::withMessages(['checkout_token' => ['Cette validation correspond deja a une autre commande.']]);
                }
                return $existing;
            }
            if ($table && app(OrderTableService::class)->activeFor($table->id)->exists()) {
                throw ValidationException::withMessages(['table_id' => ['Cette table a deja une commande active. Reprenez son encaissement.']]);
            }
            if ($table && $this->reservationLocked($table)) {
                throw ValidationException::withMessages(['table_id' => ['Cette table est reservee et indisponible actuellement.']]);
            }
            $quantities = collect($data['items'])->pluck('quantity', 'menu_id');
            $menus = Menu::query()->whereIn('id', $quantities->keys())->with('ingredients.rawMaterial')->orderBy('id')->lockForUpdate()->get();
            if ($menus->count() !== $quantities->count() || $menus->contains(fn ($menu) => !$menu->is_available)) {
                throw ValidationException::withMessages(['items' => ['Un des plats selectionnes n\'est plus au catalogue.']]);
            }
            $total = 0;
            $requirements = [];
            foreach ($menus as $menu) {
                $quantity = (int) $quantities[$menu->id];
                $price = Ariary::round($menu->price);
                if ($price < 0 || $price > 999999) {
                    throw ValidationException::withMessages(['items' => ['Le prix du plat depasse la precision autorisee.']]);
                }
                $total += $price * $quantity;
                foreach ($this->stock->requirements($menu, $quantity) as $item) {
                    $id = $item['raw_material_id'];
                    $requirements[$id] ??= [...$item, 'quantity_units' => 0];
                    $requirements[$id]['quantity_units'] += $item['quantity_units'];
                }
            }
            if ($total <= 0 || $total > 99999999) {
                throw ValidationException::withMessages(['items' => ['Le total de la commande doit etre compris entre 1 et 99999999 Ar.']]);
            }
            foreach ($requirements as $requirement) {
                if ($requirement['quantity_units'] > $requirement['available_units']) {
                    throw ValidationException::withMessages(['stock' => ["Stock insuffisant pour {$requirement['name']}. Reduisez le panier."]]);
                }
            }
            $order = Order::create([
                'user_id' => $request->user()->id, 'table_id' => $table?->id,
                'order_type' => $type, 'status' => 'served', 'total_amount' => $total,
                ...(Schema::hasColumn('orders', 'order_label') ? ['order_label' => $data['order_label'] ?? null] : []),
                'special_requests' => $data['notes'] ?? null, 'occupies_table' => (bool) $table,
                'bill_requested_at' => now(), 'bill_requested_by_user_id' => $request->user()->id,
                'checkout_source' => 'cashier', 'checkout_token' => $data['checkout_token'],
                'stock_requirements' => array_values($requirements),
            ]);
            foreach ($menus as $menu) {
                $order->items()->create([
                    'menu_id' => $menu->id, 'quantity' => $quantities[$menu->id],
                    'price_at_order' => Ariary::round($menu->price), 'status' => 'served',
                    ...(Schema::hasColumn('order_items', 'stock_requirements') ? [
                        'stock_requirements' => $this->stock->requirements($menu), 'source_table_id' => $table?->id,
                    ] : []),
                ]);
            }
            $table?->setOccupied();
            ActionLog::create([
                'user_id' => $request->user()->id, 'action' => 'cashier_order_created', 'entity_type' => 'Order',
                'entity_id' => $order->id, 'changes' => ['table_id' => $table?->id, 'total_amount' => $total, 'order_type' => $type], 'action_at' => now(),
            ]);
            return $order;
        });
        return response()->json($order->load('items.menu:id,name', 'table:id,table_number'), 201);
    }

    private function presentMenu(Menu $menu): array
    {
        return [
            'id' => $menu->id, 'name' => $menu->name, 'description' => $menu->description,
            'price' => Ariary::round($menu->price), 'category' => $menu->category,
            'image_url' => $menu->image_url, 'is_available' => $menu->is_available,
            'ingredients' => $menu->ingredients->map(fn ($ingredient) => ['id' => $ingredient->id, 'name' => $ingredient->name])->values(),
            ...$this->stock->availability($menu),
        ];
    }

    private function reservationLocked(RestaurantTable $table): bool
    {
        return $table->status === 'reserved' && (!$table->reservation_at
            || (!$table->reservation_at->isPast() && now()->greaterThanOrEqualTo($table->reservation_at->copy()->subHours(2))));
    }
}
