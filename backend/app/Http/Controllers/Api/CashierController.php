<?php

namespace App\Http\Controllers\Api;

use App\Models\ActionLog;
use App\Models\CashMovement;
use App\Models\Customer;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;

class CashierController extends Controller
{
    private const CUSTOMER_CACHE_KEY = 'server:snapshot:customers:v1';

    // Voir commandes dont l'addition a été demandée et qui sont en attente d'encaissement
    public function getReadyOrders(Request $request)
    {
        $includeItems = $request->boolean('include_items', false);
        $selectColumns = ['id', 'table_id', 'customer_id', 'total_amount', 'status', 'created_at', 'served_at', 'occupies_table'];
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
            ->with([
                'table:id,table_number',
                'customer:id,name',
                'billRequestedByUser:id,name',
                'latestPayment' => function ($paymentQuery) {
                    $paymentQuery->select([
                        'payments.id',
                        'payments.order_id',
                        'payments.amount',
                        'payments.discount_percent',
                        'payments.discount_amount',
                        'payments.method',
                        'payments.settlement_method',
                        'payments.status',
                        'payments.reference',
                        'payments.printed_at',
                        'payments.encashed_at',
                        'payments.created_at',
                    ]);
                },
            ]);

        $query->where('status', '!=', 'paid');
        $query->where(function ($workflowQuery) {
            if ($this->hasOrderColumn('bill_requested_at')) {
                $workflowQuery->whereNotNull('bill_requested_at');
            } else {
                $workflowQuery->where('status', 'served');
            }

            $workflowQuery->orWhereHas('payments', function ($paymentQuery) {
                $paymentQuery->where('status', 'pending');
            });
        });

        if ($this->hasOrderColumn('bill_requested_at')) {
            $query
                ->orderByRaw('CASE WHEN bill_requested_at IS NULL THEN 1 ELSE 0 END ASC')
                ->orderByDesc('bill_requested_at');
        }

        $orders = $query
            ->orderBy('created_at', 'asc')
            ->get();

        foreach ($orders as $order) {
            $this->synchronizeOrderWorkflowStatus($order, false);
        }
        $orders = $orders
            ->filter(function (Order $order) {
                $latestPayment = $order->latestPayment;
                $hasPendingPayment = $latestPayment && (string) $latestPayment->status === 'pending';

                if ($hasPendingPayment) {
                    return true;
                }

                if ($this->hasOrderColumn('bill_requested_at')) {
                    return !empty($order->bill_requested_at) && in_array((string) $order->status, ['served'], true);
                }

                return in_array((string) $order->status, ['served'], true);
            })
            ->values();

        if ($includeItems) {
            $orders->load([
                'items:id,order_id,menu_id,quantity,price_at_order,status',
                'items.menu:id,name',
            ]);
            $orders->each(function (Order $order) {
                $order->items->each(function (OrderItem $item) {
                    if ((string) $item->status === 'preparing') {
                        $item->status = 'in_kitchen';
                    }
                });
            });
        }

        return response()->json($orders);
    }

