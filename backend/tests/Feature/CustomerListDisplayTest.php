<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CustomerListDisplayTest extends TestCase
{
    use RefreshDatabase;

    public function test_customer_dropdown_list_returns_only_real_name_without_preferred_cooking_suffix(): void
    {
        $cashier = User::factory()->create(['role' => 'cashier']);
        Sanctum::actingAs($cashier);

        Customer::query()->create([
            'name' => 'Rakoto - à point',
            'loyalty_points' => 0,
            'preferred_cooking' => 'à point',
        ]);

        $response = $this->getJson('/api/cashier/customers');

        $response->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.name', 'Rakoto');
    }
}
