<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('menus', function (Blueprint $table) {
            if (!Schema::hasColumn('menus', 'baseline_catalog_price')) {
                $table->decimal('baseline_catalog_price', 12, 2)->nullable()->after('price');
            }

            if (!Schema::hasColumn('menus', 'baseline_unit_cost')) {
                $table->decimal('baseline_unit_cost', 12, 2)->nullable()->after('baseline_catalog_price');
            }

            if (!Schema::hasColumn('menus', 'baseline_margin_percent')) {
                $table->decimal('baseline_margin_percent', 8, 2)->nullable()->after('baseline_unit_cost');
            }
        });
    }

    public function down(): void
    {
        Schema::table('menus', function (Blueprint $table) {
            $columns = [];

            if (Schema::hasColumn('menus', 'baseline_margin_percent')) {
                $columns[] = 'baseline_margin_percent';
            }

            if (Schema::hasColumn('menus', 'baseline_unit_cost')) {
                $columns[] = 'baseline_unit_cost';
            }

            if (Schema::hasColumn('menus', 'baseline_catalog_price')) {
                $columns[] = 'baseline_catalog_price';
            }

            if (!empty($columns)) {
                $table->dropColumn($columns);
            }
        });
    }
};