    // Préparer l'addition avant encaissement réel
    public function preparePayment(Request $request, Order $order)
    {
        $validated = $request->validate([
            'method' => 'required|in:cash,mobile_money,card,transfer,check,bon',
            'reference' => 'nullable|string|max:255',
            'discount_percent' => 'nullable|integer|min:0|max:10',
            'customer_id' => 'nullable|exists:customers,id',
            'customer_name' => 'nullable|string|max:120',
        ]);

        $normalizedMethod = $this->normalizePaymentMethod((string) $validated['method']);
        $discountPercent = max(0, (int) ($validated['discount_percent'] ?? 0));
        $actorId = (int) $request->user()->id;

        try {
            [$payment, $preparedOrder, $grossAmount, $discountAmount, $finalAmount] = DB::transaction(function () use (
                $order,
                $validated,
                $normalizedMethod,
                $discountPercent,
                $actorId
            ) {
                /** @var Order $lockedOrder */
                $lockedOrder = Order::query()
                    ->where('id', $order->id)
                    ->lockForUpdate()
                    ->firstOrFail();

                if ($lockedOrder->status === 'paid') {
                    throw new InvalidArgumentException('Commande déjà encaissée.');
                }

                $this->assertBillRequestExists($lockedOrder);

                $customerId = $this->resolveCustomerForPayment($lockedOrder, $validated, $normalizedMethod);
                if ($customerId && (int) ($lockedOrder->customer_id ?? 0) !== $customerId) {
                    $lockedOrder->customer_id = $customerId;
                }

                $grossAmount = round((float) $lockedOrder->total_amount, 2);
                $discountAmount = round(($grossAmount * $discountPercent) / 100, 2);
                $finalAmount = round(max(0, $grossAmount - $discountAmount), 2);

                /** @var Payment|null $payment */
                $payment = $lockedOrder->payments()
                    ->where('status', 'pending')
                    ->lockForUpdate()
                    ->latest('id')
                    ->first();

                $payload = [
                    'amount' => $finalAmount,
                    'discount_percent' => $discountPercent,
                    'discount_amount' => $discountAmount,
                    'method' => $normalizedMethod,
                    'settlement_method' => null,
                    'reference' => $validated['reference'] ?? null,
                    'status' => 'pending',
                    'printed_at' => now(),
                    'encashed_at' => null,
                ];

                if ($payment) {
                    $payment->fill($payload);
                    $payment->save();
                } else {
                    $payment = $lockedOrder->payments()->create($payload);
                }

                if ($lockedOrder->isDirty()) {
                    $lockedOrder->save();
                }

                if ($lockedOrder->table_id) {
                    $lockedOrder->occupies_table = true;
                    $lockedOrder->save();
                    $this->markTableAsOccupied($lockedOrder);
                }

                ActionLog::create([
                    'user_id' => $actorId,
                    'action' => 'order_bill_print_prepared',
                    'entity_type' => 'Payment',
                    'entity_id' => $payment->id,
                    'changes' => [
                        'order_id' => $lockedOrder->id,
                        'method' => $normalizedMethod,
                        'discount_percent' => $discountPercent,
                        'amount' => $finalAmount,
                    ],
                    'action_at' => now(),
                ]);

                $lockedOrder->load([
                    'table:id,table_number',
                    'customer:id,name',
                    'billRequestedByUser:id,name',
                    'latestPayment' => function ($paymentQuery) {
                        $paymentQuery->select([
                            'payments.id',
                            'payments.order_id',
                            'payments.amount',
                            'payments.discount_percent',
                            'payments.discount_amount',
                            'payments.method',
                            'payments.settlement_method',
                            'payments.status',
                            'payments.reference',
                            'payments.printed_at',
                            'payments.encashed_at',
                            'payments.created_at',
                        ]);
                    },
                ]);

                return [$payment->fresh(), $lockedOrder, $grossAmount, $discountAmount, $finalAmount];
            });
        } catch (InvalidArgumentException $exception) {
            return response()->json(['error' => $exception->getMessage()], 422);
        }

        Cache::forget('server:snapshot:tables:v1');

        return response()->json([
            'message' => $normalizedMethod === 'bon'
                ? 'Bon préparé et addition prête à imprimer.'
                : 'Addition préparée. Imprimez puis validez l’encaissement.',
            'payment' => $payment,
            'order' => $preparedOrder,
            'amount_before_discount' => $grossAmount,
            'discount_percent' => $discountPercent,
            'discount_amount' => $discountAmount,
            'amount_due' => $finalAmount,
        ]);
    }

