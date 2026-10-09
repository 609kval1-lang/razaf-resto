<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->string('order_label', 120)->nullable();
            $table->json('linked_table_ids')->nullable();
            $table->json('source_order_ids')->nullable();
        });
        Schema::table('order_items', function (Blueprint $table) {
            $table->json('stock_requirements')->nullable();
            $table->unsignedBigInteger('source_table_id')->nullable();
        });
        Schema::table('payments', function (Blueprint $table) {
            $table->unsignedInteger('deposit_amount')->default(0);
        });
        Schema::create('reservation_deposits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('table_id')->nullable()->constrained('tables');
            $table->string('customer_name', 120);
            $table->timestamp('reservation_at')->nullable();
            $table->unsignedInteger('amount');
            $table->string('method', 20);
            $table->string('reference')->nullable();
            $table->foreignId('cash_movement_id')->constrained('cash_movements');
            $table->foreignId('received_by_user_id')->constrained('users');
            $table->uuid('receipt_token')->unique();
            $table->timestamps();
        });
        Schema::create('reservation_deposit_applications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('deposit_id')->constrained('reservation_deposits');
            $table->foreignId('payment_id')->constrained('payments');
            $table->unsignedInteger('amount');
            $table->timestamp('applied_at')->nullable();
            $table->timestamps();
            $table->unique(['deposit_id', 'payment_id'], 'deposit_payment_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('reservation_deposit_applications');
        Schema::dropIfExists('reservation_deposits');
        Schema::table('payments', fn (Blueprint $table) => $table->dropColumn('deposit_amount'));
        Schema::table('order_items', fn (Blueprint $table) => $table->dropColumn(['stock_requirements', 'source_table_id']));
        Schema::table('orders', fn (Blueprint $table) => $table->dropColumn(['order_label', 'linked_table_ids', 'source_order_ids']));
    }
};
