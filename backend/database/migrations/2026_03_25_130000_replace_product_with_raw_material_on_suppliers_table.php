<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('suppliers', function (Blueprint $table) {
            if (Schema::hasColumn('suppliers', 'product_id')) {
                $table->dropForeign(['product_id']);
                $table->dropColumn('product_id');
            }
        });

        if (!Schema::hasColumn('suppliers', 'raw_material_id')) {
            Schema::table('suppliers', function (Blueprint $table) {
                $table->foreignId('raw_material_id')
                    ->nullable()
                    ->after('id')
                    ->constrained('raw_materials')
                    ->restrictOnDelete();
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('suppliers', function (Blueprint $table) {
            if (Schema::hasColumn('suppliers', 'raw_material_id')) {
                $table->dropForeign(['raw_material_id']);
                $table->dropColumn('raw_material_id');
            }
        });

        if (!Schema::hasColumn('suppliers', 'product_id')) {
            Schema::table('suppliers', function (Blueprint $table) {
                $table->foreignId('product_id')
                    ->nullable()
                    ->after('id')
                    ->constrained('products')
                    ->restrictOnDelete();
            });
        }
    }
};