    public function releaseVoucherTable(Request $request, Order $order)
    {
        $actorId = (int) $request->user()->id;

        if ($order->status === 'paid') {
            return response()->json(['error' => 'Commande déjà encaissée.'], 422);
        }

        try {
            $releasedOrder = DB::transaction(function () use ($order, $actorId) {
                /** @var Order $lockedOrder */
                $lockedOrder = Order::query()
                    ->where('id', $order->id)
                    ->lockForUpdate()
                    ->firstOrFail();

                if ($lockedOrder->status === 'paid') {
                    throw new InvalidArgumentException('Commande déjà encaissée.');
                }

                if (!$lockedOrder->table_id) {
                    throw new InvalidArgumentException('Aucune table associée à cette commande.');
                }

                /** @var Payment|null $payment */
                $payment = $lockedOrder->payments()
                    ->where('status', 'pending')
                    ->lockForUpdate()
                    ->latest('id')
                    ->first();

                if (!$payment || $this->normalizePaymentMethod((string) ($payment->method ?? '')) !== 'bon') {
                    throw new InvalidArgumentException('Seuls les bons clients en attente peuvent libérer la table.');
                }

                if (!$lockedOrder->occupies_table) {
                    throw new InvalidArgumentException('Cette table est déjà libérée pour ce bon.');
                }

                $lockedOrder->occupies_table = false;
                $lockedOrder->save();
                $this->releaseTableIfPossible($lockedOrder);

                ActionLog::create([
                    'user_id' => $actorId,
                    'action' => 'voucher_table_released',
                    'entity_type' => 'Order',
                    'entity_id' => $lockedOrder->id,
                    'changes' => [
                        'order_id' => $lockedOrder->id,
                        'payment_id' => $payment->id,
                    ],
                    'action_at' => now(),
                ]);

                return $lockedOrder->fresh([
                    'table:id,table_number',
                    'customer:id,name',
                    'billRequestedByUser:id,name',
                    'latestPayment' => function ($paymentQuery) {
                        $paymentQuery->select([
                            'payments.id',
                            'payments.order_id',
                            'payments.amount',
                            'payments.discount_percent',
                            'payments.discount_amount',
                            'payments.method',
                            'payments.settlement_method',
                            'payments.status',
                            'payments.reference',
                            'payments.printed_at',
                            'payments.encashed_at',
                            'payments.created_at',
                        ]);
                    },
                ]);
            });
        } catch (InvalidArgumentException $exception) {
            return response()->json(['error' => $exception->getMessage()], 422);
        }

        Cache::forget('server:snapshot:tables:v1');

        return response()->json([
            'message' => 'Table libérée. Le bon reste en attente d’encaissement.',
            'order' => $releasedOrder,
        ]);
    }

