<?php

namespace Tests\Feature;

use App\Models\CashMovement;
use App\Models\Menu;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CashierDashboardTest extends TestCase
{
    use RefreshDatabase;

    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(Carbon::parse('2026-10-08T10:00:00Z'));
        $this->cashier = User::factory()->create(['role' => 'cashier']);
        Sanctum::actingAs($this->cashier);
    }

    private function sale(string $date, int $amount = 1000, string $category = 'main', string $name = 'Plat'): Payment
    {
        $menu = Menu::create(['name' => $name, 'price' => $amount, 'category' => $category, 'is_available' => true]);
        $order = Order::create(['user_id' => $this->cashier->id, 'status' => 'paid', 'paid_at' => $date,
            'total_amount' => $amount, 'occupies_table' => false]);
        OrderItem::create(['order_id' => $order->id, 'menu_id' => $menu->id, 'quantity' => 1,
            'price_at_order' => $amount, 'status' => 'served']);
        return Payment::create(['order_id' => $order->id, 'amount' => $amount, 'method' => 'cash',
            'status' => 'completed', 'encashed_at' => $date]);
    }

    public function test_cashier_stats_follow_the_local_day_boundaries_and_admin_keeps_older_payments(): void
    {
        $yesterday = $this->sale('2026-10-07 20:59:59', 7000);
        $first = $this->sale('2026-10-07 21:00:00', 1000);
        $last = $this->sale('2026-10-08 20:59:59', 2000);
        $tomorrow = $this->sale('2026-10-08 21:00:00', 9000);
        $pending = $this->sale('2026-10-08 09:00:00', 8000);
        $pending->update(['status' => 'pending', 'encashed_at' => null]);
        $pending->order->update(['status' => 'served', 'paid_at' => null]);

        $stats = $this->getJson('/api/cashier/stats')->assertOk()
            ->assertJsonPath('total_revenue', 3000)->assertJsonPath('customer_count', 2)
            ->assertJsonPath('total_orders', 2)->assertJsonPath('by_method.0.total', 3000)
            ->assertJsonCount(2, 'recent_customer_payments');
        $this->assertSame([$last->id, $first->id], array_column($stats->json('recent_customer_payments'), 'id'));
        $this->assertSame('2026-10-07T21:00:00+00:00', $stats->json('recent_customer_payments.1.encashed_at'));
        $this->assertEquals(3000, $stats->json('dashboard_sales.dishes'));

        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $adminPayments = $this->getJson('/api/admin/treasury')->assertOk()->json('recent_customer_payments');
        $this->assertContains($yesterday->id, array_column($adminPayments, 'id'));
        $this->assertContains($tomorrow->id, array_column($adminPayments, 'id'));
    }

    public function test_cashier_history_cannot_be_expanded_to_previous_days_with_query_parameters(): void
    {
        $this->sale('2026-10-07 20:59:59');
        $first = $this->sale('2026-10-07 21:00:00');
        $last = $this->sale('2026-10-08 20:59:59');
        $this->sale('2026-10-08 21:00:00');

        $history = $this->getJson('/api/cashier/history?from=2026-01-01&to=2026-12-31')->assertOk();
        $this->assertSame([$last->id, $first->id], array_column($history->json('data'), 'id'));
    }

    public function test_drinks_include_cocktails_and_all_other_sales_remain_in_dishes_without_changing_totals(): void
    {
        $food = $this->sale('2026-10-08 08:00:00', 900, 'main', 'Plateau de brochettes');
        $this->sale('2026-10-08 08:01:00', 1900, 'dessert', 'Gateau au chocolat');
        $this->sale('2026-10-08 08:02:00', 2800, 'drink', 'Eau minerale');
        $this->sale('2026-10-08 08:03:00', 3700, 'cocktail', 'Mojito');
        $this->sale('2026-10-08 08:04:00', 4600, 'Boissons alcoolisees', 'Biere');
        $food->order->update(['with_packaging' => true, 'packaging_quantity' => 1, 'packaging_unit_price' => 100]);
        $food->update(['amount' => 1000]);

        $stats = $this->getJson('/api/cashier/stats')->assertOk();
        $this->assertEquals(14000, $stats->json('total_revenue'));
        $this->assertEquals(11100, $stats->json('dashboard_sales.drinks'));
        $this->assertEquals(2900, $stats->json('dashboard_sales.dishes'));
        $this->assertEquals($stats->json('total_revenue'), array_sum($stats->json('dashboard_sales')));
    }

    public function test_admin_cash_sales_use_the_same_local_day_and_two_families_as_cashier(): void
    {
        $this->sale('2026-10-07 20:59:59', 7000, 'main', 'Vente veille');
        $food = $this->sale('2026-10-08 08:00:00', 900, 'main', 'Plat');
        $food->order->update(['with_packaging' => true, 'packaging_quantity' => 1, 'packaging_unit_price' => 100]);
        $food->update(['amount' => 1000]);
        $this->sale('2026-10-08 08:01:00', 2800, 'drink', 'Eau');
        $this->sale('2026-10-08 08:02:00', 3700, 'cocktail', 'Mojito');
        $this->sale('2026-10-08 08:03:00', 4600, 'Boissons alcoolisees', 'Bière');
        $this->sale('2026-10-08 21:00:00', 9000, 'main', 'Vente demain');

        $cashier = $this->getJson('/api/cashier/stats')->assertOk();
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $admin = $this->getJson('/api/admin/cash-movements')->assertOk();

        $this->assertSame($cashier->json('dashboard_sales.dishes'), $admin->json('revenue_breakdown_today.dishes'));
        $this->assertSame($cashier->json('dashboard_sales.drinks'), $admin->json('revenue_breakdown_today.drinks'));
        $this->assertSame($cashier->json('total_revenue'), $admin->json('revenue_breakdown_today.total'));
        $this->assertSame(1000, $admin->json('revenue_breakdown_today.dishes'));
        $this->assertSame(11100, $admin->json('revenue_breakdown_today.drinks'));
    }

    public function test_admin_day_report_and_cash_entries_follow_local_day_boundaries(): void
    {
        $this->sale('2026-10-07 20:59:59', 7000);
        $this->sale('2026-10-07 21:00:00', 1000);
        $this->sale('2026-10-08 20:59:59', 2000);
        $this->sale('2026-10-08 21:00:00', 9000);
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        foreach ([
            '2026-10-07 20:59:59' => 7000,
            '2026-10-07 21:00:00' => 1000,
            '2026-10-08 20:59:59' => 2000,
            '2026-10-08 21:00:00' => 9000,
        ] as $at => $amount) {
            CashMovement::create([
                'direction' => 'in', 'status' => 'approved', 'movement_type' => 'sale',
                'flow_type' => 'customer_payment', 'amount' => $amount, 'payment_method' => 'cash',
                'destination_account' => CashMovement::ACCOUNT_CASH, 'approved_at' => $at,
                'requested_by_user_id' => $admin->id, 'approved_by_user_id' => $admin->id,
            ]);
        }

        $this->getJson('/api/admin/revenue-report?scope=day')->assertOk()
            ->assertJsonPath('summary.total_revenue_net', 3000);
        $this->getJson('/api/admin/cash-movements')->assertOk()
            ->assertJsonPath('summary.entries_today', 3000)
            ->assertJsonPath('revenue_breakdown_today.total', 3000);
    }

    public function test_partial_payments_count_one_addition_and_deposits_are_not_counted_as_new_collections(): void
    {
        $partial = $this->sale('2026-10-08 08:00:00', 2500);
        $partial->update(['amount' => 1500, 'deposit_amount' => 500]);
        Payment::create(['order_id' => $partial->order_id, 'amount' => 1000, 'method' => 'bon',
            'settlement_method' => 'transfer', 'status' => 'completed', 'encashed_at' => '2026-10-08 09:00:00']);
        $covered = $this->sale('2026-10-08 09:30:00', 5000);
        $covered->update(['deposit_amount' => 5000]);

        $stats = $this->getJson('/api/cashier/stats')->assertOk()->assertJsonPath('total_revenue', 7500)
            ->assertJsonPath('customer_count', 2)->assertJsonCount(2, 'recent_customer_payments');
        $this->assertEquals(2000, array_sum(array_column($stats->json('by_method'), 'total')));
        $this->assertSame([1000.0, 1000.0], array_map('floatval', array_column($stats->json('recent_customer_payments'), 'collected_amount')));
        $this->assertSame(0, CashMovement::count());
        $this->assertSame(3, Payment::count());
    }

    public function test_recent_collections_are_the_latest_twelve_not_the_first_twelve_and_do_not_change_all_day_totals(): void
    {
        $ids = [];
        for ($hour = 0; $hour < 14; $hour++) {
            $ids[] = $this->sale(sprintf('2026-10-08 %02d:00:00', $hour))->id;
        }

        $stats = $this->getJson('/api/cashier/stats')->assertOk()->assertJsonPath('total_revenue', 14000)
            ->assertJsonPath('customer_count', 14)->assertJsonCount(12, 'recent_customer_payments');
        $this->assertSame(array_slice(array_reverse($ids), 0, 12), array_column($stats->json('recent_customer_payments'), 'id'));
    }

    public function test_legacy_decimal_sales_are_rounded_once_for_the_dashboard_without_a_negative_dishes_total(): void
    {
        $first = $this->sale('2026-10-08 08:00:00', 1, 'drink', 'Eau');
        $second = $this->sale('2026-10-08 09:00:00', 1, 'cocktail', 'Mojito');
        $first->update(['amount' => 0.60]);
        $second->update(['amount' => 0.60]);

        $this->getJson('/api/cashier/stats')->assertOk()->assertJsonPath('total_revenue', 1)
            ->assertJsonPath('dashboard_sales.drinks', 1)->assertJsonPath('dashboard_sales.dishes', 0);
        $this->assertEquals(0.60, $first->fresh()->amount);
        $this->assertEquals(0.60, $second->fresh()->amount);
    }
}
