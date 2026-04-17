<?php

namespace App\Http\Controllers;

use App\Models\Order;
use Illuminate\Http\Request;

class CashierDashboardController extends Controller
{
    /**
     * Get orders ready for payment (served status)
     */
    public function index(Request $request)
    {
        $this->authorize('viewAny', Order::class);

        $orders = Order::where('status', 'ready')
            ->orWhere('status', 'served')
            ->with(['customer', 'user', 'items.product'])
            ->orderBy('ready_at', 'desc')
            ->get();

        return response()->json($orders);
    }

    /**
     * Mark order as served (after payment)
     */
    public function markServed(Request $request, Order $order)
    {
        $this->authorize('changeStatus', $order);

        if ($order->status !== 'ready') {
            return response()->json([
                'message' => 'Seulement les commandes prêtes peuvent être marquées comme servies',
            ], 422);
        }

        $order->update([
            'status' => 'served',
            'served_at' => now(),
        ]);

        return response()->json([
            'message' => 'Commande marquée comme servie',
            'order' => $order->load(['customer', 'user', 'items.product']),
        ]);
    }

    /**
     * Get payment summary
     */
    public function paymentSummary(Request $request)
    {
        $from = $request->query('from') ? now()->parse($request->query('from')) : now()->startOfDay();
        $to = $request->query('to') ? now()->parse($request->query('to')) : now()->endOfDay();

        $orders = Order::whereBetween('served_at', [$from, $to])
            ->where('status', 'served')
            ->get();

        return response()->json([
            'total_orders' => $orders->count(),
            'total_revenue' => $orders->sum('total_amount'),
            'orders' => $orders,
        ]);
    }
}
