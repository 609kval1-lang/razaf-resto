<?php

namespace Tests\Feature;

use App\Models\Ingredient;
use App\Models\CashMovement;
use App\Models\Menu;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\RawMaterial;
use App\Models\Supplier;
use App\Models\SupplierPurchase;
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
            ->assertJsonPath('0.available_portions_total', 10)
            ->assertJsonPath('0.ingredients_count', 2)
            ->assertJsonPath('0.ingredients.0.quantity_available', 10)
            ->assertJsonPath('0.ingredients.1.quantity_available', 4);
    }

    public function test_purchase_can_update_reference_cost_without_automatically_changing_menu_price_or_money(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);
        $supplier = Supplier::create(['name' => 'Fournisseur farine']);
        $material = RawMaterial::create([
            'name' => 'Farine', 'stock' => 1, 'unit' => 'kg', 'cost' => 100,
        ]);
        $ingredient = Ingredient::create([
            'raw_material_id' => $material->id, 'name' => 'Portion farine', 'portion_size' => 1,
            'portion_unit' => 'kg', 'quantity_available' => 1, 'cost_per_portion' => 100,
        ]);
        $menu = Menu::create([
            'name' => 'Crêpe', 'price' => 300, 'category' => 'main', 'is_available' => true,
            'baseline_catalog_price' => 300, 'baseline_unit_cost' => 100, 'baseline_margin_percent' => 66.67,
        ]);
        $menu->ingredients()->attach($ingredient->id, ['quantity_needed' => 1]);

        $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases", [
            'raw_material_id' => $material->id, 'quantity' => 2, 'unit_price' => 150,
            'payment_mode' => 'credit', 'initial_paid_amount' => 0,
            'due_date' => '2026-12-31', 'update_reference_cost' => true,
        ])->assertCreated();

        $this->assertSame(3.0, (float) $material->fresh()->stock);
        $this->assertSame(150.0, (float) $material->fresh()->cost);
        $this->assertSame(150.0, (float) $ingredient->fresh()->cost_per_portion);
        $this->assertSame(300.0, (float) $menu->fresh()->price);
        $this->assertSame(300.0, (float) SupplierPurchase::sum('remaining_amount'));
        $this->assertSame(0, CashMovement::count());

        $impact = collect($this->getJson('/api/admin/revenue-report')->assertOk()->json('menu_pricing_impact'))
            ->firstWhere('menu_id', $menu->id);
        $this->assertSame(150.0, (float) $impact['current_unit_cost']);
        $this->assertSame(100.0, (float) $impact['current_profit_on_cost_percent']);

        $this->putJson("/api/admin/menus/{$menu->id}", ['price' => 400])->assertOk();
        $impact = collect($this->getJson('/api/admin/revenue-report')->assertOk()->json('menu_pricing_impact'))
            ->firstWhere('menu_id', $menu->id);
        $this->assertSame(400.0, (float) $impact['current_catalog_price']);
        $this->assertSame(166.67, round((float) $impact['current_profit_on_cost_percent'], 2));

        $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases", [
            'raw_material_id' => $material->id, 'quantity' => 1, 'unit_price' => 200,
            'payment_mode' => 'credit', 'initial_paid_amount' => 0,
            'due_date' => '2026-12-31', 'update_reference_cost' => false,
        ])->assertCreated();
        $this->assertSame(4.0, (float) $material->fresh()->stock);
        $this->assertSame(150.0, (float) $material->fresh()->cost);
        $this->assertSame(150.0, (float) $ingredient->fresh()->cost_per_portion);
        $this->assertSame(500.0, (float) SupplierPurchase::sum('remaining_amount'));
        $this->assertSame(0, CashMovement::count());

        $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases", [
            'raw_material_id' => $material->id, 'quantity' => 1, 'unit_price' => 500,
            'payment_mode' => 'cash', 'initial_paid_amount' => 500,
            'payment_method' => 'cash', 'update_reference_cost' => true,
        ])->assertUnprocessable();
        $this->assertSame(2, SupplierPurchase::count());
        $this->assertSame(4.0, (float) $material->fresh()->stock);
        $this->assertSame(150.0, (float) $material->fresh()->cost);
        $this->assertSame(150.0, (float) $ingredient->fresh()->cost_per_portion);
        $this->assertSame(0, CashMovement::count());
    }
}
