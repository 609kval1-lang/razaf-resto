import axios from 'axios';

const BROWSER_ORIGIN = typeof window !== 'undefined' ? window.location.origin : '';
const DEFAULT_API_BASE_URL = (() => {
  if (typeof window === 'undefined') {
    return 'http://localhost:8000/api';
  }

  const { protocol, hostname, port, origin } = window.location;
  const normalizedPort = String(port || '').trim();
  const isFrontendDevServer = ['3000', '3001', '5173', '4173'].includes(normalizedPort);
  const isLocalHost = ['localhost', '127.0.0.1'].includes(String(hostname || '').trim().toLowerCase());

  if (isFrontendDevServer) {
    return `${protocol}//${isLocalHost ? 'localhost' : hostname}:8000/api`;
  }

  return `${origin.replace(/\/+$/, '')}/api`;
})();

const API_BASE_URL = process.env.REACT_APP_API_URL || DEFAULT_API_BASE_URL;
const NORMALIZED_API_BASE_URL = String(API_BASE_URL || '').replace(/\/+$/, '');
const API_ORIGIN = (() => {
  try {
    return new URL(API_BASE_URL).origin;
  } catch (error) {
    return BROWSER_ORIGIN;
  }
})();

const buildPublicMediaUrl = (relativePath) => {
  const normalizedPath = String(relativePath || '')
    .trim()
    .replace(/^\/+/, '');

  if (!normalizedPath || !NORMALIZED_API_BASE_URL) {
    return '';
  }

  const encodedPath = normalizedPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `${NORMALIZED_API_BASE_URL}/media/public/${encodedPath}`;
};

const extractPublicMediaPath = (assetUrl) => {
  const raw = String(assetUrl || '').trim();
  if (!raw) {
    return '';
  }

  let pathname = raw;

  try {
    const parsed = new URL(raw, `${API_ORIGIN || BROWSER_ORIGIN || 'http://localhost'}/`);
    pathname = parsed.pathname;
  } catch (error) {
    pathname = raw;
  }

  const normalizedPath = String(pathname || '').replace(/\\/g, '/');
  for (const prefix of ['/api/media/public/', '/storage/']) {
    const position = normalizedPath.indexOf(prefix);
    if (position !== -1) {
      return normalizedPath.slice(position + prefix.length).replace(/^\/+/, '');
    }
  }

  return '';
};

export const resolveApiAssetUrl = (assetUrl) => {
  const raw = String(assetUrl || '').trim();
  if (!raw) {
    return '';
  }

  if (raw.startsWith('data:') || raw.startsWith('blob:')) {
    return raw;
  }

  const publicMediaPath = extractPublicMediaPath(raw);
  if (publicMediaPath) {
    const mediaUrl = buildPublicMediaUrl(publicMediaPath);
    if (mediaUrl) {
      return mediaUrl;
    }
  }

  const assetBase = API_ORIGIN || BROWSER_ORIGIN;
  if (!assetBase) {
    return raw;
  }

  try {
    const parsed = new URL(raw, `${assetBase}/`);
    return parsed.toString();
  } catch (error) {
    return raw;
  }
};

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Intercepteur pour ajouter le token automatiquement
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Intercepteur pour gérer les erreurs d'authentification
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;

