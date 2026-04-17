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
        Schema::table('orders', function (Blueprint $table) {
            if (!Schema::hasColumn('orders', 'packaging_quantity')) {
                $table->unsignedInteger('packaging_quantity')->default(0)->after('with_packaging');
            }

            if (!Schema::hasColumn('orders', 'packaging_unit_price')) {
                $table->decimal('packaging_unit_price', 10, 2)->default(0)->after('packaging_quantity');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (Schema::hasColumn('orders', 'packaging_unit_price')) {
                $table->dropColumn('packaging_unit_price');
            }

            if (Schema::hasColumn('orders', 'packaging_quantity')) {
                $table->dropColumn('packaging_quantity');
            }
        });
    }
};

