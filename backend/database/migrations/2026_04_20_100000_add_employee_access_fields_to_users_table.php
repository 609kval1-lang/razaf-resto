<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('users')) {
            return;
        }

        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'has_system_access')) {
                $table->boolean('has_system_access')->default(true)->after('role');
            }

            if (!Schema::hasColumn('users', 'job_title')) {
                $table->string('job_title', 120)->nullable()->after('has_system_access');
            }

            if (!Schema::hasColumn('users', 'employment_status')) {
                $table->string('employment_status', 40)->default('active')->after('job_title');
            }
        });

        DB::table('users')
            ->whereNull('role')
            ->update(['role' => 'employee']);

        $driver = DB::getDriverName();
        if (in_array($driver, ['mysql', 'mariadb'], true)) {
            DB::statement('ALTER TABLE users MODIFY email VARCHAR(255) NULL');
            DB::statement('ALTER TABLE users MODIFY password VARCHAR(255) NULL');
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('users')) {
            return;
        }

        $driver = DB::getDriverName();
        if (in_array($driver, ['mysql', 'mariadb'], true)) {
            DB::statement("UPDATE users SET email = CONCAT('employee-', id, '@local.invalid') WHERE email IS NULL");
            DB::statement("UPDATE users SET password = '' WHERE password IS NULL");
            DB::statement('ALTER TABLE users MODIFY email VARCHAR(255) NOT NULL');
            DB::statement('ALTER TABLE users MODIFY password VARCHAR(255) NOT NULL');
        }

        Schema::table('users', function (Blueprint $table) {
            if (Schema::hasColumn('users', 'employment_status')) {
                $table->dropColumn('employment_status');
            }

            if (Schema::hasColumn('users', 'job_title')) {
                $table->dropColumn('job_title');
            }

            if (Schema::hasColumn('users', 'has_system_access')) {
                $table->dropColumn('has_system_access');
            }
        });
    }
};
