<?php

namespace Tests\Feature;

use App\Models\RestaurantTable;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ReservationDateTimeFormattingTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();

        parent::tearDown();
    }

    public function test_admin_and_server_table_lists_keep_local_reservation_time_strings(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-04-08 08:00:00'));

        RestaurantTable::create([
            'table_number' => 11,
            'capacity' => 4,
            'section' => 'Salle',
            'status' => 'reserved',
            'reservation_name' => 'Client midi',
            'reservation_phone' => '0340000000',
            'reservation_at' => '2026-04-08 11:00:00',
            'reservation_notes' => 'Test heure locale',
        ]);

        $admin = User::factory()->create(['role' => 'admin', 'has_system_access' => true]);
        Sanctum::actingAs($admin);

        $this->getJson('/api/admin/tables')
            ->assertOk()
            ->assertJsonPath('0.reservation_at', '2026-04-08 11:00:00')
            ->assertJsonPath('0.reservation_lock_at', '2026-04-08 09:00:00');

        $server = User::factory()->create(['role' => 'server', 'has_system_access' => true]);
        Sanctum::actingAs($server);

        $this->getJson('/api/server/tables')
            ->assertOk()
            ->assertJsonPath('0.reservation_at', '2026-04-08 11:00:00')
            ->assertJsonPath('0.reservation_lock_at', '2026-04-08 09:00:00')
            ->assertJsonPath('0.reservation_locked', false);
    }
}
