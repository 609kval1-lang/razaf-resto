<?php

namespace Tests\Feature;

use App\Models\Menu;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\RestaurantTable;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ActiveOrdersVisibilityTest extends TestCase
{
    use RefreshDatabase;

    public function test_server_default_scope_keeps_old_active_orders_visible(): void
    {
        $server = User::factory()->create(['role' => 'server']);
        Sanctum::actingAs($server);

        $table = RestaurantTable::create([
            'table_number' => 18,
            'capacity' => 4,
            'section' => 'Salle',
            'status' => 'free',
        ]);

        $oldActive = Order::create([
            'user_id' => $server->id,
            'table_id' => $table->id,
            'total_amount' => 20000,
            'status' => 'in_kitchen',
            'is_urgent' => false,
        ]);

        $oldPaid = Order::create([
            'user_id' => $server->id,
            'table_id' => $table->id,
            'total_amount' => 15000,
            'status' => 'paid',
            'is_urgent' => false,
        ]);

        $todayPaid = Order::create([
            'user_id' => $server->id,
            'table_id' => $table->id,
            'total_amount' => 17000,
            'status' => 'paid',
            'is_urgent' => false,
        ]);

        $oldTimestamp = now()->subDays(2);
        DB::table('orders')->where('id', $oldActive->id)->update([
            'created_at' => $oldTimestamp,
            'updated_at' => $oldTimestamp,
        ]);
        DB::table('orders')->where('id', $oldPaid->id)->update([
            'created_at' => $oldTimestamp,
            'updated_at' => $oldTimestamp,
        ]);

        $response = $this->getJson('/api/server/my-orders');
        $response->assertStatus(200);

        $orderIds = collect($response->json())
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertContains((int) $oldActive->id, $orderIds);
        $this->assertContains((int) $todayPaid->id, $orderIds);
        $this->assertNotContains((int) $oldPaid->id, $orderIds);
    }

    public function test_kitchen_queue_and_stats_include_old_active_orders(): void
    {
        $kitchen = User::factory()->create(['role' => 'kitchen']);
        $server = User::factory()->create(['role' => 'server']);
        Sanctum::actingAs($kitchen);

        $table = RestaurantTable::create([
            'table_number' => 19,
            'capacity' => 4,
            'section' => 'Salle',
            'status' => 'free',
        ]);

        $menu = Menu::create([
            'name' => 'Plat test',
            'description' => 'Test',
            'price' => 12000,
            'category' => 'Plats',
            'is_available' => true,
        ]);

        $order = Order::create([
            'user_id' => $server->id,
            'table_id' => $table->id,
            'total_amount' => 12000,
            'status' => 'pending',
            'is_urgent' => false,
        ]);

        OrderItem::create([
            'order_id' => $order->id,
            'menu_id' => $menu->id,
            'quantity' => 1,
            'price_at_order' => $menu->price,
            'status' => 'pending',
            'station' => 'kitchen',
        ]);

        $oldTimestamp = now()->subDays(2);
        DB::table('orders')->where('id', $order->id)->update([
            'created_at' => $oldTimestamp,
            'updated_at' => $oldTimestamp,
        ]);

        $queueResponse = $this->getJson('/api/kitchen/orders');
        $queueResponse->assertStatus(200);

        $queueOrderIds = collect($queueResponse->json())
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertContains((int) $order->id, $queueOrderIds);

        $statsResponse = $this->getJson('/api/kitchen/stats');
        $statsResponse
            ->assertStatus(200)
            ->assertJsonPath('pending', 1);
    }

    public function test_kitchen_ready_stat_resets_each_new_day(): void
    {
        $kitchen = User::factory()->create(['role' => 'kitchen']);
        $server = User::factory()->create(['role' => 'server']);
        Sanctum::actingAs($kitchen);

        $table = RestaurantTable::create([
            'table_number' => 20,
            'capacity' => 4,
            'section' => 'Salle',
            'status' => 'free',
        ]);

        $menu = Menu::create([
            'name' => 'Plat ready day test',
            'description' => 'Test reset quotidien',
            'price' => 13000,
            'category' => 'Plats',
            'is_available' => true,
        ]);

        $yesterdayReadyOrder = Order::create([
            'user_id' => $server->id,
            'table_id' => $table->id,
            'total_amount' => 13000,
            'status' => 'ready',
            'is_urgent' => false,
            'ready_at' => now()->subDay()->setTime(22, 0),
        ]);

        OrderItem::create([
            'order_id' => $yesterdayReadyOrder->id,
            'menu_id' => $menu->id,
            'quantity' => 1,
            'price_at_order' => $menu->price,
            'status' => 'ready',
            'station' => 'kitchen',
        ]);

        $todayReadyOrder = Order::create([
            'user_id' => $server->id,
            'table_id' => $table->id,
            'total_amount' => 13000,
            'status' => 'ready',
            'is_urgent' => false,
            'ready_at' => now()->setTime(10, 30),
        ]);

        OrderItem::create([
            'order_id' => $todayReadyOrder->id,
            'menu_id' => $menu->id,
            'quantity' => 1,
            'price_at_order' => $menu->price,
            'status' => 'ready',
            'station' => 'kitchen',
        ]);

        $response = $this->getJson('/api/kitchen/stats');
        $response
            ->assertStatus(200)
            ->assertJsonPath('ready', 1);
    }

    public function test_server_my_orders_normalizes_legacy_kitchen_preparing_statuses(): void
    {
        $server = User::factory()->create(['role' => 'server']);
        Sanctum::actingAs($server);

        $table = RestaurantTable::create([
            'table_number' => 21,
            'capacity' => 4,
            'section' => 'Salle',
            'status' => 'occupied',
        ]);

        $menu = Menu::create([
            'name' => 'Plat legacy prep',
            'description' => 'Test legacy preparation',
            'price' => 14000,
            'category' => 'Plats',
            'is_available' => true,
        ]);

        $order = Order::create([
            'user_id' => $server->id,
            'table_id' => $table->id,
            'total_amount' => 14000,
            'status' => 'pending',
            'is_urgent' => false,
        ]);

        $item = OrderItem::create([
            'order_id' => $order->id,
            'menu_id' => $menu->id,
            'quantity' => 1,
            'price_at_order' => $menu->price,
            'status' => 'pending',
            'station' => 'kitchen',
        ]);

        DB::statement('PRAGMA ignore_check_constraints = ON');
        DB::table('orders')->where('id', $order->id)->update(['status' => 'preparing']);
        DB::table('order_items')->where('id', $item->id)->update(['status' => 'preparing']);
        DB::statement('PRAGMA ignore_check_constraints = OFF');

        $response = $this->getJson('/api/server/my-orders');
        $response
            ->assertStatus(200)
            ->assertJsonPath('0.id', $order->id)
            ->assertJsonPath('0.status', 'in_kitchen')
            ->assertJsonPath('0.items.0.id', $item->id)
            ->assertJsonPath('0.items.0.status', 'in_kitchen');

        $this->assertSame('preparing', DB::table('orders')->where('id', $order->id)->value('status'));
        $this->assertSame('preparing', DB::table('order_items')->where('id', $item->id)->value('status'));
    }

    public function test_appending_to_another_servers_order_requires_confirmation_and_keeps_original_owner(): void
    {
        $serverA = User::factory()->create(['role' => 'server', 'has_system_access' => true, 'name' => 'Serveur A']);
        $serverB = User::factory()->create(['role' => 'server', 'has_system_access' => true, 'name' => 'Serveur B']);

        $table = RestaurantTable::create([
            'table_number' => 22,
            'capacity' => 4,
            'section' => 'Salle',
            'status' => 'free',
        ]);

        $menu = Menu::create([
            'name' => 'Plat partage',
            'description' => 'Test',
            'price' => 15000,
            'category' => 'Plats',
            'is_available' => true,
        ]);

        Sanctum::actingAs($serverA);
        $createResponse = $this->postJson('/api/server/orders', [
            'table_id' => $table->id,
            'items' => [
                [
                    'menu_id' => $menu->id,
                    'quantity' => 1,
                ],
            ],
        ]);

        $createResponse->assertCreated();
        $orderId = (int) $createResponse->json('id');

        Sanctum::actingAs($serverB);
        $confirmResponse = $this->postJson('/api/server/orders', [
            'table_id' => $table->id,
            'append_to_existing' => true,
            'items' => [
                [
                    'menu_id' => $menu->id,
                    'quantity' => 1,
                ],
            ],
        ]);

        $confirmResponse->assertStatus(409)
            ->assertJsonPath('require_confirmation', true)
            ->assertJsonPath('confirmation_reason', 'foreign_server_append')
            ->assertJsonPath('existing_order_id', $orderId)
            ->assertJsonPath('existing_server.name', 'Serveur A');

        $appendResponse = $this->postJson('/api/server/orders', [
            'table_id' => $table->id,
            'append_to_existing' => true,
            'confirm_other_server_append' => true,
            'items' => [
                [
                    'menu_id' => $menu->id,
                    'quantity' => 1,
                ],
            ],
        ]);

        $appendResponse->assertCreated()
            ->assertJsonPath('id', $orderId)
            ->assertJsonPath('appended_to_existing', true)
            ->assertJsonPath('user.id', $serverA->id)
            ->assertJsonPath('user.name', 'Serveur A');

        $this->assertDatabaseCount('orders', 1);
        $this->assertDatabaseHas('orders', [
            'id' => $orderId,
            'user_id' => $serverA->id,
        ]);
        $this->assertDatabaseCount('order_items', 2);

        Sanctum::actingAs($serverA);
        $serverAOrders = $this->getJson('/api/server/my-orders');
        $serverAOrders->assertOk()->assertJsonFragment(['id' => $orderId]);

        Sanctum::actingAs($serverB);
        $serverBOrders = $this->getJson('/api/server/my-orders');
        $orderIds = collect($serverBOrders->json())
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();

        $this->assertNotContains($orderId, $orderIds);
    }
}
