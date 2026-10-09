<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\SupplierController;
use App\Http\Controllers\Api\AdminController;
use App\Http\Controllers\Api\CashMovementController;
use App\Http\Controllers\Api\EmployeePayrollController;
use App\Http\Controllers\Api\CashierController;
use App\Http\Controllers\Api\CashierOrderEntryController;
use App\Http\Controllers\Api\CashierAdditionController;
use App\Http\Controllers\Api\ReservationDepositController;
use App\Http\Controllers\Api\PublicMediaController;

Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:5,1');
Route::get('/media/public/{path}', [PublicMediaController::class, 'showPublicStorageFile'])
    ->where('path', '.*');

Route::middleware('auth:sanctum')->group(function () {

    Route::get('/user', function (Request $request) {
        abort_unless(in_array($request->user()->role, ['admin', 'cashier'], true), 403, 'Ce role est archive.');
        return $request->user();
    });
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::put('/auth/password', [AuthController::class, 'changePassword']);

    Route::middleware('role:admin')->group(function () {

        Route::get('/admin/users', [AdminController::class, 'listUsers']);
        Route::get('/admin/summary', [AdminController::class, 'getSummary']);
        Route::post('/admin/users', [AdminController::class, 'createUser']);
        Route::put('/admin/users/{user}', [AdminController::class, 'updateUser']);
        Route::delete('/admin/users/{user}', [AdminController::class, 'deleteUser']);

        Route::get('/admin/tables', [AdminController::class, 'listTables']);
        Route::post('/admin/tables', [AdminController::class, 'createTable']);
        Route::put('/admin/tables/{table}', [AdminController::class, 'updateTable']);
        Route::delete('/admin/tables/{table}', [AdminController::class, 'deleteTable']);

        Route::get('/admin/raw-materials', [AdminController::class, 'listRawMaterials']);
        Route::get('/admin/raw-materials/price-variations', [AdminController::class, 'getRawMaterialPriceVariations']);
        Route::post('/admin/raw-materials', [AdminController::class, 'createRawMaterial']);
        Route::put('/admin/raw-materials/{rawMaterial}', [AdminController::class, 'updateRawMaterial']);
        Route::delete('/admin/raw-materials/{rawMaterial}', [AdminController::class, 'deleteRawMaterial']);

        Route::get('/admin/ingredients', [AdminController::class, 'listIngredients']);
        Route::post('/admin/ingredients', [AdminController::class, 'createIngredient']);
        Route::put('/admin/ingredients/{ingredient}', [AdminController::class, 'updateIngredient']);
        Route::delete('/admin/ingredients/{ingredient}', [AdminController::class, 'deleteIngredient']);

        Route::get('/admin/menus', [AdminController::class, 'listMenus']);
        Route::post('/admin/menus', [AdminController::class, 'createMenu']);
        Route::put('/admin/menus/{menu}', [AdminController::class, 'updateMenu']);
        Route::delete('/admin/menus/{menu}', [AdminController::class, 'deleteMenu']);

        Route::get('/admin/revenue-report', [AdminController::class, 'getRevenueReport']);

        Route::get('/admin/cash-movements', [CashMovementController::class, 'adminIndex']);
        Route::get('/admin/treasury', [CashMovementController::class, 'adminTreasuryIndex']);
        Route::post('/admin/treasury/transfers', [CashMovementController::class, 'adminStoreTransfer']);
        Route::post('/admin/treasury/withdrawals', [CashMovementController::class, 'adminStoreAccountWithdrawal']);
        Route::post('/admin/orders/{order}/payment', [CashierController::class, 'processPayment']);
        Route::post('/admin/cash-movements/withdrawals/direct', [CashMovementController::class, 'adminStoreDirectWithdrawal']);
        Route::post('/admin/cash-movements/{movement}/approve', [CashMovementController::class, 'adminApprove']);
        Route::post('/admin/cash-movements/{movement}/reject', [CashMovementController::class, 'adminReject']);

        Route::get('/admin/employees/payroll', [EmployeePayrollController::class, 'index']);
        Route::put('/admin/employees/{user}/salary-profile', [EmployeePayrollController::class, 'upsertSalaryProfile']);
        Route::post('/admin/employees/{user}/payroll/advances', [EmployeePayrollController::class, 'storeAdvance']);
        Route::post('/admin/employees/{user}/payroll/salaries', [EmployeePayrollController::class, 'storeSalaryPayment']);

        Route::get('/admin/suppliers/payables/alerts', [SupplierController::class, 'getPayablesAlerts']);
        Route::get('/admin/suppliers/{supplier}/ledger', [SupplierController::class, 'getLedger']);
        Route::post('/admin/suppliers/{supplier}/purchases', [SupplierController::class, 'storePurchase']);
        Route::post('/admin/suppliers/{supplier}/purchases/{purchase}/payments', [SupplierController::class, 'addPurchasePayment']);
        Route::post('/admin/suppliers/{supplier}/purchases/settle-all', [SupplierController::class, 'settleAllOutstandingPurchases']);
        Route::get('/admin/suppliers', [SupplierController::class, 'index']);
        Route::post('/admin/suppliers', [SupplierController::class, 'store']);
        Route::put('/admin/suppliers/{supplier}', [SupplierController::class, 'update']);
        Route::delete('/admin/suppliers/{supplier}', [SupplierController::class, 'destroy']);
    });

    Route::middleware('role:cashier')->group(function () {
        Route::post('/cashier/order-entry/orders', [CashierOrderEntryController::class, 'store']);
        Route::post('/cashier/order-entry/redistribute', [CashierAdditionController::class, 'redistribute']);
        Route::get('/cashier/reservation-deposits', [ReservationDepositController::class, 'index']);
        Route::post('/cashier/reservation-deposits', [ReservationDepositController::class, 'store']);
        Route::get('/cashier/availability', [CashierOrderEntryController::class, 'availability']);
        Route::get('/cashier/order-entry/tables', [CashierOrderEntryController::class, 'tables']);
        Route::get('/cashier/order-entry/menus', [CashierOrderEntryController::class, 'menus']);
        Route::get('/cashier/orders', [CashierController::class, 'getReadyOrders']);
        Route::get('/cashier/customers', [CashierOrderEntryController::class, 'customers']);
        Route::post('/cashier/orders/{order}/prepare-payment', [CashierController::class, 'preparePayment']);
        Route::post('/cashier/orders/{order}/release-table', [CashierController::class, 'releaseVoucherTable']);
        Route::post('/cashier/orders/{order}/payment', [CashierController::class, 'processPayment']);
        Route::get('/cashier/stats', [CashierController::class, 'getDayStats']);
        Route::get('/cashier/invoice/{order}', [CashierController::class, 'generateInvoice']);
        Route::get('/cashier/history', [CashierController::class, 'getPaymentHistory']);
        Route::get('/cashier/cash-movements', [CashMovementController::class, 'cashierIndex']);
        Route::post('/cashier/cash-movements/withdrawals', [CashMovementController::class, 'cashierStoreWithdrawalRequest']);
    });
});
