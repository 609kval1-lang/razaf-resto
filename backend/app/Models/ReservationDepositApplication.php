<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ReservationDepositApplication extends Model
{
    protected $fillable = ['deposit_id', 'payment_id', 'amount', 'applied_at'];
    protected $casts = ['amount' => 'integer', 'applied_at' => 'datetime'];

    public function payment()
    {
        return $this->belongsTo(Payment::class);
    }
}
