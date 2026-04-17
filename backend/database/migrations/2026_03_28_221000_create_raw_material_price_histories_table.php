<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('raw_material_price_histories', function (Blueprint $table) {
            $table->id();
            $table->foreignId('raw_material_id')->constrained('raw_materials')->cascadeOnDelete();
            $table->foreignId('changed_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->decimal('previous_cost', 12, 2);
            $table->decimal('new_cost', 12, 2);
            $table->decimal('variation_amount', 12, 2);
            $table->decimal('variation_percent', 8, 2)->default(0);
            $table->dateTime('changed_at');
            $table->timestamps();

            $table->index(['raw_material_id', 'changed_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('raw_material_price_histories');
    }
};
