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
        if (!Schema::hasTable('cash_movements')) {
            return;
        }

        if (!Schema::hasColumn('cash_movements', 'movement_type')) {
            Schema::table('cash_movements', function (Blueprint $table) {
                $table->string('movement_type', 40)->nullable()->after('status');
            });
        }

        if (!Schema::hasColumn('cash_movements', 'source_account')) {
            Schema::table('cash_movements', function (Blueprint $table) {
                $table->string('source_account', 40)->nullable()->after('payment_method');
            });
        }

        if (!Schema::hasColumn('cash_movements', 'destination_account')) {
            Schema::table('cash_movements', function (Blueprint $table) {
                $table->string('destination_account', 40)->nullable()->after('source_account');
            });
        }

        Schema::table('cash_movements', function (Blueprint $table) {
            $table->index('movement_type');
            $table->index('source_account');
            $table->index('destination_account');
        });

        DB::table('cash_movements')
            ->select(['id', 'direction', 'payment_method'])
            ->orderBy('id')
            ->chunk(200, function ($rows) {
                foreach ($rows as $row) {
                    $direction = strtolower(trim((string) ($row->direction ?? '')));
                    $paymentMethod = strtolower(trim((string) ($row->payment_method ?? '')));

                    $sourceAccount = $direction === 'out' ? CashMovement::ACCOUNT_CASH : null;
                    $destinationAccount = $direction === 'in'
                        ? CashMovement::accountFromPaymentMethod($paymentMethod)
                        : null;
                    $movementType = $direction === 'in' ? 'sale' : 'withdrawal';

                    DB::table('cash_movements')
                        ->where('id', (int) $row->id)
                        ->update([
                            'movement_type' => $movementType,
                            'source_account' => $sourceAccount,
                            'destination_account' => $destinationAccount,
                        ]);
                }
            });
    }

    public function down(): void
    {
        if (!Schema::hasTable('cash_movements')) {
            return;
        }

        Schema::table('cash_movements', function (Blueprint $table) {
            if (Schema::hasColumn('cash_movements', 'destination_account')) {
                $table->dropIndex(['destination_account']);
                $table->dropColumn('destination_account');
            }

            if (Schema::hasColumn('cash_movements', 'source_account')) {
                $table->dropIndex(['source_account']);
                $table->dropColumn('source_account');
            }

            if (Schema::hasColumn('cash_movements', 'movement_type')) {
                $table->dropIndex(['movement_type']);
                $table->dropColumn('movement_type');
            }
        });
    }
};
