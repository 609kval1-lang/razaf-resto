<?php

namespace App\Services;

use App\Models\ActionLog;
use App\Models\Menu;
use App\Models\Order;
use App\Models\RawMaterial;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

class OrderStockService
{
    public const STOCK_SCALE = 1000000;

    public function __construct(private InventoryService $inventory) {}

    public function requirements(Menu $menu, int $quantity = 1): array
    {
        if ($menu->ingredients->isEmpty()) {
            throw ValidationException::withMessages(['stock' => ["Recette non renseignee pour {$menu->name}."]]);
        }

        $requirements = [];
        foreach ($menu->ingredients as $ingredient) {
            $rawMaterial = $ingredient->rawMaterial;
            $portions = (int) $ingredient->pivot->quantity_needed;
            if (!$rawMaterial || $portions <= 0 || (float) $ingredient->portion_size <= 0) {
                throw ValidationException::withMessages(['stock' => ["Recette invalide pour {$menu->name} : {$ingredient->name}."]]);
            }
            try {
                $rawUnits = $this->inventory->calculateIngredientRawUsage($ingredient, $portions) * self::STOCK_SCALE;
            } catch (InvalidArgumentException $exception) {
                throw ValidationException::withMessages(['stock' => [$exception->getMessage()]]);
            }
            $units = (int) round($rawUnits);
            $tolerance = PHP_FLOAT_EPSILON * max(1.0, abs($rawUnits)) * 8;
            if ($units <= 0 || abs($rawUnits - $units) > $tolerance || $units > intdiv(PHP_INT_MAX, $quantity)) {
                throw ValidationException::withMessages(['stock' => ["Precision de portion insuffisante pour {$ingredient->name}."]]);
            }
            $units *= $quantity;
            $id = $rawMaterial->id;
            $requirements[$id] ??= [
                'raw_material_id' => $id, 'name' => $rawMaterial->name, 'unit' => $rawMaterial->unit,
                'quantity_units' => 0, 'available_units' => max(0, (int) round((float) $rawMaterial->stock * self::STOCK_SCALE)),
            ];
            if ($requirements[$id]['quantity_units'] > PHP_INT_MAX - $units) {
                throw ValidationException::withMessages(['stock' => ['La quantite demandee depasse la precision autorisee.']]);
            }
            $requirements[$id]['quantity_units'] += $units;
        }

        return array_values($requirements);
    }

    public function availability(Menu $menu): array
    {
        try {
            $requirements = $this->requirements($menu);
            $capacity = min(array_map(fn ($item) => intdiv($item['available_units'], $item['quantity_units']), $requirements));
            return [
                'max_portions_available' => $capacity,
                'is_orderable' => $menu->is_available && $capacity > 0,
                'stock_requirements' => $requirements,
                'availability_reason' => !$menu->is_available ? 'Indisponible au catalogue' : ($capacity > 0 ? null : 'Stock insuffisant'),
            ];
        } catch (ValidationException $exception) {
            return [
                'max_portions_available' => 0, 'is_orderable' => false, 'stock_requirements' => [],
                'availability_reason' => $exception->errors()['stock'][0],
            ];
        }
    }

    public function consume(Order $order, int $actorId): void
    {
        // Legacy orders already consumed stock when they were created.
        if ($order->checkout_source !== 'cashier' || $order->stock_deducted_at) return;
        $requirements = $order->stock_requirements;
        if (!is_array($requirements) || $requirements === []) {
            throw ValidationException::withMessages(['stock' => ['La recette enregistree de cette commande est introuvable.']]);
        }

        $materials = RawMaterial::query()->whereIn('id', array_column($requirements, 'raw_material_id'))
            ->orderBy('id')->lockForUpdate()->get()->keyBy('id');
        $errors = [];
        foreach ($requirements as $requirement) {
            $material = $materials->get($requirement['raw_material_id']);
            $available = $material ? (int) round((float) $material->stock * self::STOCK_SCALE) : 0;
            if (!$material || $available < $requirement['quantity_units']) {
                $needed = $requirement['quantity_units'] / self::STOCK_SCALE;
                $remaining = max(0, $available) / self::STOCK_SCALE;
                $errors[] = "{$requirement['name']} : {$needed} {$requirement['unit']} necessaires, {$remaining} disponibles.";
            }
        }
        if ($errors) throw ValidationException::withMessages(['stock' => $errors]);

        foreach ($requirements as $requirement) {
            $material = $materials->get($requirement['raw_material_id']);
            $available = (int) round((float) $material->stock * self::STOCK_SCALE);
            $material->stock = ($available - $requirement['quantity_units']) / self::STOCK_SCALE;
            $material->save();
            $this->inventory->syncIngredientsForRawMaterial($material);
        }
        $order->stock_deducted_at = now();
        $order->save();
        ActionLog::create([
            'user_id' => $actorId, 'action' => 'order_stock_consumed', 'entity_type' => 'Order',
            'entity_id' => $order->id, 'changes' => ['requirements' => $requirements], 'action_at' => now(),
        ]);
    }
}
