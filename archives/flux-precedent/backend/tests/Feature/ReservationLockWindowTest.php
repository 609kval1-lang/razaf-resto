<?php

namespace Tests\Feature;

use App\Models\RestaurantTable;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ReservationLockWindowTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    public function test_reserved_table_stays_usable_until_two_hours_before_reservation_then_locks(): void
    {
        $server = User::factory()->create(['role' => 'server']);
        Sanctum::actingAs($server);

        Carbon::setTestNow(Carbon::parse('2026-04-08 15:59:00'));

        $table = RestaurantTable::create([
            'table_number' => 7,
            'capacity' => 4,
            'section' => 'Salle',
            'status' => 'reserved',
            'reservation_name' => 'Client soir',
            'reservation_phone' => '0340000000',
            'reservation_at' => Carbon::parse('2026-04-08 18:00:00'),
            'reservation_notes' => 'Diner',
        ]);

        $usableResponse = $this->getJson('/api/server/tables');
        $usableResponse->assertOk()
            ->assertJsonPath('0.recorded_status', 'reserved')
            ->assertJsonPath('0.service_status', 'free')
            ->assertJsonPath('0.is_orderable_now', true)
            ->assertJsonPath('0.reservation_locked', false)
            ->assertJsonPath('0.reservation_lock_minutes', 120)
            ->assertJsonPath('0.reservation_lock_at', '2026-04-08 16:00:00');

        Carbon::setTestNow(Carbon::parse('2026-04-08 16:00:00'));

        $lockedResponse = $this->getJson('/api/server/tables');
        $lockedResponse->assertOk()
            ->assertJsonPath('0.recorded_status', 'reserved')
            ->assertJsonPath('0.service_status', 'reserved')
            ->assertJsonPath('0.is_orderable_now', false)
            ->assertJsonPath('0.reservation_locked', true)
            ->assertJsonPath('0.server_block_reason', 'Réservation verrouillée (T-2h)');

        $table->refresh();
        $this->assertSame('reserved', $table->status);
    }
}
