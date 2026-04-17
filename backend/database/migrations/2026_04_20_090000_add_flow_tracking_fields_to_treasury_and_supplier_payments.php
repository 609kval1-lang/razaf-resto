<?php

use App\Models\CashMovement;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('supplier_purchase_payments') && !Schema::hasColumn('supplier_purchase_payments', 'source_account')) {
            Schema::table('supplier_purchase_payments', function (Blueprint $table) {
                $table->string('source_account', 40)->nullable()->after('method');
                $table->index('source_account', 'supplier_purchase_payments_source_account_idx');
            });

            DB::table('supplier_purchase_payments')
                ->select(['id', 'method'])
                ->orderBy('id')
                ->chunk(200, function ($rows) {
                    foreach ($rows as $row) {
                        $method = strtolower(trim((string) ($row->method ?? '')));
                        $sourceAccount = match ($method) {
                            'transfer', 'check' => CashMovement::ACCOUNT_BANK,
                            'mobile_money', 'card' => CashMovement::ACCOUNT_MOBILE_MONEY,
                            default => CashMovement::ACCOUNT_CASH,
                        };

                        DB::table('supplier_purchase_payments')
                            ->where('id', (int) $row->id)
                            ->update(['source_account' => $sourceAccount]);
                    }
                });
        }

        if (!Schema::hasTable('cash_movements')) {
            return;
        }

        Schema::table('cash_movements', function (Blueprint $table) {
            if (!Schema::hasColumn('cash_movements', 'flow_type')) {
                $table->string('flow_type', 60)->nullable()->after('movement_type');
            }

            if (!Schema::hasColumn('cash_movements', 'supplier_purchase_id')) {
                $table->foreignId('supplier_purchase_id')
                    ->nullable()
                    ->after('order_id')
                    ->constrained('supplier_purchases')
                    ->nullOnDelete();
            }

            if (!Schema::hasColumn('cash_movements', 'supplier_purchase_payment_id')) {
                $table->foreignId('supplier_purchase_payment_id')
                    ->nullable()
                    ->after('supplier_purchase_id')
                    ->constrained('supplier_purchase_payments')
                    ->nullOnDelete();
            }
        });

        Schema::table('cash_movements', function (Blueprint $table) {
            $table->index('flow_type', 'cash_movements_flow_type_idx');
        });

        DB::table('cash_movements')
            ->select(['id', 'direction', 'movement_type', 'payment_method', 'metadata'])
            ->orderBy('id')
            ->chunk(200, function ($rows) {
                foreach ($rows as $row) {
                    $metadata = json_decode((string) ($row->metadata ?? 'null'), true);
                    $metadata = is_array($metadata) ? $metadata : [];
                    $direction = strtolower(trim((string) ($row->direction ?? '')));
                    $movementType = strtolower(trim((string) ($row->movement_type ?? '')));
                    $paymentMethod = strtolower(trim((string) ($row->payment_method ?? '')));
                    $source = strtolower(trim((string) ($metadata['source'] ?? '')));
                    $initialMethod = strtolower(trim((string) ($metadata['initial_method'] ?? '')));

                    $flowType = match (true) {
                        $source === 'supplier_payment' => 'supplier_payment',
                        $source === 'admin_treasury_transfer' || $movementType === 'transfer' => 'treasury_transfer',
                        $source === 'cashier_request' => 'cash_withdrawal_request',
                        $source === 'admin_exception' => 'cash_withdrawal',
                        $source === 'admin_treasury_withdrawal' => 'treasury_withdrawal',
                        $source === 'payment' && $initialMethod === 'bon' => 'customer_voucher_settlement',
                        $source === 'payment' || ($direction === 'in' && in_array($paymentMethod, ['cash', 'mobile_money', 'transfer', 'check'], true)) => 'customer_payment',
                        $direction === 'in' => 'customer_payment',
                        default => 'treasury_withdrawal',
                    };

                    DB::table('cash_movements')
                        ->where('id', (int) $row->id)
                        ->update([
                            'flow_type' => $flowType,
                            'supplier_purchase_id' => isset($metadata['supplier_purchase_id']) ? (int) $metadata['supplier_purchase_id'] : null,
                            'supplier_purchase_payment_id' => isset($metadata['supplier_purchase_payment_id']) ? (int) $metadata['supplier_purchase_payment_id'] : null,
                        ]);
                }
            });
    }

    public function down(): void
    {
        if (Schema::hasTable('cash_movements')) {
            Schema::table('cash_movements', function (Blueprint $table) {
                if (Schema::hasColumn('cash_movements', 'supplier_purchase_payment_id')) {
                    $table->dropConstrainedForeignId('supplier_purchase_payment_id');
                }

                if (Schema::hasColumn('cash_movements', 'supplier_purchase_id')) {
                    $table->dropConstrainedForeignId('supplier_purchase_id');
                }

                if (Schema::hasColumn('cash_movements', 'flow_type')) {
                    $table->dropIndex('cash_movements_flow_type_idx');
                    $table->dropColumn('flow_type');
                }
            });
        }

        if (Schema::hasTable('supplier_purchase_payments') && Schema::hasColumn('supplier_purchase_payments', 'source_account')) {
            Schema::table('supplier_purchase_payments', function (Blueprint $table) {
                $table->dropIndex('supplier_purchase_payments_source_account_idx');
                $table->dropColumn('source_account');
            });
        }
    }
};