    // Traiter paiement réel après impression
    public function processPayment(Request $request, Order $order)
    {
        $validated = $request->validate([
            'method' => 'nullable|in:cash,mobile_money,card,transfer,check',
            'reference' => 'nullable|string|max:255',
            'discount_percent' => 'nullable|integer|min:0|max:10',
            'customer_id' => 'nullable|exists:customers,id',
            'customer_name' => 'nullable|string|max:120',
        ]);
        $actorId = (int) $request->user()->id;

        if ($order->status === 'paid') {
            return response()->json(['error' => 'Commande déjà encaissée.'], 422);
        }

        try {
            [$payment, $paidOrder, $grossAmount, $discountPercent, $discountAmount, $finalAmount, $actualMethod] = DB::transaction(function () use ($order, $validated, $actorId) {
                /** @var Order $lockedOrder */
                $lockedOrder = Order::query()
                    ->where('id', $order->id)
                    ->lockForUpdate()
                    ->firstOrFail();

                if ($lockedOrder->status === 'paid') {
                    throw new InvalidArgumentException('Commande déjà encaissée.');
                }

                /** @var Payment|null $payment */
                $payment = $lockedOrder->payments()
                    ->where('status', 'pending')
                    ->lockForUpdate()
                    ->latest('id')
                    ->first();

                if (!$payment) {
                    throw new InvalidArgumentException(
                        'Cette commande n’a plus d’addition valide à encaisser. Redemandez puis réimprimez l’addition avant encaissement.'
                    );
                }

                $this->assertBillRequestExists($lockedOrder);

                $customerId = $this->resolveCustomerForPayment(
                    $lockedOrder,
                    $validated,
                    $this->normalizePaymentMethod((string) ($payment->method ?? $validated['method'] ?? ''))
                );
                if ($customerId && (int) ($lockedOrder->customer_id ?? 0) !== $customerId) {
                    $lockedOrder->customer_id = $customerId;
                    $lockedOrder->save();
                }

                $grossAmount = round((float) $lockedOrder->total_amount, 2);
                $discountPercent = (int) ($payment->discount_percent ?? 0);
                $discountAmount = round((float) ($payment->discount_amount ?? 0), 2);
                $finalAmount = round((float) ($payment->amount ?? 0), 2);

                $requestedMethod = $this->normalizeImmediatePaymentMethod(
                    (string) ($validated['method'] ?? ''),
                    ''
                );
                $storedSettlementMethod = $this->normalizeImmediatePaymentMethod(
                    (string) ($payment->settlement_method ?? ''),
                    ''
                );
                $initialMethod = $this->normalizePaymentMethod((string) ($payment->method ?? ''));
                $fallbackMethod = $initialMethod === 'bon'
                    ? ''
                    : $this->normalizeImmediatePaymentMethod((string) ($payment->method ?? ''), '');
                $actualMethod = $requestedMethod !== ''
                    ? $requestedMethod
                    : ($storedSettlementMethod !== ''
                        ? $storedSettlementMethod
                        : $fallbackMethod);

                if ($initialMethod === 'bon' && $actualMethod === '') {
                    throw new InvalidArgumentException(
                        'Choisissez le mode d’encaissement du bon (cash, mobile money, virement ou cheque).'
                    );
                }

                if ($actualMethod === 'bon' || $actualMethod === '') {
                    throw new InvalidArgumentException('Sélectionnez un vrai mode d’encaissement pour finaliser ce paiement.');
                }

                $payment->status = 'completed';
                $payment->settlement_method = $actualMethod;
                $payment->reference = $validated['reference'] ?? $payment->reference;
                $payment->encashed_at = now();
                $payment->save();

                $movement = CashMovement::create([
                    'direction' => 'in',
                    'status' => 'approved',
                    'movement_type' => 'sale',
                    'flow_type' => (string) $payment->method === 'bon'
                        ? 'customer_voucher_settlement'
                        : 'customer_payment',
                    'amount' => $finalAmount,
                    'payment_method' => $actualMethod,
                    'source_account' => null,
                    'destination_account' => CashMovement::accountFromPaymentMethod($actualMethod) ?? CashMovement::ACCOUNT_CASH,
                    'description' => "Encaissement commande #{$lockedOrder->id}",
                    'reason' => (string) $payment->method === 'bon'
                        ? 'Encaissement d’un bon client.'
                        : ($discountPercent > 0
                            ? "Encaissement avec réduction {$discountPercent}%."
                            : 'Encaissement normal.'),
                    'requested_by_user_id' => $actorId,
                    'approved_by_user_id' => $actorId,
                    'payment_id' => $payment->id,
                    'order_id' => $lockedOrder->id,
                    'metadata' => [
                        'source' => 'payment',
                        'initial_method' => $payment->method,
                        'settlement_method' => $actualMethod,
                        'discount_percent' => $discountPercent,
                        'discount_amount' => $discountAmount,
                    ],
                    'approved_at' => now(),
                ]);

                ActionLog::create([
                    'user_id' => $actorId,
                    'action' => 'cash_payment_recorded',
                    'entity_type' => 'CashMovement',
                    'entity_id' => $movement->id,
                    'changes' => [
                        'order_id' => $lockedOrder->id,
                        'payment_id' => $payment->id,
                        'amount' => $finalAmount,
                        'initial_method' => $payment->method,
                        'settlement_method' => $actualMethod,
                    ],
                    'action_at' => now(),
                ]);

                $lockedOrder->status = 'paid';
                $lockedOrder->paid_at = now();
                $lockedOrder->occupies_table = false;
                $lockedOrder->save();

                $this->releaseTableIfPossible($lockedOrder);

                return [$payment, $lockedOrder, $grossAmount, $discountPercent, $discountAmount, $finalAmount, $actualMethod];
            });
        } catch (InvalidArgumentException $exception) {
            return response()->json(['error' => $exception->getMessage()], 422);
        }

        Cache::forget('server:snapshot:tables:v1');

        return response()->json([
            'payment' => $payment,
            'order' => $paidOrder,
            'amount_before_discount' => $grossAmount,
            'discount_percent' => $discountPercent,
            'discount_amount' => $discountAmount,
            'amount_paid' => $finalAmount,
            'settlement_method' => $actualMethod,
            'message' => 'Paiement encaissé avec succès.',
        ]);
    }

