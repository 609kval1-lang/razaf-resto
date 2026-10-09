<?php

namespace App\Services;

use App\Models\ActionLog;
use App\Models\Payment;
use App\Models\ReservationDeposit;
use App\Models\ReservationDepositApplication;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;

class ReservationDepositService
{
    public function available(ReservationDeposit $deposit, ?int $exceptPaymentId = null): int
    {
        $used = $deposit->applications()->where(function ($query) {
            $query->whereNotNull('applied_at')->orWhereHas('payment', fn ($payment) => $payment->where('status', 'pending'));
        })->when($exceptPaymentId, fn ($query) => $query->where('payment_id', '!=', $exceptPaymentId))->sum('amount');
        return max(0, $deposit->amount - (int) $used);
    }

    public function reserve(Payment $payment, array $ids): void
    {
        if (!Schema::hasTable('reservation_deposits')) {
            if ($ids) abort(503, 'Appliquez la migration des operations de caisse.');
            return;
        }
        $deposits = ReservationDeposit::query()->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get();
        if ($deposits->count() !== count($ids)) {
            throw ValidationException::withMessages(['deposit_ids' => ['Un acompte selectionne est introuvable.']]);
        }
        $payment->loadMissing('order');
        if ($deposits->contains(fn ($deposit) => $deposit->table_id
            && !in_array((int) $deposit->table_id, array_filter([(int) $payment->order->table_id, ...($payment->order->linked_table_ids ?? [])]), true))) {
            throw ValidationException::withMessages(['deposit_ids' => ['Cet acompte ne correspond pas aux tables de cette addition.']]);
        }
        ReservationDepositApplication::where('payment_id', $payment->id)->whereNull('applied_at')->delete();
        $remaining = (int) $payment->amount;
        foreach ($deposits as $deposit) {
            $amount = min($remaining, $this->available($deposit, $payment->id));
            if ($amount <= 0) {
                throw ValidationException::withMessages(['deposit_ids' => ['Cet acompte est deja utilise ou depasse le montant de cette addition.']]);
            }
            ReservationDepositApplication::create(['deposit_id' => $deposit->id, 'payment_id' => $payment->id, 'amount' => $amount]);
            $remaining -= $amount;
        }
        $payment->deposit_amount = (int) $payment->amount - $remaining;
        $payment->save();
    }

    public function apply(Payment $payment, int $actorId): void
    {
        if (!(int) $payment->deposit_amount) return;
        $applications = ReservationDepositApplication::where('payment_id', $payment->id)->orderBy('deposit_id')->lockForUpdate()->get();
        $deposits = ReservationDeposit::whereIn('id', $applications->pluck('deposit_id'))->orderBy('id')->lockForUpdate()->get()->keyBy('id');
        if ($applications->sum('amount') !== (int) $payment->deposit_amount || $applications->contains(fn ($entry) => $entry->applied_at)) {
            throw ValidationException::withMessages(['deposit_ids' => ['Le credit de reservation doit etre verifie.']]);
        }
        foreach ($applications as $entry) {
            $deposit = $deposits->get($entry->deposit_id);
            if (!$deposit || $this->available($deposit, $payment->id) < $entry->amount) {
                throw ValidationException::withMessages(['deposit_ids' => ['Le solde de cet acompte a change.']]);
            }
            $entry->update(['applied_at' => now()]);
        }
        ActionLog::create(['user_id' => $actorId, 'action' => 'reservation_deposit_applied', 'entity_type' => 'Payment',
            'entity_id' => $payment->id, 'changes' => ['amount' => $payment->deposit_amount, 'deposit_ids' => $deposits->keys()->all()], 'action_at' => now()]);
    }
}
