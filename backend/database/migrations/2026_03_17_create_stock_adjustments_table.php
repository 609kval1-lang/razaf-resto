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
        Schema::create('stock_adjustments', function (Blueprint $table) {
            $table->id();
            $table->morphs('adjustable'); // Peut être Product ou Ingredient
            $table->unsignedBigInteger('user_id')->nullable();
            $table->enum('type', ['ingredient', 'product']);
            $table->decimal('quantity', 10, 2);
            $table->string('reason'); // restock, damage, loss, usage, return, correction
            $table->text('notes')->nullable();
            $table->decimal('old_stock', 10, 2);
            $table->decimal('new_stock', 10, 2);
            $table->timestamps();

            $table->foreign('user_id')->references('id')->on('users')->onDelete('set null');
            $table->index('adjustable_type');
            $table->index('adjustable_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('stock_adjustments');
    }
};
