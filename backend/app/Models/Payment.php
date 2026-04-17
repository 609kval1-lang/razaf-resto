<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Payment extends Model
{
    protected $fillable = [
        'order_id',
        'amount',
        'discount_percent',
        'discount_amount',
        'method',
        'settlement_method',
        'status',
        'reference',
        'printed_at',
        'encashed_at',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'discount_amount' => 'decimal:2',
        'discount_percent' => 'integer',
        'printed_at' => 'datetime',
        'encashed_at' => 'datetime',
    ];

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function markAsCompleted(): bool
    {
        $this->status = 'completed';
        return $this->save();
    }

    public function markAsRefunded(): bool
    {
        $this->status = 'refunded';
        return $this->save();
    }
}
