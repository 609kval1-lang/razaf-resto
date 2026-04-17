<?php

namespace Tests\Feature;

use App\Models\CashMovement;
use App\Models\Order;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminTreasuryManagementTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_transfer_and_withdrawal_update_treasury_balances(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        CashMovement::query()->create([
            'direction' => 'in',
            'status' => 'approved',
            'movement_type' => 'sale',
            'amount' => 10000,
            'payment_method' => 'cash',
            'destination_account' => CashMovement::ACCOUNT_CASH,
            'description' => 'Encaissement test',
            'reason' => 'Base de départ',
            'requested_by_user_id' => $admin->id,
            'approved_by_user_id' => $admin->id,
            'approved_at' => now(),
        ]);

        $this->postJson('/api/admin/treasury/transfers', [
            'amount' => 6000,
            'source_account' => CashMovement::ACCOUNT_CASH,
            'destination_account' => CashMovement::ACCOUNT_BANK,
            'reason' => 'Dépôt banque',
            'description' => 'Vidage caisse soir',
        ])->assertStatus(201)
            ->assertJsonPath('movement.source_account', CashMovement::ACCOUNT_CASH)
            ->assertJsonPath('movement.destination_account', CashMovement::ACCOUNT_BANK);

        $afterTransfer = $this->getJson('/api/admin/treasury');
        $afterTransfer->assertOk()
            ->assertJsonPath('summary.accounts.cash.balance', 4000)
            ->assertJsonPath('summary.accounts.bank.balance', 6000)
            ->assertJsonPath('summary.total_internal_balance', 10000);

        $this->postJson('/api/admin/treasury/withdrawals', [
            'amount' => 1500,
            'source_account' => CashMovement::ACCOUNT_BANK,
            'reason' => 'Entretien local',
            'description' => 'Décaissement banque maintenance',
        ])->assertStatus(201)
            ->assertJsonPath('movement.source_account', CashMovement::ACCOUNT_BANK)
            ->assertJsonPath('movement.destination_account', null);

        $afterWithdrawal = $this->getJson('/api/admin/treasury');
        $afterWithdrawal->assertOk()
            ->assertJsonPath('summary.accounts.cash.balance', 4000)
            ->assertJsonPath('summary.accounts.bank.balance', 4500)
            ->assertJsonPath('summary.total_internal_balance', 8500);
    }

    public function test_mobile_money_receipt_contributes_to_mobile_money_balance(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        $order = Order::query()->create([
            'user_id' => $admin->id,
            'table_id' => null,
            'customer_id' => null,
            'total_amount' => 23000,
            'status' => 'paid',
            'is_urgent' => false,
            'occupies_table' => false,
        ]);

        $movement = CashMovement::query()->create([
            'direction' => 'in',
            'status' => 'approved',
            'movement_type' => 'sale',
            'amount' => 23000,
            'payment_method' => null,
            'destination_account' => CashMovement::ACCOUNT_MOBILE_MONEY,
            'description' => "Encaissement commande #{$order->id}",
            'reason' => 'Encaissement mobile money',
            'requested_by_user_id' => $admin->id,
            'approved_by_user_id' => $admin->id,
            'order_id' => $order->id,
            'approved_at' => now(),
        ]);

        $this->assertNotNull($movement);
        $this->assertSame('sale', $movement->movement_type);
        $this->assertSame(CashMovement::ACCOUNT_MOBILE_MONEY, $movement->destination_account);

        $snapshot = $this->getJson('/api/admin/treasury');
        $snapshot->assertOk()
            ->assertJsonPath('summary.accounts.mobile_money.balance', 23000)
            ->assertJsonPath('summary.accounts.cash.balance', 0);
    }
}
