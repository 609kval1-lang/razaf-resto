<?php

namespace Tests\Unit;

use App\Models\CashMovement;
use App\Services\TreasuryService;
use Tests\TestCase;

class TreasuryRoutingRulesTest extends TestCase
{
    public function test_mobile_money_payment_routes_to_mobile_money_account(): void
    {
        $service = app(TreasuryService::class);

        $this->assertSame(
            CashMovement::ACCOUNT_MOBILE_MONEY,
            $service->resolveOutgoingSourceAccount('mobile_money')
        );

        $this->assertSame(
            CashMovement::ACCOUNT_MOBILE_MONEY,
            CashMovement::accountFromPaymentMethod('mobile_money')
        );
    }

    public function test_bank_and_cash_rules_match_expected_accounts(): void
    {
        $service = app(TreasuryService::class);

        $this->assertSame(CashMovement::ACCOUNT_BANK, $service->resolveOutgoingSourceAccount('transfer'));
        $this->assertSame(CashMovement::ACCOUNT_BANK, $service->resolveOutgoingSourceAccount('check'));
        $this->assertSame(CashMovement::ACCOUNT_CASH, $service->resolveOutgoingSourceAccount('cash'));
        $this->assertSame(CashMovement::ACCOUNT_SAFE, $service->resolveOutgoingSourceAccount('cash', 'safe'));

        $this->assertSame(CashMovement::ACCOUNT_BANK, CashMovement::accountFromPaymentMethod('transfer'));
        $this->assertSame(CashMovement::ACCOUNT_BANK, CashMovement::accountFromPaymentMethod('check'));
        $this->assertSame(CashMovement::ACCOUNT_CASH, CashMovement::accountFromPaymentMethod('cash'));
    }
}
