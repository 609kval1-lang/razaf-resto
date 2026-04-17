<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Customer extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'name',
        'phone',
        'email',
        'loyalty_points',
        'notes',
        'preferred_cooking',
        'allergies',
    ];

    protected $casts = [
        'loyalty_points' => 'decimal:2',
    ];

    public function orders()
    {
        return $this->hasMany(Order::class);
    }

    public function addLoyaltyPoints(float $points): void
    {
        $this->loyalty_points += $points;
        $this->save();
    }
}
