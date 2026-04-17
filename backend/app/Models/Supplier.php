<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Supplier extends Model
{
    protected $fillable = [
        'raw_material_id',
        'name',
        'email',
        'phone',
    ];

    public function rawMaterial()
    {
        return $this->belongsTo(RawMaterial::class);
    }

    public function rawMaterials()
    {
        return $this->belongsToMany(RawMaterial::class, 'raw_material_supplier')->withTimestamps();
    }

    public function purchases()
    {
        return $this->hasMany(SupplierPurchase::class);
    }
}
