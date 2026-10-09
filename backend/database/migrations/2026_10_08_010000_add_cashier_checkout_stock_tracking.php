<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('checkout_source', 20)->default('legacy')->index();
            $table->uuid('checkout_token')->nullable()->unique();
            $table->json('stock_requirements')->nullable();
            $table->timestamp('stock_deducted_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropUnique(['checkout_token']);
            $table->dropIndex(['checkout_source']);
            $table->dropColumn(['checkout_source', 'checkout_token', 'stock_requirements', 'stock_deducted_at']);
        });
    }
};
