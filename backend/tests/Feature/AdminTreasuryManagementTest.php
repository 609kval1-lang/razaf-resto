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

    public function test_cash_history_only_lists_movements_that_touch_the_cash_account(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        $cashMovement = CashMovement::query()->create([
            'direction' => 'in',
            'status' => 'approved',
            'movement_type' => 'sale',
            'flow_type' => 'customer_payment',
            'amount' => 12000,
            'payment_method' => 'cash',
            'destination_account' => CashMovement::ACCOUNT_CASH,
            'description' => 'Paiement client comptoir',
            'reason' => 'Encaissement cash',
            'requested_by_user_id' => $admin->id,
            'approved_by_user_id' => $admin->id,
            'approved_at' => now(),
        ]);

        $safeMovement = CashMovement::query()->create([
            'direction' => 'out',
            'status' => 'approved',
            'movement_type' => 'withdrawal',
            'flow_type' => 'employee_advance_payment',
            'amount' => 4000,
            'payment_method' => 'cash',
            'source_account' => CashMovement::ACCOUNT_SAFE,
            'description' => 'Avance employee depuis coffre',
            'reason' => 'Avance employee',
            'requested_by_user_id' => $admin->id,
            'approved_by_user_id' => $admin->id,
            'approved_at' => now(),
        ]);

        $cashHistory = $this->getJson('/api/admin/cash-movements');
        $cashHistory->assertOk();

        $movementIds = collect($cashHistory->json('movements'))->pluck('id');

        $this->assertTrue($movementIds->contains((int) $cashMovement->id));
        $this->assertFalse($movementIds->contains((int) $safeMovement->id));

        $treasuryHistory = $this->getJson('/api/admin/treasury');
        $treasuryHistory->assertOk();

        $treasuryMovementIds = collect($treasuryHistory->json('movements'))->pluck('id');

        $this->assertTrue($treasuryMovementIds->contains((int) $safeMovement->id));
    }

    public function test_cash_available_is_consistent_between_cashier_and_admin_views(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $cashier = User::factory()->create(['role' => 'cashier']);

        CashMovement::query()->create([
            'direction' => 'in',
            'status' => 'approved',
            'movement_type' => 'sale',
            'flow_type' => 'customer_payment',
            'amount' => 20000,
            'payment_method' => 'cash',
            'destination_account' => CashMovement::ACCOUNT_CASH,
            'description' => 'Base caisse',
            'reason' => 'Encaissement cash',
            'requested_by_user_id' => $admin->id,
            'approved_by_user_id' => $admin->id,
            'approved_at' => now(),
        ]);

        CashMovement::query()->create([
            'direction' => 'out',
            'status' => 'approved',
            'movement_type' => 'transfer',
            'flow_type' => 'treasury_transfer',
            'amount' => 6000,
            'payment_method' => 'cash',
            'source_account' => CashMovement::ACCOUNT_CASH,
            'destination_account' => CashMovement::ACCOUNT_BANK,
            'description' => 'Depot banque',
            'reason' => 'Vidage partiel caisse',
            'requested_by_user_id' => $admin->id,
            'approved_by_user_id' => $admin->id,
            'approved_at' => now(),
        ]);

        CashMovement::query()->create([
            'direction' => 'out',
            'status' => 'pending',
            'movement_type' => 'withdrawal',
            'flow_type' => 'cash_withdrawal_request',
            'amount' => 1500,
            'payment_method' => 'cash',
            'source_account' => CashMovement::ACCOUNT_CASH,
            'description' => 'Sortie en attente',
            'reason' => 'Petite caisse',
            'requested_by_user_id' => $cashier->id,
        ]);

        CashMovement::query()->create([
            'direction' => 'out',
            'status' => 'approved',
            'movement_type' => 'withdrawal',
            'flow_type' => 'supplier_payment',
            'amount' => 3000,
            'payment_method' => 'cash',
            'source_account' => CashMovement::ACCOUNT_SAFE,
            'description' => 'Paiement coffre',
            'reason' => 'Fournisseur',
            'requested_by_user_id' => $admin->id,
            'approved_by_user_id' => $admin->id,
            'approved_at' => now(),
        ]);

        Sanctum::actingAs($cashier);

        $cashierStats = $this->getJson('/api/cashier/stats');
        $cashierMovements = $this->getJson('/api/cashier/cash-movements');

        $cashierStats->assertOk()
            ->assertJsonPath('cash_register.cash_available', 14000)
            ->assertJsonPath('cash_register.cash_out_pending', 1500);

        $cashierMovements->assertOk()
            ->assertJsonPath('summary.cash_available', 14000)
            ->assertJsonPath('summary.cash_out_pending', 1500);

        Sanctum::actingAs($admin);

        $adminCash = $this->getJson('/api/admin/cash-movements');
        $treasury = $this->getJson('/api/admin/treasury');

        $adminCash->assertOk()
            ->assertJsonPath('summary.cash_available', 14000)
            ->assertJsonPath('summary.cash_out_pending', 1500);

        $treasury->assertOk()
            ->assertJsonPath('summary.cash_available', 14000)
            ->assertJsonPath('summary.accounts.cash.balance', 14000);

        $this->assertSame(
            (float) $cashierStats->json('cash_register.cash_available'),
            (float) $cashierMovements->json('summary.cash_available')
        );
        $this->assertSame(
            (float) $cashierStats->json('cash_register.cash_available'),
            (float) $adminCash->json('summary.cash_available')
        );
        $this->assertSame(
            (float) $cashierStats->json('cash_register.cash_available'),
            (float) $treasury->json('summary.accounts.cash.balance')
        );
    }
}
