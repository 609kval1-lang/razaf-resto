<?php

namespace App\Http\Controllers\Api;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Ingredient;
use App\Http\Controllers\Controller;
use App\Support\PreparationStation;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

class KitchenController extends Controller
{
    // Voir portions disponibles
    public function getIngredientsStatus(Request $request)
    {
        $station = $this->resolveStation($request);

        $query = Ingredient::query()
            ->select([
                'id',
                'raw_material_id',
                'name',
                'portion_size',
                'portion_unit',
                'quantity_available',
            ])
            ->with('rawMaterial:id,name,unit');

        if ($station === PreparationStation::BAR) {
            $query->whereHas('menus', function ($menuQuery) {
                $this->applyBarMenuScope($menuQuery);
            });
        }

        $ingredients = $query->get();

        return response()->json($ingredients);
    }

    // Voir commandes en attente
    public function getPendingOrders(Request $request)
    {
        $station = $this->resolveStation($request);
        $lightweight = $request->boolean('lightweight', false);

        $query = Order::query()
            ->whereHas('items', function ($itemQuery) use ($station) {
                $itemQuery
                    ->where('station', $station)
                    ->whereIn('status', ['pending', 'in_kitchen']);
            })
            ->select([
                'id',
                'table_id',
                'customer_id',
                'user_id',
                'status',
                'is_urgent',
                'created_at',
            ])
            ->withCount([
                'items as station_pending_items_count' => function ($itemQuery) use ($station) {
                    $itemQuery
                        ->where('station', $station)
                        ->where('status', 'pending');
                },
                'items as station_started_items_count' => function ($itemQuery) use ($station) {
                    $itemQuery
                        ->where('station', $station)
                        ->whereIn('status', ['in_kitchen', 'ready', 'served']);
                },
            ])
            ->orderBy('is_urgent', 'desc')
            ->orderBy('created_at', 'asc');

        if ($lightweight) {
            $query->with([
                'table:id,table_number',
                'customer:id,name',
                'user:id,name',
            ]);
        } else {
            $query->with([
                'items' => function ($itemQuery) use ($station) {
                    $itemQuery
                        ->select(['id', 'order_id', 'menu_id', 'quantity', 'status', 'station'])
                        ->where('station', $station)
                        ->whereIn('status', ['pending', 'in_kitchen', 'ready', 'served']);
                },
                'items.menu:id,name,category',
                'items.menu.ingredients:id,name,portion_size,portion_unit',
                'table:id,table_number',
                'customer:id,name',
                'user:id,name',
            ]);
        }

        $orders = $query->get()->each(function (Order $order) {
            $pendingCount = (int) ($order->station_pending_items_count ?? 0);
            $startedCount = (int) ($order->station_started_items_count ?? 0);

            if ($order->relationLoaded('items')) {
                $order->station_status = $this->resolveStationStatusFromItems($order->items);
            } else {
                $order->station_status = $startedCount > 0
                    ? 'in_kitchen'
                    : ($pendingCount > 0 ? 'pending' : 'ready');
            }

            unset($order->station_pending_items_count, $order->station_started_items_count);
        });

        return response()->json($orders);
    }

    // Marquer commande en cours de préparation
    public function startOrder(Request $request, Order $order)
    {
        $station = $this->resolveStation($request);

        $updated = $order->items()
            ->where('station', $station)
            ->where('status', 'pending')
            ->update(['status' => 'in_kitchen']);

        if ($updated === 0) {
            return response()->json(['error' => 'Aucun article en attente pour ce poste.'], 422);
        }

        if (!$order->prepared_at) {
            $order->prepared_at = now();
        }

        $this->refreshOrderWorkflowStatus($order);

        return response()->json($order->fresh(['items.menu', 'table', 'customer', 'user']));
    }

    // Marquer un article en cours de préparation
    public function startOrderItem(Request $request, OrderItem $item)
    {
        return $this->transitionOrderItemStatus(
            $request,
            $item,
            ['pending'],
            'in_kitchen',
            'Cet article ne peut pas être démarré.'
        );
    }

    // Marquer un article prêt
    public function markOrderItemReady(Request $request, OrderItem $item)
    {
        return $this->transitionOrderItemStatus(
            $request,
            $item,
            ['pending', 'in_kitchen'],
            'ready',
            'Cet article ne peut pas être marqué prêt.'
        );
    }