    // Voir statistiques caisse
    public function getDayStats()
    {
        $today = now()->startOfDay();
        $salesBreakdown = $this->salesBreakdownSince($today);
        $completedToday = Payment::query()
            ->with(['order.table:id,table_number', 'order.customer:id,name'])
            ->where('status', 'completed')
            ->where('encashed_at', '>=', $today)
            ->get(['id', 'order_id', 'amount', 'method', 'settlement_method', 'reference', 'encashed_at']);

        $cashInApprovedTotal = (float) CashMovement::query()
            ->where('status', 'approved')
            ->where('destination_account', CashMovement::ACCOUNT_CASH)
            ->sum('amount');

        $cashOutApprovedTotal = (float) CashMovement::query()
            ->where('status', 'approved')
            ->where('source_account', CashMovement::ACCOUNT_CASH)
            ->sum('amount');

        $cashOutPendingTotal = (float) CashMovement::query()
            ->where('status', 'pending')
            ->where('source_account', CashMovement::ACCOUNT_CASH)
            ->sum('amount');

        $cashInApprovedToday = (float) CashMovement::query()
            ->where('status', 'approved')
            ->where('destination_account', CashMovement::ACCOUNT_CASH)
            ->where(function ($query) use ($today) {
                $query->where('approved_at', '>=', $today)
                    ->orWhere(function ($fallback) use ($today) {
                        $fallback->whereNull('approved_at')
                            ->where('created_at', '>=', $today);
                    });
            })
            ->sum('amount');

        $cashOutApprovedToday = (float) CashMovement::query()
            ->where('status', 'approved')
            ->where('source_account', CashMovement::ACCOUNT_CASH)
            ->where(function ($query) use ($today) {
                $query->where('approved_at', '>=', $today)
                    ->orWhere(function ($fallback) use ($today) {
                        $fallback->whereNull('approved_at')
                            ->where('created_at', '>=', $today);
                    });
            })
            ->sum('amount');

        $cashOutPendingToday = (float) CashMovement::query()
            ->where('status', 'pending')
            ->where('source_account', CashMovement::ACCOUNT_CASH)
            ->where('created_at', '>=', $today)
            ->sum('amount');

        $stats = [
            'total_revenue' => round((float) $completedToday->sum('amount'), 2),
            'total_orders' => Order::where('status', 'paid')
                ->where('paid_at', '>=', $today)
                ->count(),
            'by_method' => $completedToday
                ->groupBy(function (Payment $payment) {
                    return (string) ($payment->settlement_method ?: $payment->method);
                })
                ->map(function ($payments, $method) {
                    $account = CashMovement::accountFromPaymentMethod((string) $method);
                    return [
                        'method' => $method,
                        'count' => $payments->count(),
                        'total' => round((float) $payments->sum('amount'), 2),
                        'account' => $account,
                        'account_label' => $account ? (CashMovement::treasuryAccountLabels()[$account] ?? $account) : null,
                    ];
                })
                ->sortBy('method')
                ->values(),
            'by_account' => $this->groupPaymentsByAccount($completedToday),
            'recent_customer_payments' => $this->formatRecentCustomerPayments($completedToday->take(12)),
            'sales_breakdown' => $salesBreakdown,
            'cash_register' => [
                'cash_in_approved' => round($cashInApprovedToday, 2),
                'cash_out_approved' => round($cashOutApprovedToday, 2),
                'cash_out_pending' => round($cashOutPendingToday, 2),
                'cash_available' => round($cashInApprovedTotal - $cashOutApprovedTotal, 2),
                'cash_in_total' => round($cashInApprovedTotal, 2),
                'cash_out_total' => round($cashOutApprovedTotal, 2),
                'cash_out_pending_total' => round($cashOutPendingTotal, 2),
            ],
        ];

        return response()->json($stats);
    }

