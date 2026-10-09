<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ActionLog;
use App\Models\CashMovement;
use App\Models\ReservationDeposit;
use App\Models\RestaurantTable;
use App\Models\User;
use App\Services\ReservationDepositService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;

class ReservationDepositController extends Controller
{
    public function index(ReservationDepositService $service)
    {
        abort_unless(Schema::hasTable('reservation_deposits'), 503, 'Appliquez la migration des operations de caisse.');
        return response()->json(ReservationDeposit::with('table:id,table_number')->latest('id')->get()->map(function ($deposit) use ($service) {
            $data = $deposit->toArray();
            unset($data['receipt_token']);
            $data['remaining_amount'] = $deposit->amount - (int) $deposit->applications()->whereNotNull('applied_at')->sum('amount');
            $data['available_amount'] = $service->available($deposit);
            return $data;
        }));
    }

    public function store(Request $request)
    {
        abort_unless(Schema::hasTable('reservation_deposits'), 503, 'Appliquez la migration des operations de caisse.');
        $data = $request->validate([
            'table_id' => 'nullable|integer|exists:tables,id', 'customer_name' => 'required|string|max:120',
            'reservation_at' => 'required|date', 'amount' => 'required|numeric|min:1|max:99999999|decimal:0',
            'method' => 'required|in:cash,mobile_money,transfer,check', 'reference' => 'nullable|string|max:255',
            'receipt_token' => 'required|uuid',
        ]);
        $data['customer_name'] = trim($data['customer_name']);
        if ($data['customer_name'] === '') throw ValidationException::withMessages(['customer_name' => ['Le nom du client est obligatoire.']]);
        $deposit = DB::transaction(function () use ($data, $request) {
            User::whereKey($request->user()->id)->lockForUpdate()->firstOrFail();
            $existing = ReservationDeposit::where('receipt_token', $data['receipt_token'])->first();
            if ($existing) {
                if ($existing->received_by_user_id !== $request->user()->id || $existing->amount !== (int) $data['amount']
                    || $existing->method !== $data['method'] || $existing->customer_name !== $data['customer_name']
                    || (int) $existing->table_id !== (int) ($data['table_id'] ?? 0)
                    || !$existing->reservation_at->equalTo($data['reservation_at'])
                    || (string) $existing->reference !== (string) ($data['reference'] ?? '')) {
                    throw ValidationException::withMessages(['receipt_token' => ['Ce recu correspond deja a un autre acompte.']]);
                }
                return $existing;
            }
            if (!empty($data['table_id'])) RestaurantTable::whereKey($data['table_id'])->firstOrFail();
            $movement = CashMovement::create([
                'direction' => 'in', 'status' => 'approved', 'movement_type' => 'deposit', 'flow_type' => 'reservation_deposit',
                'amount' => (int) $data['amount'], 'payment_method' => $data['method'],
                'destination_account' => CashMovement::accountFromPaymentMethod($data['method']),
                'description' => 'Acompte reservation - '.$data['customer_name'], 'reason' => 'Acompte de reservation',
                'requested_by_user_id' => $request->user()->id, 'approved_by_user_id' => $request->user()->id, 'approved_at' => now(),
                'metadata' => ['source' => 'reservation_deposit', 'customer_name' => $data['customer_name'],
                    'reservation_at' => $data['reservation_at'], 'reference' => $data['reference'] ?? null],
            ]);
            $deposit = ReservationDeposit::create([...$data, 'cash_movement_id' => $movement->id, 'received_by_user_id' => $request->user()->id]);
            ActionLog::create(['user_id' => $request->user()->id, 'action' => 'reservation_deposit_received', 'entity_type' => 'ReservationDeposit',
                'entity_id' => $deposit->id, 'changes' => ['amount' => $deposit->amount, 'cash_movement_id' => $movement->id], 'action_at' => now()]);
            return $deposit;
        });
        return response()->json($deposit, 201);
    }
}
