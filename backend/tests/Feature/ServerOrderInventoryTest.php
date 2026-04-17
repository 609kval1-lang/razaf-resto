<?php

namespace Tests\Feature;

use App\Models\Ingredient;
use App\Models\Menu;
use App\Models\RawMaterial;
use App\Models\RestaurantTable;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ServerOrderInventoryTest extends TestCase
{
    use RefreshDatabase;

    public function test_server_can_view_menu_ingredients_with_portion_capacity(): void
    {
        $server = User::factory()->create(['role' => 'server']);
        Sanctum::actingAs($server);

        $rawMaterial = RawMaterial::create([
            'name' => 'Poulet brut',
            'description' => null,
            'stock' => 2.00,
            'unit' => 'kg',
            'cost' => 12000,
            'reorder_level' => 0.50,
        ]);

        $ingredient = Ingredient::create([
            'raw_material_id' => $rawMaterial->id,
            'name' => 'Poulet portion 250g',
            'portion_size' => 250,
            'portion_unit' => 'g',
            'quantity_available' => 8,
            'cost_per_portion' => 3000,
        ]);

        $menu = Menu::create([
            'name' => 'Poulet Grille',
            'description' => 'Test',
            'price' => 12000,
            'category' => 'Plats',
            'is_available' => true,
        ]);

        $menu->ingredients()->attach($ingredient->id, ['quantity_needed' => 2]);

        $response = $this->getJson('/api/server/menus');

        $response->assertStatus(200)
            ->assertJsonPath('0.id', $menu->id)
            ->assertJsonPath('0.ingredients.0.name', 'Poulet portion 250g')
            ->assertJsonPath('0.ingredients.0.required_portions_per_menu', 2)
            ->assertJsonPath('0.max_portions_available', 4)
            ->assertJsonPath('0.is_orderable', true);
    }

    public function test_creating_server_order_decrements_ingredient_portions_and_raw_material_stock(): void
    {
        $server = User::factory()->create(['role' => 'server']);
        Sanctum::actingAs($server);

        $table = RestaurantTable::create([
            'table_number' => 9,
            'capacity' => 4,
            'section' => 'Salle',
            'status' => 'free',
        ]);

        $rawMaterial = RawMaterial::create([
            'name' => 'Poulet brut',
            'description' => null,
            'stock' => 2.00,
            'unit' => 'kg',
            'cost' => 12000,
            'reorder_level' => 0.50,
        ]);

        $ingredient = Ingredient::create([
            'raw_material_id' => $rawMaterial->id,
            'name' => 'Poulet portion 250g',
            'portion_size' => 250,
            'portion_unit' => 'g',
            'quantity_available' => 8,
            'cost_per_portion' => 3000,
        ]);

        $menu = Menu::create([
            'name' => 'Poulet Grille',
            'description' => 'Test',
            'price' => 12000,
            'category' => 'Plats',
            'is_available' => true,
        ]);

        $menu->ingredients()->attach($ingredient->id, ['quantity_needed' => 2]);

        $response = $this->postJson('/api/server/orders', [
            'table_id' => $table->id,
            'items' => [
                [
                    'menu_id' => $menu->id,
                    'quantity' => 3,
                ],
            ],
        ]);

        $response->assertStatus(201);

        $ingredient->refresh();
        $rawMaterial->refresh();

        // 8 portions dispo - (2 portions/menu * 3 menus) = 2 portions restantes
        $this->assertSame(2, (int) $ingredient->quantity_available);
        // 2.00 kg - (6 portions * 0.25 kg) = 0.50 kg restant
        $this->assertEquals(0.5, (float) $rawMaterial->stock);
    }

    public function test_takeaway_order_includes_packaging_pricing_in_total(): void
    {
        $server = User::factory()->create(['role' => 'server']);
        Sanctum::actingAs($server);

        $menu = Menu::create([
            'name' => 'Wrap poulet',
            'description' => 'Test',
            'price' => 10000,
            'category' => 'Plats',
            'is_available' => true,
        ]);

        $response = $this->postJson('/api/server/orders', [
            'order_type' => 'takeaway',
            'with_packaging' => true,
            'packaging_quantity' => 2,
            'packaging_unit_price' => 500,
            'items' => [
                [
                    'menu_id' => $menu->id,
                    'quantity' => 1,
                ],
            ],
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('order_type', 'takeaway')
            ->assertJsonPath('with_packaging', true)
            ->assertJsonPath('packaging_quantity', 2);

        $data = $response->json();
        $this->assertSame(500.0, (float) ($data['packaging_unit_price'] ?? 0));
        $this->assertSame(11000.0, (float) ($data['total_amount'] ?? 0));
    }
}
