<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Order extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'user_id',
        'table_id',
        'order_type',
        'with_packaging',
        'packaging_quantity',
        'packaging_unit_price',
        'customer_id',
        'total_amount',
        'status',
        'special_requests',
        'is_urgent',
        'prepared_at',
        'ready_at',
        'served_at',
        'bill_requested_at',
        'bill_requested_by_user_id',
        'paid_at',
        'occupies_table',
    ];

    protected $casts = [
        'total_amount' => 'decimal:2',
        'with_packaging' => 'boolean',
        'packaging_quantity' => 'integer',
        'packaging_unit_price' => 'decimal:2',
        'is_urgent' => 'boolean',
        'prepared_at' => 'datetime',
        'ready_at' => 'datetime',
        'served_at' => 'datetime',
        'bill_requested_at' => 'datetime',
        'paid_at' => 'datetime',
        'occupies_table' => 'boolean',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function table()
    {
        return $this->belongsTo(RestaurantTable::class, 'table_id');
    }

    public function customer()
    {
        return $this->belongsTo(Customer::class);
    }

    public function items()
    {
        return $this->hasMany(OrderItem::class);
    }

    public function payments()
    {
        return $this->hasMany(Payment::class);
    }

    public function latestPayment()
    {
        return $this->hasOne(Payment::class)->latestOfMany();
    }

    public function calculateTotal(): float
    {
        return (float) $this->items()
            ->selectRaw('COALESCE(SUM(price_at_order * quantity), 0) as total')
            ->value('total');
    }

    public function billRequestedByUser()
    {
        return $this->belongsTo(User::class, 'bill_requested_by_user_id');
    }

    public function canBeServed(): bool
    {
        return $this->items()
            ->whereNotIn('status', ['ready', 'served', 'cancelled'])
            ->count() === 0;
    }

    public function scopeOccupyingTable($query)
    {
        return $query->where('occupies_table', true);
    }
}
