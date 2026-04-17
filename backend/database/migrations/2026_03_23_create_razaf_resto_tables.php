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
        // Supprime les tables conflictuelles créées par des migrations précédentes
        $tablesToDrop = [
            'action_logs',
            'payments',
            'order_items',
            'orders',
            'customers',
            'tables',
            'menu_ingredients',
            'menus',
            'product_ingredients',
            'ingredients',
            'raw_materials',
        ];

        foreach ($tablesToDrop as $tableName) {
            if (Schema::hasTable($tableName)) {
                Schema::dropIfExists($tableName);
            }
        }

        // ============ MATIÈRES PREMIÈRES BRUTES (CONGÉLATEUR) ============
        Schema::create('raw_materials', function (Blueprint $table) {
            $table->id();
            $table->string('name'); // Riz, Poulet, Sauce soja
            $table->text('description')->nullable();
            $table->decimal('stock', 12, 2); // Quantité disponible
            $table->string('unit'); // kg, L, pcs, etc.
            $table->decimal('cost', 8, 2); // Coût unitaire
            $table->decimal('reorder_level', 12, 2)->default(5); // Niveau de réapprovisionnement
            $table->timestamps();
            $table->softDeletes();
        });

        // ============ INGRÉDIENTS PORTIONNÉS (FRIGO) ============
        Schema::create('ingredients', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('raw_material_id'); // Relation avec stock brut
            $table->string('name'); // "100g Riz" ou "Poulet 150g"
            $table->decimal('portion_size', 8, 2); // 100g, 150g, etc.
            $table->string('portion_unit'); // g, ml, pcs
            $table->integer('quantity_available')->default(0); // Nombre de portions dispo
            $table->decimal('cost_per_portion', 8, 2); // Prix par portion
            $table->timestamps();
            $table->softDeletes();

            $table->foreign('raw_material_id')
                ->references('id')
                ->on('raw_materials')
                ->onDelete('cascade');
        });

        // ============ MENUS/PLATS ============
        Schema::create('menus', function (Blueprint $table) {
            $table->id();
            $table->string('name'); // "Riz Poulet", "Riz Légumes"
            $table->text('description')->nullable();
            $table->decimal('price', 8, 2); // Prix du plat
            $table->string('category')->nullable(); // Entrée, Plat, Dessert
            $table->boolean('is_available')->default(true);
            $table->timestamps();
            $table->softDeletes();
        });

        // ============ COMPOSITION DES MENUS (Recettes) ============
        Schema::create('menu_ingredients', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('menu_id');
            $table->unsignedBigInteger('ingredient_id');
            $table->integer('quantity_needed'); // Nombre de portions de cet ingrédient
            $table->timestamps();

            $table->foreign('menu_id')
                ->references('id')
                ->on('menus')
                ->onDelete('cascade');
            $table->foreign('ingredient_id')
                ->references('id')
                ->on('ingredients')
                ->onDelete('cascade');
        });

        // ============ TABLES DU RESTAURANT ============
        Schema::create('tables', function (Blueprint $table) {
            $table->id();
            $table->integer('table_number'); // 1, 2, 3, etc.
            $table->integer('capacity'); // Nombre de places (2, 4, 6, etc.)
            $table->string('section')->nullable(); // "Terrasse", "Intérieur", etc.
            $table->enum('status', ['free', 'occupied', 'reserved'])->default('free');
            $table->timestamps();
            $table->softDeletes();
        });

        // ============ CLIENTS FIDÈLES ============
        Schema::create('customers', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('phone')->nullable();
            $table->string('email')->nullable();
            $table->decimal('loyalty_points', 8, 2)->default(0);
            $table->text('notes')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });

        // ============ COMMANDES ============
        Schema::create('orders', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id'); // Serveur qui crée la commande
            $table->unsignedBigInteger('table_id')->nullable(); // Table du restaurant
            $table->unsignedBigInteger('customer_id')->nullable(); // Client fidèle
            $table->decimal('total_amount', 10, 2)->default(0);
            $table->enum('status', [
                'pending',      // En attente cuisine
                'in_kitchen',   // En préparation
                'ready',        // Prêt à servir
                'served',       // Servi à la table
                'paid',         // Payé
                'archived'      // Archivé
            ])->default('pending');
            $table->text('special_requests')->nullable();
            $table->boolean('is_urgent')->default(false);
            $table->timestamp('prepared_at')->nullable();
            $table->timestamp('ready_at')->nullable();
            $table->timestamp('served_at')->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->foreign('user_id')
                ->references('id')
                ->on('users')
                ->onDelete('cascade');
            $table->foreign('table_id')
                ->references('id')
                ->on('tables')
                ->onDelete('set null');
            $table->foreign('customer_id')
                ->references('id')
                ->on('customers')
                ->onDelete('set null');
        });

        // ============ DÉTAILS COMMANDES ============
        Schema::create('order_items', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('order_id');
            $table->unsignedBigInteger('menu_id');
            $table->integer('quantity');
            $table->decimal('price_at_order', 8, 2); // Prix au moment de la commande
            $table->enum('status', [
                'pending',
                'in_kitchen',
                'ready',
                'served',
                'cancelled'
            ])->default('pending');
            $table->timestamps();

            $table->foreign('order_id')
                ->references('id')
                ->on('orders')
                ->onDelete('cascade');
            $table->foreign('menu_id')
                ->references('id')
                ->on('menus')
                ->onDelete('restrict');
        });

        // ============ PAIEMENTS ============
        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('order_id');
            $table->decimal('amount', 10, 2);
            $table->enum('method', ['cash', 'card', 'mobile_money', 'transfer', 'check', 'bon'])->default('cash');
            $table->enum('status', ['pending', 'completed', 'refunded'])->default('pending');
            $table->string('reference')->nullable(); // Numéro de transaction
            $table->timestamps();

            $table->foreign('order_id')
                ->references('id')
                ->on('orders')
                ->onDelete('cascade');
        });

        // ============ AUDIT DES ACTIONS ============
        Schema::create('action_logs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id');
            $table->string('action'); // "order_created", "ingredient_updated", etc.
            $table->string('entity_type'); // "Order", "Ingredient", etc.
            $table->unsignedBigInteger('entity_id')->nullable();
            $table->text('changes')->nullable(); // JSON des changements
            $table->timestamp('action_at')->useCurrent();

            $table->foreign('user_id')
                ->references('id')
                ->on('users')
                ->onDelete('cascade');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('action_logs');
        Schema::dropIfExists('payments');
        Schema::dropIfExists('order_items');
        Schema::dropIfExists('orders');
        Schema::dropIfExists('customers');
        Schema::dropIfExists('tables');
        Schema::dropIfExists('menu_ingredients');
        Schema::dropIfExists('menus');
        Schema::dropIfExists('ingredients');
        Schema::dropIfExists('raw_materials');
    }
};
