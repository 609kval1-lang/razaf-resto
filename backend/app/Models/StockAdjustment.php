<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class StockAdjustment extends Model
{
    protected $table = 'stock_adjustments';

    protected $fillable = [
        'adjustable_type',
        'adjustable_id',
        'user_id',
        'type',
        'quantity',
        'reason',
        'notes',
        'old_stock',
        'new_stock',
    ];

    protected $casts = [
        'quantity' => 'decimal:2',
        'old_stock' => 'decimal:2',
        'new_stock' => 'decimal:2',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function adjustable()
    {
        return $this->morphTo();
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function ingredient()
    {
        return $this->belongsTo(Ingredient::class, 'adjustable_id')
            ->where('adjustable_type', Ingredient::class)
            ->withoutGlobalScopes();
    }

    public function product()
    {
        return $this->belongsTo(Product::class, 'adjustable_id')
            ->where('adjustable_type', Product::class)
            ->withoutGlobalScopes();
    }
}
