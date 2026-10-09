<?php

namespace Tests\Feature;

use App\Models\Ingredient;
use App\Models\RawMaterial;
use App\Models\Supplier;
use App\Models\User;
use App\Services\InventoryService;
use App\Services\SupplierProcurementService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class StockCalculationTest extends TestCase
{
    use RefreshDatabase;

    public function test_one_gram_purchase_keeps_its_stock_and_portion_capacity(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $supplier = Supplier::create(['name' => 'Small quantities']);

        $response = $this->postJson('/api/admin/raw-materials', [
            'name' => 'Spice', 'stock' => 0.001, 'unit' => 'kg',
            'cost' => 5000, 'supplier_id' => $supplier->id,
        ])->assertCreated();

        $material = RawMaterial::findOrFail($response->json('id'));
        $this->assertEquals(0.001, (float) $material->stock);
        $this->assertDatabaseHas('supplier_purchases', [
            'raw_material_id' => $material->id, 'total_amount' => 5, 'remaining_amount' => 5,
        ]);

        $this->postJson('/api/admin/ingredients', [
            'name' => 'One gram', 'raw_material_id' => $material->id,
            'portion_size' => 1, 'portion_unit' => 'g',
        ])->assertCreated()->assertJsonPath('quantity_available', 1)
            ->assertJsonPath('cost_per_portion', '5.00');
    }

    public function test_restocking_preserves_a_fractional_remainder(): void
    {
        $material = RawMaterial::create([
            'name' => 'Spice', 'stock' => 0.00101, 'unit' => 'kg',
            'cost' => 5000, 'reorder_level' => 0,
        ]);
        $supplier = Supplier::create(['name' => 'Small quantities']);

        app(SupplierProcurementService::class)->registerPurchase($supplier, $material, 0.001, 5000, [
            'payment_mode' => 'credit', 'due_date' => now()->addDay()->toDateString(),
        ]);

        $this->assertEqualsWithDelta(0.00201, (float) $material->fresh()->stock, 0.00000001);
    }

    public function test_purchase_stock_adjustments_do_not_round_the_requested_quantity_up(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $material = RawMaterial::create([
            'name' => 'Spice', 'stock' => 0.00101, 'unit' => 'kg', 'cost' => 5000, 'reorder_level' => 0,
        ]);
        $supplier = Supplier::create(['name' => 'Supplier']);
        $supplier->rawMaterials()->attach($material->id);

        $this->putJson("/api/admin/raw-materials/{$material->id}", [
            'stock' => 0.00241, 'stock_update_mode' => 'purchase',
        ])->assertUnprocessable();
        $this->assertEquals(0.00101, (float) $material->fresh()->stock);
        $this->assertDatabaseCount('supplier_purchases', 0);

        $this->putJson("/api/admin/raw-materials/{$material->id}", [
            'stock' => 0.00201, 'stock_update_mode' => 'purchase',
        ])->assertOk();
        $this->assertEquals(0.00201, (float) $material->fresh()->stock);
        $this->assertDatabaseHas('supplier_purchases', ['quantity' => 0.001, 'total_amount' => 5]);
    }

    public function test_exact_portion_capacity_is_not_lost_to_floating_point_rounding(): void
    {
        $material = new RawMaterial(['stock' => 0.29, 'unit' => 'g', 'cost' => 100]);
        $service = app(InventoryService::class);

        $this->assertSame(29, $service->calculateIngredientMetrics($material, 0.01, 'g')['quantity_available']);
        $this->assertSame(28, $service->calculateIngredientMetrics($material, 0.0100001, 'g')['quantity_available']);
        $this->assertEquals(1, $service->calculateIngredientMetrics(
            new RawMaterial(['stock' => 0.001, 'unit' => 'kg', 'cost' => 5000]), 1, 'g'
        )['quantity_available']);
    }

    public function test_unit_conversions_and_costs_match_mass_volume_and_count(): void
    {
        $service = app(InventoryService::class);
        foreach ([['kg', 'g', 2, 250, 8, 3000], ['L', 'ml', 1.5, 30, 50, 360], ['piece', 'piece', 10, 2, 5, 24000]] as $case) {
            [$unit, $portionUnit, $stock, $size, $capacity, $cost] = $case;
            $metrics = $service->calculateIngredientMetrics(new RawMaterial([
                'stock' => $stock, 'unit' => $unit, 'cost' => 12000,
            ]), $size, $portionUnit);
            $this->assertSame($capacity, $metrics['quantity_available']);
            $this->assertEquals($cost, $metrics['cost_per_portion']);
        }
        $this->assertEqualsWithDelta(0.00001, $service->convert(0.01, 'g', 'kg'), 0.000000001);
        $this->expectException(\InvalidArgumentException::class);
        $service->convert(1, 'kg', 'ml');
    }

    public function test_negative_stock_prices_and_reorder_levels_are_rejected(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $material = RawMaterial::create([
            'name' => 'Rice', 'stock' => 10, 'unit' => 'kg', 'cost' => 5000, 'reorder_level' => 1,
        ]);

        foreach (['stock', 'cost', 'reorder_level'] as $field) {
            $this->putJson("/api/admin/raw-materials/{$material->id}", [$field => -1])
                ->assertUnprocessable()->assertJsonValidationErrors($field);
        }
        $this->assertEquals(10, (float) $material->fresh()->stock);
        $this->assertEquals(5000, (float) $material->fresh()->cost);
    }

    public function test_portion_metrics_use_the_same_precision_as_the_stored_portion_size(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $material = RawMaterial::create([
            'name' => 'Rice', 'stock' => 1, 'unit' => 'kg', 'cost' => 5000, 'reorder_level' => 0,
        ]);

        $this->postJson('/api/admin/ingredients', [
            'name' => 'Fractional portion', 'raw_material_id' => $material->id,
            'portion_size' => 10.009, 'portion_unit' => 'g',
        ])->assertUnprocessable()->assertJsonValidationErrors('portion_size');
        $this->assertSame(0, Ingredient::count());
    }
}
