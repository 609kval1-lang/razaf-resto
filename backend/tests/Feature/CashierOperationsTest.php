<?php

namespace Tests\Feature;

use App\Models\CashMovement;
use App\Models\Ingredient;
use App\Models\Menu;
use App\Models\Order;
use App\Models\RawMaterial;
use App\Models\ReservationDeposit;
use App\Models\RestaurantTable;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CashierOperationsTest extends TestCase
{
    use RefreshDatabase;

    private User $cashier;
    private Menu $menu;
    private RawMaterial $raw;
    private RestaurantTable $table;

    protected function setUp(): void
    {
        parent::setUp();
        $this->cashier = User::factory()->create(['role' => 'cashier']);
        Sanctum::actingAs($this->cashier);
        $this->table = RestaurantTable::create(['table_number' => 1, 'capacity' => 4, 'status' => 'free']);
        $this->raw = RawMaterial::create(['name' => 'Rice', 'stock' => 10, 'unit' => 'kg', 'cost' => 5000]);
        $portion = Ingredient::create(['raw_material_id' => $this->raw->id, 'name' => 'Rice 100g', 'portion_size' => 100,
            'portion_unit' => 'g', 'quantity_available' => 100, 'cost_per_portion' => 500]);
        $this->menu = Menu::create(['name' => 'Rice dish', 'price' => 1251, 'category' => 'Main', 'is_available' => true]);
        $this->menu->ingredients()->attach($portion->id, ['quantity_needed' => 2]);
    }

    private function order(?int $tableId = null, string $type = 'dine_in', int $quantity = 2): Order
    {
        $response = $this->postJson('/api/cashier/order-entry/orders', ['table_id' => $type === 'dine_in' ? ($tableId ?? $this->table->id) : null,
            'order_type' => $type, 'order_label' => $type === 'other' ? 'Groupe 3 places' : null,
            'checkout_token' => (string) Str::uuid(), 'items' => [['menu_id' => $this->menu->id, 'quantity' => $quantity]]])->assertCreated();
        return Order::findOrFail($response->json('id'));
    }

    private function depositPayload(int $amount = 1000, string $method = 'cash'): array
    {
        return ['table_id' => $this->table->id, 'customer_name' => 'Reservation Alice', 'reservation_at' => '2026-10-09T12:00:00Z',
            'amount' => $amount, 'method' => $method, 'receipt_token' => (string) Str::uuid()];
    }

    private function pay(Order $order, array $data = []): void
    {
        $this->postJson("/api/cashier/orders/{$order->id}/prepare-payment", ['method' => 'cash'])->assertOk();
        $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => 'cash', ...$data])->assertOk();
    }

    public function test_takeaway_and_other_orders_have_no_physical_table_and_keep_the_payment_stock_flow(): void
    {
        foreach (['takeaway', 'other'] as $type) {
            $order = $this->order(type: $type);
            $this->assertNull($order->table_id);
            $this->assertFalse($order->occupies_table);
            $this->assertSame('free', $this->table->fresh()->status);
            $this->assertNull($order->stock_deducted_at);
            $this->pay($order, ['cash_received' => 5000, 'change' => 2498]);
            $this->assertEquals(2502, (float) $order->payments()->first()->amount);
        }
        $this->assertEquals(9.2, (float) $this->raw->fresh()->stock);
        $this->assertEquals(5004, (float) CashMovement::sum('amount'));
        $this->assertNull(CashMovement::first()->metadata['cash_received'] ?? null);
    }

    public function test_free_order_retries_do_not_duplicate_orders_and_require_a_label_for_other(): void
    {
        $payload = ['order_type' => 'takeaway', 'checkout_token' => (string) Str::uuid(), 'items' => [['menu_id' => $this->menu->id, 'quantity' => 1]]];
        $id = $this->postJson('/api/cashier/order-entry/orders', $payload)->assertCreated()->json('id');
        $this->postJson('/api/cashier/order-entry/orders', $payload)->assertCreated()->assertJsonPath('id', $id);
        $payload['order_type'] = 'other';
        $this->postJson('/api/cashier/order-entry/orders', $payload)->assertUnprocessable();
        $this->assertDatabaseCount('orders', 1);
    }

    public function test_deposit_receipts_are_idempotent_route_to_each_account_and_do_not_touch_stock_or_sales(): void
    {
        foreach (['cash' => 'cash', 'mobile_money' => 'mobile_money', 'transfer' => 'bank', 'check' => 'bank'] as $method => $account) {
            $payload = $this->depositPayload(method: $method);
            $id = $this->postJson('/api/cashier/reservation-deposits', $payload)->assertCreated()->json('id');
            $this->postJson('/api/cashier/reservation-deposits', $payload)->assertCreated()->assertJsonPath('id', $id);
            $movement = CashMovement::findOrFail(ReservationDeposit::find($id)->cash_movement_id);
            $this->assertSame($account, $movement->destination_account);
            $this->assertSame('reservation_deposit', $movement->flow_type);
            $this->assertSame('deposit', $movement->movement_type);
            $payload['amount'] = 999;
            $this->postJson('/api/cashier/reservation-deposits', $payload)->assertUnprocessable();
        }
        $this->assertDatabaseCount('cash_movements', 4);
        $this->assertDatabaseCount('payments', 0);
        $this->assertEquals(10, (float) $this->raw->fresh()->stock);
        $this->getJson('/api/cashier/stats')->assertOk()->assertJsonPath('total_revenue', 0);
        $payload = $this->depositPayload(); $payload['amount'] = 1000.5;
        $this->postJson('/api/cashier/reservation-deposits', $payload)->assertUnprocessable();
    }

    public function test_deposit_is_subtracted_once_and_the_bill_keeps_its_full_sales_value(): void
    {
        $depositId = $this->postJson('/api/cashier/reservation-deposits', $this->depositPayload())->assertCreated()->json('id');
        $order = $this->order();
        $this->postJson("/api/cashier/orders/{$order->id}/prepare-payment", ['method' => 'cash', 'deposit_ids' => [$depositId]])
            ->assertOk()->assertJsonPath('amount_due', 1502);
        $this->assertEquals(10, (float) $this->raw->fresh()->stock);
        $this->getJson("/api/cashier/orders?order_id={$order->id}")->assertOk()->assertJsonPath('0.payments.0.deposit_amount', 1000);
        $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => 'cash'])->assertOk()->assertJsonPath('amount_paid', 1502);
        $this->assertEquals(2502, (float) CashMovement::sum('amount'));
        $this->assertEquals(2502, (float) $order->payments()->sum('amount'));
        $this->assertEquals(9.6, (float) $this->raw->fresh()->stock);
        $this->getJson('/api/cashier/reservation-deposits')->assertOk()->assertJsonPath('0.remaining_amount', 0);
        $this->getJson('/api/cashier/stats')->assertOk()->assertJsonPath('total_revenue', 2502)->assertJsonPath('by_method.0.total', 1502);
        $this->getJson("/api/cashier/invoice/{$order->id}")->assertOk()->assertJsonPath('deposit_amount', 1000);
        $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => 'cash'])->assertUnprocessable();
        $this->assertDatabaseCount('cash_movements', 2);
    }

    public function test_fully_covered_bill_keeps_excess_deposit_and_creates_no_second_receipt(): void
    {
        $depositId = $this->postJson('/api/cashier/reservation-deposits', $this->depositPayload(3000))->assertCreated()->json('id');
        $order = $this->order();
        $this->postJson("/api/cashier/orders/{$order->id}/prepare-payment", ['method' => 'cash', 'deposit_ids' => [$depositId]])->assertOk()->assertJsonPath('amount_due', 0);
        $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => 'cash'])->assertOk()->assertJsonPath('amount_paid', 0);
        $this->assertSame('paid', $order->fresh()->status);
        $this->assertDatabaseCount('cash_movements', 1);
        $this->getJson('/api/cashier/reservation-deposits')->assertOk()->assertJsonPath('0.remaining_amount', 498);
    }

    public function test_deposit_and_partial_payment_then_voucher_preserve_money_and_stock_totals(): void
    {
        $depositId = $this->postJson('/api/cashier/reservation-deposits', $this->depositPayload())->assertCreated()->json('id');
        $order = $this->order();
        $this->postJson("/api/cashier/orders/{$order->id}/prepare-payment", ['method' => 'cash', 'deposit_ids' => [$depositId]])->assertOk();
        $this->postJson("/api/cashier/orders/{$order->id}/payment", ['split_with_voucher' => true, 'split_immediate_amount' => 500,
            'split_immediate_method' => 'mobile_money', 'customer_name' => 'Alice'])->assertOk()->assertJsonPath('voucher_amount', 1002);
        $this->assertEquals(9.6, (float) $this->raw->fresh()->stock);
        $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => 'transfer'])->assertOk();
        $this->assertEquals(9.6, (float) $this->raw->fresh()->stock);
        $this->assertEquals(2502, (float) CashMovement::sum('amount'));
        $this->assertEquals(2502, (float) $order->payments()->sum('amount'));
        $this->assertSame('paid', $order->fresh()->status);
    }

    public function test_shortage_rolls_back_deposit_application_and_collection(): void
    {
        $depositId = $this->postJson('/api/cashier/reservation-deposits', $this->depositPayload())->assertCreated()->json('id');
        $order = $this->order();
        $this->postJson("/api/cashier/orders/{$order->id}/prepare-payment", ['method' => 'cash', 'deposit_ids' => [$depositId]])->assertOk();
        $this->raw->update(['stock' => 0]);
        $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => 'cash'])->assertUnprocessable();
        $this->assertDatabaseHas('reservation_deposit_applications', ['deposit_id' => $depositId, 'applied_at' => null]);
        $this->assertDatabaseCount('cash_movements', 1);
        $this->assertSame('pending', $order->payments()->first()->status);
    }

    public function test_grouping_then_dividing_by_table_preserves_prices_stock_and_table_occupancy(): void
    {
        $secondTable = RestaurantTable::create(['table_number' => 2, 'capacity' => 4, 'status' => 'free']);
        $first = $this->order(quantity: 1); $second = $this->order($secondTable->id, quantity: 2);
        $items = [$first->items->first(), $second->items->first()];
        $payload = ['checkout_token' => (string) Str::uuid(), 'order_ids' => [$first->id, $second->id],
            'groups' => [['label' => 'Groupe tables 1 et 2', 'table_ids' => [$this->table->id, $secondTable->id],
                'items' => array_map(fn ($item) => ['item_id' => $item->id, 'quantity' => $item->quantity], $items)]]];
        $mergedId = $this->postJson('/api/cashier/order-entry/redistribute', $payload)->assertCreated()->json('0.id');
        $this->postJson('/api/cashier/order-entry/redistribute', $payload)->assertCreated()->assertJsonPath('0.id', $mergedId);
        $this->assertDatabaseCount('orders', 3);
        $this->assertSame('archived', $first->fresh()->status);
        $this->assertEquals(10, (float) $this->raw->fresh()->stock);
        $this->getJson('/api/cashier/order-entry/tables')->assertOk()->assertJsonPath('0.active_order_id', $mergedId)->assertJsonPath('1.active_order_id', $mergedId);
        $merged = Order::findOrFail($mergedId);
        $this->assertEquals(3753, (float) $merged->total_amount);
        $this->menu->update(['price' => 9999]);
        $groups = $merged->items->map(fn ($item) => ['label' => 'Table '.$item->source_table_id, 'table_ids' => [$item->source_table_id],
            'items' => [['item_id' => $item->id, 'quantity' => $item->quantity]]])->all();
        $response = $this->postJson('/api/cashier/order-entry/redistribute', ['checkout_token' => (string) Str::uuid(), 'order_ids' => [$mergedId], 'groups' => $groups])->assertCreated();
        $this->assertSame(3753, (int) collect($response->json())->sum('total_amount'));
        $this->pay(Order::find($response->json('0.id')));
        $this->assertSame('free', $this->table->fresh()->status);
        $this->assertSame('occupied', $secondTable->fresh()->status);
        $this->pay(Order::find($response->json('1.id')));
        $this->assertSame('free', $secondTable->fresh()->status);
        $this->assertEquals(9.4, (float) $this->raw->fresh()->stock);
        $this->assertEquals(3753, (float) CashMovement::sum('amount'));
    }

    public function test_invalid_repartition_and_printed_bills_cannot_modify_existing_financial_records(): void
    {
        $order = $this->order();
        $payload = ['checkout_token' => (string) Str::uuid(), 'order_ids' => [$order->id], 'groups' => [
            ['label' => 'Addition', 'table_ids' => [$this->table->id], 'items' => [['item_id' => $order->items->first()->id, 'quantity' => 1]]]]];
        $this->postJson('/api/cashier/order-entry/redistribute', $payload)->assertUnprocessable();
        $this->assertDatabaseCount('orders', 1);
        $payload['groups'][0]['items'][0]['quantity'] = 2;
        $this->postJson("/api/cashier/orders/{$order->id}/prepare-payment", ['method' => 'bon', 'customer_name' => 'Alice'])->assertOk();
        $this->postJson('/api/cashier/order-entry/redistribute', $payload)->assertUnprocessable();
        $this->assertDatabaseCount('orders', 1);
        $this->assertDatabaseCount('payments', 1);
        $this->assertEquals(10, (float) $this->raw->fresh()->stock);
    }

    public function test_only_cashier_can_create_operations_and_voucher_filter_excludes_other_bills(): void
    {
        $order = $this->order();
        $this->order(type: 'takeaway');
        $this->postJson("/api/cashier/orders/{$order->id}/prepare-payment", ['method' => 'bon', 'customer_name' => 'Alice'])->assertOk();
        $this->getJson('/api/cashier/orders?scope=vouchers')->assertOk()->assertJsonCount(1)->assertJsonPath('0.id', $order->id);
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->postJson('/api/cashier/reservation-deposits', $this->depositPayload())->assertForbidden();
        $this->postJson('/api/cashier/order-entry/redistribute', [])->assertForbidden();
        $this->assertDatabaseCount('reservation_deposits', 0);
    }

    public function test_stale_balance_blocks_collection_without_stock_or_treasury_writes(): void
    {
        $order = $this->order();
        $this->postJson("/api/cashier/orders/{$order->id}/prepare-payment", ['method' => 'cash'])->assertOk();
        $this->postJson("/api/cashier/orders/{$order->id}/payment", ['method' => 'cash', 'expected_balance' => 2501])->assertUnprocessable();
        $this->assertDatabaseCount('cash_movements', 0);
        $this->assertEquals(10, (float) $this->raw->fresh()->stock);
        $this->assertSame('pending', $order->payments()->first()->status);
    }

    public function test_split_additions_sharing_a_table_release_it_only_after_the_last_payment(): void
    {
        $order = $this->order();
        $itemId = $order->items->first()->id;
        $groups = array_map(fn ($label) => ['label' => $label, 'table_ids' => [$this->table->id], 'items' => [['item_id' => $itemId, 'quantity' => 1]]], ['Addition 1', 'Addition 2']);
        $result = $this->postJson('/api/cashier/order-entry/redistribute', ['checkout_token' => (string) Str::uuid(), 'order_ids' => [$order->id], 'groups' => $groups])->assertCreated();
        $this->pay(Order::findOrFail($result->json('0.id')));
        $this->assertSame('occupied', $this->table->fresh()->status);
        $this->assertEquals(9.8, (float) $this->raw->fresh()->stock);
        $this->pay(Order::findOrFail($result->json('1.id')));
        $this->assertSame('free', $this->table->fresh()->status);
        $this->assertEquals(9.6, (float) $this->raw->fresh()->stock);
    }
}