    // Générer facture
    public function generateInvoice(Order $order)
    {
        $payment = $order->payments()->latest('id')->first();
        $canGenerate = $order->status === 'paid'
            || !empty($order->bill_requested_at)
            || $payment !== null;

        if (!$canGenerate) {
            return response()->json(['error' => 'Addition indisponible pour cette commande.'], 422);
        }

        $items = $order->items()->with('menu')->get();
        $itemsSubtotal = round((float) $items->sum(function ($item) {
            return (float) ($item->price_at_order ?? 0) * (float) ($item->quantity ?? 0);
        }), 2);
        $packagingQuantity = max(0, (int) ($order->packaging_quantity ?? 0));
        $packagingUnitPrice = round(max(0.0, (float) ($order->packaging_unit_price ?? 0)), 2);
        $packagingTotal = round($packagingQuantity * $packagingUnitPrice, 2);

        $invoice = [
            'order_id' => $order->id,
            'table' => $order->table ? $order->table->table_number : null,
            'order_type' => (string) ($order->order_type ?? 'dine_in'),
            'with_packaging' => (bool) ($order->with_packaging ?? false),
            'packaging_quantity' => $packagingQuantity,
            'packaging_unit_price' => $packagingUnitPrice,
            'packaging_total' => $packagingTotal,
            'customer' => $order->customer ? $order->customer->name : null,
            'items' => $items,
            'items_subtotal' => $itemsSubtotal,
            'subtotal' => round($itemsSubtotal + $packagingTotal, 2),
            'payment' => $payment,
            'bill_requested_at' => $order->bill_requested_at,
            'created_at' => $order->created_at,
        ];

        $invoice['discount_percent'] = (int) ($invoice['payment']?->discount_percent ?? 0);
        $invoice['discount_amount'] = (float) ($invoice['payment']?->discount_amount ?? 0);
        $invoice['total'] = (float) ($invoice['payment']?->amount ?? $order->total_amount);
        $invoice['printed_at'] = $invoice['payment']?->printed_at;
        $invoice['encashed_at'] = $invoice['payment']?->encashed_at;
        $invoice['payment_status'] = (string) ($invoice['payment']?->status ?? 'pending');

        return response()->json($invoice);
    }

    // Voir opérations paiements du jour (caisse)
    public function getPaymentHistory(Request $request)
    {
        $request->validate([
            'date' => 'nullable|date_format:Y-m-d',
            'from' => 'nullable|date',
            'to' => 'nullable|date|after_or_equal:from',
        ]);

        $todayStart = now()->startOfDay();
        $todayEnd = now()->endOfDay();

        $query = Payment::with(['order.table', 'order.customer'])
            ->whereIn('status', ['pending', 'completed']);
        $dateExpression = DB::raw('COALESCE(encashed_at, printed_at, created_at)');

        $query->whereBetween($dateExpression, [$todayStart, $todayEnd]);

        $payments = $query->orderByRaw('COALESCE(encashed_at, printed_at, created_at) DESC')->paginate(50);
        $payments->getCollection()->transform(function (Payment $payment) {
            return $this->formatPaymentHistoryEntry($payment);
        });

        return response()->json($payments);
    }

    private function groupPaymentsByAccount($payments)
    {
        return $payments
            ->groupBy(function (Payment $payment) {
                return CashMovement::accountFromPaymentMethod((string) ($payment->settlement_method ?: $payment->method)) ?: 'unassigned';
            })
            ->map(function ($group, $account) {
                return [
                    'account' => $account,
                    'account_label' => CashMovement::treasuryAccountLabels()[$account] ?? $account,
                    'count' => $group->count(),
                    'total' => round((float) $group->sum('amount'), 2),
                ];
            })
            ->sortBy('account')
            ->values();
    }

    private function formatRecentCustomerPayments($payments)
    {
        return collect($payments)
            ->map(fn (Payment $payment) => $this->formatPaymentHistoryEntry($payment))
            ->values();
    }

