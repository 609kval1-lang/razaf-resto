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

    private function actingAsCashier(): User
    {
        $server = User::factory()->create(['role' => 'cashier', 'has_system_access' => true]);
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
            'role' => 'cashier',
            'has_system_access' => true,
            'job_title' => null,
            'employment_status' => 'active',
            'monthly_salary' => 180000,
            'payment_day' => 28,
        ]);

        $createResponse->assertCreated()
            ->assertJsonPath('name', 'Serveur Test')
            ->assertJsonPath('role', 'cashier')
            ->assertJsonPath('job_title', 'Caisse')
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

    public function test_admin_can_crud_raw_materials_and_manually_adjust_stock_without_an_extra_purchase(): void
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
            ->assertJsonPath('stock', '12.000000');

        $rawMaterialId = (int) $createResponse->json('id');

        $this->assertDatabaseHas('supplier_purchases', [
            'supplier_id' => $supplier->id,
            'raw_material_id' => $rawMaterialId,
            'quantity' => 12,
            'total_amount' => 102000,
            'remaining_amount' => 102000,
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
            ->assertJsonPath('stock', '14.000000');

        $this->assertDatabaseCount('supplier_purchases', 1);

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
        $this->actingAsCashier();

        $this->getJson('/api/admin/users')->assertStatus(403);
        $this->postJson('/api/admin/tables', [
            'table_number' => 4,
            'capacity' => 2,
            'section' => 'Salle',
            'status' => 'free',
        ])->assertStatus(403);
        $this->getJson('/api/admin/suppliers')->assertStatus(403);
    }

    public function test_admin_menu_prices_require_whole_ariary_without_silent_rounding(): void
    {
        $this->actingAsAdmin();

        $payload = [
            'name' => 'Menu entier',
            'description' => 'Prix entier ariary',
            'price' => 8034.98,
            'category' => 'main',
            'is_available' => true,
            'ingredients' => [],
        ];
        $this->postJson('/api/admin/menus', $payload)->assertUnprocessable()->assertJsonValidationErrors('price');
        $this->assertDatabaseCount('menus', 0);
        $payload['price'] = 8035;
        $createResponse = $this->postJson('/api/admin/menus', $payload);
        $createResponse->assertCreated();

        $menuId = (int) $createResponse->json('id');
        $menu = Menu::query()->findOrFail($menuId);
        $this->assertSame(8035.0, (float) $menu->price);

        $listResponse = $this->getJson('/api/admin/menus');
        $listResponse->assertOk();
        $listedMenu = collect($listResponse->json())->firstWhere('id', $menuId);
        $this->assertSame(8035.0, (float) ($listedMenu['price'] ?? 0));

        $this->putJson("/api/admin/menus/{$menuId}", [
            'price' => 12000.51,
        ])->assertUnprocessable()->assertJsonValidationErrors('price');
        $this->assertSame(8035.0, (float) $menu->fresh()->price);
        $this->putJson("/api/admin/menus/{$menuId}", ['price' => 12001])->assertOk();

        $menu->refresh();
        $this->assertSame(12001.0, (float) $menu->price);
    }
}
