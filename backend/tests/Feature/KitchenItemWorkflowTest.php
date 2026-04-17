<?php

namespace Tests\Feature;

use App\Models\Menu;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\RestaurantTable;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class KitchenItemWorkflowTest extends TestCase
{
    use RefreshDatabase;

    public function test_kitchen_can_update_items_individually_without_closing_the_whole_order(): void
    {
        $kitchen = User::factory()->create(['role' => 'kitchen']);
        $server = User::factory()->create(['role' => 'server']);
        Sanctum::actingAs($kitchen);

        $table = $this->createTable(30);
        [$firstItem, $secondItem, $order] = $this->createKitchenOrder($server, $table);

        $this->postJson("/api/kitchen/order-items/{$firstItem->id}/start")
            ->assertStatus(200);

        $order->refresh();
        $firstItem->refresh();
        $secondItem->refresh();

        $this->assertSame('in_kitchen', $firstItem->status);
        $this->assertSame('pending', $secondItem->status);
        $this->assertSame('in_kitchen', $order->status);
        $this->assertNotNull($order->prepared_at);

        $this->postJson("/api/kitchen/order-items/{$firstItem->id}/ready")
            ->assertStatus(200);

        $order->refresh();
        $firstItem->refresh();
        $secondItem->refresh();

        $this->assertSame('ready', $firstItem->status);
        $this->assertSame('pending', $secondItem->status);
        $this->assertSame('in_kitchen', $order->status);
        $this->assertNull($order->ready_at);

        $queueResponse = $this->getJson('/api/kitchen/orders');
        $queueResponse->assertStatus(200);

        $queueOrder = collect($queueResponse->json())
            ->firstWhere('id', $order->id);

        $this->assertNotNull($queueOrder);
        $this->assertSame('in_kitchen', $queueOrder['station_status']);
        $this->assertSame(['ready', 'pending'], collect($queueOrder['items'])->pluck('status')->values()->all());
    }

    public function test_server_can_mark_a_ready_item_as_served_while_other_items_continue(): void
    {
        $server = User::factory()->create(['role' => 'server']);
        Sanctum::actingAs($server);

        $table = $this->createTable(31);
        [$firstItem, $secondItem, $order] = $this->createKitchenOrder($server, $table, ['ready', 'pending'], 'in_kitchen');

        $this->postJson("/api/server/order-items/{$firstItem->id}/serve")
            ->assertStatus(200)
            ->assertJsonPath('message', 'Menu marqué comme servie.');

        $order->refresh();
        $firstItem->refresh();
        $secondItem->refresh();

        $this->assertSame('served', $firstItem->status);
        $this->assertSame('pending', $secondItem->status);
        $this->assertSame('in_kitchen', $order->status);
        $this->assertNull($order->served_at);
    }

    public function test_server_cannot_request_bill_until_every_item_is_ready_or_served(): void
    {
        $server = User::factory()->create(['role' => 'server']);
        Sanctum::actingAs($server);

        $table = $this->createTable(32);
        [, , $order] = $this->createKitchenOrder($server, $table, ['served', 'pending'], 'in_kitchen');

        $this->postJson("/api/server/orders/{$order->id}/request-bill")
            ->assertStatus(422)
            ->assertJsonPath('error', 'Tous les menus doivent être prêts ou servis avant la demande d’addition.');
    }

    private function createKitchenOrder(
        User $server,
        RestaurantTable $table,
        array $itemStatuses = ['pending', 'pending'],
        string $orderStatus = 'pending'
    ): array {
        $firstMenu = Menu::create([
            'name' => 'Plat cuisine 1',
            'description' => 'Test cuisine',
            'price' => 12000,
            'category' => 'Plats',
            'is_available' => true,
        ]);

        $secondMenu = Menu::create([
            'name' => 'Plat cuisine 2',
            'description' => 'Test cuisine',
            'price' => 9000,
            'category' => 'Plats',
            'is_available' => true,
        ]);

        $order = Order::create([
            'user_id' => $server->id,
            'table_id' => $table->id,
            'total_amount' => 21000,
            'status' => $orderStatus,
            'is_urgent' => false,
        ]);

        $firstItem = OrderItem::create([
            'order_id' => $order->id,
            'menu_id' => $firstMenu->id,
            'quantity' => 1,
            'price_at_order' => $firstMenu->price,
            'status' => $itemStatuses[0] ?? 'pending',
            'station' => 'kitchen',
        ]);

        $secondItem = OrderItem::create([
            'order_id' => $order->id,
            'menu_id' => $secondMenu->id,
            'quantity' => 1,
            'price_at_order' => $secondMenu->price,
            'status' => $itemStatuses[1] ?? 'pending',
            'station' => 'kitchen',
        ]);

        return [$firstItem, $secondItem, $order];
    }

    private function createTable(int $number): RestaurantTable
    {
        return RestaurantTable::create([
            'table_number' => $number,
            'capacity' => 4,
            'section' => 'Salle',
            'status' => 'free',
        ]);
    }
}