    private function formatPaymentHistoryEntry(Payment $payment): array
    {
        $resolvedMethod = (string) ($payment->settlement_method ?: $payment->method);
        $account = CashMovement::accountFromPaymentMethod($resolvedMethod);

        return [
            'id' => (int) $payment->id,
            'order_id' => (int) $payment->order_id,
            'amount' => round((float) $payment->amount, 2),
            'discount_percent' => (int) ($payment->discount_percent ?? 0),
            'discount_amount' => round((float) ($payment->discount_amount ?? 0), 2),
            'method' => (string) ($payment->method ?? ''),
            'settlement_method' => $payment->settlement_method,
            'status' => (string) ($payment->status ?? ''),
            'reference' => $payment->reference,
            'printed_at' => optional($payment->printed_at)->toDateTimeString(),
            'encashed_at' => optional($payment->encashed_at)->toDateTimeString(),
            'created_at' => optional($payment->created_at)->toDateTimeString(),
            'target_account' => $account,
            'target_account_label' => $account ? (CashMovement::treasuryAccountLabels()[$account] ?? $account) : null,
            'order' => [
                'id' => (int) ($payment->order?->id ?? $payment->order_id ?? 0),
                'order_type' => (string) ($payment->order?->order_type ?? 'dine_in'),
                'table' => $payment->order?->table ? [
                    'table_number' => $payment->order->table->table_number,
                ] : null,
                'customer' => $payment->order?->customer ? [
                    'id' => (int) $payment->order->customer->id,
                    'name' => (string) $payment->order->customer->name,
                ] : null,
            ],
        ];
    }

    private function salesBreakdownSince($since): array
    {
        $payments = Payment::query()
            ->with([
                'order.items.menu:id,name,category',
            ])
            ->where('status', 'completed')
            ->where('encashed_at', '>=', $since)
            ->get();

        $totals = [
            'restaurant' => 0.0,
            'boissons' => 0.0,
            'cocktails' => 0.0,
        ];

        foreach ($payments as $payment) {
            $order = $payment->order;
            if (!$order) {
                continue;
            }

            $gross = max(0.0, (float) ($order->total_amount ?? 0));
            $net = max(0.0, (float) ($payment->amount ?? 0));
            $factor = $gross > 0 ? ($net / $gross) : 1.0;

            foreach ($order->items as $item) {
                $lineGross = (float) ($item->price_at_order ?? 0) * (float) ($item->quantity ?? 0);
                $lineNet = max(0.0, $lineGross * $factor);
                $bucket = $this->salesBucket(
                    (string) ($item->menu?->category ?? ''),
                    (string) ($item->menu?->name ?? ''),
                    (string) ($item->station ?? '')
                );
                $totals[$bucket] += $lineNet;
            }
        }

        return [
            'restaurant' => round($totals['restaurant'], 2),
            'boissons' => round($totals['boissons'], 2),
            'cocktails' => round($totals['cocktails'], 2),
            'total' => round($totals['restaurant'] + $totals['boissons'] + $totals['cocktails'], 2),
        ];
    }

    private function salesBucket(string $category, string $name, string $station): string
    {
        $normalizedCategory = $this->normalize($category);
        $normalizedName = $this->normalize($name);
        $normalizedStation = $this->normalize($station);

        $source = trim($normalizedCategory . ' ' . $normalizedName);
        if ($normalizedStation === 'bar') {
            $source .= ' bar';
        }

        foreach (['cocktail', 'mocktail'] as $keyword) {
            if ($keyword !== '' && str_contains($source, $keyword)) {
                return 'cocktails';
            }
        }

        foreach ([
            'bar',
            'boisson',
            'boissons',
            'drink',
            'beverage',
            'jus',
            'smoothie',
            'soda',
            'eau',
            'water',
            'cafe',
            'coffee',
            'the',
            'tea',
            'infusion',
            'nectar',
        ] as $keyword) {
            if ($keyword !== '' && str_contains($source, $keyword)) {
                return 'boissons';
            }
        }

        return 'restaurant';
    }

    private function assertBillRequestExists(Order $order): void
    {
        if ($this->hasOrderColumn('bill_requested_at') && empty($order->bill_requested_at)) {
            throw new InvalidArgumentException('La demande d’addition doit être faite avant cette opération.');
        }
    }

    private function resolveCustomerForPayment(Order $order, array $validated, string $method): ?int
    {
        $customerId = !empty($validated['customer_id']) ? (int) $validated['customer_id'] : (int) ($order->customer_id ?? 0);
        if ($customerId > 0) {
            return $customerId;
        }

        $customerName = $this->sanitizeCustomerName($validated['customer_name'] ?? '');
        if ($customerName !== '') {
            return $this->findOrCreateCustomerByName($customerName);
        }

        if ($method === 'bon') {
            throw new InvalidArgumentException('Un bon exige un client valide. Sélectionnez un client enregistré ou créez-en un nouveau.');
        }

        return null;
    }