// ============ AUTHENTICATION ============
export const authAPI = {
  login: (credentials) => api.post('/login', credentials),
  changePassword: (payload) => api.put('/auth/password', payload),
  logout: async () => {
    try {
      await api.post('/logout');
    } catch (_error) {
      // Nettoie quand même le contexte local même si le token est déjà invalide.
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  },
  getCurrentUser: () => api.get('/user'),
};

// ============ ADMIN API ============
export const adminAPI = {
  // Users
  getUsers: () => api.get('/admin/users'),
  getSummary: () => api.get('/admin/summary'),
  createUser: (userData) => api.post('/admin/users', userData),
  updateUser: (userId, userData) => api.put(`/admin/users/${userId}`, userData),
  deleteUser: (userId) => api.delete(`/admin/users/${userId}`),

  // Tables
  getTables: () => api.get('/admin/tables'),
  createTable: (tableData) => api.post('/admin/tables', tableData),
  updateTable: (tableId, tableData) => api.put(`/admin/tables/${tableId}`, tableData),
  deleteTable: (tableId) => api.delete(`/admin/tables/${tableId}`),

  // Raw Materials
  getRawMaterials: (params) => api.get('/admin/raw-materials', { params }),
  getRawMaterialPriceVariations: () => api.get('/admin/raw-materials/price-variations'),
  createRawMaterial: (materialData) => api.post('/admin/raw-materials', materialData),
  updateRawMaterial: (materialId, materialData) => api.put(`/admin/raw-materials/${materialId}`, materialData),
  deleteRawMaterial: (materialId) => api.delete(`/admin/raw-materials/${materialId}`),

  // Ingredients
  getIngredients: () => api.get('/admin/ingredients'),
  createIngredient: (ingredientData) => api.post('/admin/ingredients', ingredientData),
  updateIngredient: (ingredientId, ingredientData) => api.put(`/admin/ingredients/${ingredientId}`, ingredientData),
  deleteIngredient: (ingredientId) => api.delete(`/admin/ingredients/${ingredientId}`),

  // Menus
  getMenus: () => api.get('/admin/menus'),
  createMenu: (menuData) => {
    if (menuData instanceof FormData) {
      return api.post('/admin/menus', menuData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
    }

    return api.post('/admin/menus', menuData);
  },
  updateMenu: (menuId, menuData) => {
    if (menuData instanceof FormData) {
      if (!menuData.has('_method')) {
        menuData.append('_method', 'PUT');
      }

      return api.post(`/admin/menus/${menuId}`, menuData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
    }

    return api.put(`/admin/menus/${menuId}`, menuData);
  },
  deleteMenu: (menuId) => api.delete(`/admin/menus/${menuId}`),

  // Revenue analytics
  getRevenueReport: (params) => api.get('/admin/revenue-report', { params }),

  // Cash register movements
  getCashMovements: (params) => api.get('/admin/cash-movements', { params }),
  getTreasurySnapshot: () => api.get('/admin/treasury'),
  createTreasuryTransfer: (payload) => api.post('/admin/treasury/transfers', payload),
  createTreasuryWithdrawal: (payload) => api.post('/admin/treasury/withdrawals', payload),
  processAdminOrderPayment: (orderId, payload) => api.post(`/admin/orders/${orderId}/payment`, payload),
  approveCashMovement: (movementId, payload) => api.post(`/admin/cash-movements/${movementId}/approve`, payload || {}),
  rejectCashMovement: (movementId, payload) => api.post(`/admin/cash-movements/${movementId}/reject`, payload || {}),
  createAdminCashWithdrawal: (payload) => api.post('/admin/cash-movements/withdrawals/direct', payload),

  // Suppliers
  getSuppliers: () => api.get('/admin/suppliers'),
  getSupplierPayablesAlerts: () => api.get('/admin/suppliers/payables/alerts'),
  getSupplierLedger: (supplierId) => api.get(`/admin/suppliers/${supplierId}/ledger`),
  createSupplierPurchase: (supplierId, purchaseData) => api.post(`/admin/suppliers/${supplierId}/purchases`, purchaseData),
  paySupplierPurchase: (supplierId, purchaseId, paymentData) => api.post(`/admin/suppliers/${supplierId}/purchases/${purchaseId}/payments`, paymentData),
  settleAllSupplierPurchases: (supplierId, paymentData) => api.post(`/admin/suppliers/${supplierId}/purchases/settle-all`, paymentData),
  createSupplier: (supplierData) => api.post('/admin/suppliers', supplierData),
  updateSupplier: (supplierId, supplierData) => api.put(`/admin/suppliers/${supplierId}`, supplierData),
  deleteSupplier: (supplierId) => api.delete(`/admin/suppliers/${supplierId}`),

  // Employees & payroll
  getEmployeePayrollSnapshot: () => api.get('/admin/employees/payroll'),
  upsertEmployeeSalaryProfile: (userId, payload) => api.put(`/admin/employees/${userId}/salary-profile`, payload),
  createEmployeeAdvance: (userId, payload) => api.post(`/admin/employees/${userId}/payroll/advances`, payload),
  createEmployeeSalaryPayment: (userId, payload) => api.post(`/admin/employees/${userId}/payroll/salaries`, payload),
};

// ============ SERVER API ============
export const serverAPI = {
  getDashboardSnapshot: (params) => api.get('/server/snapshot', { params }),
  getAvailableTables: () => api.get('/server/tables'),
  getCustomers: () => api.get('/server/customers'),
  getCustomerInsights: (customerId) => api.get(`/server/customers/${customerId}/insights`),
  getMenus: () => api.get('/server/menus'),
  createOrder: (orderData) => api.post('/server/orders', orderData),
  markOrderItemServed: (itemId) => api.post(`/server/order-items/${itemId}/serve`),
  requestBill: (orderId) => api.post(`/server/orders/${orderId}/request-bill`),
  getMyOrders: (params) => api.get('/server/my-orders', { params }),
};

// ============ KITCHEN API ============
export const kitchenAPI = {
  getIngredientsStatus: () => api.get('/kitchen/ingredients'),
  getPendingOrders: (params) => api.get('/kitchen/orders', { params }),
  startOrderItem: (itemId) => api.post(`/kitchen/order-items/${itemId}/start`),
  markOrderItemReady: (itemId) => api.post(`/kitchen/order-items/${itemId}/ready`),
  startOrder: (orderId) => api.post(`/kitchen/orders/${orderId}/start`),
  markOrderReady: (orderId) => api.post(`/kitchen/orders/${orderId}/ready`),
  getOrderHistory: (params) => api.get('/kitchen/history', { params }),
  getKitchenStats: () => api.get('/kitchen/stats'),
};

// ============ BAR API ============
export const barAPI = {
  getIngredientsStatus: () => api.get('/bar/ingredients'),
  getPendingOrders: (params) => api.get('/bar/orders', { params }),
  startOrderItem: (itemId) => api.post(`/bar/order-items/${itemId}/start`),
  markOrderItemReady: (itemId) => api.post(`/bar/order-items/${itemId}/ready`),
  startOrder: (orderId) => api.post(`/bar/orders/${orderId}/start`),
  markOrderReady: (orderId) => api.post(`/bar/orders/${orderId}/ready`),
  getOrderHistory: (params) => api.get('/bar/history', { params }),
  getKitchenStats: () => api.get('/bar/stats'),
};

// ============ CASHIER API ============
export const cashierAPI = {
  getReadyOrders: (params) => api.get('/cashier/orders', { params }),
  getCustomers: () => api.get('/cashier/customers'),
  preparePayment: (orderId, paymentData) => api.post(`/cashier/orders/${orderId}/prepare-payment`, paymentData),
  releaseOrderTable: (orderId) => api.post(`/cashier/orders/${orderId}/release-table`),
  processPayment: (orderId, paymentData) => api.post(`/cashier/orders/${orderId}/payment`, paymentData),
  getDayStats: () => api.get('/cashier/stats'),
  generateInvoice: (orderId) => api.get(`/cashier/invoice/${orderId}`),
  getPaymentHistory: (params) => api.get('/cashier/history', { params }),
  getCashMovements: () => api.get('/cashier/cash-movements'),
  requestCashWithdrawal: (payload) => api.post('/cashier/cash-movements/withdrawals', payload),
};
