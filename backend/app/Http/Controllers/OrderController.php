<?php

namespace App\Http\Controllers;

use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class OrderController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();

        $query = Order::with(['customer', 'user', 'items.product'])->latest();

        if ($user->role !== 'admin') {
            $query->where('user_id', $user->id);
        }

        return response()->json($query->get());
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'customer_id' => ['required', 'exists:customers,id'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.product_id' => ['required', 'integer', 'exists:products,id', 'distinct'],
            'items.*.quantity' => ['required', 'integer', 'min:1'],
            'special_requests' => ['nullable', 'string', 'max:1000'],
            'is_urgent' => ['nullable', 'boolean'],
        ]);

        $order = DB::transaction(function () use ($validated, $request) {
            $items = collect($validated['items']);
            $productIds = $items->pluck('product_id')->all();

            $products = Product::whereIn('id', $productIds)
                ->lockForUpdate()
                ->get()
                ->keyBy('id');

            $order = Order::create([
                'user_id' => $request->user()->id,
                'customer_id' => $validated['customer_id'],
                'total_amount' => 0,
                'status' => 'pending',
                'special_requests' => $validated['special_requests'] ?? null,
                'is_urgent' => $validated['is_urgent'] ?? false,
            ]);

            $total = 0;

            foreach ($items as $item) {
                $product = $products->get($item['product_id']);
                $quantity = (int) $item['quantity'];

                if (!$product) {
                    throw ValidationException::withMessages([
                        'items' => ['Un produit demandé est introuvable.'],
                    ]);
                }

                if ($product->stock < $quantity) {
                    throw ValidationException::withMessages([
                        'items' => [
                            "Stock insuffisant pour {$product->designation}. Disponible: {$product->stock}.",
                        ],
                    ]);
                }

                $unitPrice = (float) $product->price;
                $subtotal = $unitPrice * $quantity;
                $total += $subtotal;

                OrderItem::create([
                    'order_id' => $order->id,
                    'product_id' => $product->id,
                    'quantity' => $quantity,
                    'unit_price' => $unitPrice,
                    'subtotal' => $subtotal,
                ]);

                $product->decrement('stock', $quantity);
            }

            $order->update(['total_amount' => $total]);

            return $order->load(['customer', 'user', 'items.product']);
        });

        return response()->json([
            'message' => 'Commande créée avec succès',
            'order' => $order,
        ], 201);
    }

    public function show(Request $request, Order $order)
    {
        $user = $request->user();

        if ($user->role !== 'admin' && $order->user_id !== $user->id) {
            return response()->json(['message' => 'Accès refusé'], 403);
        }

        return response()->json(
            $order->load(['customer', 'user', 'items.product'])
        );
    }

    /**
     * Get all orders for kitchen display
     */
    public function kitchen(Request $request)
    {
        $this->authorize('viewAny', Order::class);

        $statuses = $request->query('status');
        $query = Order::with(['customer', 'user', 'items.product']);

        // Filter by status if provided
        if ($statuses) {
            $statusArray = is_array($statuses) ? $statuses : explode(',', $statuses);
            $query->whereIn('status', $statusArray);
        } else {
            // Default: show pending and preparing orders
            $query->whereIn('status', ['pending', 'preparing']);
        }

        // Sort urgent first, then by creation date
        $query->orderBy('is_urgent', 'desc')->latest();

        return response()->json($query->get());
    }

    /**
     * Update order status (kitchen workflow)
     */
    public function updateStatus(Request $request, Order $order)
    {
        $this->authorize('changeStatus', $order);

        $validated = $request->validate([
            'status' => ['required', 'in:pending,preparing,ready,served,cancelled'],
        ]);

        $previousStatus = $order->status;
        $newStatus = $validated['status'];

        // Update timestamps based on status
        $updateData = ['status' => $newStatus];

        if ($newStatus === 'preparing' && $previousStatus === 'pending') {
            $updateData['prepared_at'] = now();
        }

        if ($newStatus === 'ready' && $previousStatus === 'preparing') {
            $updateData['ready_at'] = now();
        }

        if ($newStatus === 'served') {
            $updateData['served_at'] = now();
        }

        $order->update($updateData);

        return response()->json([
            'message' => "Commande mise à jour: {$newStatus}",
            'order' => $order->load(['customer', 'user', 'items.product']),
        ]);
    }

    /**
     * Cancel an order
     */
    public function cancel(Request $request, Order $order)
    {
        $this->authorize('cancel', $order);

        $validated = $request->validate([
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        // Restore stock if order is being cancelled before being served
        if ($order->status !== 'served') {
            DB::transaction(function () use ($order) {
                foreach ($order->items as $item) {
                    $item->product->increment('stock', $item->quantity);
                }
            });
        }

        $order->update([
            'status' => 'cancelled',
            'cancellation_reason' => $validated['reason'] ?? null,
        ]);

        return response()->json([
            'message' => 'Commande annulée avec succès',
            'order' => $order->load(['customer', 'user', 'items.product']),
        ]);
    }
}
