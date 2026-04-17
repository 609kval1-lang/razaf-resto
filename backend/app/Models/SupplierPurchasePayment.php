<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SupplierPurchasePayment extends Model
{
    protected $fillable = [
        'supplier_purchase_id',
        'amount',
        'method',
        'source_account',
        'reference',
        'note',
        'paid_at',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'paid_at' => 'datetime',
    ];

    public function purchase()
    {
        return $this->belongsTo(SupplierPurchase::class, 'supplier_purchase_id');
    }
}