    // Marquer commande prête
    public function markOrderReady(Request $request, Order $order)
    {
        $station = $this->resolveStation($request);

        $updated = $order->items()
            ->where('station', $station)
            ->whereIn('status', ['pending', 'in_kitchen'])
            ->update(['status' => 'ready']);

        if ($updated === 0) {
            return response()->json(['error' => 'Aucun article en préparation pour ce poste.'], 422);
        }

        $this->refreshOrderWorkflowStatus($order);

        return response()->json($order->fresh(['items.menu', 'table', 'customer', 'user']));
    }

    // Voir historique commandes
    public function getOrderHistory(Request $request)
    {
        $station = $this->resolveStation($request);
        $scope = $request->query('scope', 'today');

        $query = Order::query()
            ->whereHas('items', function ($itemQuery) use ($station) {
                $itemQuery
                    ->where('station', $station)
                    ->whereIn('status', ['ready', 'served']);
            })
            ->select(['id', 'table_id', 'customer_id', 'status', 'total_amount', 'created_at', 'ready_at', 'served_at', 'paid_at'])
            ->with([
                'items' => function ($itemQuery) use ($station) {
                    $itemQuery
                        ->select(['id', 'order_id', 'menu_id', 'quantity', 'price_at_order', 'status', 'station'])
                        ->where('station', $station);
                },
                'items.menu:id,name,category',
                'table:id,table_number',
                'customer:id,name',
                'latestPayment' => function ($paymentQuery) {
                    $paymentQuery->select([
                        'payments.id',
                        'payments.order_id',
                        'payments.method',
                    ]);
                },
            ])
            ->orderBy('created_at', 'desc');

        if ($scope !== 'all') {
            $query->whereBetween('created_at', [now()->startOfDay(), now()->endOfDay()]);
        }

        $orders = $query->limit(50)->get();

        return response()->json($orders);
    }

    // Statistiques cuisine
    public function getKitchenStats(Request $request)
    {
        $station = $this->resolveStation($request);
        $todayStart = now()->startOfDay();
        $todayEnd = now()->endOfDay();

        $pendingQuery = Order::query()->whereHas('items', function ($itemQuery) use ($station) {
            $itemQuery->where('station', $station)->where('status', 'pending');
        });

        $inProgressQuery = Order::query()
            ->whereHas('items', function ($itemQuery) use ($station) {
                $itemQuery->where('station', $station)->whereIn('status', ['in_kitchen', 'ready', 'served']);
            })
            ->whereHas('items', function ($itemQuery) use ($station) {
                $itemQuery->where('station', $station)->whereIn('status', ['pending', 'in_kitchen']);
            });

        $readyQuery = Order::query()
            ->whereHas('items', function ($itemQuery) use ($station) {
                $itemQuery->where('station', $station);
            })
            ->whereDoesntHave('items', function ($itemQuery) use ($station) {
                $itemQuery->where('station', $station)->whereIn('status', ['pending', 'in_kitchen']);
            })
            ->whereNotNull('ready_at')
            ->whereBetween('ready_at', [$todayStart, $todayEnd]);

        $urgentQuery = Order::query()
            ->where('status', '!=', 'paid')
            ->where('is_urgent', true)
            ->whereHas('items', function ($itemQuery) use ($station) {
                $itemQuery->where('station', $station)->whereIn('status', ['pending', 'in_kitchen']);
            });

        $lowIngredientsQuery = Ingredient::query()->where('quantity_available', '<', 5);
        if ($station === PreparationStation::BAR) {
            $lowIngredientsQuery->whereHas('menus', function ($menuQuery) {
                $this->applyBarMenuScope($menuQuery);
            });
        }

        $stats = [
            'pending' => $pendingQuery->count(),
            'in_kitchen' => $inProgressQuery->count(),
            'ready' => $readyQuery->count(),
            'urgent' => $urgentQuery->count(),
            'low_ingredients' => $lowIngredientsQuery->count(),
        ];

        return response()->json($stats);
    }

