<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('raw_materials', function (Blueprint $table) {
            $table->decimal('stock', 16, 6)->change();
            $table->decimal('reorder_level', 16, 6)->default(5)->change();
        });
    }

    public function down(): void
    {
        Schema::table('raw_materials', function (Blueprint $table) {
            $table->decimal('stock', 12, 2)->change();
            $table->decimal('reorder_level', 12, 2)->default(5)->change();
        });
    }
};
