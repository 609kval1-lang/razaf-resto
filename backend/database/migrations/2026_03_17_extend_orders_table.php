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
            // Remplacer status string par enum
            $table->dropColumn('status');
            $table->enum('status', ['pending', 'preparing', 'ready', 'served', 'cancelled'])->default('pending')->after('total_amount');

            // Ajouter les champs pour notes et urgence
            $table->text('special_requests')->nullable()->after('status');
            $table->boolean('is_urgent')->default(false)->after('special_requests');

            // Timestamps pour suivi du workflow
            $table->timestamp('prepared_at')->nullable()->after('is_urgent');
            $table->timestamp('ready_at')->nullable()->after('prepared_at');
            $table->timestamp('served_at')->nullable()->after('ready_at');

            // Raison d'annulation si applicable
            $table->text('cancellation_reason')->nullable()->after('served_at');

            // Index pour les requêtes rapides
            $table->index('status');
            $table->index('is_urgent');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropIndex(['status']);
            $table->dropIndex(['is_urgent']);
            $table->dropColumn(['status', 'special_requests', 'is_urgent', 'prepared_at', 'ready_at', 'served_at', 'cancellation_reason']);
            $table->string('status')->default('confirmed');
        });
    }
};