    private function refreshOrderWorkflowStatus(Order $order): void
    {
        $order->loadMissing('items:id,order_id,status');
        $items = $order->items;

        if ($items->isEmpty()) {
            return;
        }

        $allServed = $items->every(function ($item) {
            return in_array($item->status, ['served', 'cancelled'], true);
        });

        $allReadyOrServed = $items->every(function ($item) {
            return in_array($item->status, ['ready', 'served', 'cancelled'], true);
        });

        if ($allServed) {
            $order->status = 'served';
            $order->ready_at = $order->ready_at ?? now();
            $order->served_at = $order->served_at ?? now();
            $order->save();
            return;
        }

        if ($allReadyOrServed) {
            $order->status = 'ready';
            $order->ready_at = $order->ready_at ?? now();
            $order->served_at = null;
            $order->save();
            return;
        }

        $hasInProgressItems = $items->contains(function ($item) {
            return in_array($item->status, ['in_kitchen', 'ready', 'served'], true);
        });

        if ($hasInProgressItems) {
            $order->status = 'in_kitchen';
            $order->ready_at = null;
            $order->served_at = null;
            $order->save();
            return;
        }

        $hasPendingItems = $items->contains(function ($item) {
            return $item->status === 'pending';
        });

        if ($hasPendingItems) {
            $order->status = 'pending';
            $order->ready_at = null;
            $order->served_at = null;
            $order->save();
        }
    }

    private function transitionOrderItemStatus(
        Request $request,
        OrderItem $item,
        array $allowedFromStatuses,
        string $targetStatus,
        string $invalidTransitionMessage
    ) {
        $station = $this->resolveStation($request);
        $item->loadMissing('order');

        if (PreparationStation::normalizeStation($item->station) !== $station) {
            return response()->json(['error' => 'Cet article ne correspond pas à ce poste.'], 422);
        }

        if (!in_array((string) $item->status, $allowedFromStatuses, true)) {
            return response()->json(['error' => $invalidTransitionMessage], 422);
        }

        $item->status = $targetStatus;
        $item->save();

        $order = $item->order;

        if ($targetStatus === 'in_kitchen' && !$order->prepared_at) {
            $order->prepared_at = now();
        }

        $this->refreshOrderWorkflowStatus($order);

        return response()->json($order->fresh(['items.menu', 'table', 'customer', 'user']));
    }

    private function resolveStationStatusFromItems($items): string
    {
        $statuses = collect($items)
            ->map(fn ($item) => (string) ($item->status ?? ''))
            ->filter()
            ->values();

        if ($statuses->isEmpty()) {
            return 'pending';
        }

        $allReadyOrServed = $statuses->every(function ($status) {
            return in_array($status, ['ready', 'served', 'cancelled'], true);
        });

        if ($allReadyOrServed) {
            $allServed = $statuses->every(function ($status) {
                return in_array($status, ['served', 'cancelled'], true);
            });

            return $allServed ? 'served' : 'ready';
        }

        $hasStartedItems = $statuses->contains(function ($status) {
            return in_array($status, ['in_kitchen', 'ready', 'served'], true);
        });

        return $hasStartedItems ? 'in_kitchen' : 'pending';
    }

    private function resolveStation(Request $request): string
    {
        $routeStation = $request->route('station');
        $queryStation = $request->query('station');

        if (!empty($routeStation)) {
            return PreparationStation::normalizeStation($routeStation);
        }

        if (!empty($queryStation)) {
            return PreparationStation::normalizeStation($queryStation);
        }

        $path = strtolower($request->path());
        if (str_contains($path, '/bar/') || str_starts_with($path, 'bar/')) {
            return PreparationStation::BAR;
        }

        if (str_contains($path, '/kitchen/') || str_starts_with($path, 'kitchen/')) {
            return PreparationStation::KITCHEN;
        }

        return PreparationStation::KITCHEN;
    }

    private function applyBarMenuScope(Builder $menuQuery): void
    {
        $menuQuery->where(function ($query) {
            $query
                ->whereRaw("LOWER(COALESCE(category, '')) LIKE '%bar%'")
                ->orWhereRaw("LOWER(COALESCE(category, '')) LIKE '%boisson%'")
                ->orWhereRaw("LOWER(COALESCE(category, '')) LIKE '%drink%'")
                ->orWhereRaw("LOWER(COALESCE(category, '')) LIKE '%cocktail%'")
                ->orWhereRaw("LOWER(COALESCE(name, '')) LIKE '%cocktail%'")
                ->orWhereRaw("LOWER(COALESCE(name, '')) LIKE '%jus%'")
                ->orWhereRaw("LOWER(COALESCE(name, '')) LIKE '%smoothie%'")
                ->orWhereRaw("LOWER(COALESCE(name, '')) LIKE '%soda%'")
                ->orWhereRaw("LOWER(COALESCE(name, '')) LIKE '%cafe%'")
                ->orWhereRaw("LOWER(COALESCE(name, '')) LIKE '%tea%'");
        });
    }
}
