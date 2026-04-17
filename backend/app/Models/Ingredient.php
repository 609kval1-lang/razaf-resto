<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Ingredient extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'raw_material_id',
        'name',
        'portion_size',
        'portion_unit',
        'quantity_available',
        'cost_per_portion',
        'is_cocktail_ingredient',
    ];

    protected $casts = [
        'portion_size' => 'decimal:2',
        'quantity_available' => 'integer',
        'cost_per_portion' => 'decimal:2',
        'is_cocktail_ingredient' => 'boolean',
    ];

    public function rawMaterial()
    {
        return $this->belongsTo(RawMaterial::class);
    }

    public function menus()
    {
        return $this->belongsToMany(Menu::class, 'menu_ingredients')
            ->withPivot('quantity_needed');
    }

    public function isAvailable(): bool
    {
        return $this->quantity_available > 0;
    }

    public function decrementAvailable(int $quantity): bool
    {
        if ($this->quantity_available >= $quantity) {
            $this->quantity_available -= $quantity;
            return $this->save();
        }
        return false;
    }

    public function stockAdjustments()
    {
        return $this->morphMany(StockAdjustment::class, 'adjustable');
    }
}
