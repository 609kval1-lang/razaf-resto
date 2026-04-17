<?php

namespace Tests\Feature;

use App\Models\RestaurantTable;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ExpiredReservationReleaseTest extends TestCase
{
    use RefreshDatabase;

    public function test_expired_reservation_without_active_order_is_released_automatically(): void
    {
        $server = User::factory()->create(['role' => 'server']);
        Sanctum::actingAs($server);

        $table = RestaurantTable::create([
            'table_number' => 15,
            'capacity' => 4,
            'section' => 'Salle',
            'status' => 'reserved',
            'reservation_name' => 'Client absent',
            'reservation_phone' => '0340000000',
            'reservation_at' => now()->subMinutes(10),
            'reservation_notes' => 'Reservation non honoree',
        ]);

        $response = $this->getJson('/api/server/tables');
        $response->assertOk()
            ->assertJsonPath('0.status', 'free')
            ->assertJsonPath('0.recorded_status', 'free');

        $table->refresh();

        $this->assertSame('free', $table->status);
        $this->assertNull($table->reservation_name);
        $this->assertNull($table->reservation_phone);
        $this->assertNull($table->reservation_at);
        $this->assertNull($table->reservation_notes);
    }
}
