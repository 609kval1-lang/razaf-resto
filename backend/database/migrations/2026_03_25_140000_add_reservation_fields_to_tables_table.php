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
        Schema::table('tables', function (Blueprint $table) {
            if (!Schema::hasColumn('tables', 'reservation_name')) {
                $table->string('reservation_name', 120)->nullable()->after('status');
            }

            if (!Schema::hasColumn('tables', 'reservation_phone')) {
                $table->string('reservation_phone', 40)->nullable()->after('reservation_name');
            }

            if (!Schema::hasColumn('tables', 'reservation_at')) {
                $table->dateTime('reservation_at')->nullable()->after('reservation_phone');
            }

            if (!Schema::hasColumn('tables', 'reservation_notes')) {
                $table->text('reservation_notes')->nullable()->after('reservation_at');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('tables', function (Blueprint $table) {
            if (Schema::hasColumn('tables', 'reservation_notes')) {
                $table->dropColumn('reservation_notes');
            }

            if (Schema::hasColumn('tables', 'reservation_at')) {
                $table->dropColumn('reservation_at');
            }

            if (Schema::hasColumn('tables', 'reservation_phone')) {
                $table->dropColumn('reservation_phone');
            }

            if (Schema::hasColumn('tables', 'reservation_name')) {
                $table->dropColumn('reservation_name');
            }
        });
    }
};
