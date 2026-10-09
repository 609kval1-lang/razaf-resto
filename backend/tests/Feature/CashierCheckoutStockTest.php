<?php

namespace Tests\Feature;

use App\Models\ActionLog;
use App\Models\CashMovement;
use App\Models\Customer;
use App\Models\Ingredient;
use App\Models\Menu;
use App\Models\Order;
use App\Models\RawMaterial;
use App\Models\RestaurantTable;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CashierCheckoutStockTest extends TestCase
{
    use RefreshDatabase;

    private User $cashier;
    private RestaurantTable $table;
    private RawMaterial $raw;
    private Ingredient $portion;
    private Menu $menu;

    protected function setUp(): void
    {
        parent::setUp();
        $this->cashier = User::factory()->create(['role' => 'cashier']);
        Sanctum::actingAs($this->cashier);
        $this->table = RestaurantTable::create(['table_number' => 1, 'capacity' => 4, 'status' => 'free']);
        $this->raw = RawMaterial::create(['name' => 'Rice', 'stock' => 1.00001, 'unit' => 'kg', 'cost' => 5000]);
        $this->portion = Ingredient::create([
            'raw_material_id' => $this->raw->id, 'name' => 'Rice 100g', 'portion_size' => 100,
            'portion_unit' => 'g', 'quantity_available' => 99, 'cost_per_portion' => 500,
        ]);
        $this->menu = Menu::create(['name' => 'Rice dish', 'price' => 1250.6, 'category' => 'Main', 'is_available' => true]);
        $this->menu->ingredients()->attach($this->portion->id, ['quantity_needed' => 2]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function payload(int $quantity = 2): array
    {
        return ['table_id' => $this->table->id, 'checkout_token' => (string) Str::uuid(), 'notes' => 'Sans sel',
            'items' => [['menu_id' => $this->menu->id, 'quantity' => $quantity, 'price' => 1]]];
    }

    private function createOrder(int $quantity = 2): Order
    {
        $response = $this->postJson('/api/cashier/order-entry/orders', $this->payload($quantity))->assertCreated();
        return Order::findOrFail($response->json('id'));
    }

    private function prepare(Order $order, string $method = 'cash'): void
    {
        $this->postJson("/api/cashier/orders/{$order->id}/prepare-payment", [
            'method' => $method, 'customer_name' => $method === 'bon' ? 'Voucher client' : null,
        ])->assertOk();
    }

    public function test_creating_an_order_uses_server_prices_but_does_not_consume_stock_or_money(): void
    {
        $order = $this->createOrder();
        $this->assertEquals(2502, (float) $order->total_amount);
        $this->assertEquals(1251, (float) $order->items->first()->price_at_order);
        $this->assertSame('cashier', $order->checkout_source);
        $this->assertNull($order->stock_deducted_at);
        $this->assertSame(400000, $order->stock_requirements[0]['quantity_units']);
        $this->assertEquals(1.00001, (float) $this->raw->fresh()->stock);
        $this->assertSame(99, $this->portion->fresh()->quantity_available);
        $this->assertSame('occupied', $this->table->fresh()->status);
        $this->assertDatabaseCount('payments', 0);
        $this->assertDatabaseCount('cash_movements', 0);
    }

    public function test_retrying_the_same_validation_returns_one_order_even_with_integer_strings(): void
    {
        $payload = $this->payload();
        $id = $this->postJson('/api/cashier/order-entry/orders', $payload)->assertCreated()->json('id');
        $payload['items'][0]['quantity'] = '2';
        $this->postJson('/api/cashier/order-entry/orders', $payload)->assertCreated()->assertJsonPath('id', $id);
        $this->assertDatabaseCount('orders', 1);
        $this->assertDatabaseCount('order_items', 1);
        $this->assertDatabaseCount('action_logs', 1);
        $payload['items'][0]['quantity'] = 3;
        $this->postJson('/api/cashier/order-entry/orders', $payload)->assertUnprocessable()->assertJsonValidationErrors('checkout_token');
        $this->assertDatabaseCount('orders', 1);
    }

    public function test_an_occupied_table_cannot_receive_a_second_order(): void
    {
        $this->createOrder();
        $this->postJson('/api/cashier/order-entry/orders', $this->payload())->assertUnprocessable()->assertJsonValidationErrors('table_id');
        $this->assertDatabaseCount('orders', 1);
    }

    public function test_reservation_lock_is_enforced_at_two_hours_and_does_not_mutate_reads(): void
    {
        Carbon::setTestNow('2026-10-08 10:00:00');
        $this->table->update(['status' => 'reserved', 'reservation_at' => '2026-10-08 12:00:00']);
        $this->getJson('/api/cashier/order-entry/tables')->assertOk()->assertJsonPath('0.reservation_locked', true);
        $this->postJson('/api/cashier/order-entry/orders', $this->payload())->assertUnprocessable();
        $this->assertDatabaseCount('orders', 0);
        Carbon::setTestNow('2026-10-08 09:59:59');
        $this->getJson('/api/cashier/order-entry/tables')->assertOk()->assertJsonPath('0.reservation_locked', false);
        $this->createOrder();
    }

    public function test_catalogue_and_availability_are_read_only_and_use_raw_stock_not_stale_portion_counters(): void
    {
        $before = [$this->raw->fresh()->getAttributes(), $this->portion->fresh()->getAttributes()];
        DB::enableQueryLog();
        $this->getJson('/api/cashier/order-entry/menus?paginate=1')->assertOk()
            ->assertJsonPath('data.0.max_portions_available', 5)->assertJsonPath('last_page', 1);
        $this->getJson('/api/cashier/availability')->assertOk()
            ->assertJsonPath('menus.0.is_orderable', true)->assertJsonPath('menus.0.portions.0.available', 10);
        $writes = array_filter(DB::getQueryLog(), fn ($query) => preg_match('/^\s*(insert|update|delete|replace)\b/i', $query['query']));
        DB::disableQueryLog();
        $this->assertSame([], array_values($writes));
        $this->assertSame($before, [$this->raw->fresh()->getAttributes(), $this->portion->fresh()->getAttributes()]);
    }

    public function test_shared_material_usage_is_grouped_within_a_recipe_and_across_the_cart(): void
    {
        $alternative = Ingredient::create([
            'raw_material_id' => $this->raw->id, 'name' => 'Rice 300g', 'portion_size' => 300,
            'portion_unit' => 'g', 'quantity_available' => 99, 'cost_per_portion' => 1500,
        ]);
        $this->menu->ingredients()->attach($alternative->id, ['quantity_needed' => 1]);
        $this->getJson('/api/cashier/order-entry/menus')->assertOk()->assertJsonPath('0.max_portions_available', 2);
        $second = Menu::create(['name' => 'Other dish', 'price' => 2000, 'is_available' => true]);
        $second->ingredients()->attach($alternative->id, ['quantity_needed' => 1]);
        $payload = $this->payload();
        $payload['items'][] = ['menu_id' => $second->id, 'quantity' => 1];
        $this->postJson('/api/cashier/order-entry/orders', $payload)->assertUnprocessable()->assertJsonValidationErrors('stock');
        $this->assertDatabaseCount('orders', 0);
        $order = $this->createOrder();
        $this->assertCount(1, $order->stock_requirements);
        $this->prepare($order);
        $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => 'cash'])->assertOk();
        $this->assertEqualsWithDelta(0.00001, (float) $this->raw->fresh()->stock, 0.00000001);
        $this->assertSame(0, $alternative->fresh()->quantity_available);
        $this->assertSame(0, $this->portion->fresh()->quantity_available);
    }

    public function test_each_real_payment_method_consumes_stock_and_routes_money_once(): void
    {
        foreach (['cash' => 'cash', 'mobile_money' => 'mobile_money', 'transfer' => 'bank', 'check' => 'bank'] as $method => $account) {
            $this->raw->refresh()->update(['stock' => 1.00001]);
            $order = $this->createOrder();
            $this->prepare($order, $method);
            $this->assertEquals(1.00001, (float) $this->raw->fresh()->stock);
            $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => $method])->assertOk()->assertJsonPath('amount_paid', 2502);
            $this->assertEqualsWithDelta(0.60001, (float) $this->raw->fresh()->stock, 0.00000001);
            $this->assertNotNull($order->fresh()->stock_deducted_at);
            $this->assertSame('paid', $order->fresh()->status);
            $this->assertSame('free', $this->table->fresh()->status);
            $this->assertDatabaseHas('cash_movements', ['order_id' => $order->id, 'destination_account' => $account, 'amount' => 2502]);
            $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => $method])->assertUnprocessable();
            $this->assertSame(1, CashMovement::where('order_id', $order->id)->count());
            $this->assertSame(1, ActionLog::where('entity_id', $order->id)->where('action', 'order_stock_consumed')->count());
        }
    }

    public function test_discount_reduces_collections_across_accounts_without_extra_money_movements(): void
    {
        foreach (['cash' => 'cash', 'mobile_money' => 'mobile_money', 'transfer' => 'bank', 'check' => 'bank'] as $method => $account) {
            $this->raw->refresh()->update(['stock' => 1.00001]);
            $order = $this->createOrder();
            $this->postJson("/api/cashier/orders/{$order->id}/prepare-payment", [
                'method' => $method, 'discount_percent' => 10,
            ])->assertOk();

            $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => $method])
                ->assertOk()
                ->assertJsonPath('amount_paid', 2252);

            $this->assertDatabaseHas('cash_movements', [
                'order_id' => $order->id,
                'destination_account' => $account,
                'amount' => 2252,
            ]);
            $this->assertSame(1, CashMovement::query()->where('order_id', $order->id)->count());
        }

        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $report = $this->getJson('/api/admin/revenue-report')->assertOk();
        $this->assertEquals(10008, $report->json('summary.total_revenue_gross'));
        $this->assertEquals(1000, $report->json('summary.total_discount'));
        $this->assertEquals(9008, $report->json('summary.total_revenue_net'));
        $this->assertEquals(9008, $report->json('summary.dishes_revenue_net'));
    }

    public function test_fractional_partial_payment_is_rejected_without_stock_consumption_or_money(): void
    {
        $order = $this->createOrder();
        $this->prepare($order);
        $this->postJson("/api/cashier/orders/{$order->id}/payment", [
            'method' => 'cash', 'split_with_voucher' => true, 'split_immediate_amount' => 500.5,
            'customer_name' => 'Client partial',
        ])->assertUnprocessable()->assertJsonValidationErrors('split_immediate_amount');
        $this->assertEquals(1.00001, (float) $this->raw->fresh()->stock);
        $this->assertNull($order->fresh()->stock_deducted_at);
        $this->assertDatabaseCount('cash_movements', 0);
        $this->assertSame('pending', $order->fresh()->payments->first()->status);
    }

    public function test_first_partial_payment_consumes_the_whole_order_and_the_balance_never_consumes_it_again(): void
    {
        $order = $this->createOrder();
        $this->prepare($order);
        $this->postJson("/api/cashier/orders/{$order->id}/payment", [
            'method' => 'mobile_money', 'customer_name' => 'Client partial', 'split_with_voucher' => true,
            'split_immediate_method' => 'mobile_money', 'split_immediate_amount' => 1000,
        ])->assertOk()->assertJsonPath('amount_paid', 1000)->assertJsonPath('voucher_amount', 1502);
        $this->assertEquals(0.60001, (float) $this->raw->fresh()->stock);
        $this->assertSame('served', $order->fresh()->status);
        $marker = $order->fresh()->stock_deducted_at->toISOString();
        $this->raw->update(['stock' => 0]);
        $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => 'transfer'])->assertOk()->assertJsonPath('amount_paid', 1502);
        $this->assertEquals(0, (float) $this->raw->fresh()->stock);
        $this->assertSame($marker, $order->fresh()->stock_deducted_at->toISOString());
        $this->assertEquals(2502, CashMovement::where('order_id', $order->id)->sum('amount'));
    }

    public function test_preparing_or_printing_a_voucher_does_not_consume_stock_until_real_collection(): void
    {
        $order = $this->createOrder();
        $this->prepare($order, 'bon');
        $this->getJson("/api/cashier/invoice/{$order->id}")->assertOk();
        $this->assertNull($order->fresh()->stock_deducted_at);
        $this->assertEquals(1.00001, (float) $this->raw->fresh()->stock);
        $this->assertDatabaseCount('cash_movements', 0);
        $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => 'cash'])->assertOk();
        $this->assertEquals(0.60001, (float) $this->raw->fresh()->stock);
    }

    public function test_two_tables_share_stock_and_the_second_payment_is_rechecked_without_another_cashier(): void
    {
        $first = $this->createOrder(3);
        $secondTable = RestaurantTable::create(['table_number' => 2, 'capacity' => 4, 'status' => 'free']);
        $payload = $this->payload(3);
        $payload['table_id'] = $secondTable->id;
        $id = $this->postJson('/api/cashier/order-entry/orders', $payload)->assertCreated()->json('id');
        $second = Order::findOrFail($id);
        $this->prepare($first);
        $this->prepare($second);
        $this->assertEquals(1.00001, (float) $this->raw->fresh()->stock);

        $this->postJson("/api/cashier/orders/{$first->id}/payment", ['method' => 'cash'])->assertOk();
        $this->assertEquals(0.40001, (float) $this->raw->fresh()->stock);
        $this->getJson('/api/cashier/availability')->assertOk()->assertJsonPath('menus.0.max_portions_available', 2);
        $this->postJson("/api/cashier/orders/{$second->id}/payment", ['method' => 'mobile_money'])
            ->assertUnprocessable()->assertJsonValidationErrors('stock');
        $this->assertEquals(0.40001, (float) $this->raw->fresh()->stock);
        $this->assertNull($second->fresh()->stock_deducted_at);
        $this->assertSame('pending', $second->fresh()->latestPayment->status);
        $this->assertSame(0, CashMovement::where('order_id', $second->id)->count());
    }

    public function test_stock_shortage_rolls_back_payment_customer_money_and_all_stock_changes(): void
    {
        $other = RawMaterial::create(['name' => 'Oil', 'stock' => 1, 'unit' => 'L', 'cost' => 2000]);
        $portion = Ingredient::create(['raw_material_id' => $other->id, 'name' => 'Oil 10ml',
            'portion_size' => 10, 'portion_unit' => 'ml', 'quantity_available' => 100, 'cost_per_portion' => 20]);
        $this->menu->ingredients()->attach($portion->id, ['quantity_needed' => 1]);
        $order = $this->createOrder();
        $this->prepare($order);
        $this->raw->update(['stock' => 0.3]);
        $logs = ActionLog::count();
        $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => 'cash', 'customer_name' => 'Should rollback'])
            ->assertUnprocessable()->assertJsonValidationErrors('stock');
        $this->assertEquals(0.3, (float) $this->raw->fresh()->stock);
        $this->assertEquals(1, (float) $other->fresh()->stock);
        $this->assertSame(100, $portion->fresh()->quantity_available);
        $this->assertNull($order->fresh()->stock_deducted_at);
        $this->assertSame('pending', $order->fresh()->latestPayment->status);
        $this->assertDatabaseCount('cash_movements', 0);
        $this->assertDatabaseCount('action_logs', $logs);
        $this->assertDatabaseMissing('customers', ['name' => 'Should rollback']);
        $this->assertSame('occupied', $this->table->fresh()->status);
        $this->raw->update(['stock' => 1.00001]);
        $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => 'cash'])->assertOk();
        $this->assertEquals(0.98, (float) $other->fresh()->stock);
    }

    public function test_recipe_changes_after_entry_do_not_change_the_frozen_stock_requirement(): void
    {
        $order = $this->createOrder();
        $this->portion->update(['portion_size' => 400]);
        $this->menu->ingredients()->detach();
        $this->prepare($order);
        $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => 'cash'])->assertOk();
        $this->assertEquals(0.60001, (float) $this->raw->fresh()->stock);
        $this->assertSame(1, $this->portion->fresh()->quantity_available);
    }

    public function test_tiny_portions_keep_six_decimal_stock_precision(): void
    {
        $this->raw->update(['stock' => 0.00003]);
        $this->portion->update(['portion_size' => 0.01]);
        $order = $this->createOrder(1);
        $this->prepare($order);
        $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => 'cash'])->assertOk();
        $this->assertEqualsWithDelta(0.00001, (float) $this->raw->fresh()->stock, 0.000000001);
        $this->assertSame(1, $this->portion->fresh()->quantity_available);
    }

    public function test_missing_recipe_deleted_material_and_unavailable_menu_are_blocked(): void
    {
        $this->menu->update(['is_available' => false]);
        $this->postJson('/api/cashier/order-entry/orders', $this->payload())->assertUnprocessable();
        $this->menu->update(['is_available' => true]);
        $this->menu->ingredients()->detach();
        $this->postJson('/api/cashier/order-entry/orders', $this->payload())->assertUnprocessable()->assertJsonValidationErrors('stock');
        $this->menu->ingredients()->attach($this->portion->id, ['quantity_needed' => 2]);
        $order = $this->createOrder();
        $this->prepare($order);
        $this->raw->delete();
        $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => 'cash'])->assertUnprocessable()->assertJsonValidationErrors('stock');
        $this->assertDatabaseCount('cash_movements', 0);
    }

    public function test_sub_stock_precision_recipes_are_rejected_instead_of_under_consuming(): void
    {
        $this->portion->update(['portion_size' => 0.51, 'portion_unit' => 'mg']);
        $this->getJson('/api/cashier/order-entry/menus')->assertOk()->assertJsonPath('0.is_orderable', false);
        $this->postJson('/api/cashier/order-entry/orders', $this->payload(100))->assertUnprocessable()->assertJsonValidationErrors('stock');
        $this->assertDatabaseCount('orders', 0);
        $this->assertEquals(1.00001, (float) $this->raw->fresh()->stock);
    }

    public function test_legacy_orders_are_payable_without_kitchen_or_bill_request_and_are_not_consumed_twice(): void
    {
        $order = Order::create(['user_id' => $this->cashier->id, 'table_id' => $this->table->id,
            'total_amount' => 2502, 'status' => 'pending', 'occupies_table' => true]);
        $order->items()->create(['menu_id' => $this->menu->id, 'quantity' => 2, 'price_at_order' => 1251, 'status' => 'pending']);
        $this->getJson("/api/cashier/orders?order_id={$order->id}&include_items=1")->assertOk()->assertJsonCount(1)->assertJsonPath('0.items.0.quantity', 2);
        $this->assertSame('pending', $order->fresh()->status);
        $this->prepare($order);
        $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => 'cash'])->assertOk();
        $this->assertEquals(1.00001, (float) $this->raw->fresh()->stock);
        $this->assertNull($order->fresh()->stock_deducted_at);
    }

    public function test_pagination_search_and_filtering_keep_the_catalogue_small(): void
    {
        for ($i = 0; $i < 15; $i++) Menu::create(['name' => "Menu {$i}", 'price' => 2000, 'category' => 'Drinks', 'is_available' => true]);
        $this->getJson('/api/cashier/order-entry/menus?paginate=1')->assertOk()->assertJsonCount(12, 'data')->assertJsonPath('total', 16);
        $this->getJson('/api/cashier/order-entry/menus?paginate=1&page=2')->assertOk()->assertJsonCount(4, 'data');
        $this->getJson('/api/cashier/order-entry/menus?paginate=1&category=Main&search=Rice')->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_archived_routes_and_roles_are_inactive_without_deleting_accounts(): void
    {
        foreach (['server', 'kitchen', 'barman'] as $role) {
            $user = User::factory()->create(['role' => $role, 'password' => 'secret123', 'has_system_access' => true]);
            $this->postJson('/api/login', ['email' => $user->email, 'password' => 'secret123'])->assertForbidden();
            $this->assertDatabaseHas('users', ['id' => $user->id, 'role' => $role]);
            $this->getJson("/api/{$role}/orders")->assertNotFound();
        }
        $this->getJson('/api/bar/orders')->assertNotFound();
        $this->postJson('/api/server/orders', $this->payload())->assertNotFound();
    }
}
