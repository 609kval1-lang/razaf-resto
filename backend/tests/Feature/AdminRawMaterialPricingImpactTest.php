<?php

namespace Tests\Feature;

use App\Models\Ingredient;
use App\Models\Menu;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\RawMaterial;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminRawMaterialPricingImpactTest extends TestCase
{
    use RefreshDatabase;

    public function test_revenue_report_uses_updated_raw_material_costs_for_menu_impact(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        $rawMaterial = RawMaterial::create([
            'name' => 'Poulet',
            'description' => 'Poulet frais',
            'stock' => 30,
            'unit' => 'pièce',
            'cost' => 100,
            'reorder_level' => 5,
        ]);

        $ingredient = Ingredient::create([
            'raw_material_id' => $rawMaterial->id,
            'name' => 'Poulet portion',
            'portion_size' => 1,
            'portion_unit' => 'pièce',
            'quantity_available' => 30,
            'cost_per_portion' => 100,
            'is_cocktail_ingredient' => false,
        ]);

        $menu = Menu::create([
            'name' => 'Poulet rôti',
            'description' => 'Menu test',
            'price' => 1000,
            'category' => 'main',
            'baseline_catalog_price' => 1000,
            'baseline_unit_cost' => 200,
            'baseline_margin_percent' => 80,
            'is_available' => true,
        ]);

        $menu->ingredients()->attach($ingredient->id, ['quantity_needed' => 2]);

        $this->putJson("/api/admin/raw-materials/{$rawMaterial->id}", [
            'cost' => 150,
        ])->assertOk();

        $ingredient->refresh();
        $this->assertSame(150.0, (float) $ingredient->cost_per_portion);

        $response = $this->getJson('/api/admin/revenue-report');
        $response->assertOk();

        $impactRow = collect($response->json('menu_pricing_impact'))
            ->firstWhere('menu_id', $menu->id);

        $this->assertNotNull($impactRow);
        $this->assertSame(200.0, (float) ($impactRow['baseline_unit_cost'] ?? 0));
        $this->assertSame(300.0, (float) ($impactRow['current_unit_cost'] ?? 0));
        $this->assertSame('decrease', (string) ($impactRow['recommended_action'] ?? ''));
        $this->assertSame(233.33, round((float) ($impactRow['current_profit_on_cost_percent'] ?? 0), 2));
        $this->assertSame(600.0, (float) ($impactRow['suggested_catalog_price'] ?? 0));
    }

    public function test_revenue_report_proposes_price_increase_when_profit_on_cost_is_below_target(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        $rawMaterial = RawMaterial::create([
            'name' => 'Steak',
            'description' => 'Steak test',
            'stock' => 20,
            'unit' => 'pièce',
            'cost' => 150,
            'reorder_level' => 5,
        ]);

        $ingredient = Ingredient::create([
            'raw_material_id' => $rawMaterial->id,
            'name' => 'Steak portion',
            'portion_size' => 1,
            'portion_unit' => 'pièce',
            'quantity_available' => 20,
            'cost_per_portion' => 150,
            'is_cocktail_ingredient' => false,
        ]);

        $menu = Menu::create([
            'name' => 'Steak minute',
            'description' => 'Menu test hausse',
            'price' => 250,
            'category' => 'main',
            'baseline_catalog_price' => 250,
            'baseline_unit_cost' => 100,
            'baseline_margin_percent' => 60,
            'is_available' => true,
        ]);

        $menu->ingredients()->attach($ingredient->id, ['quantity_needed' => 1]);

        $response = $this->getJson('/api/admin/revenue-report');
        $response->assertOk();

        $impactRow = collect($response->json('menu_pricing_impact'))
            ->firstWhere('menu_id', $menu->id);

        $this->assertNotNull($impactRow);
        $this->assertSame(150.0, (float) ($impactRow['current_unit_cost'] ?? 0));
        $this->assertSame('increase', (string) ($impactRow['recommended_action'] ?? ''));
        $this->assertSame(66.67, round((float) ($impactRow['current_profit_on_cost_percent'] ?? 0), 2));
        $this->assertSame(300.0, (float) ($impactRow['suggested_catalog_price'] ?? 0));
    }

    public function test_revenue_report_uses_same_profit_on_cost_formula_for_rankings_and_menu_impact(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        $rawMaterial = RawMaterial::create([
            'name' => 'Jus tropical',
            'description' => 'Base cocktail test',
            'stock' => 20,
            'unit' => 'pièce',
            'cost' => 1205,
            'reorder_level' => 2,
        ]);

        $ingredient = Ingredient::create([
            'raw_material_id' => $rawMaterial->id,
            'name' => 'Dose cocktail',
            'portion_size' => 1,
            'portion_unit' => 'pièce',
            'quantity_available' => 20,
            'cost_per_portion' => 1205,
            'is_cocktail_ingredient' => true,
        ]);

        $menu = Menu::create([
            'name' => 'Virgin Pine Cooler',
            'description' => 'Cocktail test',
            'price' => 9000,
            'category' => 'cocktail',
            'baseline_catalog_price' => 9000,
            'baseline_unit_cost' => 1012,
            'baseline_margin_percent' => 0,
            'is_available' => true,
        ]);

        $menu->ingredients()->attach($ingredient->id, ['quantity_needed' => 1]);

        $order = Order::create([
            'user_id' => $admin->id,
            'table_id' => null,
            'customer_id' => null,
            'total_amount' => 36000,
            'status' => 'paid',
        ]);

        OrderItem::create([
            'order_id' => $order->id,
            'menu_id' => $menu->id,
            'quantity' => 4,
            'price_at_order' => 9000,
            'status' => 'served',
        ]);

        Payment::create([
            'order_id' => $order->id,
            'amount' => 36000,
            'discount_percent' => 0,
            'discount_amount' => 0,
            'method' => 'cash',
            'status' => 'completed',
            'encashed_at' => now(),
        ]);

        $response = $this->getJson('/api/admin/revenue-report');
        $response->assertOk();

        $impactRow = collect($response->json('menu_pricing_impact'))
            ->firstWhere('menu_id', $menu->id);
        $rankingRow = collect($response->json('rankings.highest_margin'))
            ->firstWhere('menu_id', $menu->id);

        $this->assertNotNull($impactRow);
        $this->assertNotNull($rankingRow);
        $this->assertSame(1205.0, (float) ($impactRow['current_unit_cost'] ?? 0));
        $this->assertSame(646.89, round((float) ($impactRow['current_profit_on_cost_percent'] ?? 0), 2));
        $this->assertSame(646.9, (float) ($rankingRow['margin_percent'] ?? 0));
        $this->assertSame(31180.0, (float) ($rankingRow['total_profit'] ?? 0));
    }

    public function test_raw_material_list_exposes_available_portions_for_related_ingredients(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);

        $rawMaterial = RawMaterial::create([
            'name' => 'Pommes de terre',
            'description' => 'Stock test',
            'stock' => 20,
            'unit' => 'pièce',
            'cost' => 50,
            'reorder_level' => 5,
        ]);

        Ingredient::create([
            'raw_material_id' => $rawMaterial->id,
            'name' => 'Portion x2',
            'portion_size' => 2,
            'portion_unit' => 'pièce',
            'quantity_available' => 0,
            'cost_per_portion' => 0,
            'is_cocktail_ingredient' => false,
        ]);

        Ingredient::create([
            'raw_material_id' => $rawMaterial->id,
            'name' => 'Portion x5',
            'portion_size' => 5,
            'portion_unit' => 'pièce',
            'quantity_available' => 0,
            'cost_per_portion' => 0,
            'is_cocktail_ingredient' => false,
        ]);

        $response = $this->getJson('/api/admin/raw-materials');
        $response->assertOk()
            ->assertJsonPath('0.available_portions_total', 14)
            ->assertJsonPath('0.ingredients_count', 2)
            ->assertJsonPath('0.ingredients.0.quantity_available', 10)
            ->assertJsonPath('0.ingredients.1.quantity_available', 4);
    }
}
