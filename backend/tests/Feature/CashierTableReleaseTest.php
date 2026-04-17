<?php

namespace Tests\Feature;

use App\Models\Order;
use App\Models\RestaurantTable;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CashierTableReleaseTest extends TestCase
{
    use RefreshDatabase;

    public function test_table_is_released_only_after_last_active_order_is_paid(): void
    {
        $cashier = User::factory()->create(['role' => 'cashier']);
        $server = User::factory()->create(['role' => 'server']);
        Sanctum::actingAs($cashier);

        $table = RestaurantTable::create([
            'table_number' => 12,
            'capacity' => 4,
            'section' => 'Salle',
            'status' => 'occupied',
        ]);

        $firstOrder = $this->createOrderForTable($server->id, $table->id, 24000, 'served');
        $secondOrder = $this->createOrderForTable($server->id, $table->id, 18000, 'ready');

        $this->postJson("/api/cashier/orders/{$firstOrder->id}/prepare-payment", [
            'method' => 'cash',
        ])->assertOk();

        $payFirst = $this->postJson("/api/cashier/orders/{$firstOrder->id}/payment", [
            'method' => 'cash',
        ]);

        $payFirst->assertStatus(200);
        $table->refresh();
        $this->assertSame('occupied', $table->status);

        $this->postJson("/api/cashier/orders/{$secondOrder->id}/prepare-payment", [
            'method' => 'cash',
        ])->assertOk();

        $paySecond = $this->postJson("/api/cashier/orders/{$secondOrder->id}/payment", [
            'method' => 'cash',
        ]);

        $paySecond->assertStatus(200);

        $firstOrder->refresh();
        $secondOrder->refresh();
        $table->refresh();

        $this->assertSame('paid', $firstOrder->status);
        $this->assertSame('paid', $secondOrder->status);
        $this->assertSame('free', $table->status);
    }

    private function createOrderForTable(int $serverId, int $tableId, float $amount, string $status): Order
    {
        return Order::create([
            'user_id' => $serverId,
            'table_id' => $tableId,
            'total_amount' => $amount,
            'status' => $status,
            'is_urgent' => false,
            'bill_requested_at' => now(),
            'occupies_table' => true,
        ]);
    }
}
