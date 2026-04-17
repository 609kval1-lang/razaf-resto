<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Create ingredients table
     */
    public function up(): void
    {
        Schema::create('ingredients', function (Blueprint $table) {
            $table->id();
            $table->string('name'); // ex: "Pâtes", "Sauce Bolognaise"
            $table->text('description')->nullable();
            $table->decimal('cost', 10, 2)->default(0); // Coût unitaire
            $table->decimal('stock', 10, 2)->default(0); // Stock en kg/L/unité
            $table->string('unit')->default('unit'); // unit, kg, L, pcs, etc
            $table->decimal('reorder_level', 10, 2)->default(5); // Niveau de réapprovisionnement
            $table->timestamps();
            $table->index('name');
        });

        // Pivot table produits-ingrédients
        Schema::create('product_ingredients', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained()->onDelete('cascade');
            $table->foreignId('ingredient_id')->constrained()->onDelete('cascade');
            $table->decimal('quantity_needed', 10, 2); // Quantité nécessaire
            $table->timestamps();
            $table->unique(['product_id', 'ingredient_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('product_ingredients');
        Schema::dropIfExists('ingredients');
    }
};
