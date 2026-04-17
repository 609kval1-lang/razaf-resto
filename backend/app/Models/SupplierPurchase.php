<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SupplierPurchase extends Model
{
    protected $fillable = [
        'supplier_id',
        'raw_material_id',
        'quantity',
        'unit_price',
        'total_amount',
        'paid_amount',
        'remaining_amount',
        'payment_mode',
        'payment_status',
        'purchased_at',
        'due_date',
        'note',
    ];

    protected $casts = [
        'quantity' => 'decimal:3',
        'unit_price' => 'decimal:2',
        'total_amount' => 'decimal:2',
        'paid_amount' => 'decimal:2',
        'remaining_amount' => 'decimal:2',
        'purchased_at' => 'datetime',
        'due_date' => 'date',
    ];

    public function supplier()
    {
        return $this->belongsTo(Supplier::class);
    }

    public function rawMaterial()
    {
        return $this->belongsTo(RawMaterial::class)->withTrashed();
    }

    public function payments()
    {
        return $this->hasMany(SupplierPurchasePayment::class);
    }
}
