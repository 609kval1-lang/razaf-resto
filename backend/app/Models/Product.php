<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Product extends Model
{
    protected $fillable = [
        'category_id',
        'parent_product_id',
        'designation',
        'description',
        'price',
        'stock',
    ];

    protected $casts = [
        'price' => 'decimal:2',
        'stock' => 'integer',
    ];

    public function category()
    {
        return $this->belongsTo(Category::class);
    }

    public function parentProduct()
    {
        return $this->belongsTo(Product::class, 'parent_product_id');
    }

    public function recipes()
    {
        return $this->hasMany(Product::class, 'parent_product_id');
    }

    public function orderItems()
    {
        return $this->hasMany(OrderItem::class);
    }

    public function ingredients()
    {
        return $this->belongsToMany(Ingredient::class, 'product_ingredients')
            ->withPivot('quantity_needed')
            ->withTimestamps();
    }

    public function preparationSteps()
    {
        return $this->hasMany(PreparationStep::class)->orderBy('step_order');
    }

    public function stockAdjustments()
    {
        return $this->morphMany(StockAdjustment::class, 'adjustable');
    }
}
