<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (!Schema::hasColumn('orders', 'bill_requested_at')) {
                $table->dateTime('bill_requested_at')->nullable()->after('served_at');
            }

            if (!Schema::hasColumn('orders', 'bill_requested_by_user_id')) {
                $table->foreignId('bill_requested_by_user_id')
                    ->nullable()
                    ->after('bill_requested_at')
                    ->constrained('users')
                    ->nullOnDelete();
            }
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (Schema::hasColumn('orders', 'bill_requested_by_user_id')) {
                $table->dropConstrainedForeignId('bill_requested_by_user_id');
            }

            if (Schema::hasColumn('orders', 'bill_requested_at')) {
                $table->dropColumn('bill_requested_at');
            }
        });
    }
};
