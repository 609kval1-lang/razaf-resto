<?php

namespace Tests\Feature;

use App\Models\CashMovement;
use App\Models\Customer;
use App\Models\Menu;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CashierPaymentRoutingTest extends TestCase
{
    use RefreshDatabase;

    public function test_cashier_routes_customer_payments_to_the_expected_account(): void
    {
        $cashier = User::factory()->create(['role' => 'cashier']);
        $server = User::factory()->create(['role' => 'server']);

        Sanctum::actingAs($cashier);

        $expectations = [
            'cash' => CashMovement::ACCOUNT_CASH,
            'transfer' => CashMovement::ACCOUNT_BANK,
            'check' => CashMovement::ACCOUNT_BANK,
        ];

        foreach ($expectations as $method => $destinationAccount) {
            $order = Order::query()->create([
                'user_id' => $server->id,
                'table_id' => null,
                'customer_id' => null,
                'total_amount' => 18000,
                'status' => 'served',
                'is_urgent' => false,
                'bill_requested_at' => now(),
                'occupies_table' => false,
            ]);

            $this->postJson("/api/cashier/orders/{$order->id}/prepare-payment", [
                'method' => $method,
            ])->assertOk();

            $response = $this->postJson("/api/cashier/orders/{$order->id}/payment", [
                'method' => $method,
            ]);

            $response->assertOk()
                ->assertJsonPath('settlement_method', $method)
                ->assertJsonPath('amount_paid', 18000);

            $this->assertDatabaseHas('cash_movements', [
                'order_id' => $order->id,
                'flow_type' => 'customer_payment',
                'payment_method' => $method,
                'destination_account' => $destinationAccount,
            ]);
        }
    }

    public function test_cashier_can_settle_a_pending_voucher_even_if_legacy_settlement_method_is_bon(): void
    {
        $cashier = User::factory()->create(['role' => 'cashier']);
        $server = User::factory()->create(['role' => 'server']);

        Sanctum::actingAs($cashier);

        $order = Order::query()->create([
            'user_id' => $server->id,
            'table_id' => null,
            'customer_id' => null,
            'total_amount' => 24500,
            'status' => 'served',
            'is_urgent' => false,
            'bill_requested_at' => now(),
            'occupies_table' => false,
        ]);

        $this->postJson("/api/cashier/orders/{$order->id}/prepare-payment", [
            'method' => 'bon',
            'customer_name' => 'Client bon',
        ])->assertOk();

        $order->refresh();
        $order->latestPayment()->update([
            'settlement_method' => 'bon',
        ]);

        $response = $this->postJson("/api/cashier/orders/{$order->id}/payment", [
            'method' => 'cash',
        ]);

        $response->assertOk()
            ->assertJsonPath('settlement_method', 'cash')
            ->assertJsonPath('amount_paid', 24500);

        $this->assertDatabaseHas('payments', [
            'order_id' => $order->id,
            'status' => 'completed',
            'method' => 'bon',
            'settlement_method' => 'cash',
        ]);

        $this->assertDatabaseHas('cash_movements', [
            'order_id' => $order->id,
            'flow_type' => 'customer_voucher_settlement',
            'payment_method' => 'cash',
            'destination_account' => CashMovement::ACCOUNT_CASH,
        ]);
    }

    public function test_cashier_can_record_a_partial_payment_and_leave_the_balance_as_a_pending_voucher(): void
    {
        $cashier = User::factory()->create(['role' => 'cashier']);
        $server = User::factory()->create(['role' => 'server']);

        Sanctum::actingAs($cashier);

        $order = Order::query()->create([
            'user_id' => $server->id,
            'table_id' => null,
            'customer_id' => null,
            'total_amount' => 30000,
            'status' => 'served',
            'is_urgent' => false,
            'bill_requested_at' => now(),
            'occupies_table' => false,
        ]);

        $this->postJson("/api/cashier/orders/{$order->id}/prepare-payment", [
            'method' => 'cash',
            'customer_name' => 'Client partage',
        ])->assertOk();

        $response = $this->postJson("/api/cashier/orders/{$order->id}/payment", [
            'method' => 'cash',
            'customer_name' => 'Client partage',
            'split_with_voucher' => true,
            'split_immediate_amount' => 12000,
            'split_immediate_method' => 'cash',
        ]);

        $response->assertOk()
            ->assertJsonPath('amount_paid', 12000)
            ->assertJsonPath('voucher_amount', 18000)
            ->assertJsonPath('settlement_method', 'cash')
            ->assertJsonPath('split_with_voucher', true);

        $order->refresh();

        $this->assertSame('served', $order->status);
        $this->assertDatabaseHas('payments', [
            'order_id' => $order->id,
            'amount' => 12000,
            'method' => 'cash',
            'settlement_method' => 'cash',
            'status' => 'completed',
        ]);
        $this->assertDatabaseHas('payments', [
            'order_id' => $order->id,
            'amount' => 18000,
            'method' => 'bon',
            'settlement_method' => null,
            'status' => 'pending',
        ]);
        $this->assertDatabaseHas('cash_movements', [
            'order_id' => $order->id,
            'flow_type' => 'customer_payment',
            'amount' => 12000,
            'payment_method' => 'cash',
            'destination_account' => CashMovement::ACCOUNT_CASH,
        ]);
    }

    public function test_reprinting_a_split_bill_keeps_the_existing_pending_voucher_amount(): void
    {
        $cashier = User::factory()->create(['role' => 'cashier']);
        $server = User::factory()->create(['role' => 'server']);

        Sanctum::actingAs($cashier);

        $order = Order::query()->create([
            'user_id' => $server->id,
            'table_id' => null,
            'customer_id' => null,
            'total_amount' => 30000,
            'status' => 'served',
            'is_urgent' => false,
            'bill_requested_at' => now(),
            'occupies_table' => false,
        ]);

        $this->postJson("/api/cashier/orders/{$order->id}/prepare-payment", [
            'method' => 'cash',
            'customer_name' => 'Client partage',
        ])->assertOk();

        $this->postJson("/api/cashier/orders/{$order->id}/payment", [
            'method' => 'cash',
            'customer_name' => 'Client partage',
            'split_with_voucher' => true,
            'split_immediate_amount' => 12000,
            'split_immediate_method' => 'cash',
        ])->assertOk();

        $reprintResponse = $this->postJson("/api/cashier/orders/{$order->id}/prepare-payment", [
            'method' => 'bon',
            'customer_name' => 'Client partage',
        ]);

        $reprintResponse->assertOk()
            ->assertJsonPath('amount_due', 18000);

        $this->assertDatabaseHas('payments', [
            'order_id' => $order->id,
            'amount' => 18000,
            'method' => 'bon',
            'status' => 'pending',
        ]);

        $this->assertSame(2, Payment::query()->where('order_id', $order->id)->count());
    }

    public function test_second_payment_of_split_voucher_keeps_customer_from_first_payment(): void
    {
        $cashier = User::factory()->create(['role' => 'cashier']);
        $server = User::factory()->create(['role' => 'server']);

        Sanctum::actingAs($cashier);

        $order = Order::query()->create([
            'user_id' => $server->id,
            'table_id' => null,
            'customer_id' => null,
            'total_amount' => 30000,
            'status' => 'served',
            'is_urgent' => false,
            'bill_requested_at' => now(),
            'occupies_table' => false,
        ]);

        $this->postJson("/api/cashier/orders/{$order->id}/prepare-payment", [
            'method' => 'cash',
            'customer_name' => 'Client tranche 1',
        ])->assertOk();

        $this->postJson("/api/cashier/orders/{$order->id}/payment", [
            'method' => 'cash',
            'customer_name' => 'Client tranche 1',
            'split_with_voucher' => true,
            'split_immediate_amount' => 12000,
            'split_immediate_method' => 'cash',
        ])->assertOk();

        $order->refresh();
        $this->assertNotNull($order->customer_id);

        $firstCustomerId = (int) $order->customer_id;
        $otherCustomer = Customer::query()->create([
            'name' => 'Client tranche 2',
            'loyalty_points' => 0,
        ]);

        $response = $this->postJson("/api/cashier/orders/{$order->id}/payment", [
            'method' => 'transfer',
            'customer_id' => $otherCustomer->id,
        ]);

        $response->assertOk()
            ->assertJsonPath('settlement_method', 'transfer')
            ->assertJsonPath('amount_paid', 18000);

        $order->refresh();

        $this->assertSame($firstCustomerId, (int) $order->customer_id);
        $this->assertDatabaseHas('payments', [
            'order_id' => $order->id,
            'amount' => 18000,
            'method' => 'bon',
            'settlement_method' => 'transfer',
            'status' => 'completed',
        ]);
        $this->assertDatabaseHas('cash_movements', [
            'order_id' => $order->id,
            'flow_type' => 'customer_voucher_settlement',
            'amount' => 18000,
            'payment_method' => 'transfer',
            'destination_account' => CashMovement::ACCOUNT_BANK,
        ]);
    }

    public function test_cashier_ready_orders_normalize_legacy_preparing_statuses_without_writing_on_read(): void
    {
        $cashier = User::factory()->create(['role' => 'cashier']);
        $server = User::factory()->create(['role' => 'server']);

        Sanctum::actingAs($cashier);

        $menu = Menu::query()->create([
            'name' => 'Plat legacy caisse',
            'description' => 'Test legacy cashier preparation',
            'price' => 18000,
            'category' => 'Plats',
            'is_available' => true,
        ]);

        $order = Order::query()->create([
            'user_id' => $server->id,
            'table_id' => null,
            'customer_id' => null,
            'total_amount' => 18000,
            'status' => 'pending',
            'is_urgent' => false,
            'bill_requested_at' => now(),
            'occupies_table' => false,
        ]);

        $item = OrderItem::query()->create([
            'order_id' => $order->id,
            'menu_id' => $menu->id,
            'quantity' => 1,
            'price_at_order' => $menu->price,
            'status' => 'pending',
            'station' => 'kitchen',
        ]);

        Payment::query()->create([
            'order_id' => $order->id,
            'amount' => $menu->price,
            'discount_percent' => 0,
            'discount_amount' => 0,
            'method' => 'cash',
            'status' => 'pending',
            'reference' => null,
            'printed_at' => now(),
            'encashed_at' => null,
            'settlement_method' => null,
        ]);

        DB::statement('PRAGMA ignore_check_constraints = ON');
        DB::table('orders')->where('id', $order->id)->update(['status' => 'preparing']);
        DB::table('order_items')->where('id', $item->id)->update(['status' => 'preparing']);
        DB::statement('PRAGMA ignore_check_constraints = OFF');

        $response = $this->getJson('/api/cashier/orders?include_items=1');

        $response
            ->assertOk()
            ->assertJsonPath('0.id', $order->id)
            ->assertJsonPath('0.status', 'in_kitchen')
            ->assertJsonPath('0.items.0.id', $item->id)
            ->assertJsonPath('0.items.0.status', 'in_kitchen');

        $this->assertSame('preparing', DB::table('orders')->where('id', $order->id)->value('status'));
        $this->assertSame('preparing', DB::table('order_items')->where('id', $item->id)->value('status'));
    }

    public function test_cashier_bill_and_invoice_round_legacy_decimal_sale_amounts_to_whole_ariary(): void
    {
        $cashier = User::factory()->create(['role' => 'cashier']);
        $server = User::factory()->create(['role' => 'server']);

        Sanctum::actingAs($cashier);

        $menu = Menu::query()->create([
            'name' => 'Plat legacy arrondi',
            'description' => 'Test montant legacy',
            'price' => 8034.98,
            'category' => 'Plats',
            'is_available' => true,
        ]);

        $order = Order::query()->create([
            'user_id' => $server->id,
            'table_id' => null,
            'customer_id' => null,
            'total_amount' => 8034.98,
            'status' => 'served',
            'is_urgent' => false,
            'bill_requested_at' => now(),
            'occupies_table' => false,
        ]);

        OrderItem::query()->create([
            'order_id' => $order->id,
            'menu_id' => $menu->id,
            'quantity' => 1,
            'price_at_order' => 8034.98,
            'status' => 'served',
            'station' => 'kitchen',
        ]);

        $readyOrdersResponse = $this->getJson('/api/cashier/orders?include_items=1');
        $readyOrdersResponse->assertOk()
            ->assertJsonPath('0.id', $order->id);

        $readyOrder = $readyOrdersResponse->json('0');
        $this->assertSame(8035.0, (float) ($readyOrder['total_amount'] ?? 0));
        $this->assertSame(8035.0, (float) ($readyOrder['items'][0]['price_at_order'] ?? 0));

        $prepareResponse = $this->postJson("/api/cashier/orders/{$order->id}/prepare-payment", [
            'method' => 'cash',
        ]);
        $prepareResponse->assertOk()
            ->assertJsonPath('amount_due', 8035);

        $this->assertSame(8035.0, (float) ($prepareResponse->json('payment.amount') ?? 0));

        $invoiceResponse = $this->getJson("/api/cashier/invoice/{$order->id}");
        $invoiceResponse->assertOk()
            ->assertJsonPath('items_subtotal', 8035)
            ->assertJsonPath('subtotal', 8035)
            ->assertJsonPath('total', 8035)
            ->assertJsonPath('remaining_amount', 8035);

        $this->assertSame(8035.0, (float) ($invoiceResponse->json('items.0.price_at_order') ?? 0));
    }
}
