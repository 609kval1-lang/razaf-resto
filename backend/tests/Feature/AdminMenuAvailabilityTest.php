<?php

namespace Tests\Feature;

use App\Models\CashMovement;
use App\Models\Ingredient;
use App\Models\RawMaterial;
use App\Models\SupplierPurchase;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminMenuAvailabilityTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_recipe_can_be_configured_without_stock_and_capacity_follows_raw_material_stock(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $material = RawMaterial::create([
            'name' => 'Farine', 'stock' => 0, 'unit' => 'kg', 'cost' => 1000, 'reorder_level' => 1,
        ]);
        $ingredient = Ingredient::create([
            'raw_material_id' => $material->id, 'name' => 'Portion farine', 'portion_size' => 0.1,
            'portion_unit' => 'kg', 'quantity_available' => 0, 'cost_per_portion' => 100,
        ]);

        $created = $this->postJson('/api/admin/menus', [
            'name' => 'Crêpe', 'price' => 500, 'category' => 'main', 'is_available' => true,
            'ingredients' => [['ingredient_id' => $ingredient->id, 'quantity_needed' => 2]],
        ])->assertCreated();

        $menuId = (int) $created->json('id');
        $listed = collect($this->getJson('/api/admin/menus')->assertOk()->json())->firstWhere('id', $menuId);
        $this->assertSame(0, $listed['max_portions_available']);
        $this->assertFalse($listed['is_orderable']);
        $this->assertSame(0.0, (float) $material->fresh()->stock);
        $this->assertSame(0, SupplierPurchase::count());
        $this->assertSame(0, CashMovement::count());

        $this->putJson("/api/admin/raw-materials/{$material->id}", [
            'stock' => 0.5, 'stock_update_mode' => 'manual',
        ])->assertOk();

        $listed = collect($this->getJson('/api/admin/menus')->assertOk()->json())->firstWhere('id', $menuId);
        $this->assertSame(2, $listed['max_portions_available']);
        $this->assertTrue($listed['is_orderable']);
        $this->assertSame(0, CashMovement::count());
    }
}
