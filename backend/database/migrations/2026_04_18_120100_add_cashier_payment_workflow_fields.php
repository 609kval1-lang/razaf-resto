<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            if (!Schema::hasColumn('orders', 'occupies_table')) {
                $table->boolean('occupies_table')->default(true)->after('paid_at');
            }
        });

        Schema::table('payments', function (Blueprint $table) {
            if (!Schema::hasColumn('payments', 'settlement_method')) {
                $table->string('settlement_method', 40)->nullable()->after('method');
            }

            if (!Schema::hasColumn('payments', 'printed_at')) {
                $table->dateTime('printed_at')->nullable()->after('reference');
            }

            if (!Schema::hasColumn('payments', 'encashed_at')) {
                $table->dateTime('encashed_at')->nullable()->after('printed_at');
            }
        });

        $driver = DB::getDriverName();
        if (in_array($driver, ['mysql', 'mariadb'], true) && Schema::hasColumn('payments', 'method')) {
            DB::statement("ALTER TABLE payments MODIFY method ENUM('cash','mobile_money','transfer','check','bon') NOT NULL DEFAULT 'cash'");
        }

        if (Schema::hasColumn('orders', 'occupies_table')) {
            DB::table('orders')
                ->whereNull('table_id')
                ->update(['occupies_table' => false]);

            DB::table('orders')
                ->whereIn('status', ['paid', 'archived'])
                ->update(['occupies_table' => false]);
        }

        if (Schema::hasColumn('payments', 'printed_at')) {
            DB::table('payments')
                ->whereNull('printed_at')
                ->update(['printed_at' => DB::raw('created_at')]);
        }

        if (Schema::hasColumn('payments', 'settlement_method')) {
            DB::table('payments')
                ->where('status', 'completed')
                ->whereNull('settlement_method')
                ->update(['settlement_method' => DB::raw('method')]);
        }

        if (Schema::hasColumn('payments', 'encashed_at')) {
            DB::table('payments')
                ->where('status', 'completed')
                ->whereNull('encashed_at')
                ->update(['encashed_at' => DB::raw('created_at')]);
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('payments', 'encashed_at')) {
            Schema::table('payments', function (Blueprint $table) {
                $table->dropColumn('encashed_at');
            });
        }

        if (Schema::hasColumn('payments', 'printed_at')) {
            Schema::table('payments', function (Blueprint $table) {
                $table->dropColumn('printed_at');
            });
        }

        if (Schema::hasColumn('payments', 'settlement_method')) {
            Schema::table('payments', function (Blueprint $table) {
                $table->dropColumn('settlement_method');
            });
        }

        if (Schema::hasColumn('orders', 'occupies_table')) {
            Schema::table('orders', function (Blueprint $table) {
                $table->dropColumn('occupies_table');
            });
        }

        $driver = DB::getDriverName();
        if (!in_array($driver, ['mysql', 'mariadb'], true) || !Schema::hasColumn('payments', 'method')) {
            return;
        }

        DB::table('payments')
            ->where('method', 'bon')
            ->update(['method' => 'check']);

        DB::statement("ALTER TABLE payments MODIFY method ENUM('cash','mobile_money','transfer','check') NOT NULL DEFAULT 'cash'");
    }
};
