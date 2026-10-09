<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActionLog;
use App\Models\Order;
use App\Models\RestaurantTable;
use App\Models\User;
use App\Services\OrderStockService;
use App\Services\OrderTableService;
use App\Support\Ariary;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;

class CashierAdditionController extends Controller
{
    public function redistribute(Request $request, OrderStockService $stock, OrderTableService $tables)
    {
        abort_unless(Schema::hasColumn('orders', 'linked_table_ids'), 503, 'Appliquez la migration des operations de caisse.');
        $data = $request->validate([
            'order_ids' => 'required|array|min:1|max:20', 'order_ids.*' => 'required|integer|distinct|min:1',
            'checkout_token' => 'required|uuid', 'groups' => 'required|array|min:1|max:20',
            'groups.*.label' => 'required|string|max:120', 'groups.*.table_ids' => 'present|array|max:20',
            'groups.*.table_ids.*' => 'integer|min:1', 'groups.*.items' => 'required|array|min:1|max:200',
            'groups.*.items.*.item_id' => 'required|integer|min:1',
            'groups.*.items.*.quantity' => 'required|integer|min:1|max:100000',
        ]);
        $orders = DB::transaction(function () use ($data, $request, $stock, $tables) {
            User::whereKey($request->user()->id)->lockForUpdate()->firstOrFail();
            $previous = ActionLog::where('action', 'cashier_additions_redistributed')->where('user_id', $request->user()->id)
                ->whereJsonContains('changes->checkout_token', $data['checkout_token'])->first();
            if ($previous) {
                if (($previous->changes['payload'] ?? null) !== $data) $this->invalid('Cette validation correspond a une autre repartition.');
                return Order::whereIn('id', $previous->changes['new_order_ids'])->get();
            }
            $sources = Order::whereIn('id', $data['order_ids'])->orderBy('id')->lockForUpdate()->get();
            if ($sources->count() !== count($data['order_ids'])) $this->invalid('Une des commandes est introuvable.');
            foreach ($sources as $source) {
                if ($source->checkout_source !== 'cashier' || $source->stock_deducted_at
                    || in_array($source->status, ['paid', 'archived'], true) || $source->payments()->exists() || $source->with_packaging) {
                    $this->invalid('Seules les additions sans paiement ni document deja emis peuvent etre reparties.');
                }
            }
            $sourceTableIds = $sources->flatMap(fn ($order) => $tables->ids($order))->unique()->sort()->values()->all();
            $targetTableIds = collect($data['groups'])->flatMap(fn ($group) => $group['table_ids'])->unique()->sort()->values()->all();
            if ($sourceTableIds !== $targetTableIds) $this->invalid('Conservez toutes les tables associees aux commandes.');
            RestaurantTable::whereIn('id', $sourceTableIds)->orderBy('id')->lockForUpdate()->get();
            $items = $sources->flatMap(fn ($order) => $order->items()->with('menu.ingredients.rawMaterial')->get())->keyBy('id');
            $allocation = [];
            foreach ($data['groups'] as $group) {
                if (trim($group['label']) === '') $this->invalid('Nommez chaque addition.');
                foreach ($group['items'] as $line) {
                    if (!$items->has($line['item_id'])) $this->invalid('Un article ne fait pas partie des commandes selectionnees.');
                    $allocation[$line['item_id']] = ($allocation[$line['item_id']] ?? 0) + $line['quantity'];
                }
            }
            foreach ($items as $item) {
                if (($allocation[$item->id] ?? 0) !== (int) $item->quantity) $this->invalid('Repartissez exactement toutes les quantites, sans ajout ni perte.');
                if (!$item->stock_requirements) {
                    if (!$item->menu) $this->invalid('La recette archivee de ce plat est introuvable.');
                    $item->stock_requirements = $stock->requirements($item->menu);
                }
            }
            foreach ($sources as $source) {
                $expected = $this->sumRequirements($items->where('order_id', $source->id)->map(fn ($item) => [$item->stock_requirements, (int) $item->quantity])->all());
                $expectedUnits = collect($expected)->pluck('quantity_units', 'raw_material_id')->sortKeys()->all();
                $originalUnits = collect($source->stock_requirements)->pluck('quantity_units', 'raw_material_id')->sortKeys()->all();
                if ($expectedUnits !== $originalUnits) $this->invalid('La recette de cette ancienne commande a change. Sa repartition doit etre verifiee avant paiement.');
            }
            $created = new \Illuminate\Database\Eloquent\Collection();
            foreach ($data['groups'] as $group) {
                $total = collect($group['items'])->sum(fn ($line) => Ariary::lineTotal($items[$line['item_id']]->price_at_order, $line['quantity']));
                if ($total <= 0 || $total > 99999999) $this->invalid('Le total de chaque addition doit etre compris entre 1 et 99999999 Ar.');
                $tableIds = array_values(array_unique($group['table_ids']));
                $order = Order::create([
                    'user_id' => $request->user()->id, 'table_id' => $tableIds[0] ?? null, 'linked_table_ids' => array_slice($tableIds, 1),
                    'source_order_ids' => $sources->pluck('id')->all(), 'order_type' => 'other', 'order_label' => trim($group['label']),
                    'status' => 'served', 'occupies_table' => count($tableIds) > 0, 'total_amount' => $total,
                    'bill_requested_at' => now(), 'bill_requested_by_user_id' => $request->user()->id, 'checkout_source' => 'cashier',
                    'stock_requirements' => $this->sumRequirements(array_map(fn ($line) => [$items[$line['item_id']]->stock_requirements, $line['quantity']], $group['items'])),
                ]);
                foreach ($group['items'] as $line) {
                    $item = $items[$line['item_id']];
                    $order->items()->create(['menu_id' => $item->menu_id, 'quantity' => $line['quantity'], 'price_at_order' => $item->price_at_order,
                        'status' => 'served', 'stock_requirements' => $item->stock_requirements,
                        'source_table_id' => $item->source_table_id ?? $sources->firstWhere('id', $item->order_id)?->table_id]);
                }
                $created->push($order);
            }
            foreach ($sources as $source) $source->update(['status' => 'archived', 'occupies_table' => false]);
            ActionLog::create(['user_id' => $request->user()->id, 'action' => 'cashier_additions_redistributed', 'entity_type' => 'Order',
                'entity_id' => $created->first()->id, 'changes' => ['checkout_token' => $data['checkout_token'], 'payload' => $data,
                    'source_order_ids' => $sources->pluck('id')->all(), 'new_order_ids' => $created->pluck('id')->all()], 'action_at' => now()]);
            return $created;
        });
        return response()->json($orders->load('items.menu:id,name', 'table:id,table_number'), 201);
    }

    private function sumRequirements(array $lines): array
    {
        $requirements = [];
        foreach ($lines as [$snapshot, $quantity]) foreach ($snapshot as $requirement) {
            $id = $requirement['raw_material_id'];
            $requirements[$id] ??= [...$requirement, 'quantity_units' => 0];
            $units = (int) $requirement['quantity_units'];
            if ($units <= 0 || $units > intdiv(PHP_INT_MAX - $requirements[$id]['quantity_units'], $quantity)) $this->invalid('Quantite de stock hors limites.');
            $requirements[$id]['quantity_units'] += $units * $quantity;
        }
        return array_values($requirements);
    }

    private function invalid(string $message): never
    {
        throw ValidationException::withMessages(['groups' => [$message]]);
    }
}
