<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActionLog;
use App\Models\CashMovement;
use App\Models\Payment;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class CashMovementController extends Controller
{
    public function cashierIndex()
    {
        return response()->json($this->buildSnapshot(
            limit: 140,
            withPending: true,
            scope: 'cash',
            includeTreasuryExtras: false,
            dailyOnly: true
        ));
    }

    public function cashierStoreWithdrawalRequest(Request $request)
    {
        $validated = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.01'],
            'reason' => ['required', 'string', 'max:1000'],
            'description' => ['nullable', 'string', 'max:255'],
        ]);

        $amount = round((float) $validated['amount'], 2);
        $available = $this->cashAvailableAmount();

        if ($amount > $available) {
            throw ValidationException::withMessages([
                'amount' => ['Le montant demandé dépasse la caisse disponible.'],
            ]);
        }

        $movement = CashMovement::query()->create([
            'direction' => 'out',
            'status' => 'pending',
            'movement_type' => 'withdrawal',
            'flow_type' => 'cash_withdrawal_request',
            'amount' => $amount,
            'payment_method' => 'cash',
            'source_account' => CashMovement::ACCOUNT_CASH,
            'description' => $validated['description'] ?? 'Demande de sortie de caisse',
            'reason' => $validated['reason'],
            'requested_by_user_id' => (int) $request->user()->id,
            'metadata' => [
                'source' => 'cashier_request',
            ],
        ]);

        $movement->load(['requestedBy:id,name', 'approvedBy:id,name']);
        $this->logAction(
            userId: (int) $request->user()->id,
            action: 'cash_withdrawal_requested',
            entityId: (int) $movement->id,
            changes: [
                'amount' => $amount,
                'reason' => $movement->reason,
            ]
        );

        return response()->json([
            'message' => 'Demande de sortie envoyée pour validation admin.',
            'movement' => $this->formatMovement($movement),
        ], 201);
    }

    public function adminIndex()
    {
        return response()->json($this->buildSnapshot(
            limit: 220,
            withPending: true,
            scope: 'cash',
            includeTreasuryExtras: false
        ));
    }

    public function adminTreasuryIndex()
    {
        return response()->json($this->buildSnapshot(
            limit: 320,
            withPending: true,
            scope: 'all',
            includeTreasuryExtras: true
        ));
    }

    public function adminApprove(Request $request, CashMovement $movement)
    {
        $validated = $request->validate([
            'admin_note' => ['nullable', 'string', 'max:1000'],
        ]);

        $approvedMovement = DB::transaction(function () use ($request, $movement, $validated) {
            /** @var CashMovement $locked */
            $locked = CashMovement::query()->where('id', $movement->id)->lockForUpdate()->firstOrFail();

            if ($locked->direction !== 'out' || $locked->status !== 'pending') {
                throw ValidationException::withMessages([
                    'movement' => ['Seules les sorties en attente peuvent être validées.'],
                ]);
            }

            $available = $this->cashAvailableAmount(true);
            $amount = round((float) $locked->amount, 2);
            if ($amount > $available) {
                throw ValidationException::withMessages([
                    'movement' => ['Validation impossible: caisse disponible insuffisante.'],
                ]);
            }

            $metadata = is_array($locked->metadata) ? $locked->metadata : [];
            if (!empty($validated['admin_note'])) {
                $metadata['admin_note'] = $validated['admin_note'];
            }
            $metadata['validated_by_admin'] = true;

            $locked->update([
                'status' => 'approved',
                'flow_type' => 'cash_withdrawal',
                'approved_by_user_id' => (int) $request->user()->id,
                'approved_at' => now(),
                'rejected_at' => null,
                'metadata' => $metadata,
            ]);

            return $locked;
        });

        $approvedMovement->load(['requestedBy:id,name', 'approvedBy:id,name']);

        $this->logAction(
            userId: (int) $request->user()->id,
            action: 'cash_withdrawal_approved',
            entityId: (int) $approvedMovement->id,
            changes: [
                'amount' => round((float) $approvedMovement->amount, 2),
                'requested_by' => $approvedMovement->requestedBy?->name,
            ]
        );

        return response()->json([
            'message' => 'Sortie de caisse validée.',
            'movement' => $this->formatMovement($approvedMovement),
        ]);
    }

    public function adminReject(Request $request, CashMovement $movement)
    {
        $validated = $request->validate([
            'admin_note' => ['nullable', 'string', 'max:1000'],
        ]);

        $rejectedMovement = DB::transaction(function () use ($request, $movement, $validated) {
            /** @var CashMovement $locked */
            $locked = CashMovement::query()->where('id', $movement->id)->lockForUpdate()->firstOrFail();

            if ($locked->direction !== 'out' || $locked->status !== 'pending') {
                throw ValidationException::withMessages([
                    'movement' => ['Seules les sorties en attente peuvent être refusées.'],
                ]);
            }

            $metadata = is_array($locked->metadata) ? $locked->metadata : [];
            if (!empty($validated['admin_note'])) {
                $metadata['admin_note'] = $validated['admin_note'];
            }
            $metadata['rejected_by_admin'] = true;

            $locked->update([
                'status' => 'rejected',
                'approved_by_user_id' => (int) $request->user()->id,
                'rejected_at' => now(),
                'approved_at' => null,
                'metadata' => $metadata,
            ]);

            return $locked;
        });

        $rejectedMovement->load(['requestedBy:id,name', 'approvedBy:id,name']);

        $this->logAction(
            userId: (int) $request->user()->id,
            action: 'cash_withdrawal_rejected',
            entityId: (int) $rejectedMovement->id,
            changes: [
                'amount' => round((float) $rejectedMovement->amount, 2),
                'requested_by' => $rejectedMovement->requestedBy?->name,
            ]
        );

        return response()->json([
            'message' => 'Sortie de caisse refusée.',
            'movement' => $this->formatMovement($rejectedMovement),
        ]);
    }

    public function adminStoreDirectWithdrawal(Request $request)
    {
        $validated = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.01'],
            'reason' => ['nullable', 'string', 'max:1000', 'required_without:reason_category'],
            'reason_category' => ['nullable', 'string', Rule::in(array_keys($this->withdrawalReasonCatalog()))],
            'reason_details' => ['nullable', 'string', 'max:1000'],
            'beneficiary_name' => ['nullable', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:255'],
        ]);

        $amount = round((float) $validated['amount'], 2);
        $reasonData = $this->resolveWithdrawalReasonData($validated);

        $movement = $this->createApprovedWithdrawal(
            actorId: (int) $request->user()->id,
            amount: $amount,
            sourceAccount: CashMovement::ACCOUNT_CASH,
            reason: $reasonData['reason'],
            description: $reasonData['description'] ?? 'Sortie exceptionnelle admin',
            metadata: [
                'source' => 'admin_exception',
                ...$reasonData['metadata'],
            ]
        );

        $movement->load(['requestedBy:id,name', 'approvedBy:id,name']);

        $this->logAction(
            userId: (int) $request->user()->id,
            action: 'cash_withdrawal_admin_exception',
            entityId: (int) $movement->id,
            changes: [
                'amount' => $amount,
                'reason' => $movement->reason,
            ]
        );

        return response()->json([
            'message' => 'Sortie de caisse effectuée (exception admin).',
            'movement' => $this->formatMovement($movement),
        ], 201);
    }

    public function adminStoreTransfer(Request $request)
    {
        $validated = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.01'],
            'source_account' => ['required', 'string', Rule::in(CashMovement::treasuryAccounts())],
            'destination_account' => ['required', 'string', Rule::in(CashMovement::treasuryAccounts()), 'different:source_account'],
            'reason' => ['required', 'string', 'max:1000'],
            'description' => ['nullable', 'string', 'max:255'],
        ]);

        $amount = round((float) $validated['amount'], 2);
        $sourceAccount = (string) $validated['source_account'];
        $destinationAccount = (string) $validated['destination_account'];
        $labels = CashMovement::treasuryAccountLabels();

        $movement = $this->createApprovedTransfer(
            actorId: (int) $request->user()->id,
            amount: $amount,
            sourceAccount: $sourceAccount,
            destinationAccount: $destinationAccount,
            reason: $validated['reason'],
            description: $validated['description']
                ?? "Transfert {$labels[$sourceAccount]} vers {$labels[$destinationAccount]}",
            metadata: [
                'source' => 'admin_treasury_transfer',
            ]
        );

        $movement->load(['requestedBy:id,name', 'approvedBy:id,name']);

        $this->logAction(
            userId: (int) $request->user()->id,
            action: 'treasury_transfer_recorded',
            entityId: (int) $movement->id,
            changes: [
                'amount' => $amount,
                'source_account' => $sourceAccount,
                'destination_account' => $destinationAccount,
            ]
        );

        return response()->json([
            'message' => 'Transfert de trésorerie enregistré.',
            'movement' => $this->formatMovement($movement),
        ], 201);
    }

    public function adminStoreAccountWithdrawal(Request $request)
    {
        $validated = $request->validate([
            'amount' => ['required', 'numeric', 'min:0.01'],
            'source_account' => ['required', 'string', Rule::in(CashMovement::treasuryAccounts())],
            'reason' => ['nullable', 'string', 'max:1000', 'required_without:reason_category'],
            'reason_category' => ['nullable', 'string', Rule::in(array_keys($this->withdrawalReasonCatalog()))],
            'reason_details' => ['nullable', 'string', 'max:1000'],
            'beneficiary_name' => ['nullable', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:255'],
        ]);

        $amount = round((float) $validated['amount'], 2);
        $sourceAccount = (string) $validated['source_account'];
        $reasonData = $this->resolveWithdrawalReasonData($validated);

        $movement = $this->createApprovedWithdrawal(
            actorId: (int) $request->user()->id,
            amount: $amount,
            sourceAccount: $sourceAccount,
            reason: $reasonData['reason'],
            description: $reasonData['description'] ?? 'Retrait de trésorerie admin',
            metadata: [
                'source' => 'admin_treasury_withdrawal',
                ...$reasonData['metadata'],
            ]
        );

        $movement->load(['requestedBy:id,name', 'approvedBy:id,name']);

        $this->logAction(
            userId: (int) $request->user()->id,
            action: 'treasury_withdrawal_recorded',
            entityId: (int) $movement->id,
            changes: [
                'amount' => $amount,
                'source_account' => $sourceAccount,
            ]
        );

        return response()->json([
            'message' => 'Retrait de trésorerie enregistré.',
            'movement' => $this->formatMovement($movement),
        ], 201);
    }

    private function buildSnapshot(
        int $limit = 150,
        bool $withPending = false,
        string $scope = 'all',
        bool $includeTreasuryExtras = true,
        bool $dailyOnly = false
    ): array
    {
        $today = now()->startOfDay();
        $movementsQuery = CashMovement::query()
            ->with([
                'requestedBy:id,name',
                'approvedBy:id,name',
            ])
            ->orderByDesc('id');

        $this->applyMovementScope($movementsQuery, $scope);
        if ($dailyOnly) {
            $this->applyEffectiveDateFilter($movementsQuery, $today);
        }

        $movements = $movementsQuery
            ->take(max(10, min($limit, 500)))
            ->get();

        $payload = [
            'summary' => $this->cashSummary($dailyOnly),
            'revenue_breakdown_today' => $this->revenueBreakdownToday(),
            'config' => $this->treasuryConfig(),
            'movements' => $movements->map(fn (CashMovement $movement) => $this->formatMovement($movement))->values(),
        ];

        if ($withPending) {
            $pendingQuery = CashMovement::query()
                ->with([
                    'requestedBy:id,name',
                    'approvedBy:id,name',
                ])
                ->where('direction', 'out')
                ->where('status', 'pending')
                ->orderBy('id');

            $this->applyPendingScope($pendingQuery, $scope);
            if ($dailyOnly) {
                $this->applyEffectiveDateFilter($pendingQuery, $today);
            }

            $pending = $pendingQuery
                ->take(150)
                ->get()
                ->values();

            $payload['pending_withdrawals'] = $pending
                ->map(fn (CashMovement $movement) => $this->formatMovement($movement))
                ->values();
        }

        if ($includeTreasuryExtras) {
            $payload['pending_vouchers'] = $this->pendingVouchers()
                ->map(fn (Payment $payment) => $this->formatPendingVoucher($payment))
                ->values();
            $payload['recent_customer_payments'] = $this->recentCustomerPayments();
        }

        return $payload;
    }

    private function cashSummary(bool $dailyOnly = false): array
    {
        $today = now()->startOfDay();
        $allInflows = $this->aggregateAccountSums('destination_account');
        $allOutflows = $this->aggregateAccountSums('source_account');
        $todayInflows = $this->aggregateAccountSums('destination_account', $today);
        $todayOutflows = $this->aggregateAccountSums('source_account', $today);
        $accountBalances = $this->buildBalancesFromAggregates($allInflows, $allOutflows);
        $cashInApproved = $this->aggregatedAccountSum($allInflows, CashMovement::ACCOUNT_CASH, 'approved');
        $cashOutApproved = $this->aggregatedAccountSum($allOutflows, CashMovement::ACCOUNT_CASH, 'approved');
        $cashOutPending = $this->aggregatedAccountSum($allOutflows, CashMovement::ACCOUNT_CASH, 'pending');
        $entriesToday = $this->aggregatedAccountSum($todayInflows, CashMovement::ACCOUNT_CASH, 'approved');
        $exitsToday = $this->aggregatedAccountSum($todayOutflows, CashMovement::ACCOUNT_CASH, 'approved');
        $pendingToday = $this->aggregatedAccountSum($todayOutflows, CashMovement::ACCOUNT_CASH, 'pending');
        $pendingVoucherSummary = Payment::query()
            ->where('status', 'pending')
            ->where('method', 'bon')
            ->selectRaw('COUNT(*) as aggregate_count, COALESCE(SUM(amount), 0) as aggregate_amount')
            ->first();

        $accounts = [];
        foreach (CashMovement::treasuryAccountLabels() as $accountKey => $label) {
            $accounts[$accountKey] = [
                'key' => $accountKey,
                'label' => $label,
                'balance' => round((float) ($accountBalances[$accountKey] ?? 0), 2),
                'approved_in_total' => $this->aggregatedAccountSum($allInflows, $accountKey, 'approved'),
                'approved_out_total' => $this->aggregatedAccountSum($allOutflows, $accountKey, 'approved'),
                'pending_out_total' => $this->aggregatedAccountSum($allOutflows, $accountKey, 'pending'),
            ];
        }

        $pendingRequestQuery = CashMovement::query()
            ->where('direction', 'out')
            ->where('status', 'pending')
            ->where('source_account', CashMovement::ACCOUNT_CASH);

        if ($dailyOnly) {
            $this->applyEffectiveDateFilter($pendingRequestQuery, $today);
        }

        return [
            'cash_in_approved' => round($dailyOnly ? $entriesToday : $cashInApproved, 2),
            'cash_out_approved' => round($dailyOnly ? $exitsToday : $cashOutApproved, 2),
            'cash_out_pending' => round($dailyOnly ? $pendingToday : $cashOutPending, 2),
            'cash_available' => round((float) ($accountBalances[CashMovement::ACCOUNT_CASH] ?? 0), 2),
            'pending_requests_count' => (int) $pendingRequestQuery->count(),
            'entries_today' => round($entriesToday, 2),
            'exits_today' => round($exitsToday, 2),
            'cash_in_total' => round($cashInApproved, 2),
            'cash_out_total' => round($cashOutApproved, 2),
            'cash_out_pending_total' => round($cashOutPending, 2),
            'pending_vouchers_count' => (int) ($pendingVoucherSummary->aggregate_count ?? 0),
            'pending_vouchers_amount' => round((float) ($pendingVoucherSummary->aggregate_amount ?? 0), 2),
            'accounts' => $accounts,
            'total_internal_balance' => round(array_sum($accountBalances), 2),
        ];
    }

    private function aggregateAccountSums(string $accountColumn, $since = null): array
    {
        if (!in_array($accountColumn, ['source_account', 'destination_account'], true)) {
            return [];
        }

        $query = CashMovement::query()
            ->selectRaw("{$accountColumn} as account, status, COALESCE(SUM(amount), 0) as total")
            ->whereNotNull($accountColumn)
            ->groupBy($accountColumn, 'status');

        $this->applyEffectiveDateFilter($query, $since);

        return $query->get()->reduce(function (array $carry, CashMovement $movement) {
            $account = (string) ($movement->account ?? '');
            $status = (string) ($movement->status ?? '');

            if ($account === '' || $status === '') {
                return $carry;
            }

            if (!isset($carry[$account])) {
                $carry[$account] = [];
            }

            $carry[$account][$status] = round((float) ($movement->total ?? 0), 2);

            return $carry;
        }, []);
    }

    private function aggregatedAccountSum(array $aggregates, string $account, string $status = 'approved'): float
    {
        return round((float) ($aggregates[$account][$status] ?? 0), 2);
    }

    private function buildBalancesFromAggregates(array $inflows, array $outflows): array
    {
        $balances = array_fill_keys(CashMovement::treasuryAccounts(), 0.0);

        foreach (array_keys($balances) as $account) {
            $balances[$account] = round(
                $this->aggregatedAccountSum($inflows, $account, 'approved')
                - $this->aggregatedAccountSum($outflows, $account, 'approved'),
                2
            );
        }

        return $balances;
    }

    private function applyMovementScope($query, string $scope): void
    {
        if ($scope !== 'cash') {
            return;
        }

        $query->where(function ($builder) {
            $builder->where('source_account', CashMovement::ACCOUNT_CASH)
                ->orWhere('destination_account', CashMovement::ACCOUNT_CASH);
        });
    }

    private function applyPendingScope($query, string $scope): void
    {
        if ($scope !== 'cash') {
            return;
        }

        $query->where('source_account', CashMovement::ACCOUNT_CASH);
    }

    private function revenueBreakdownToday(): array
    {
        $payments = Payment::query()
            ->with([
                'order.items.menu:id,name,category',
            ])
            ->where('status', 'completed')
            ->where('encashed_at', '>=', now()->startOfDay())
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
                $bucket = $this->revenueBucket(
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

    private function revenueBucket(string $category, string $name, string $station): string
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

    private function cashAvailableAmount(bool $lockForUpdate = false): float
    {
        return $this->accountAvailableAmount(CashMovement::ACCOUNT_CASH, $lockForUpdate);
    }

    private function formatMovement(CashMovement $movement): array
    {
        $labels = CashMovement::treasuryAccountLabels();
        $flowLabels = CashMovement::flowTypeLabels();
        $effectiveAt = $movement->approved_at ?? $movement->created_at;
        $metadata = is_array($movement->metadata) ? $movement->metadata : [];

        return [
            'id' => (int) $movement->id,
            'direction' => (string) $movement->direction,
            'status' => (string) $movement->status,
            'movement_type' => (string) ($movement->movement_type ?: $movement->inferMovementType()),
            'flow_type' => $movement->flow_type,
            'flow_type_label' => $movement->flow_type ? ($flowLabels[$movement->flow_type] ?? $movement->flow_type) : null,
            'amount' => round((float) $movement->amount, 2),
            'payment_method' => $movement->payment_method,
            'source_account' => $movement->source_account,
            'source_account_label' => $movement->source_account ? ($labels[$movement->source_account] ?? $movement->source_account) : null,
            'destination_account' => $movement->destination_account,
            'destination_account_label' => $movement->destination_account ? ($labels[$movement->destination_account] ?? $movement->destination_account) : null,
            'description' => $movement->description,
            'reason' => $movement->reason,
            'requested_by_user_id' => $movement->requested_by_user_id,
            'requested_by_name' => $movement->requestedBy?->name,
            'approved_by_user_id' => $movement->approved_by_user_id,
            'approved_by_name' => $movement->approvedBy?->name,
            'payment_id' => $movement->payment_id,
            'order_id' => $movement->order_id,
            'supplier_purchase_id' => $movement->supplier_purchase_id,
            'supplier_purchase_payment_id' => $movement->supplier_purchase_payment_id,
            'metadata' => $metadata,
            'reason_category' => $metadata['reason_category'] ?? null,
            'reason_label' => $metadata['reason_label'] ?? null,
            'reason_details' => $metadata['reason_details'] ?? null,
            'beneficiary_name' => $metadata['beneficiary_name'] ?? null,
            'approved_at' => optional($movement->approved_at)->toDateTimeString(),
            'rejected_at' => optional($movement->rejected_at)->toDateTimeString(),
            'effective_at' => optional($effectiveAt)->toDateTimeString(),
            'created_at' => optional($movement->created_at)->toDateTimeString(),
            'updated_at' => optional($movement->updated_at)->toDateTimeString(),
        ];
    }

    private function treasuryConfig(): array
    {
        $withdrawalOptions = [];
        foreach ($this->withdrawalReasonCatalog() as $key => $option) {
            $withdrawalOptions[] = [
                'value' => $key,
                'label' => $option['label'],
                'hint' => $option['hint'],
                'beneficiary_label' => $option['beneficiary_label'],
                'beneficiary_placeholder' => $option['beneficiary_placeholder'],
                'details_placeholder' => $option['details_placeholder'],
            ];
        }

        return [
            'withdrawal_reason_options' => $withdrawalOptions,
            'payment_account_rules' => [
                [
                    'payment_method' => 'cash',
                    'payment_method_label' => 'Cash',
                    'target_account' => CashMovement::ACCOUNT_CASH,
                    'target_account_label' => CashMovement::treasuryAccountLabels()[CashMovement::ACCOUNT_CASH],
                    'note' => 'Seuls les paiements cash remplissent la caisse.',
                ],
                [
                    'payment_method' => 'mobile_money',
                    'payment_method_label' => 'Mobile Money',
                    'target_account' => CashMovement::ACCOUNT_MOBILE_MONEY,
                    'target_account_label' => CashMovement::treasuryAccountLabels()[CashMovement::ACCOUNT_MOBILE_MONEY],
                    'note' => 'Les encaissements mobile money alimentent uniquement le compte mobile money.',
                ],
                [
                    'payment_method' => 'check',
                    'payment_method_label' => 'Cheque',
                    'target_account' => CashMovement::ACCOUNT_BANK,
                    'target_account_label' => CashMovement::treasuryAccountLabels()[CashMovement::ACCOUNT_BANK],
                    'note' => 'Les chèques alimentent la banque, pas la caisse.',
                ],
                [
                    'payment_method' => 'transfer',
                    'payment_method_label' => 'Virement',
                    'target_account' => CashMovement::ACCOUNT_BANK,
                    'target_account_label' => CashMovement::treasuryAccountLabels()[CashMovement::ACCOUNT_BANK],
                    'note' => 'Les virements alimentent la banque, pas la caisse.',
                ],
                [
                    'payment_method' => 'bon',
                    'payment_method_label' => 'Bon client',
                    'target_account' => null,
                    'target_account_label' => 'En attente',
                    'note' => 'Un bon imprimé n’alimente aucun compte tant qu’il n’est pas encaissé.',
                ],
            ],
        ];
    }

    private function withdrawalReasonCatalog(): array
    {
        return [
            'packaging' => [
                'label' => 'Emballages / consommables',
                'hint' => 'Barquettes, gobelets, sacs, serviettes, pailles, boîtes pizza et autres consommables de service.',
                'beneficiary_label' => 'Fournisseur / magasin',
                'beneficiary_placeholder' => 'Ex: Grossiste emballages',
                'details_placeholder' => 'Ex: Barquettes, sacs kraft, serviettes',
            ],
            'kitchen_fuel' => [
                'label' => 'Gaz / charbon / combustible',
                'hint' => 'Gaz de cuisine, charbon, bois ou autre combustible utilisé en production.',
                'beneficiary_label' => 'Fournisseur',
                'beneficiary_placeholder' => 'Ex: Dépôt gaz',
                'details_placeholder' => 'Ex: Recharge bouteille gaz cuisine',
            ],
            'non_consumable_supplies' => [
                'label' => 'Achat fournitures non consommables',
                'hint' => 'Balais, serpillières, poubelles, seaux, petits équipements et autres achats durables.',
                'beneficiary_label' => 'Fournisseur / magasin',
                'beneficiary_placeholder' => 'Ex: Quincaillerie Analakely',
                'details_placeholder' => 'Ex: Balais, serpillières et sacs poubelles',
            ],
            'cleaning_products' => [
                'label' => 'Produits de nettoyage',
                'hint' => 'Détergents, désinfectants, savon, javel et autres produits d’hygiène du restaurant.',
                'beneficiary_label' => 'Fournisseur / magasin',
                'beneficiary_placeholder' => 'Ex: Magasin hygiène',
                'details_placeholder' => 'Ex: Javel, savon main, désinfectant cuisine',
            ],
            'electricity' => [
                'label' => 'Paiement électricité',
                'hint' => 'Facture JIRAMA ou autre charge d’énergie.',
                'beneficiary_label' => 'Prestataire',
                'beneficiary_placeholder' => 'Ex: JIRAMA',
                'details_placeholder' => 'Ex: Facture avril 2026',
            ],
            'water' => [
                'label' => 'Paiement eau',
                'hint' => 'Règlement eau ou consommation liée au local.',
                'beneficiary_label' => 'Prestataire',
                'beneficiary_placeholder' => 'Ex: JIRAMA Eau',
                'details_placeholder' => 'Ex: Eau avril 2026',
            ],
            'internet_phone' => [
                'label' => 'Internet / téléphone',
                'hint' => 'Forfaits téléphone, internet, communication client ou ligne utilisée par le restaurant.',
                'beneficiary_label' => 'Opérateur',
                'beneficiary_placeholder' => 'Ex: Telma / Orange',
                'details_placeholder' => 'Ex: Recharge internet caisse et commandes',
            ],
            'rent' => [
                'label' => 'Paiement loyer',
                'hint' => 'Loyer, avance de loyer ou charges liées au local.',
                'beneficiary_label' => 'Bailleur',
                'beneficiary_placeholder' => 'Ex: Propriétaire local',
                'details_placeholder' => 'Ex: Loyer avril 2026',
            ],
            'maintenance' => [
                'label' => 'Entretien / maintenance',
                'hint' => 'Réparation, maintenance machine, plomberie, électricité ou dépannage.',
                'beneficiary_label' => 'Technicien / prestataire',
                'beneficiary_placeholder' => 'Ex: Technicien froid',
                'details_placeholder' => 'Ex: Réparation congélateur bar',
            ],
            'delivery_transport' => [
                'label' => 'Transport / livraison',
                'hint' => 'Course taxi, livraison fournisseur, transport marchandises ou dépense logistique.',
                'beneficiary_label' => 'Transporteur / livreur',
                'beneficiary_placeholder' => 'Ex: Taxi fournisseur',
                'details_placeholder' => 'Ex: Transport stock marché -> restaurant',
            ],
            'marketing' => [
                'label' => 'Marketing / publicité',
                'hint' => 'Flyers, affiches, promotions, sponsorisation réseaux sociaux ou communication commerciale.',
                'beneficiary_label' => 'Prestataire / agence',
                'beneficiary_placeholder' => 'Ex: Imprimerie locale',
                'details_placeholder' => 'Ex: Impression flyers menu du jour',
            ],
            'tax' => [
                'label' => 'Taxes / frais administratifs',
                'hint' => 'Impôts, taxes, frais bancaires ou frais administratifs.',
                'beneficiary_label' => 'Organisme',
                'beneficiary_placeholder' => 'Ex: Centre fiscal',
                'details_placeholder' => 'Ex: TVA du mois',
            ],
            'other' => [
                'label' => 'Autre décaissement',
                'hint' => 'Pour un besoin exceptionnel non couvert par les motifs standards.',
                'beneficiary_label' => 'Bénéficiaire',
                'beneficiary_placeholder' => 'Ex: Nom du bénéficiaire',
                'details_placeholder' => 'Ex: Précisez clairement le motif',
            ],
        ];
    }

    private function resolveWithdrawalReasonData(array $validated): array
    {
        $catalog = $this->withdrawalReasonCatalog();
        $reasonCategory = trim((string) ($validated['reason_category'] ?? ''));
        $legacyReason = trim((string) ($validated['reason'] ?? ''));
        $reasonDetails = trim((string) ($validated['reason_details'] ?? ''));
        $beneficiaryName = trim((string) ($validated['beneficiary_name'] ?? ''));
        $description = trim((string) ($validated['description'] ?? ''));

        if ($reasonCategory !== '' && isset($catalog[$reasonCategory])) {
            if ($reasonCategory === 'other' && $reasonDetails === '' && $description === '') {
                throw ValidationException::withMessages([
                    'reason_details' => ['Précisez le motif de ce décaissement.'],
                ]);
            }

            return [
                'reason' => $catalog[$reasonCategory]['label'],
                'description' => $description !== ''
                    ? $description
                    : $this->buildWithdrawalDescription($beneficiaryName, $reasonDetails),
                'metadata' => [
                    'reason_category' => $reasonCategory,
                    'reason_label' => $catalog[$reasonCategory]['label'],
                    'reason_details' => $reasonDetails !== '' ? $reasonDetails : null,
                    'beneficiary_name' => $beneficiaryName !== '' ? $beneficiaryName : null,
                ],
            ];
        }

        if ($legacyReason === '') {
            throw ValidationException::withMessages([
                'reason_category' => ['Sélectionnez un motif de décaissement.'],
            ]);
        }

        return [
            'reason' => $legacyReason,
            'description' => $description !== '' ? $description : null,
            'metadata' => [],
        ];
    }

    private function buildWithdrawalDescription(string $beneficiaryName, string $reasonDetails): ?string
    {
        $parts = [];

        if ($beneficiaryName !== '') {
            $parts[] = $beneficiaryName;
        }

        if ($reasonDetails !== '') {
            $parts[] = $reasonDetails;
        }

        if (empty($parts)) {
            return null;
        }

        return implode(' · ', $parts);
    }

    private function createApprovedTransfer(
        int $actorId,
        float $amount,
        string $sourceAccount,
        string $destinationAccount,
        string $reason,
        ?string $description,
        array $metadata = []
    ): CashMovement {
        return DB::transaction(function () use (
            $actorId,
            $amount,
            $sourceAccount,
            $destinationAccount,
            $reason,
            $description,
            $metadata
        ) {
            $available = $this->accountAvailableAmount($sourceAccount, true);
            if ($amount > $available) {
                throw ValidationException::withMessages([
                    'amount' => ['Le montant dépasse le solde disponible du compte source.'],
                ]);
            }

            return CashMovement::query()->create([
                'direction' => $destinationAccount === CashMovement::ACCOUNT_CASH ? 'in' : 'out',
                'status' => 'approved',
                'movement_type' => 'transfer',
                'flow_type' => 'treasury_transfer',
                'amount' => $amount,
                'payment_method' => null,
                'source_account' => $sourceAccount,
                'destination_account' => $destinationAccount,
                'description' => $description,
                'reason' => $reason,
                'requested_by_user_id' => $actorId,
                'approved_by_user_id' => $actorId,
                'approved_at' => now(),
                'metadata' => $metadata,
            ]);
        });
    }

    private function createApprovedWithdrawal(
        int $actorId,
        float $amount,
        string $sourceAccount,
        string $reason,
        ?string $description,
        array $metadata = []
    ): CashMovement {
        return DB::transaction(function () use ($actorId, $amount, $sourceAccount, $reason, $description, $metadata) {
            $available = $this->accountAvailableAmount($sourceAccount, true);
            if ($amount > $available) {
                throw ValidationException::withMessages([
                    'amount' => ['Le montant dépasse le solde disponible du compte sélectionné.'],
                ]);
            }

            return CashMovement::query()->create([
                'direction' => 'out',
                'status' => 'approved',
                'movement_type' => 'withdrawal',
                'flow_type' => $sourceAccount === CashMovement::ACCOUNT_CASH
                    ? 'cash_withdrawal'
                    : 'treasury_withdrawal',
                'amount' => $amount,
                'payment_method' => $sourceAccount === CashMovement::ACCOUNT_CASH ? 'cash' : null,
                'source_account' => $sourceAccount,
                'destination_account' => null,
                'description' => $description,
                'reason' => $reason,
                'requested_by_user_id' => $actorId,
                'approved_by_user_id' => $actorId,
                'approved_at' => now(),
                'metadata' => $metadata,
            ]);
        });
    }

    private function accountBalances(bool $lockForUpdate = false): array
    {
        $accounts = array_fill_keys(CashMovement::treasuryAccounts(), 0.0);

        $query = CashMovement::query()
            ->where('status', 'approved')
            ->select(['amount', 'source_account', 'destination_account']);

        $rows = $lockForUpdate
            ? $query->lockForUpdate()->get()
            : $query->get();

        foreach ($rows as $row) {
            $amount = round((float) ($row->amount ?? 0), 2);
            $sourceAccount = (string) ($row->source_account ?? '');
            $destinationAccount = (string) ($row->destination_account ?? '');

            if ($sourceAccount !== '' && array_key_exists($sourceAccount, $accounts)) {
                $accounts[$sourceAccount] -= $amount;
            }

            if ($destinationAccount !== '' && array_key_exists($destinationAccount, $accounts)) {
                $accounts[$destinationAccount] += $amount;
            }
        }

        return array_map(fn ($value) => round((float) $value, 2), $accounts);
    }

    private function accountAvailableAmount(string $account, bool $lockForUpdate = false): float
    {
        $balances = $this->accountBalances($lockForUpdate);
        return round((float) ($balances[$account] ?? 0), 2);
    }

    private function sumAccountInflows(string $account, string $status = 'approved', $since = null): float
    {
        $query = CashMovement::query()
            ->where('status', $status)
            ->where('destination_account', $account);

        $this->applyEffectiveDateFilter($query, $since);

        return round((float) $query->sum('amount'), 2);
    }

    private function sumAccountOutflows(string $account, string $status = 'approved', $since = null): float
    {
        $query = CashMovement::query()
            ->where('status', $status)
            ->where('source_account', $account);

        $this->applyEffectiveDateFilter($query, $since);

        return round((float) $query->sum('amount'), 2);
    }

    private function applyEffectiveDateFilter($query, $since): void
    {
        if (!$since) {
            return;
        }

        $query->where(function ($builder) use ($since) {
            $builder->where('approved_at', '>=', $since)
                ->orWhere(function ($fallback) use ($since) {
                    $fallback->whereNull('approved_at')
                        ->where('created_at', '>=', $since);
                });
        });
    }

    private function logAction(int $userId, string $action, int $entityId, array $changes): void
    {
        ActionLog::query()->create([
            'user_id' => $userId,
            'action' => $action,
            'entity_type' => 'CashMovement',
            'entity_id' => $entityId,
            'changes' => $changes,
            'action_at' => now(),
        ]);
    }

    private function pendingVouchers()
    {
        return Payment::query()
            ->with([
                'order.table:id,table_number',
                'order.customer:id,name',
            ])
            ->where('status', 'pending')
            ->where('method', 'bon')
            ->orderByDesc('printed_at')
            ->orderByDesc('id')
            ->take(150)
            ->get();
    }

    private function formatPendingVoucher(Payment $payment): array
    {
        $order = $payment->order;

        return [
            'id' => (int) $payment->id,
            'order_id' => (int) ($payment->order_id ?? 0),
            'amount' => round((float) ($payment->amount ?? 0), 2),
            'discount_percent' => (int) ($payment->discount_percent ?? 0),
            'discount_amount' => round((float) ($payment->discount_amount ?? 0), 2),
            'method' => (string) ($payment->method ?? ''),
            'reference' => $payment->reference,
            'printed_at' => optional($payment->printed_at)->toDateTimeString(),
            'created_at' => optional($payment->created_at)->toDateTimeString(),
            'customer_name' => $order?->customer?->name,
            'table_number' => $order?->table?->table_number,
            'order_type' => (string) ($order?->order_type ?? 'dine_in'),
        ];
    }

    private function recentCustomerPayments(): array
    {
        return Payment::query()
            ->with([
                'order.table:id,table_number',
                'order.customer:id,name',
            ])
            ->whereIn('status', ['pending', 'completed'])
            ->orderByRaw('COALESCE(encashed_at, printed_at, created_at) DESC')
            ->take(20)
            ->get()
            ->map(function (Payment $payment) {
                $resolvedMethod = (string) ($payment->settlement_method ?: $payment->method);
                $targetAccount = $payment->status === 'completed'
                    ? CashMovement::accountFromPaymentMethod($resolvedMethod)
                    : null;

                return [
                    'id' => (int) $payment->id,
                    'order_id' => (int) ($payment->order_id ?? 0),
                    'status' => (string) ($payment->status ?? ''),
                    'amount' => round((float) ($payment->amount ?? 0), 2),
                    'method' => (string) ($payment->method ?? ''),
                    'settlement_method' => $payment->settlement_method,
                    'reference' => $payment->reference,
                    'printed_at' => optional($payment->printed_at)->toDateTimeString(),
                    'encashed_at' => optional($payment->encashed_at)->toDateTimeString(),
                    'created_at' => optional($payment->created_at)->toDateTimeString(),
                    'customer_name' => $payment->order?->customer?->name,
                    'table_number' => $payment->order?->table?->table_number,
                    'order_type' => (string) ($payment->order?->order_type ?? 'dine_in'),
                    'target_account' => $targetAccount,
                    'target_account_label' => $targetAccount
                        ? (CashMovement::treasuryAccountLabels()[$targetAccount] ?? $targetAccount)
                        : ((string) ($payment->method ?? '') === 'bon' ? 'En attente' : null),
                ];
            })
            ->values()
            ->all();
    }
}
