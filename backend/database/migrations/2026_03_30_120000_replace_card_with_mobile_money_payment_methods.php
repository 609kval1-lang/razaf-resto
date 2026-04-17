<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $driver = DB::getDriverName();
        $isMysql = in_array($driver, ['mysql', 'mariadb'], true);

        if ($isMysql) {
            if (Schema::hasTable('payments') && Schema::hasColumn('payments', 'method')) {
                DB::statement("ALTER TABLE payments MODIFY method ENUM('cash','card','mobile_money','transfer','check') NOT NULL DEFAULT 'cash'");
            }

            if (Schema::hasTable('supplier_purchase_payments') && Schema::hasColumn('supplier_purchase_payments', 'method')) {
                DB::statement("ALTER TABLE supplier_purchase_payments MODIFY method ENUM('cash','card','mobile_money','transfer','check') NOT NULL DEFAULT 'cash'");
            }

            if (Schema::hasTable('cash_movements') && Schema::hasColumn('cash_movements', 'payment_method')) {
                DB::statement("ALTER TABLE cash_movements MODIFY payment_method ENUM('cash','card','mobile_money','transfer','check') NULL");
            }
        }

        if (Schema::hasTable('payments') && Schema::hasColumn('payments', 'method')) {
            DB::table('payments')->where('method', 'card')->update(['method' => 'mobile_money']);
        }

        if (Schema::hasTable('supplier_purchase_payments') && Schema::hasColumn('supplier_purchase_payments', 'method')) {
            DB::table('supplier_purchase_payments')->where('method', 'card')->update(['method' => 'mobile_money']);
        }

        if (Schema::hasTable('cash_movements') && Schema::hasColumn('cash_movements', 'payment_method')) {
            DB::table('cash_movements')->where('payment_method', 'card')->update(['payment_method' => 'mobile_money']);
        }

        if (!$isMysql) {
            return;
        }

        if (Schema::hasTable('payments') && Schema::hasColumn('payments', 'method')) {
            DB::statement("ALTER TABLE payments MODIFY method ENUM('cash','mobile_money','transfer','check') NOT NULL DEFAULT 'cash'");
        }

        if (Schema::hasTable('supplier_purchase_payments') && Schema::hasColumn('supplier_purchase_payments', 'method')) {
            DB::statement("ALTER TABLE supplier_purchase_payments MODIFY method ENUM('cash','mobile_money','transfer','check') NOT NULL DEFAULT 'cash'");
        }

        if (Schema::hasTable('cash_movements') && Schema::hasColumn('cash_movements', 'payment_method')) {
            DB::statement("ALTER TABLE cash_movements MODIFY payment_method ENUM('cash','mobile_money','transfer','check') NULL");
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('payments') && Schema::hasColumn('payments', 'method')) {
            DB::table('payments')->where('method', 'mobile_money')->update(['method' => 'card']);
        }

        if (Schema::hasTable('supplier_purchase_payments') && Schema::hasColumn('supplier_purchase_payments', 'method')) {
            DB::table('supplier_purchase_payments')->where('method', 'mobile_money')->update(['method' => 'card']);
        }

        if (Schema::hasTable('cash_movements') && Schema::hasColumn('cash_movements', 'payment_method')) {
            DB::table('cash_movements')->where('payment_method', 'mobile_money')->update(['payment_method' => 'card']);
        }

        $driver = DB::getDriverName();
        if (!in_array($driver, ['mysql', 'mariadb'], true)) {
            return;
        }

        if (Schema::hasTable('payments') && Schema::hasColumn('payments', 'method')) {
            DB::statement("ALTER TABLE payments MODIFY method ENUM('cash','card','transfer','check') NOT NULL DEFAULT 'cash'");
        }

        if (Schema::hasTable('supplier_purchase_payments') && Schema::hasColumn('supplier_purchase_payments', 'method')) {
            DB::statement("ALTER TABLE supplier_purchase_payments MODIFY method ENUM('cash','card','transfer','check') NOT NULL DEFAULT 'cash'");
        }

        if (Schema::hasTable('cash_movements') && Schema::hasColumn('cash_movements', 'payment_method')) {
            DB::statement("ALTER TABLE cash_movements MODIFY payment_method ENUM('cash','card','transfer','check') NULL");
        }
    }
};
