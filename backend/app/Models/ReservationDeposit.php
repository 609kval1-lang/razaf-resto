<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ReservationDeposit extends Model
{
    protected $fillable = ['table_id', 'customer_name', 'reservation_at', 'amount', 'method', 'reference',
        'cash_movement_id', 'received_by_user_id', 'receipt_token'];

    protected $casts = ['amount' => 'integer', 'reservation_at' => 'datetime'];

    public function table()
    {
        return $this->belongsTo(RestaurantTable::class, 'table_id');
    }

    public function applications()
    {
        return $this->hasMany(ReservationDepositApplication::class, 'deposit_id');
    }
}
