<?php

namespace Tests\Feature;

use App\Models\CashMovement;
use App\Models\RawMaterial;
use App\Models\Supplier;
use App\Models\SupplierPurchase;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AdminSupplierRawMaterialLinkTest extends TestCase
{
    use RefreshDatabase;

    private function actingAsAdmin(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($admin);
    }

    private function seedAccountBalance(string $account, float $amount, ?string $paymentMethod = null): void
    {
        /** @var User $admin */
        $admin = auth()->user();

        CashMovement::query()->create([
            'direction' => 'in',
            'status' => 'approved',
            'movement_type' => 'sale',
            'amount' => $amount,
            'payment_method' => $paymentMethod,
            'destination_account' => $account,
            'description' => "Solde initial {$account}",
            'reason' => 'Base de départ',
            'requested_by_user_id' => $admin->id,
            'approved_by_user_id' => $admin->id,
            'approved_at' => now(),
        ]);
    }

    public function test_admin_can_create_raw_material_with_existing_supplier(): void
    {
        $this->actingAsAdmin();

        $supplier = Supplier::create([
            'name' => 'Fournisseur existant',
            'email' => 'existing@supplier.test',
            'phone' => '+261321010101',
        ]);

        $response = $this->postJson('/api/admin/raw-materials', [
            'name' => 'Tomate',
            'description' => 'Tomate fraiche',
            'stock' => 120,
            'unit' => 'kg',
            'cost' => 3500,
            'reorder_level' => 15,
            'supplier_id' => $supplier->id,
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('name', 'Tomate');

        $materialId = (int) $response->json('id');

        $this->assertDatabaseHas('raw_material_supplier', [
            'supplier_id' => $supplier->id,
            'raw_material_id' => $materialId,
        ]);
        $purchase = SupplierPurchase::query()
            ->where('supplier_id', $supplier->id)
            ->where('raw_material_id', $materialId)
            ->latest('id')
            ->first();
        $this->assertNotNull($purchase);
        $this->assertSame('unpaid', (string) $purchase->payment_status);
        $this->assertSame(420000.0, (float) $purchase->total_amount);
        $this->assertSame(0.0, (float) $purchase->paid_amount);
        $this->assertSame(420000.0, (float) $purchase->remaining_amount);
        $this->assertSame(120.0, (float) RawMaterial::query()->findOrFail($materialId)->stock);

        $supplier->refresh();
        $this->assertSame($materialId, (int) $supplier->raw_material_id);
    }

    public function test_admin_can_create_raw_material_with_new_supplier(): void
    {
        $this->actingAsAdmin();

        $response = $this->postJson('/api/admin/raw-materials', [
            'name' => 'Poivre noir',
            'description' => null,
            'stock' => 40,
            'unit' => 'kg',
            'cost' => 9500,
            'reorder_level' => 5,
            'new_supplier' => [
                'name' => 'Nouveau fournisseur',
                'email' => 'new@supplier.test',
                'phone' => '+261322020202',
            ],
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('name', 'Poivre noir');

        $materialId = (int) $response->json('id');
        $supplierId = (int) Supplier::query()->where('email', 'new@supplier.test')->value('id');

        $this->assertGreaterThan(0, $supplierId);
        $this->assertDatabaseHas('raw_material_supplier', [
            'supplier_id' => $supplierId,
            'raw_material_id' => $materialId,
        ]);
        $purchase = SupplierPurchase::query()
            ->where('supplier_id', $supplierId)
            ->where('raw_material_id', $materialId)
            ->latest('id')
            ->first();
        $this->assertNotNull($purchase);
        $this->assertSame('unpaid', (string) $purchase->payment_status);
        $this->assertSame(380000.0, (float) $purchase->total_amount);
        $this->assertSame(0.0, (float) $purchase->paid_amount);
        $this->assertSame(380000.0, (float) $purchase->remaining_amount);
    }

    public function test_admin_cannot_create_raw_material_without_supplier_link(): void
    {
        $this->actingAsAdmin();

        $response = $this->postJson('/api/admin/raw-materials', [
            'name' => 'Sel',
            'description' => null,
            'stock' => 30,
            'unit' => 'kg',
            'cost' => 1600,
            'reorder_level' => 5,
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['supplier']);
    }

    public function test_admin_cannot_create_supplier_without_raw_materials(): void
    {
        $this->actingAsAdmin();

        $response = $this->postJson('/api/admin/suppliers', [
            'name' => 'Supplier sans matiere',
            'email' => 'no-raw@supplier.test',
            'phone' => '+261323030303',
        ]);

        $response->assertStatus(422)
            ->assertJsonValidationErrors(['raw_material_ids']);
    }

    public function test_admin_can_create_supplier_with_multiple_raw_materials(): void
    {
        $this->actingAsAdmin();

        $rawMaterialA = RawMaterial::create([
            'name' => 'Pomme de terre',
            'description' => null,
            'stock' => 200,
            'unit' => 'kg',
            'cost' => 1800,
            'reorder_level' => 20,
        ]);

        $rawMaterialB = RawMaterial::create([
            'name' => 'Huile',
            'description' => null,
            'stock' => 55,
            'unit' => 'L',
            'cost' => 8200,
            'reorder_level' => 10,
        ]);

        $response = $this->postJson('/api/admin/suppliers', [
            'name' => 'Supplier multi',
            'email' => 'multi@supplier.test',
            'phone' => '+261324040404',
            'raw_material_ids' => [$rawMaterialA->id, $rawMaterialB->id],
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('supplier.name', 'Supplier multi');

        $supplierId = (int) $response->json('supplier.id');
        $this->assertGreaterThan(0, $supplierId);

        $this->assertDatabaseHas('raw_material_supplier', [
            'supplier_id' => $supplierId,
            'raw_material_id' => $rawMaterialA->id,
        ]);

        $this->assertDatabaseHas('raw_material_supplier', [
            'supplier_id' => $supplierId,
            'raw_material_id' => $rawMaterialB->id,
        ]);
        $this->assertDatabaseMissing('supplier_purchases', [
            'supplier_id' => $supplierId,
            'raw_material_id' => $rawMaterialA->id,
        ]);
        $this->assertDatabaseMissing('supplier_purchases', [
            'supplier_id' => $supplierId,
            'raw_material_id' => $rawMaterialB->id,
        ]);

        $this->assertSame(0, SupplierPurchase::query()->where('supplier_id', $supplierId)->count());
        $this->assertEquals(200.0, (float) $rawMaterialA->fresh()->stock);
        $this->assertEquals(55.0, (float) $rawMaterialB->fresh()->stock);
    }

    public function test_admin_can_create_supplier_with_new_raw_materials(): void
    {
        $this->actingAsAdmin();

        $response = $this->postJson('/api/admin/suppliers', [
            'name' => 'Supplier new raws',
            'email' => 'supplier-new-raws@test.local',
            'phone' => '+261325050505',
            'new_raw_materials' => [
                [
                    'name' => 'Rhum blanc',
                    'description' => 'Bouteille 1L',
                    'stock' => 15,
                    'unit' => 'L',
                    'cost' => 38000,
                    'reorder_level' => 3,
                ],
                [
                    'name' => 'Menthe fraiche',
                    'description' => null,
                    'stock' => 120,
                    'unit' => 'pièce',
                    'cost' => 250,
                    'reorder_level' => 20,
                ],
            ],
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('supplier.name', 'Supplier new raws');

        $supplierId = (int) $response->json('supplier.id');
        $this->assertGreaterThan(0, $supplierId);

        $rhumId = (int) RawMaterial::query()->where('name', 'Rhum blanc')->value('id');
        $mentheId = (int) RawMaterial::query()->where('name', 'Menthe fraiche')->value('id');

        $this->assertGreaterThan(0, $rhumId);
        $this->assertGreaterThan(0, $mentheId);

        $this->assertDatabaseHas('raw_material_supplier', [
            'supplier_id' => $supplierId,
            'raw_material_id' => $rhumId,
        ]);
        $this->assertDatabaseHas('raw_material_supplier', [
            'supplier_id' => $supplierId,
            'raw_material_id' => $mentheId,
        ]);
        $this->assertDatabaseMissing('supplier_purchases', [
            'supplier_id' => $supplierId,
            'raw_material_id' => $rhumId,
        ]);
        $this->assertDatabaseMissing('supplier_purchases', [
            'supplier_id' => $supplierId,
            'raw_material_id' => $mentheId,
        ]);
    }

    public function test_admin_can_create_supplier_with_existing_and_new_raw_materials(): void
    {
        $this->actingAsAdmin();

        $existingRawMaterial = RawMaterial::create([
            'name' => 'Jus orange',
            'description' => null,
            'stock' => 40,
            'unit' => 'L',
            'cost' => 7000,
            'reorder_level' => 8,
        ]);

        $response = $this->postJson('/api/admin/suppliers', [
            'name' => 'Supplier mix',
            'email' => 'supplier-mix@test.local',
            'phone' => '+261326060606',
            'raw_material_ids' => [$existingRawMaterial->id],
            'new_raw_materials' => [
                [
                    'name' => 'Sirop grenadine',
                    'description' => null,
                    'stock' => 22,
                    'unit' => 'L',
                    'cost' => 9200,
                    'reorder_level' => 4,
                ],
            ],
        ]);

        $response->assertStatus(201)
            ->assertJsonPath('supplier.name', 'Supplier mix');

        $supplierId = (int) $response->json('supplier.id');
        $newRawMaterialId = (int) RawMaterial::query()->where('name', 'Sirop grenadine')->value('id');

        $this->assertGreaterThan(0, $supplierId);
        $this->assertGreaterThan(0, $newRawMaterialId);

        $this->assertDatabaseHas('raw_material_supplier', [
            'supplier_id' => $supplierId,
            'raw_material_id' => $existingRawMaterial->id,
        ]);
        $this->assertDatabaseHas('raw_material_supplier', [
            'supplier_id' => $supplierId,
            'raw_material_id' => $newRawMaterialId,
        ]);
        $this->assertDatabaseMissing('supplier_purchases', [
            'supplier_id' => $supplierId,
            'raw_material_id' => $existingRawMaterial->id,
        ]);
        $this->assertDatabaseMissing('supplier_purchases', [
            'supplier_id' => $supplierId,
            'raw_material_id' => $newRawMaterialId,
        ]);
    }

    public function test_admin_can_pay_supplier_purchase_with_cash_method(): void
    {
        $this->actingAsAdmin();
        $this->seedAccountBalance(CashMovement::ACCOUNT_CASH, 50000, 'cash');

        $rawMaterial = RawMaterial::create([
            'name' => 'Farine',
            'description' => null,
            'stock' => 80,
            'unit' => 'kg',
            'cost' => 2400,
            'reorder_level' => 10,
        ]);

        $supplier = Supplier::create([
            'name' => 'Supplier paiement',
            'email' => 'supplier-paiement@test.local',
            'phone' => '+261327070707',
            'raw_material_id' => $rawMaterial->id,
        ]);
        $supplier->rawMaterials()->syncWithoutDetaching([$rawMaterial->id]);

        $purchase = SupplierPurchase::create([
            'supplier_id' => $supplier->id,
            'raw_material_id' => $rawMaterial->id,
            'quantity' => 20,
            'unit_price' => 3000,
            'total_amount' => 60000,
            'paid_amount' => 0,
            'remaining_amount' => 60000,
            'payment_mode' => 'credit',
            'payment_status' => 'unpaid',
            'purchased_at' => now(),
            'due_date' => now()->addDays(10)->toDateString(),
        ]);

        $response = $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases/{$purchase->id}/payments", [
            'amount' => 12000,
            'method' => 'cash',
            'note' => 'Test paiement cash',
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('purchase.id', $purchase->id)
            ->assertJsonPath('purchase.paid_amount', '12000.00')
            ->assertJsonPath('purchase.remaining_amount', '48000.00');

        $this->assertDatabaseHas('supplier_purchase_payments', [
            'supplier_purchase_id' => $purchase->id,
            'amount' => 12000,
            'method' => 'cash',
        ]);
        $this->assertDatabaseHas('cash_movements', [
            'flow_type' => 'supplier_payment',
            'supplier_purchase_id' => $purchase->id,
            'amount' => 12000,
            'source_account' => CashMovement::ACCOUNT_CASH,
        ]);
    }

    public function test_admin_can_create_paid_supplier_purchase_from_safe_account(): void
    {
        $this->actingAsAdmin();
        $this->seedAccountBalance(CashMovement::ACCOUNT_SAFE, 70000, 'cash');

        $rawMaterial = RawMaterial::create([
            'name' => 'Riz local',
            'description' => null,
            'stock' => 100,
            'unit' => 'kg',
            'cost' => 2800,
            'reorder_level' => 12,
        ]);

        $supplier = Supplier::create([
            'name' => 'Supplier coffre',
            'email' => 'supplier-safe@test.local',
            'phone' => '+261321111111',
            'raw_material_id' => $rawMaterial->id,
        ]);
        $supplier->rawMaterials()->syncWithoutDetaching([$rawMaterial->id]);

        $response = $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases", [
            'raw_material_id' => $rawMaterial->id,
            'quantity' => 5,
            'unit_price' => 6000,
            'payment_mode' => 'cash',
            'payment_method' => 'cash',
            'cash_source_account' => CashMovement::ACCOUNT_SAFE,
            'note' => 'Reglement depuis le coffre',
        ]);

        $response->assertCreated()
            ->assertJsonPath('purchase.payment_status', 'paid')
            ->assertJsonPath('purchase.paid_amount', '30000.00')
            ->assertJsonPath('purchase.remaining_amount', '0.00');

        $purchaseId = (int) $response->json('purchase.id');

        $this->assertDatabaseHas('supplier_purchase_payments', [
            'supplier_purchase_id' => $purchaseId,
            'amount' => 30000,
            'method' => 'cash',
            'source_account' => CashMovement::ACCOUNT_SAFE,
        ]);
        $this->assertDatabaseHas('cash_movements', [
            'flow_type' => 'supplier_payment',
            'supplier_purchase_id' => $purchaseId,
            'amount' => 30000,
            'source_account' => CashMovement::ACCOUNT_SAFE,
        ]);
    }

    public function test_supplier_payment_movement_uses_real_payment_date(): void
    {
        $this->actingAsAdmin();
        $this->seedAccountBalance(CashMovement::ACCOUNT_BANK, 90000, 'transfer');

        $rawMaterial = RawMaterial::create([
            'name' => 'Beurre',
            'description' => null,
            'stock' => 50,
            'unit' => 'kg',
            'cost' => 6200,
            'reorder_level' => 8,
        ]);

        $supplier = Supplier::create([
            'name' => 'Supplier date paiement',
            'email' => 'supplier-date@test.local',
            'phone' => '+261320101010',
            'raw_material_id' => $rawMaterial->id,
        ]);
        $supplier->rawMaterials()->syncWithoutDetaching([$rawMaterial->id]);

        $purchase = SupplierPurchase::create([
            'supplier_id' => $supplier->id,
            'raw_material_id' => $rawMaterial->id,
            'quantity' => 10,
            'unit_price' => 7000,
            'total_amount' => 70000,
            'paid_amount' => 0,
            'remaining_amount' => 70000,
            'payment_mode' => 'credit',
            'payment_status' => 'unpaid',
            'purchased_at' => now(),
            'due_date' => now()->addDays(15)->toDateString(),
        ]);

        $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases/{$purchase->id}/payments", [
            'amount' => 25000,
            'method' => 'check',
            'paid_at' => '2026-03-25 14:30:00',
            'reference' => 'CHQ-2026-03',
        ])->assertOk();

        $movement = CashMovement::query()
            ->where('flow_type', 'supplier_payment')
            ->where('supplier_purchase_id', $purchase->id)
            ->latest('id')
            ->first();

        $this->assertNotNull($movement);
        $this->assertSame('2026-03-25 14:30:00', optional($movement->approved_at)->format('Y-m-d H:i:s'));
    }

    public function test_supplier_payments_follow_selected_method_update_balances_and_keep_history(): void
    {
        $this->actingAsAdmin();
        $this->seedAccountBalance(CashMovement::ACCOUNT_BANK, 100000, 'transfer');
        $this->seedAccountBalance(CashMovement::ACCOUNT_SAFE, 50000, 'cash');

        $rawMaterial = RawMaterial::create([
            'name' => 'Poisson',
            'description' => null,
            'stock' => 25,
            'unit' => 'kg',
            'cost' => 12000,
            'reorder_level' => 6,
        ]);

        $supplier = Supplier::create([
            'name' => 'Supplier flux',
            'email' => 'supplier-flux@test.local',
            'phone' => '+261320202020',
            'raw_material_id' => $rawMaterial->id,
        ]);
        $supplier->rawMaterials()->syncWithoutDetaching([$rawMaterial->id]);

        $createPurchase = $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases", [
            'raw_material_id' => $rawMaterial->id,
            'quantity' => 10,
            'unit_price' => 10000,
            'payment_mode' => 'credit',
            'initial_paid_amount' => 0,
            'due_date' => now()->addDays(10)->toDateString(),
            'note' => 'Achat en dette',
        ]);

        $createPurchase->assertCreated()
            ->assertJsonPath('purchase.payment_status', 'unpaid')
            ->assertJsonPath('purchase.paid_amount', '0.00')
            ->assertJsonPath('purchase.remaining_amount', '100000.00');

        $purchaseId = (int) $createPurchase->json('purchase.id');
        $this->assertGreaterThan(0, $purchaseId);

        $firstPayment = $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases/{$purchaseId}/payments", [
            'amount' => 30000,
            'method' => 'transfer',
            'reference' => 'VIR-001',
            'note' => 'Paiement banque',
        ]);

        $firstPayment->assertOk()
            ->assertJsonPath('purchase.paid_amount', '30000.00')
            ->assertJsonPath('purchase.remaining_amount', '70000.00');

        $secondPayment = $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases/{$purchaseId}/payments", [
            'amount' => 15000,
            'method' => 'cash',
            'cash_source_account' => CashMovement::ACCOUNT_SAFE,
            'reference' => 'SAFE-001',
            'note' => 'Paiement coffre',
        ]);

        $secondPayment->assertOk()
            ->assertJsonPath('purchase.paid_amount', '45000.00')
            ->assertJsonPath('purchase.remaining_amount', '55000.00')
            ->assertJsonPath('purchase.payment_status', 'partial');

        $this->assertDatabaseHas('supplier_purchase_payments', [
            'supplier_purchase_id' => $purchaseId,
            'amount' => 30000,
            'method' => 'transfer',
            'source_account' => CashMovement::ACCOUNT_BANK,
            'reference' => 'VIR-001',
        ]);
        $this->assertDatabaseHas('supplier_purchase_payments', [
            'supplier_purchase_id' => $purchaseId,
            'amount' => 15000,
            'method' => 'cash',
            'source_account' => CashMovement::ACCOUNT_SAFE,
            'reference' => 'SAFE-001',
        ]);

        $this->assertSame(2, CashMovement::query()
            ->where('flow_type', 'supplier_payment')
            ->where('supplier_purchase_id', $purchaseId)
            ->count());

        $this->assertDatabaseHas('cash_movements', [
            'flow_type' => 'supplier_payment',
            'supplier_purchase_id' => $purchaseId,
            'source_account' => CashMovement::ACCOUNT_BANK,
            'amount' => 30000,
        ]);
        $this->assertDatabaseHas('cash_movements', [
            'flow_type' => 'supplier_payment',
            'supplier_purchase_id' => $purchaseId,
            'source_account' => CashMovement::ACCOUNT_SAFE,
            'amount' => 15000,
        ]);

        $treasurySnapshot = $this->getJson('/api/admin/treasury');
        $treasurySnapshot->assertOk()
            ->assertJsonPath('summary.accounts.bank.balance', 70000)
            ->assertJsonPath('summary.accounts.safe.balance', 35000)
            ->assertJsonPath('summary.total_internal_balance', 105000);

        $ledger = $this->getJson("/api/admin/suppliers/{$supplier->id}/ledger");
        $ledger->assertOk()
            ->assertJsonPath('summary.total_remaining', 55000)
            ->assertJsonPath('summary.total_paid', 45000);

        $ledgerPurchase = collect($ledger->json('purchases'))->firstWhere('id', $purchaseId);
        $this->assertNotNull($ledgerPurchase);
        $this->assertSame(2, count($ledgerPurchase['payments'] ?? []));

        $paymentAccounts = collect($ledgerPurchase['payments'])
            ->pluck('source_account')
            ->filter()
            ->values()
            ->all();

        $this->assertContains(CashMovement::ACCOUNT_BANK, $paymentAccounts);
        $this->assertContains(CashMovement::ACCOUNT_SAFE, $paymentAccounts);
    }

    public function test_admin_can_settle_all_outstanding_purchases_for_one_supplier_only(): void
    {
        $this->actingAsAdmin();
        $this->seedAccountBalance(CashMovement::ACCOUNT_BANK, 220000, 'transfer');

        $rawMaterialA = RawMaterial::create([
            'name' => 'Gingembre',
            'description' => null,
            'stock' => 30,
            'unit' => 'kg',
            'cost' => 6000,
            'reorder_level' => 6,
        ]);

        $rawMaterialB = RawMaterial::create([
            'name' => 'Citron vert',
            'description' => null,
            'stock' => 80,
            'unit' => 'pièce',
            'cost' => 700,
            'reorder_level' => 20,
        ]);

        $otherRawMaterial = RawMaterial::create([
            'name' => 'Cannelle',
            'description' => null,
            'stock' => 10,
            'unit' => 'kg',
            'cost' => 15000,
            'reorder_level' => 2,
        ]);

        $supplier = Supplier::create([
            'name' => 'Supplier multi ingredients',
            'email' => 'supplier-multi-ingredients@test.local',
            'phone' => '+261330000001',
            'raw_material_id' => $rawMaterialA->id,
        ]);
        $supplier->rawMaterials()->syncWithoutDetaching([$rawMaterialA->id, $rawMaterialB->id]);

        $otherSupplier = Supplier::create([
            'name' => 'Supplier autre',
            'email' => 'supplier-autre@test.local',
            'phone' => '+261330000002',
            'raw_material_id' => $otherRawMaterial->id,
        ]);
        $otherSupplier->rawMaterials()->syncWithoutDetaching([$otherRawMaterial->id]);

        $purchaseA = SupplierPurchase::create([
            'supplier_id' => $supplier->id,
            'raw_material_id' => $rawMaterialA->id,
            'quantity' => 8,
            'unit_price' => 5000,
            'total_amount' => 40000,
            'paid_amount' => 0,
            'remaining_amount' => 40000,
            'payment_mode' => 'credit',
            'payment_status' => 'unpaid',
            'purchased_at' => now()->subDays(4),
            'due_date' => now()->addDays(8)->toDateString(),
        ]);

        $purchaseB = SupplierPurchase::create([
            'supplier_id' => $supplier->id,
            'raw_material_id' => $rawMaterialB->id,
            'quantity' => 20,
            'unit_price' => 3000,
            'total_amount' => 60000,
            'paid_amount' => 0,
            'remaining_amount' => 60000,
            'payment_mode' => 'credit',
            'payment_status' => 'unpaid',
            'purchased_at' => now()->subDays(2),
            'due_date' => now()->addDays(12)->toDateString(),
        ]);

        $otherPurchase = SupplierPurchase::create([
            'supplier_id' => $otherSupplier->id,
            'raw_material_id' => $otherRawMaterial->id,
            'quantity' => 2,
            'unit_price' => 20000,
            'total_amount' => 40000,
            'paid_amount' => 0,
            'remaining_amount' => 40000,
            'payment_mode' => 'credit',
            'payment_status' => 'unpaid',
            'purchased_at' => now()->subDays(1),
            'due_date' => now()->addDays(6)->toDateString(),
        ]);

        $response = $this->postJson("/api/admin/suppliers/{$supplier->id}/purchases/settle-all", [
            'method' => 'transfer',
            'reference' => 'VIR-GLOBAL-001',
            'note' => 'Reglement global fournisseur',
        ]);

        $response->assertOk()
            ->assertJsonPath('paid_purchases_count', 2)
            ->assertJsonPath('total_paid_amount', 100000);

        $this->assertDatabaseHas('supplier_purchases', [
            'id' => $purchaseA->id,
            'payment_status' => 'paid',
            'remaining_amount' => 0,
            'paid_amount' => 40000,
        ]);
        $this->assertDatabaseHas('supplier_purchases', [
            'id' => $purchaseB->id,
            'payment_status' => 'paid',
            'remaining_amount' => 0,
            'paid_amount' => 60000,
        ]);

        $this->assertDatabaseHas('supplier_purchases', [
            'id' => $otherPurchase->id,
            'payment_status' => 'unpaid',
            'remaining_amount' => 40000,
        ]);

        $this->assertDatabaseHas('supplier_purchase_payments', [
            'supplier_purchase_id' => $purchaseA->id,
            'amount' => 40000,
            'method' => 'transfer',
            'source_account' => CashMovement::ACCOUNT_BANK,
            'reference' => 'VIR-GLOBAL-001',
        ]);
        $this->assertDatabaseHas('supplier_purchase_payments', [
            'supplier_purchase_id' => $purchaseB->id,
            'amount' => 60000,
            'method' => 'transfer',
            'source_account' => CashMovement::ACCOUNT_BANK,
            'reference' => 'VIR-GLOBAL-001',
        ]);

        $this->assertSame(2, CashMovement::query()
            ->where('flow_type', 'supplier_payment')
            ->whereIn('supplier_purchase_id', [$purchaseA->id, $purchaseB->id])
            ->where('source_account', CashMovement::ACCOUNT_BANK)
            ->count());

        $this->assertDatabaseHas('cash_movements', [
            'flow_type' => 'supplier_payment',
            'supplier_purchase_id' => $purchaseA->id,
            'source_account' => CashMovement::ACCOUNT_BANK,
            'amount' => 40000,
        ]);
        $this->assertDatabaseHas('cash_movements', [
            'flow_type' => 'supplier_payment',
            'supplier_purchase_id' => $purchaseB->id,
            'source_account' => CashMovement::ACCOUNT_BANK,
            'amount' => 60000,
        ]);

        $this->assertDatabaseMissing('cash_movements', [
            'flow_type' => 'supplier_payment',
            'supplier_purchase_id' => $otherPurchase->id,
            'amount' => 40000,
        ]);

        $treasurySnapshot = $this->getJson('/api/admin/treasury');
        $treasurySnapshot->assertOk()
            ->assertJsonPath('summary.accounts.bank.balance', 120000)
            ->assertJsonPath('summary.total_internal_balance', 120000);

        $ledger = $this->getJson("/api/admin/suppliers/{$supplier->id}/ledger");
        $ledger->assertOk()
            ->assertJsonPath('summary.total_remaining', 0)
            ->assertJsonPath('summary.total_paid', 100000)
            ->assertJsonPath('summary.unpaid_purchases_count', 0);
    }

    public function test_supplier_ledger_keeps_raw_material_name_even_if_material_is_soft_deleted(): void
    {
        $this->actingAsAdmin();

        $rawMaterial = RawMaterial::create([
            'name' => 'Paprika doux',
            'description' => null,
            'stock' => 12,
            'unit' => 'kg',
            'cost' => 9000,
            'reorder_level' => 3,
        ]);

        $supplier = Supplier::create([
            'name' => 'Supplier archive test',
            'email' => 'supplier-archive@test.local',
            'phone' => '+261330000003',
            'raw_material_id' => $rawMaterial->id,
        ]);
        $supplier->rawMaterials()->syncWithoutDetaching([$rawMaterial->id]);

        $purchase = SupplierPurchase::create([
            'supplier_id' => $supplier->id,
            'raw_material_id' => $rawMaterial->id,
            'quantity' => 3,
            'unit_price' => 11000,
            'total_amount' => 33000,
            'paid_amount' => 33000,
            'remaining_amount' => 0,
            'payment_mode' => 'cash',
            'payment_status' => 'paid',
            'purchased_at' => now(),
            'due_date' => null,
        ]);

        $rawMaterial->delete();

        $ledgerResponse = $this->getJson("/api/admin/suppliers/{$supplier->id}/ledger");
        $ledgerResponse->assertOk();

        $ledgerPurchase = collect($ledgerResponse->json('purchases'))->firstWhere('id', $purchase->id);
        $this->assertNotNull($ledgerPurchase);
        $this->assertSame('Paprika doux', $ledgerPurchase['raw_material']['name'] ?? null);
    }

    public function test_admin_can_link_same_raw_material_to_multiple_suppliers_during_update(): void
    {
        $this->actingAsAdmin();

        $sharedRawMaterial = RawMaterial::create([
            'name' => 'Sucre',
            'description' => null,
            'stock' => 0,
            'unit' => 'kg',
            'cost' => 2500,
            'reorder_level' => 5,
        ]);

        $otherRawMaterial = RawMaterial::create([
            'name' => 'Cafe',
            'description' => null,
            'stock' => 20,
            'unit' => 'kg',
            'cost' => 18000,
            'reorder_level' => 4,
        ]);

        $supplierA = Supplier::create([
            'name' => 'Supplier A',
            'email' => 'supplier-a@test.local',
            'phone' => '+261328080808',
            'raw_material_id' => $sharedRawMaterial->id,
        ]);
        $supplierA->rawMaterials()->syncWithoutDetaching([$sharedRawMaterial->id]);

        $supplierB = Supplier::create([
            'name' => 'Supplier B',
            'email' => 'supplier-b@test.local',
            'phone' => '+261329090909',
            'raw_material_id' => $otherRawMaterial->id,
        ]);
        $supplierB->rawMaterials()->syncWithoutDetaching([$otherRawMaterial->id]);

        $response = $this->putJson("/api/admin/suppliers/{$supplierB->id}", [
            'name' => 'Supplier B',
            'email' => 'supplier-b@test.local',
            'phone' => '+261329090909',
            'raw_material_ids' => [$otherRawMaterial->id, $sharedRawMaterial->id],
        ]);

        $response->assertStatus(200)
            ->assertJsonPath('supplier.name', 'Supplier B');

        $this->assertDatabaseHas('raw_material_supplier', [
            'supplier_id' => $supplierA->id,
            'raw_material_id' => $sharedRawMaterial->id,
        ]);

        $this->assertDatabaseHas('raw_material_supplier', [
            'supplier_id' => $supplierB->id,
            'raw_material_id' => $sharedRawMaterial->id,
        ]);
    }

    public function test_changing_raw_material_preferred_supplier_keeps_existing_debt_on_original_supplier(): void
    {
        $this->actingAsAdmin();

        $rawMaterial = RawMaterial::create([
            'name' => 'Vanille',
            'description' => null,
            'stock' => 10,
            'unit' => 'kg',
            'cost' => 12000,
            'reorder_level' => 2,
        ]);

        $supplierA = Supplier::create([
            'name' => 'Supplier historique',
            'email' => 'supplier-historique@test.local',
            'phone' => '+261331111111',
            'raw_material_id' => $rawMaterial->id,
        ]);
        $supplierA->rawMaterials()->syncWithoutDetaching([$rawMaterial->id]);

        $supplierB = Supplier::create([
            'name' => 'Supplier nouveau',
            'email' => 'supplier-nouveau@test.local',
            'phone' => '+261332222222',
        ]);

        $existingPurchase = SupplierPurchase::create([
            'supplier_id' => $supplierA->id,
            'raw_material_id' => $rawMaterial->id,
            'quantity' => 4,
            'unit_price' => 10000,
            'total_amount' => 40000,
            'paid_amount' => 0,
            'remaining_amount' => 40000,
            'payment_mode' => 'credit',
            'payment_status' => 'unpaid',
            'purchased_at' => now()->subDays(2),
            'due_date' => now()->addDays(20)->toDateString(),
            'note' => 'Dette historique',
        ]);

        $response = $this->putJson("/api/admin/raw-materials/{$rawMaterial->id}", [
            'name' => 'Vanille',
            'description' => null,
            'stock' => 15,
            'unit' => 'kg',
            'cost' => 12000,
            'reorder_level' => 2,
            'supplier_id' => $supplierB->id,
            'stock_update_mode' => 'purchase',
            'purchase_unit_price' => 15000,
        ]);

        $response->assertOk()
            ->assertJsonPath('stock', '15.00');

        $this->assertDatabaseHas('supplier_purchases', [
            'id' => $existingPurchase->id,
            'supplier_id' => $supplierA->id,
            'raw_material_id' => $rawMaterial->id,
            'remaining_amount' => 40000,
        ]);

        $newPurchase = SupplierPurchase::query()
            ->where('supplier_id', $supplierB->id)
            ->where('raw_material_id', $rawMaterial->id)
            ->latest('id')
            ->first();

        $this->assertNotNull($newPurchase);
        $this->assertNotSame((int) $existingPurchase->id, (int) $newPurchase->id);
        $this->assertSame(75000.0, (float) $newPurchase->total_amount);
        $this->assertSame(75000.0, (float) $newPurchase->remaining_amount);

        $supplierALedger = $this->getJson("/api/admin/suppliers/{$supplierA->id}/ledger");
        $supplierALedger->assertOk()
            ->assertJsonPath('summary.total_remaining', 40000)
            ->assertJsonPath('summary.unpaid_purchases_count', 1);

        $supplierBLedger = $this->getJson("/api/admin/suppliers/{$supplierB->id}/ledger");
        $supplierBLedger->assertOk()
            ->assertJsonPath('summary.total_remaining', 75000)
            ->assertJsonPath('summary.unpaid_purchases_count', 1);

        $supplierAPurchaseIds = collect($supplierALedger->json('purchases'))->pluck('id')->map(fn ($id) => (int) $id);
        $supplierBPurchaseIds = collect($supplierBLedger->json('purchases'))->pluck('id')->map(fn ($id) => (int) $id);

        $this->assertTrue($supplierAPurchaseIds->contains((int) $existingPurchase->id));
        $this->assertFalse($supplierAPurchaseIds->contains((int) $newPurchase->id));
        $this->assertTrue($supplierBPurchaseIds->contains((int) $newPurchase->id));
        $this->assertFalse($supplierBPurchaseIds->contains((int) $existingPurchase->id));
    }
}
