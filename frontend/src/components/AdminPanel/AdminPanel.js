import React, { useCallback, useEffect, useState } from 'react';
import { Routes, Route, Link, NavLink, useNavigate, useLocation } from 'react-router-dom';
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
import './AdminPanel.css';

const sidebarGroups = [
  {
    id: 'room',
    label: 'Salle',
    subLabel: 'Tables et réservations',
    icon: '🍽️',
    items: [
      { id: 'tables', label: 'Tables et réservations', icon: '🪑', path: '/admin/tables' },
    ],
  },
  {
    id: 'stock',
    label: 'Stocks & achats',
    subLabel: 'Matières premières et fournisseurs',
    icon: '📦',
    items: [
      { id: 'raw-materials', label: 'Matières premières', icon: '🧊', path: '/admin/raw-materials' },
      { id: 'suppliers', label: 'Fournisseurs et achats', icon: '🚚', path: '/admin/suppliers' },
    ],
  },
  {
    id: 'production',
    label: 'Menus & production',
    subLabel: 'Menus et ingrédients',
    icon: '📋',
    items: [
      { id: 'menus', label: 'Menus et cartes', icon: '🍽️', path: '/admin/menus' },
      { id: 'ingredients', label: 'Ingrédients préparés', icon: '🥄', path: '/admin/ingredients' },
    ],
  },
  {
    id: 'team',
    label: 'Équipe',
    subLabel: 'Utilisateurs et paie',
    icon: '👥',
    items: [
      { id: 'users', label: 'Utilisateurs et accès', icon: '👤', path: '/admin/users' },
      { id: 'employees', label: 'Employés et paie', icon: '💼', path: '/admin/employees' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    subLabel: 'Trésorerie multi-comptes et validation caisse',
    icon: '💰',
    items: [
      { id: 'revenue', label: 'Recettes et analyses', icon: '📈', path: '/admin/revenue' },
      { id: 'treasury', label: 'Trésorerie multi-comptes', icon: '🏛️', path: '/admin/treasury' },
      { id: 'cash-movements', label: 'Caisse: demandes et validation', icon: '💸', path: '/admin/cash-movements' },
    ],
  },
];

const matchesPath = (pathname, path) => pathname === path || (path !== '/admin' && pathname.startsWith(`${path}/`));

const buildInitialOpenGroups = (pathname) => {
  const activeGroup = sidebarGroups.find((group) => group.items.some((item) => matchesPath(pathname, item.path)));
  return activeGroup ? { [activeGroup.id]: true } : {};
};

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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [openGroups, setOpenGroups] = useState(() => buildInitialOpenGroups(location.pathname));

  useEffect(() => {
    setSidebarOpen(false);
    setOpenGroups((current) => {
      const activeGroup = sidebarGroups.find((group) => group.items.some((item) => matchesPath(location.pathname, item.path)));
      if (!activeGroup || current[activeGroup.id]) {
        return current;
      }

      return {
        ...current,
        [activeGroup.id]: true,
      };
    });
  }, [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const toggleGroup = (groupId) => {
    setOpenGroups((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  };

  return (
    <div className={`dashboard ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <div
        className="sidebar-backdrop"
        onClick={() => setSidebarOpen(false)}
        aria-hidden={!sidebarOpen}
      />

      {/* Sidebar */}
      <aside className="dashboard-sidebar">
        <div className="sidebar-brand-row">
          <div className="sidebar-brand">
            <h2>Razafimamonjy Restaurant</h2>
            <span>Administration</span>
          </div>
          <button
            className="sidebar-close"
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Fermer le menu"
          >
            ×
          </button>
        </div>

        <nav className="sidebar-nav">
          <ul>
            <li>
              <NavLink
                to="/admin"
                end
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                <span className="menu-icon" aria-hidden="true">📊</span>
                <span className="menu-text">
                  <span>Tableau de bord</span>
                  <small className="menu-subtext">Vue générale</small>
                </span>
              </NavLink>
            </li>

            {sidebarGroups.map((group) => {
              const isOpen = Boolean(openGroups[group.id]);
              const isActive = group.items.some((item) => matchesPath(location.pathname, item.path));

              return (
                <li key={group.id} className={`sidebar-group ${isOpen ? 'is-open' : ''} ${isActive ? 'is-active' : ''}`}>
                  <button
                    type="button"
                    className={`sidebar-group-toggle ${isActive ? 'active' : ''}`}
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={isOpen}
                  >
                    <span className="menu-icon" aria-hidden="true">{group.icon}</span>
                    <span className="menu-text">
                      <span>{group.label}</span>
                      <small className="menu-subtext">{group.subLabel}</small>
                    </span>
                    <span className="sidebar-group-arrow" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                  </button>

                  {isOpen ? (
                    <ul className="sidebar-submenu">
                      {group.items.map((item) => (
                        <li key={item.id}>
                          <NavLink
                            to={item.path}
                            className={({ isActive: linkActive }) => (linkActive ? 'active' : '')}
                          >
                            <span className="sidebar-submenu-icon" aria-hidden="true">{item.icon || '•'}</span>
                            <span>{item.label}</span>
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="sidebar-user">
          <div className="sidebar-user-name">{user?.name || 'Utilisateur'}</div>
          <div className="sidebar-user-role">{user?.role || 'Rôle inconnu'}</div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="dashboard-main">
        <div className="dashboard-header">
          <div className="header-left">
            <button
              className="sidebar-toggle"
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Ouvrir le menu"
            >
              ☰
            </button>
            <h1>Panneau d'administration</h1>
          </div>
          <div className="user-info">
            <span>Connecté en tant que: {user?.name} ({user?.role})</span>
            <button className="btn btn-secondary" onClick={() => setShowPasswordModal(true)}>
              Changer mot de passe
            </button>
            <button className="logout-btn" onClick={handleLogout}>
              Déconnexion
            </button>
          </div>
        </div>

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

        <ChangePasswordModal
          isOpen={showPasswordModal}
          onClose={() => setShowPasswordModal(false)}
        />
      </div>
    </div>
  );
};

// Composant Dashboard principal
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
    <div>
      <h2>📊 Vue d'ensemble</h2>

      <div className="card">
        <h3>⚠️ Suivis prioritaires</h3>
        <p className="form-hint" style={{ marginBottom: '14px' }}>
          Cliquer sur une card pour ouvrir directement la page concernée.
        </p>
        <div className="dashboard-alert-grid">
          <Link to="/admin/raw-materials" className="dashboard-alert-card warning">
            <span className="dashboard-alert-label">Matières premières sous seuil</span>
            <strong className="dashboard-alert-number">{alerts.stockAlertCount}</strong>
            <p>Stocks en alerte à vérifier</p>
          </Link>

          <Link to="/admin/suppliers" className="dashboard-alert-card supplier-warning">
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
            <p>Tables avec commandes actives</p>
          </Link>
        </div>
      </div>

      <div className="card">
        <h3>🚀 Actions Rapides</h3>
        <div className="quick-actions">
          <Link to="/admin/users" className="btn btn-primary">
            ➕ Ajouter Utilisateur
          </Link>
          <Link to="/admin/tables" className="btn btn-primary">
            ➕ Ajouter Table
          </Link>
          <Link to="/admin/menus" className="btn btn-primary">
            ➕ Créer Menu
          </Link>
          <Link to="/admin/revenue" className="btn btn-primary">
            📈 Voir Recettes
          </Link>
          <Link to="/admin/employees" className="btn btn-primary">
            💼 Gérer la paie
          </Link>
          <Link to="/admin/treasury" className="btn btn-primary">
            🏛️ Gérer Trésorerie
          </Link>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <h3>👥 Utilisateurs</h3>
          <div className="stat-number">{stats.users}</div>
          <p>Utilisateurs actifs</p>
        </div>

        <div className="stat-card">
          <h3>🍽️ Tables</h3>
          <div className="stat-number">{stats.tables}</div>
          <p>Tables configurées</p>
        </div>

        <div className="stat-card">
          <h3>🧊 Matières Premières</h3>
          <div className="stat-number">{stats.rawMaterials}</div>
          <p>Stocks bruts</p>
        </div>

        <div className="stat-card">
          <h3>🥄 Ingrédients</h3>
          <div className="stat-number">{stats.ingredients}</div>
          <p>Portions préparées</p>
        </div>

        <div className="stat-card">
          <h3>📋 Menus</h3>
          <div className="stat-number">{stats.menus}</div>
          <p>Plats disponibles</p>
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
