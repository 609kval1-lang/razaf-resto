<?php

namespace App\Services;

use App\Models\Order;
use App\Models\RestaurantTable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Schema;

class OrderTableService
{
    public function activeFor(int $tableId): Builder
    {
        return $this->activeOrders()->where(function ($query) use ($tableId) {
                $query->where('table_id', $tableId);
                if (Schema::hasColumn('orders', 'linked_table_ids')) $query->orWhereJsonContains('linked_table_ids', $tableId);
            });
    }

    public function activeOrders(): Builder
    {
        return Order::query()->whereIn('status', ['pending', 'preparing', 'in_kitchen', 'ready', 'served'])->where('occupies_table', true);
    }

    public function ids(Order $order): array
    {
        return array_values(array_unique(array_filter([(int) $order->table_id, ...($order->linked_table_ids ?? [])])));
    }

    public function release(Order $order): void
    {
        foreach ($this->ids($order) as $id) {
            $table = RestaurantTable::whereKey($id)->lockForUpdate()->first();
            if ($table && !$this->activeFor($id)->exists()) $table->setFree();
        }
    }
}
