<?php

namespace Tests\Feature;

use App\Models\Ingredient;
use App\Models\Menu;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\RawMaterial;
use App\Models\RestaurantTable;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CashierOrderEntryTest extends TestCase
{
    use RefreshDatabase;

    public function test_guest_and_other_roles_cannot_read_the_cashier_catalogue(): void
    {
        foreach (['tables', 'menus'] as $resource) {
            $this->getJson("/api/cashier/order-entry/{$resource}")->assertUnauthorized();
        }

        foreach (['admin', 'server', 'kitchen', 'barman', 'employee'] as $role) {
            Sanctum::actingAs(User::factory()->create(['role' => $role]));
            foreach (['tables', 'menus'] as $resource) {
                $this->getJson("/api/cashier/order-entry/{$resource}")->assertForbidden();
            }
        }
    }

    public function test_cashier_reads_table_occupancy_without_changing_reservations_or_orders(): void
    {
        $cashier = User::factory()->create(['role' => 'cashier']);
        Sanctum::actingAs($cashier);
        $free = RestaurantTable::create(['table_number' => 1, 'capacity' => 2, 'status' => 'free']);
        $occupied = RestaurantTable::create(['table_number' => 2, 'capacity' => 4, 'status' => 'free']);
        $reserved = RestaurantTable::create([
            'table_number' => 3, 'capacity' => 6, 'status' => 'reserved',
            'reservation_name' => 'Client', 'reservation_at' => now()->subHour(),
        ]);
        $released = RestaurantTable::create(['table_number' => 4, 'capacity' => 2, 'status' => 'free']);
        $deleted = RestaurantTable::create(['table_number' => 5, 'capacity' => 2, 'status' => 'free']);
        $deleted->delete();
        $activeOrder = Order::create([
            'user_id' => $cashier->id, 'table_id' => $occupied->id,
            'total_amount' => 1251, 'status' => 'pending', 'occupies_table' => true,
        ]);
        $menu = Menu::create(['name' => 'Dish', 'price' => 417, 'is_available' => true]);
        OrderItem::create(['order_id' => $activeOrder->id, 'menu_id' => $menu->id, 'quantity' => 3, 'price_at_order' => 417]);
        Order::create([
            'user_id' => $cashier->id, 'table_id' => $free->id,
            'total_amount' => 2000, 'status' => 'paid', 'occupies_table' => true,
        ]);
        Order::create([
            'user_id' => $cashier->id, 'table_id' => $released->id,
            'total_amount' => 2000, 'status' => 'served', 'occupies_table' => false,
        ]);
        $before = [$free->fresh()->getAttributes(), $occupied->fresh()->getAttributes(), $reserved->fresh()->getAttributes()];

        DB::enableQueryLog();
        $this->getJson('/api/cashier/order-entry/tables')->assertOk()->assertJsonCount(4)
            ->assertJsonPath('0.id', $free->id)->assertJsonPath('0.status', 'free')
            ->assertJsonPath('1.status', 'occupied')->assertJsonPath('1.active_order_id', $activeOrder->id)
            ->assertJsonPath('0.active_order', null)->assertJsonPath('1.active_order.item_count', 3)
            ->assertJsonPath('1.active_order.total_amount', 1251)
            ->assertJsonPath('2.status', 'reserved')->assertJsonPath('3.status', 'free');
        $this->assertReadOnlyQueries();

        $this->assertSame($before, [$free->fresh()->getAttributes(), $occupied->fresh()->getAttributes(), $reserved->fresh()->getAttributes()]);
        $this->assertDatabaseCount('orders', 3);
        $this->assertDatabaseCount('order_items', 1);
        $this->assertDatabaseCount('payments', 0);
        $this->assertDatabaseCount('cash_movements', 0);
    }

    public function test_cashier_reads_menu_prices_and_recipes_without_changing_stock(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'cashier']));
        $rawMaterial = RawMaterial::create(['name' => 'Rice', 'stock' => 1, 'unit' => 'kg', 'cost' => 5000]);
        $ingredient = Ingredient::create([
            'raw_material_id' => $rawMaterial->id, 'name' => 'Rice portion',
            'portion_size' => 100, 'portion_unit' => 'g', 'quantity_available' => 4, 'cost_per_portion' => 500,
        ]);
        $menu = Menu::create(['name' => 'A Rice', 'price' => 1250.6, 'category' => 'main', 'is_available' => true]);
        $menu->ingredients()->attach($ingredient->id, ['quantity_needed' => 1]);
        Menu::create(['name' => 'B Unavailable', 'price' => 2000, 'is_available' => false]);
        $deleted = Menu::create(['name' => 'C Deleted', 'price' => 3000, 'is_available' => true]);
        $deleted->delete();
        $before = [$rawMaterial->fresh()->getAttributes(), $ingredient->fresh()->getAttributes()];

        DB::enableQueryLog();
        $this->getJson('/api/cashier/order-entry/menus')->assertOk()->assertJsonCount(2)
            ->assertJsonPath('0.id', $menu->id)->assertJsonPath('0.price', 1251)
            ->assertJsonPath('0.ingredients.0.name', 'Rice portion')
            ->assertJsonPath('0.is_available', true)->assertJsonPath('1.is_available', false)
            ->assertJsonMissingPath('0.ingredients.0.cost_per_portion');
        $this->assertReadOnlyQueries();

        $this->assertSame($before, [$rawMaterial->fresh()->getAttributes(), $ingredient->fresh()->getAttributes()]);
        $this->assertDatabaseCount('orders', 0);
        $this->assertDatabaseCount('payments', 0);
        $this->assertDatabaseCount('cash_movements', 0);
    }

    private function assertReadOnlyQueries(): void
    {
        $writes = array_filter(DB::getQueryLog(), fn ($query) => preg_match('/^\s*(insert|update|delete|replace)\b/i', $query['query']));
        DB::disableQueryLog();
        $this->assertSame([], array_values($writes));
    }
}
