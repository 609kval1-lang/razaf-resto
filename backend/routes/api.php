<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\SupplierController;
use App\Http\Controllers\Api\AdminController;
use App\Http\Controllers\Api\CashMovementController;
use App\Http\Controllers\Api\EmployeePayrollController;
use App\Http\Controllers\Api\ServerController;
use App\Http\Controllers\Api\KitchenController;
use App\Http\Controllers\Api\CashierController;
use App\Http\Controllers\Api\PublicMediaController;

// ============ AUTHENTIFICATION ============
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:5,1');
Route::get('/media/public/{path}', [PublicMediaController::class, 'showPublicStorageFile'])
    ->where('path', '.*');

// ============ ROUTES PROTÉGÉES ============
Route::middleware('auth:sanctum')->group(function () {

    Route::get('/user', function (Request $request) {
        return $request->user();
    });
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::put('/auth/password', [AuthController::class, 'changePassword']);

    // ============ ADMIN ROUTES ============
    Route::middleware('role:admin')->group(function () {

        // Utilisateurs
        Route::get('/admin/users', [AdminController::class, 'listUsers']);
        Route::get('/admin/summary', [AdminController::class, 'getSummary']);
        Route::post('/admin/users', [AdminController::class, 'createUser']);
        Route::put('/admin/users/{user}', [AdminController::class, 'updateUser']);
        Route::delete('/admin/users/{user}', [AdminController::class, 'deleteUser']);

        // Tables
        Route::get('/admin/tables', [AdminController::class, 'listTables']);
        Route::post('/admin/tables', [AdminController::class, 'createTable']);
        Route::put('/admin/tables/{table}', [AdminController::class, 'updateTable']);
        Route::delete('/admin/tables/{table}', [AdminController::class, 'deleteTable']);

        // Matières premières
        Route::get('/admin/raw-materials', [AdminController::class, 'listRawMaterials']);
        Route::get('/admin/raw-materials/price-variations', [AdminController::class, 'getRawMaterialPriceVariations']);
        Route::post('/admin/raw-materials', [AdminController::class, 'createRawMaterial']);
        Route::put('/admin/raw-materials/{rawMaterial}', [AdminController::class, 'updateRawMaterial']);
        Route::delete('/admin/raw-materials/{rawMaterial}', [AdminController::class, 'deleteRawMaterial']);

        // Ingrédients (portions)
        Route::get('/admin/ingredients', [AdminController::class, 'listIngredients']);
        Route::post('/admin/ingredients', [AdminController::class, 'createIngredient']);
        Route::put('/admin/ingredients/{ingredient}', [AdminController::class, 'updateIngredient']);
        Route::delete('/admin/ingredients/{ingredient}', [AdminController::class, 'deleteIngredient']);

        // Menus
        Route::get('/admin/menus', [AdminController::class, 'listMenus']);
        Route::post('/admin/menus', [AdminController::class, 'createMenu']);
        Route::put('/admin/menus/{menu}', [AdminController::class, 'updateMenu']);
        Route::delete('/admin/menus/{menu}', [AdminController::class, 'deleteMenu']);

        // Recettes / Analytics
        Route::get('/admin/revenue-report', [AdminController::class, 'getRevenueReport']);

        // Caisse - validations admin des sorties
        Route::get('/admin/cash-movements', [CashMovementController::class, 'adminIndex']);
        Route::get('/admin/treasury', [CashMovementController::class, 'adminTreasuryIndex']);
        Route::post('/admin/treasury/transfers', [CashMovementController::class, 'adminStoreTransfer']);
        Route::post('/admin/treasury/withdrawals', [CashMovementController::class, 'adminStoreAccountWithdrawal']);
        Route::post('/admin/orders/{order}/payment', [CashierController::class, 'processPayment']);
        Route::post('/admin/cash-movements/withdrawals/direct', [CashMovementController::class, 'adminStoreDirectWithdrawal']);
        Route::post('/admin/cash-movements/{movement}/approve', [CashMovementController::class, 'adminApprove']);
        Route::post('/admin/cash-movements/{movement}/reject', [CashMovementController::class, 'adminReject']);

        // Employes & paie
        Route::get('/admin/employees/payroll', [EmployeePayrollController::class, 'index']);
        Route::put('/admin/employees/{user}/salary-profile', [EmployeePayrollController::class, 'upsertSalaryProfile']);
        Route::post('/admin/employees/{user}/payroll/advances', [EmployeePayrollController::class, 'storeAdvance']);
        Route::post('/admin/employees/{user}/payroll/salaries', [EmployeePayrollController::class, 'storeSalaryPayment']);

        // Fournisseurs
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

    // ============ SERVEUR ROUTES ============
    Route::middleware('role:server')->group(function () {
        Route::get('/server/snapshot', [ServerController::class, 'getDashboardSnapshot']);
        Route::get('/server/tables', [ServerController::class, 'listAvailableTables']);
        Route::get('/server/customers', [ServerController::class, 'listCustomers']);
        Route::get('/server/customers/{customer}/insights', [ServerController::class, 'getCustomerInsights']);
        Route::get('/server/menus', [ServerController::class, 'listMenus']);
        Route::post('/server/orders', [ServerController::class, 'createOrder']);
        Route::post('/server/order-items/{item}/serve', [ServerController::class, 'markOrderItemServed']);
        Route::post('/server/orders/{order}/request-bill', [ServerController::class, 'requestBill']);
        Route::get('/server/my-orders', [ServerController::class, 'myOrders']);
    });

    // ============ CUISINE ROUTES ============
    Route::middleware('role:kitchen')->group(function () {
        Route::get('/kitchen/ingredients', [KitchenController::class, 'getIngredientsStatus'])->defaults('station', 'kitchen');
        Route::get('/kitchen/orders', [KitchenController::class, 'getPendingOrders'])->defaults('station', 'kitchen');
        Route::post('/kitchen/order-items/{item}/start', [KitchenController::class, 'startOrderItem'])->defaults('station', 'kitchen');
        Route::post('/kitchen/order-items/{item}/ready', [KitchenController::class, 'markOrderItemReady'])->defaults('station', 'kitchen');
        Route::post('/kitchen/orders/{order}/start', [KitchenController::class, 'startOrder'])->defaults('station', 'kitchen');
        Route::post('/kitchen/orders/{order}/ready', [KitchenController::class, 'markOrderReady'])->defaults('station', 'kitchen');
        Route::get('/kitchen/history', [KitchenController::class, 'getOrderHistory'])->defaults('station', 'kitchen');
        Route::get('/kitchen/stats', [KitchenController::class, 'getKitchenStats'])->defaults('station', 'kitchen');
    });

    // ============ BAR ROUTES ============
    Route::middleware('role:barman')->group(function () {
        Route::get('/bar/ingredients', [KitchenController::class, 'getIngredientsStatus'])->defaults('station', 'bar');
        Route::get('/bar/orders', [KitchenController::class, 'getPendingOrders'])->defaults('station', 'bar');
        Route::post('/bar/order-items/{item}/start', [KitchenController::class, 'startOrderItem'])->defaults('station', 'bar');
        Route::post('/bar/order-items/{item}/ready', [KitchenController::class, 'markOrderItemReady'])->defaults('station', 'bar');
        Route::post('/bar/orders/{order}/start', [KitchenController::class, 'startOrder'])->defaults('station', 'bar');
        Route::post('/bar/orders/{order}/ready', [KitchenController::class, 'markOrderReady'])->defaults('station', 'bar');
        Route::get('/bar/history', [KitchenController::class, 'getOrderHistory'])->defaults('station', 'bar');
        Route::get('/bar/stats', [KitchenController::class, 'getKitchenStats'])->defaults('station', 'bar');
    });

    // ============ CAISSIER ROUTES ============
    Route::middleware('role:cashier')->group(function () {
        Route::get('/cashier/orders', [CashierController::class, 'getReadyOrders']);
        Route::get('/cashier/customers', [ServerController::class, 'listCustomers']);
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
