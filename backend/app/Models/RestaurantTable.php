<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class RestaurantTable extends Model
{
    use SoftDeletes;

    protected $table = 'tables';

    protected $fillable = [
        'table_number',
        'capacity',
        'section',
        'status',
        'reservation_name',
        'reservation_phone',
        'reservation_at',
        'reservation_notes',
    ];

    protected $casts = [
        'reservation_at' => 'datetime',
    ];

    public function orders()
    {
        return $this->hasMany(Order::class, 'table_id');
    }

    public function currentOrder()
    {
        return $this->hasOne(Order::class, 'table_id')
            ->whereIn('status', ['pending', 'preparing', 'in_kitchen', 'ready', 'served'])
            ->where('occupies_table', true)
            ->latest();
    }

    public function isFree(): bool
    {
        return $this->status === 'free';
    }

    public function setOccupied(): bool
    {
        $this->status = 'occupied';
        $this->clearReservationData();
        return $this->save();
    }

    public function setFree(): bool
    {
        $this->status = 'free';
        $this->clearReservationData();
        return $this->save();
    }

    public function setReserved(array $reservationData): bool
    {
        $this->status = 'reserved';
        $this->reservation_name = $reservationData['reservation_name'] ?? null;
        $this->reservation_phone = $reservationData['reservation_phone'] ?? null;
        $this->reservation_at = $reservationData['reservation_at'] ?? null;
        $this->reservation_notes = $reservationData['reservation_notes'] ?? null;

        return $this->save();
    }

    public function clearReservationData(): void
    {
        $this->reservation_name = null;
        $this->reservation_phone = null;
        $this->reservation_at = null;
        $this->reservation_notes = null;
    }
}
