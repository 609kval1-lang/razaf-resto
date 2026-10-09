import React, { useCallback, useEffect, useState } from 'react';
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { adminAPI } from '../../services/api';
import UserManagement from './UserManagement';
import TableManagement from './TableManagement';
import RawMaterialManagement from './RawMaterialManagement';
import IngredientManagement from './IngredientManagement';
import MenuManagement from './MenuManagement';
import SupplierManagement from './SupplierManagement';
import EmployeePayrollManagement from './EmployeePayrollManagement';
import CashMovementManagement from './CashMovementManagement';
import RevenueDashboard from './RevenueDashboard';
import TreasuryManagement from './TreasuryManagement';
import ChangePasswordModal from '../common/ChangePasswordModal';
import WorkspaceHeader from '../common/WorkspaceHeader';
import './AdminPanel.css';
import '../common/RestaurantWorkspace.css';
import './AdminShell.css';

const navigationGroups = [
  { path: '/admin', label: 'Tableau de bord' },
  { path: '/admin/tables', label: 'Tables et réservations' },
  {
    id: 'stock',
    label: 'Stocks & achats',
    items: [
      { id: 'raw-materials', label: 'Matières premières', path: '/admin/raw-materials' },
      { id: 'suppliers', label: 'Fournisseurs et achats', path: '/admin/suppliers' },
    ],
  },
  {
    id: 'production',
    label: 'Menus & production',
    items: [
      { id: 'menus', label: 'Menus et cartes', path: '/admin/menus' },
      { id: 'ingredients', label: 'Ingrédients préparés', path: '/admin/ingredients' },
    ],
  },
  {
    id: 'team',
    label: 'Équipe',
    items: [
      { id: 'users', label: 'Utilisateurs et accès', path: '/admin/users' },
      { id: 'employees', label: 'Employés et paie', path: '/admin/employees' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      { id: 'revenue', label: 'Recettes et analyses', path: '/admin/revenue' },
      { id: 'treasury', label: 'Trésorerie multi-comptes', path: '/admin/treasury' },
      { id: 'cash-movements', label: 'Caisse: demandes et validation', path: '/admin/cash-movements' },
    ],
  },
];

const getDashboardStockStatus = (stock, reorderLevel) => {
  const value = Number(stock || 0);
  const threshold = Number(reorderLevel || 0);

  if (threshold <= 0) {
    return value <= 0 ? 'low' : 'good';
  }

  const ratio = (value / threshold) * 100;

  if (ratio < 75) return 'low';
  if (ratio <= 100) return 'warning';
  return 'good';
};

const formatAr = (value) => {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} Ar`;
};

const toLocalDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const AdminPanel = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="dashboard restaurant-workspace admin-shell">
      <WorkspaceHeader
        className="admin-topbar"
        section="Administration"
        groups={navigationGroups}
        pathname={location.pathname.replace(/\/$/, '')}
        navigationLabel="Menu principal de l'administration"
        userName={user?.name}
        onPasswordChange={() => setShowPasswordModal(true)}
        onLogout={handleLogout}
      />

      <main className="dashboard-main admin-content">
        <Routes>
          <Route path="/" element={<AdminDashboard />} />
          <Route path="/users" element={<UserManagement />} />
          <Route path="/tables" element={<TableManagement />} />
          <Route path="/raw-materials" element={<RawMaterialManagement />} />
          <Route path="/suppliers" element={<SupplierManagement />} />
          <Route path="/employees" element={<EmployeePayrollManagement />} />
          <Route path="/ingredients" element={<IngredientManagement />} />
          <Route path="/menus" element={<MenuManagement />} />
          <Route path="/revenue" element={<RevenueDashboard />} />
          <Route path="/treasury" element={<TreasuryManagement />} />
          <Route path="/cash-movements" element={<CashMovementManagement />} />
        </Routes>
      </main>

      <ChangePasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />
    </div>
  );
};

const AdminDashboard = () => {
  const [stats, setStats] = useState({
    users: 0,
    tables: 0,
    rawMaterials: 0,
    ingredients: 0,
    menus: 0,
  });
  const [alerts, setAlerts] = useState({
    stockAlertCount: 0,
    overdueSupplierPaymentsCount: 0,
    supplierDueTodayCount: 0,
    supplierDueTomorrowCount: 0,
    priceIncreaseCount: 0,
    priceDecreaseCount: 0,
    occupiedTablesCount: 0,
    cashPendingCount: 0,
    cashPendingAmount: 0,
  });

  const loadDashboardData = useCallback(async () => {
    const [
      summaryResult,
      supplierAlertsResult,
      revenueResult,
      cashMovementResult,
    ] = await Promise.allSettled([
      adminAPI.getSummary(),
      adminAPI.getSupplierPayablesAlerts(),
      adminAPI.getRevenueReport({ scope: 'day', top_limit: 5 }),
      adminAPI.getCashMovements(),
    ]);

    const summaryData = summaryResult.status === 'fulfilled'
      ? (summaryResult.value?.data || {})
      : {};

    if (summaryResult.status === 'fulfilled') {
      setStats({
        users: Number(summaryData.users || 0),
        tables: Number(summaryData.tables || 0),
        rawMaterials: Number(summaryData.raw_materials || 0),
        ingredients: Number(summaryData.ingredients || 0),
        menus: Number(summaryData.menus || 0),
      });
    } else {
      console.error('Erreur chargement stats:', summaryResult.reason);
    }

    const todayKey = toLocalDateKey(new Date());
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowKey = toLocalDateKey(tomorrowDate);
    const supplierAlerts = supplierAlertsResult.status === 'fulfilled'
      ? (Array.isArray(supplierAlertsResult.value?.data?.alerts) ? supplierAlertsResult.value.data.alerts : [])
      : [];
    const cashSummary = cashMovementResult.status === 'fulfilled'
      ? (cashMovementResult.value?.data?.summary || {})
      : {};

    setAlerts({
      stockAlertCount: Number(summaryData.stock_alert_count || 0),
      overdueSupplierPaymentsCount: supplierAlertsResult.status === 'fulfilled'
        ? Number(supplierAlertsResult.value?.data?.summary?.overdue_purchases_count || 0)
        : 0,
      supplierDueTodayCount: supplierAlerts.filter((alert) => String(alert?.due_date || '') === todayKey).length,
      supplierDueTomorrowCount: supplierAlerts.filter((alert) => String(alert?.due_date || '') === tomorrowKey).length,
      priceIncreaseCount: revenueResult.status === 'fulfilled'
        ? (Array.isArray(revenueResult.value?.data?.menu_pricing_impact) ? revenueResult.value.data.menu_pricing_impact : [])
          .filter((row) => String(row?.recommended_action || '') === 'increase')
          .length
        : 0,
      priceDecreaseCount: revenueResult.status === 'fulfilled'
        ? (Array.isArray(revenueResult.value?.data?.menu_pricing_impact) ? revenueResult.value.data.menu_pricing_impact : [])
          .filter((row) => String(row?.recommended_action || '') === 'decrease')
          .length
        : 0,
      occupiedTablesCount: Number(summaryData.occupied_tables_count || 0),
      cashPendingCount: Number(cashSummary.pending_requests_count || 0),
      cashPendingAmount: Number(cashSummary.cash_out_pending_total ?? cashSummary.cash_out_pending ?? 0),
    });
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const supplierUpcomingCount = alerts.supplierDueTodayCount + alerts.supplierDueTomorrowCount;
  const supplierFollowUpCount = alerts.overdueSupplierPaymentsCount + supplierUpcomingCount;
  const pricingProposalCount = alerts.priceIncreaseCount + alerts.priceDecreaseCount;

  return (
    <div className="admin-dashboard">
      <h2>Vue d'ensemble</h2>

      <div className="card">
        <h3>Suivis prioritaires</h3>
        <div className="dashboard-alert-grid">
          <Link to="/admin/raw-materials" className="dashboard-alert-card warning">
            <span className="dashboard-alert-label">Matières premières sous seuil</span>
            <strong className="dashboard-alert-number">{alerts.stockAlertCount}</strong>
          </Link>

          <Link to="/admin/suppliers?focus=supplier-payments" className="dashboard-alert-card supplier-warning">
            <span className="dashboard-alert-label">Echeances fournisseurs</span>
            <strong className="dashboard-alert-number">{supplierFollowUpCount}</strong>
            <div className="dashboard-alert-split">
              <div>
                <small>En retard</small>
                <strong>{alerts.overdueSupplierPaymentsCount}</strong>
              </div>
              <div>
                <small>Echeance proche</small>
                <strong>{supplierUpcomingCount}</strong>
              </div>
            </div>
          </Link>

          <Link to="/admin/revenue" className="dashboard-alert-card cool">
            <span className="dashboard-alert-label">Propositions de prix</span>
            <strong className="dashboard-alert-number">{pricingProposalCount}</strong>
            <div className="dashboard-alert-split">
              <div>
                <small>Hausses</small>
                <strong>{alerts.priceIncreaseCount}</strong>
              </div>
              <div>
                <small>Baisses</small>
                <strong>{alerts.priceDecreaseCount}</strong>
              </div>
            </div>
          </Link>

          <Link to="/admin/cash-movements" className="dashboard-alert-card danger">
            <span className="dashboard-alert-label">Validations de caisse</span>
            <strong className="dashboard-alert-number">{alerts.cashPendingCount}</strong>
            <p>{formatAr(alerts.cashPendingAmount)} en attente de validation</p>
          </Link>

          <Link to="/admin/tables" className="dashboard-alert-card neutral">
            <span className="dashboard-alert-label">Tables occupées</span>
            <strong className="dashboard-alert-number">{alerts.occupiedTablesCount}</strong>
          </Link>
        </div>
      </div>

      <div className="card">
        <h3>Actions Rapides</h3>
        <div className="quick-actions">
          <Link to="/admin/users" className="btn btn-primary">
            Ajouter Utilisateur
          </Link>
          <Link to="/admin/tables" className="btn btn-primary">
            Ajouter Table
          </Link>
          <Link to="/admin/menus" className="btn btn-primary">
            Créer Menu
          </Link>
          <Link to="/admin/revenue" className="btn btn-primary">
            Voir Recettes
          </Link>
          <Link to="/admin/employees" className="btn btn-primary">
            Gérer la paie
          </Link>
          <Link to="/admin/treasury" className="btn btn-primary">
            Gérer Trésorerie
          </Link>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <h3>Utilisateurs</h3>
          <div className="stat-number">{stats.users}</div>
        </div>

        <div className="stat-card">
          <h3>Tables</h3>
          <div className="stat-number">{stats.tables}</div>
        </div>

        <div className="stat-card">
          <h3>Matières Premières</h3>
          <div className="stat-number">{stats.rawMaterials}</div>
        </div>

        <div className="stat-card">
          <h3>Ingrédients</h3>
          <div className="stat-number">{stats.ingredients}</div>
        </div>

        <div className="stat-card">
          <h3>Menus</h3>
          <div className="stat-number">{stats.menus}</div>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
