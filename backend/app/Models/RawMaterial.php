<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class RawMaterial extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'name',
        'description',
        'stock',
        'unit',
        'cost',
        'reorder_level',
    ];

    protected $casts = [
        'stock' => 'decimal:2',
        'cost' => 'decimal:2',
        'reorder_level' => 'decimal:2',
    ];

    public function ingredients()
    {
        return $this->hasMany(Ingredient::class);
    }

    public function suppliers()
    {
        return $this->belongsToMany(Supplier::class, 'raw_material_supplier')->withTimestamps();
    }

    public function priceHistories()
    {
        return $this->hasMany(RawMaterialPriceHistory::class);
    }

    public function isLowStock(): bool
    {
        return $this->stock <= $this->reorder_level;
    }
}
