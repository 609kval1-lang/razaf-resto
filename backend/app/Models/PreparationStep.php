<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PreparationStep extends Model
{
    protected $table = 'preparation_steps';

    protected $fillable = [
        'product_id',
        'step_order',
        'instruction',
        'duration_minutes',
        'temperature',
    ];

    protected $casts = [
        'duration_minutes' => 'integer',
    ];

    public function product()
    {
        return $this->belongsTo(Product::class);
    }
}
