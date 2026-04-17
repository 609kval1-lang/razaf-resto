<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('raw_material_supplier')) {
            Schema::create('raw_material_supplier', function (Blueprint $table) {
                $table->id();
                $table->foreignId('supplier_id')->constrained('suppliers')->cascadeOnDelete();
                $table->foreignId('raw_material_id')->constrained('raw_materials')->restrictOnDelete();
                $table->timestamps();

                $table->unique(['supplier_id', 'raw_material_id']);
            });
        }

        if (!Schema::hasTable('supplier_purchases')) {
            Schema::create('supplier_purchases', function (Blueprint $table) {
                $table->id();
                $table->foreignId('supplier_id')->constrained('suppliers')->restrictOnDelete();
                $table->foreignId('raw_material_id')->constrained('raw_materials')->restrictOnDelete();
                $table->decimal('quantity', 12, 3);
                $table->decimal('unit_price', 12, 2);
                $table->decimal('total_amount', 12, 2);
                $table->decimal('paid_amount', 12, 2)->default(0);
                $table->decimal('remaining_amount', 12, 2)->default(0);
                $table->enum('payment_mode', ['cash', 'credit'])->default('cash');
                $table->enum('payment_status', ['paid', 'partial', 'unpaid'])->default('unpaid');
                $table->dateTime('purchased_at');
                $table->date('due_date')->nullable();
                $table->text('note')->nullable();
                $table->timestamps();
            });
        }

        if (!Schema::hasTable('supplier_purchase_payments')) {
            Schema::create('supplier_purchase_payments', function (Blueprint $table) {
                $table->id();
                $table->foreignId('supplier_purchase_id')
                    ->constrained('supplier_purchases')
                    ->cascadeOnDelete();
                $table->decimal('amount', 12, 2);
                $table->enum('method', ['cash', 'card', 'transfer', 'check'])->default('cash');
                $table->string('reference', 120)->nullable();
                $table->text('note')->nullable();
                $table->dateTime('paid_at');
                $table->timestamps();
            });
        }

        // Migration de compatibilité: convertir l'ancienne liaison unique en liaison multiple.
        if (
            Schema::hasTable('suppliers')
            && Schema::hasColumn('suppliers', 'raw_material_id')
            && Schema::hasTable('raw_material_supplier')
        ) {
            $now = now();

            DB::table('suppliers')
                ->select(['id', 'raw_material_id'])
                ->whereNotNull('raw_material_id')
                ->orderBy('id')
                ->chunkById(200, function ($rows) use ($now) {
                    $payload = [];

                    foreach ($rows as $row) {
                        $payload[] = [
                            'supplier_id' => (int) $row->id,
                            'raw_material_id' => (int) $row->raw_material_id,
                            'created_at' => $now,
                            'updated_at' => $now,
                        ];
                    }

                    if (!empty($payload)) {
                        DB::table('raw_material_supplier')->insertOrIgnore($payload);
                    }
                });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('supplier_purchase_payments')) {
            Schema::drop('supplier_purchase_payments');
        }

        if (Schema::hasTable('supplier_purchases')) {
            Schema::drop('supplier_purchases');
        }

        if (Schema::hasTable('raw_material_supplier')) {
            Schema::drop('raw_material_supplier');
        }
    }
};

