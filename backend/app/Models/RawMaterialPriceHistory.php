<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class RawMaterialPriceHistory extends Model
{
    protected $fillable = [
        'raw_material_id',
        'changed_by_user_id',
        'previous_cost',
        'new_cost',
        'variation_amount',
        'variation_percent',
        'changed_at',
    ];

    protected $casts = [
        'previous_cost' => 'decimal:2',
        'new_cost' => 'decimal:2',
        'variation_amount' => 'decimal:2',
        'variation_percent' => 'decimal:2',
        'changed_at' => 'datetime',
    ];

    public function rawMaterial()
    {
        return $this->belongsTo(RawMaterial::class);
    }

    public function changedByUser()
    {
        return $this->belongsTo(User::class, 'changed_by_user_id');
    }
}
