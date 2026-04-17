<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('employee_salary_profiles')) {
            Schema::create('employee_salary_profiles', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
                $table->decimal('monthly_salary', 12, 2)->default(0);
                $table->unsignedTinyInteger('payment_day')->nullable();
                $table->boolean('is_active')->default(true);
                $table->text('notes')->nullable();
                $table->timestamps();

                $table->unique('user_id');
            });
        }

        if (!Schema::hasTable('employee_payroll_transactions')) {
            Schema::create('employee_payroll_transactions', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
                $table->foreignId('salary_profile_id')->nullable()->constrained('employee_salary_profiles')->nullOnDelete();
                $table->string('transaction_type', 40);
                $table->decimal('gross_amount', 12, 2)->default(0);
                $table->decimal('advance_deduction_amount', 12, 2)->default(0);
                $table->decimal('net_amount', 12, 2)->default(0);
                $table->string('payment_method', 40)->nullable();
                $table->string('source_account', 40)->nullable();
                $table->date('payroll_month')->nullable();
                $table->string('reference', 120)->nullable();
                $table->text('note')->nullable();
                $table->dateTime('paid_at');
                $table->foreignId('cash_movement_id')->nullable()->constrained('cash_movements')->nullOnDelete();
                $table->foreignId('created_by_user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->json('metadata')->nullable();
                $table->timestamps();

                $table->index(['user_id', 'transaction_type']);
                $table->index('payroll_month');
            });
        }

        if (!Schema::hasTable('employee_advance_settlements')) {
            Schema::create('employee_advance_settlements', function (Blueprint $table) {
                $table->id();
                $table->foreignId('advance_transaction_id')
                    ->constrained('employee_payroll_transactions')
                    ->cascadeOnDelete();
                $table->foreignId('salary_transaction_id')
                    ->constrained('employee_payroll_transactions')
                    ->cascadeOnDelete();
                $table->decimal('amount', 12, 2);
                $table->timestamps();

                $table->index(['advance_transaction_id', 'salary_transaction_id'], 'employee_advance_settlements_pair_idx');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('employee_advance_settlements')) {
            Schema::drop('employee_advance_settlements');
        }

        if (Schema::hasTable('employee_payroll_transactions')) {
            Schema::drop('employee_payroll_transactions');
        }

        if (Schema::hasTable('employee_salary_profiles')) {
            Schema::drop('employee_salary_profiles');
        }
    }
};
