<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (Schema::hasTable('cash_movements')) {
            return;
        }

        Schema::create('cash_movements', function (Blueprint $table) {
            $table->id();
            $table->enum('direction', ['in', 'out']);
            $table->enum('status', ['pending', 'approved', 'rejected'])->default('pending');
            $table->decimal('amount', 12, 2);
            $table->enum('payment_method', ['cash', 'card', 'mobile_money', 'transfer', 'check'])->nullable();
            $table->string('description', 255)->nullable();
            $table->text('reason')->nullable();
            $table->foreignId('requested_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('approved_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('payment_id')->nullable()->constrained('payments')->nullOnDelete();
            $table->foreignId('order_id')->nullable()->constrained('orders')->nullOnDelete();
            $table->json('metadata')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->timestamp('rejected_at')->nullable();
            $table->timestamps();

            $table->index(['direction', 'status']);
            $table->index('created_at');
            $table->index('payment_method');
        });

        if (Schema::hasTable('payments') && Schema::hasTable('orders')) {
            DB::table('payments')
                ->leftJoin('orders', 'orders.id', '=', 'payments.order_id')
                ->where('payments.status', 'completed')
                ->select([
                    'payments.id as payment_id',
                    'payments.order_id',
                    'payments.amount',
                    'payments.method',
                    'payments.discount_percent',
                    'payments.discount_amount',
                    'payments.created_at as paid_at',
                    'orders.user_id as cashier_user_id',
                ])
                ->orderBy('payments.id')
                ->chunk(200, function ($rows) {
                    $payload = [];

                    foreach ($rows as $row) {
                        $payload[] = [
                            'direction' => 'in',
                            'status' => 'approved',
                            'amount' => (float) ($row->amount ?? 0),
                            'payment_method' => (string) ($row->method ?? 'cash'),
                            'description' => 'Encaissement commande #' . ((int) ($row->order_id ?? 0)),
                            'reason' => 'Historique migration paiements.',
                            'requested_by_user_id' => $row->cashier_user_id ? (int) $row->cashier_user_id : null,
                            'approved_by_user_id' => $row->cashier_user_id ? (int) $row->cashier_user_id : null,
                            'payment_id' => (int) ($row->payment_id ?? 0),
                            'order_id' => $row->order_id ? (int) $row->order_id : null,
                            'metadata' => json_encode([
                                'source' => 'migration_payment_backfill',
                                'discount_percent' => (int) ($row->discount_percent ?? 0),
                                'discount_amount' => round((float) ($row->discount_amount ?? 0), 2),
                            ]),
                            'approved_at' => $row->paid_at ?? now(),
                            'rejected_at' => null,
                            'created_at' => $row->paid_at ?? now(),
                            'updated_at' => $row->paid_at ?? now(),
                        ];
                    }

                    if (!empty($payload)) {
                        DB::table('cash_movements')->insert($payload);
                    }
                });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasTable('cash_movements')) {
            Schema::drop('cash_movements');
        }
    }
};