    private function findOrCreateCustomerByName(string $customerName): int
    {
        $customerName = $this->sanitizeCustomerName($customerName);
        if ($customerName === '') {
            throw new InvalidArgumentException('Nom client invalide pour la création du bon.');
        }

        $customer = Customer::query()->firstOrCreate(
            ['name' => $customerName],
            ['loyalty_points' => 0]
        );

        Cache::forget(self::CUSTOMER_CACHE_KEY);

        return (int) $customer->id;
    }

    private function releaseTableIfPossible(Order $order): void
    {
        if (!$order->table_id) {
            return;
        }

        $table = $order->table()->lockForUpdate()->first();
        $hasActiveOrders = Order::query()
            ->where('table_id', $order->table_id)
            ->where('id', '!=', $order->id)
            ->whereIn('status', ['pending', 'preparing', 'in_kitchen', 'ready', 'served'])
            ->where('occupies_table', true)
            ->exists();

        if ($table && !$hasActiveOrders) {
            $table->setFree();
        }
    }

    private function markTableAsOccupied(Order $order): void
    {
        if (!$order->table_id) {
            return;
        }

        $table = $order->table()->lockForUpdate()->first();
        if ($table) {
            $table->setOccupied();
        }
    }

    private function normalize(string $value): string
    {
        $value = strtolower(trim($value));
        return strtr($value, [
            'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e',
            'à' => 'a', 'â' => 'a',
            'î' => 'i', 'ï' => 'i',
            'ô' => 'o', 'ö' => 'o',
            'ù' => 'u', 'û' => 'u', 'ü' => 'u',
        ]);
    }

    private function normalizePaymentMethod(string $method): string
    {
        return match ($method) {
            'card' => 'mobile_money',
            'voucher' => 'bon',
            default => $method,
        };
    }

    private function normalizeImmediatePaymentMethod(string $method, string $fallback = 'cash'): string
    {
        $normalized = $this->normalizePaymentMethod($method);

        if (in_array($normalized, ['cash', 'mobile_money', 'transfer', 'check'], true)) {
            return $normalized;
        }

        return in_array($fallback, ['cash', 'mobile_money', 'transfer', 'check'], true)
            ? $fallback
            : '';
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

    private function normalizeCustomerNameForComparison(?string $name): string
    {
        $value = $this->normalize((string) $name);
        $value = strtr($value, [
            '_' => ' ',
            '-' => ' ',
        ]);

        $collapsed = preg_replace('/\s+/u', ' ', $value);
        return $collapsed === null ? '' : trim($collapsed);
    }

    private function hasOrderColumn(string $column): bool
    {
        static $cache = [];

        if (!array_key_exists($column, $cache)) {
            $cache[$column] = Schema::hasColumn('orders', $column);
        }

        return (bool) $cache[$column];
    }

    private function synchronizeOrderWorkflowStatus(Order $order, bool $persist = true): void
    {
        if ($order->status === 'paid' || $order->status === 'archived') {
            return;
        }

        $order->loadMissing('items:id,order_id,status');
        $items = $order->items;
        if ($items->isEmpty()) {
            return;
        }

        $legacyItemIds = $items
            ->filter(fn ($item) => (string) $item->status === 'preparing')
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->values();

        if ($legacyItemIds->isNotEmpty()) {
            if ($persist) {
                OrderItem::query()
                    ->whereIn('id', $legacyItemIds->all())
                    ->update(['status' => 'in_kitchen']);
                $order->load('items:id,order_id,status');
                $items = $order->items;
            } else {
                $items->each(function ($item) {
                    if ((string) $item->status === 'preparing') {
                        $item->status = 'in_kitchen';
                    }
                });
            }
        }

        $allServed = $items->every(function ($item) {
            return in_array((string) $item->status, ['served', 'cancelled'], true);
        });

        $allReadyOrServed = $items->every(function ($item) {
            return in_array((string) $item->status, ['ready', 'served', 'cancelled'], true);
        });

        $nextStatus = (string) $order->status;
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
            $hasInProgress = $items->contains(fn ($item) => in_array((string) $item->status, ['in_kitchen', 'ready', 'served'], true));
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
}
