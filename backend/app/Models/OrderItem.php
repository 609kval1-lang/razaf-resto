<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OrderItem extends Model
{
    protected $fillable = [
        'order_id',
        'menu_id',
        'quantity',
        'price_at_order',
        'status',
        'station',
        'stock_requirements',
        'source_table_id',
    ];

    protected $casts = [
        'price_at_order' => 'decimal:2',
        'stock_requirements' => 'array',
    ];

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function menu()
    {
        return $this->belongsTo(Menu::class);
    }
}
