<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            if (!Schema::hasColumn('customers', 'preferred_cooking')) {
                $table->string('preferred_cooking', 120)->nullable()->after('notes');
            }

            if (!Schema::hasColumn('customers', 'allergies')) {
                $table->text('allergies')->nullable()->after('preferred_cooking');
            }
        });
    }

    public function down(): void
    {
        Schema::table('customers', function (Blueprint $table) {
            if (Schema::hasColumn('customers', 'allergies')) {
                $table->dropColumn('allergies');
            }

            if (Schema::hasColumn('customers', 'preferred_cooking')) {
                $table->dropColumn('preferred_cooking');
            }
        });
    }
};

