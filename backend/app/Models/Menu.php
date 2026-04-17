<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Menu extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'name',
        'description',
        'price',
        'baseline_catalog_price',
        'baseline_unit_cost',
        'baseline_margin_percent',
        'category',
        'image_url',
        'is_available',
    ];

    protected $casts = [
        'price' => 'decimal:2',
        'baseline_catalog_price' => 'decimal:2',
        'baseline_unit_cost' => 'decimal:2',
        'baseline_margin_percent' => 'decimal:2',
        'is_available' => 'boolean',
    ];

    public function ingredients()
    {
        return $this->belongsToMany(Ingredient::class, 'menu_ingredients')
            ->withPivot('quantity_needed');
    }

    public function orderItems()
    {
        return $this->hasMany(OrderItem::class);
    }

    public function canBePrepared(): bool
    {
        foreach ($this->ingredients as $ingredient) {
            if ($ingredient->pivot->quantity_needed > $ingredient->quantity_available) {
                return false;
            }
        }
        return true;
    }

    public function getInsufficientIngredients()
    {
        $insufficient = [];
        foreach ($this->ingredients as $ingredient) {
            if ($ingredient->pivot->quantity_needed > $ingredient->quantity_available) {
                $insufficient[] = [
                    'name' => $ingredient->name,
                    'needed' => $ingredient->pivot->quantity_needed,
                    'available' => $ingredient->quantity_available,
                ];
            }
        }
        return $insufficient;
    }
}
