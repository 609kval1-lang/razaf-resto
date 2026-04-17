<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('ingredients')) {
            return;
        }

        if (!Schema::hasColumn('ingredients', 'is_cocktail_ingredient')) {
            Schema::table('ingredients', function (Blueprint $table) {
                $table->boolean('is_cocktail_ingredient')->default(false)->after('cost_per_portion');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('ingredients')) {
            return;
        }

        if (Schema::hasColumn('ingredients', 'is_cocktail_ingredient')) {
            Schema::table('ingredients', function (Blueprint $table) {
                $table->dropColumn('is_cocktail_ingredient');
            });
        }
    }
};
