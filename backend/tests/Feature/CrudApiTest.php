<?php

namespace Tests\Feature;

use App\Models\Customer;
use App\Models\Ingredient;
use App\Models\Menu;
use App\Models\RawMaterial;
use App\Models\RestaurantTable;
use App\Models\Supplier;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CrudApiTest extends TestCase
{
    use RefreshDatabase;

    private function actingAsAdmin(): User
    {
        $admin = User::factory()->create(['role' => 'admin', 'has_system_access' => true]);
        Sanctum::actingAs($admin);

        return $admin;
    }

    private function actingAsServer(): User
    {
        $server = User::factory()->create(['role' => 'server', 'has_system_access' => true]);
        Sanctum::actingAs($server);

        return $server;
    }

    public function test_admin_can_crud_users_on_current_admin_routes(): void
    {
        $this->actingAsAdmin();

        $createResponse = $this->postJson('/api/admin/users', [
            'name' => 'Serveur Test',
            'email' => 'serveur@test.local',
            'password' => 'secret123',
            'role' => 'server',
            'has_system_access' => true,
            'job_title' => null,
            'employment_status' => 'active',
            'monthly_salary' => 180000,
            'payment_day' => 28,
        ]);

        $createResponse->assertCreated()
            ->assertJsonPath('name', 'Serveur Test')
            ->assertJsonPath('role', 'server')
            ->assertJsonPath('job_title', 'Serveur')
            ->assertJsonPath('salary_profile.monthly_salary', '180000.00')
            ->assertJsonPath('salary_profile.payment_day', 28);

        $userId = (int) $createResponse->json('id');

        $this->getJson('/api/admin/users')
            ->assertOk()
            ->assertJsonFragment(['email' => 'serveur@test.local']);

        $this->putJson("/api/admin/users/{$userId}", [
            'name' => 'Serveur Test Modifie',
            'job_title' => 'Chef de rang',
            'monthly_salary' => 220000,
        ])->assertOk()
            ->assertJsonPath('name', 'Serveur Test Modifie')
            ->assertJsonPath('job_title', 'Chef de rang')
            ->assertJsonPath('salary_profile.monthly_salary', '220000.00');

        $this->deleteJson("/api/admin/users/{$userId}")
            ->assertOk();

        $this->assertDatabaseMissing('users', ['id' => $userId]);
    }

    public function test_admin_can_crud_tables_on_current_admin_routes(): void
    {
        $this->actingAsAdmin();

        $createResponse = $this->postJson('/api/admin/tables', [
            'table_number' => 15,
            'capacity' => 4,
            'section' => 'Terrasse',
            'status' => 'free',
        ]);

        $createResponse->assertCreated()
            ->assertJsonPath('table_number', 15)
            ->assertJsonPath('section', 'Terrasse');

        $tableId = (int) $createResponse->json('id');

        $this->getJson('/api/admin/tables')
            ->assertOk()
            ->assertJsonFragment(['table_number' => 15]);

        $this->putJson("/api/admin/tables/{$tableId}", [
            'capacity' => 6,
            'section' => 'Salle VIP',
            'status' => 'reserved',
            'reservation_name' => 'Client Test',
            'reservation_phone' => '+261320000000',
            'reservation_at' => now()->addDay()->toDateTimeString(),
        ])->assertOk()
            ->assertJsonPath('capacity', 6)
            ->assertJsonPath('status', 'reserved');

        $this->deleteJson("/api/admin/tables/{$tableId}")
            ->assertOk();

        $this->assertSoftDeleted('tables', ['id' => $tableId]);
    }

    public function test_admin_can_crud_raw_materials_without_automatic_supplier_purchase(): void
    {
        $this->actingAsAdmin();

        $supplier = Supplier::query()->create([
            'name' => 'Supplier brut',
            'email' => 'supplier-brut@test.local',
            'phone' => '+261321111111',
        ]);

        $createResponse = $this->postJson('/api/admin/raw-materials', [
            'name' => 'Creme fraiche',
            'description' => 'Brique 1L',
            'stock' => 12,
            'unit' => 'L',
            'cost' => 8500,
            'reorder_level' => 2,
            'supplier_id' => $supplier->id,
        ]);

        $createResponse->assertCreated()
            ->assertJsonPath('name', 'Creme fraiche')
            ->assertJsonPath('stock', '12.00');

        $rawMaterialId = (int) $createResponse->json('id');

        $this->assertDatabaseMissing('supplier_purchases', [
            'supplier_id' => $supplier->id,
            'raw_material_id' => $rawMaterialId,
        ]);

        $this->getJson('/api/admin/raw-materials')
            ->assertOk()
            ->assertJsonFragment(['name' => 'Creme fraiche']);

        $this->putJson("/api/admin/raw-materials/{$rawMaterialId}", [
            'description' => 'Brique 1L UHT',
            'stock' => 14,
            'cost' => 9000,
            'stock_update_mode' => 'manual',
        ])->assertOk()
            ->assertJsonPath('description', 'Brique 1L UHT')
            ->assertJsonPath('stock', '14.00');

        $this->deleteJson("/api/admin/raw-materials/{$rawMaterialId}")
            ->assertOk();

        $this->assertSoftDeleted('raw_materials', ['id' => $rawMaterialId]);
    }

    public function test_admin_can_crud_suppliers_on_current_admin_routes(): void
    {
        $this->actingAsAdmin();

        $rawMaterial = RawMaterial::query()->create([
            'name' => 'Sucre blanc',
            'description' => null,
            'stock' => 20,
            'unit' => 'kg',
            'cost' => 3000,
            'reorder_level' => 5,
        ]);

        $createResponse = $this->postJson('/api/admin/suppliers', [
            'name' => 'Alpha Supply',
            'email' => 'alpha@supply.test',
            'phone' => '+33102030405',
            'raw_material_ids' => [$rawMaterial->id],
        ]);

        $createResponse->assertCreated()
            ->assertJsonPath('supplier.name', 'Alpha Supply');

        $supplierId = (int) $createResponse->json('supplier.id');

        $this->getJson('/api/admin/suppliers')
            ->assertOk()
            ->assertJsonFragment(['email' => 'alpha@supply.test']);

        $this->putJson("/api/admin/suppliers/{$supplierId}", [
            'name' => 'Alpha Supply Updated',
            'email' => 'alpha-updated@supply.test',
            'phone' => '+33111111111',
            'raw_material_ids' => [$rawMaterial->id],
        ])->assertOk()
            ->assertJsonPath('supplier.name', 'Alpha Supply Updated');

        $this->deleteJson("/api/admin/suppliers/{$supplierId}")
            ->assertOk();

        $this->assertDatabaseMissing('suppliers', ['id' => $supplierId]);
    }

    public function test_non_admin_cannot_access_admin_routes(): void
    {
        $this->actingAsServer();

        $this->getJson('/api/admin/users')->assertStatus(403);
        $this->postJson('/api/admin/tables', [
            'table_number' => 4,
            'capacity' => 2,
            'section' => 'Salle',
            'status' => 'free',
        ])->assertStatus(403);
        $this->getJson('/api/admin/suppliers')->assertStatus(403);
    }

    public function test_server_can_list_customers_and_create_order_when_stock_is_available(): void
    {
        $this->actingAsServer();

        $table = RestaurantTable::query()->create([
            'table_number' => 9,
            'capacity' => 4,
            'section' => 'Salle',
            'status' => 'free',
        ]);

        $customer = Customer::query()->create([
            'name' => 'Client stock',
            'email' => 'stock@test.dev',
            'phone' => '+261330000001',
        ]);

        $rawMaterial = RawMaterial::query()->create([
            'name' => 'Poulet brut',
            'description' => null,
            'stock' => 2.00,
            'unit' => 'kg',
            'cost' => 12000,
            'reorder_level' => 0.50,
        ]);

        $ingredient = Ingredient::query()->create([
            'raw_material_id' => $rawMaterial->id,
            'name' => 'Poulet portion 250g',
            'portion_size' => 250,
            'portion_unit' => 'g',
            'quantity_available' => 8,
            'cost_per_portion' => 3000,
        ]);

        $menu = Menu::query()->create([
            'name' => 'Poulet Grille',
            'description' => 'Test',
            'price' => 12000,
            'category' => 'Plats',
            'is_available' => true,
        ]);
        $menu->ingredients()->attach($ingredient->id, ['quantity_needed' => 2]);

        $this->getJson('/api/server/customers')
            ->assertOk()
            ->assertJsonFragment(['name' => 'Client stock']);

        $response = $this->postJson('/api/server/orders', [
            'table_id' => $table->id,
            'customer_id' => $customer->id,
            'items' => [
                [
                    'menu_id' => $menu->id,
                    'quantity' => 2,
                ],
            ],
        ]);

        $response->assertCreated()
            ->assertJsonPath('customer_id', $customer->id)
            ->assertJsonPath('items.0.quantity', 2)
            ->assertJsonPath('table_id', $table->id);

        $ingredient->refresh();
        $rawMaterial->refresh();

        $this->assertSame(4, (int) $ingredient->quantity_available);
        $this->assertEquals(1.0, (float) $rawMaterial->stock);
    }

    public function test_server_cannot_create_order_when_stock_is_insufficient_without_confirmation(): void
    {
        $this->actingAsServer();

        $table = RestaurantTable::query()->create([
            'table_number' => 12,
            'capacity' => 4,
            'section' => 'Salle',
            'status' => 'free',
        ]);

        $rawMaterial = RawMaterial::query()->create([
            'name' => 'Steak',
            'description' => null,
            'stock' => 0.50,
            'unit' => 'kg',
            'cost' => 22000,
            'reorder_level' => 0.20,
        ]);

        $ingredient = Ingredient::query()->create([
            'raw_material_id' => $rawMaterial->id,
            'name' => 'Steak portion 250g',
            'portion_size' => 250,
            'portion_unit' => 'g',
            'quantity_available' => 2,
            'cost_per_portion' => 5500,
        ]);

        $menu = Menu::query()->create([
            'name' => 'Steak Frites',
            'description' => 'Test',
            'price' => 18000,
            'category' => 'Plats',
            'is_available' => true,
        ]);
        $menu->ingredients()->attach($ingredient->id, ['quantity_needed' => 2]);

        $response = $this->postJson('/api/server/orders', [
            'table_id' => $table->id,
            'items' => [
                [
                    'menu_id' => $menu->id,
                    'quantity' => 2,
                ],
            ],
        ]);

        $response->assertStatus(409)
            ->assertJsonPath('require_confirmation', true);
    }
}
