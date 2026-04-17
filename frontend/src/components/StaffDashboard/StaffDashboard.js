import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getHomePathForRole } from '../../utils/roleRoutes';
import ChangePasswordModal from '../common/ChangePasswordModal';
import {
  ServerOverviewModule,
  ServerTablesModule,
  ServerOrdersModule,
} from './modules/ServerModules';
import {
  KitchenOverviewModule,
  KitchenQueueModule,
  KitchenHistoryModule,
} from './modules/KitchenModules';
import {
  CashierOverviewModule,
  CashierPaymentsModule,
  CashierCashRegisterModule,
} from './modules/CashierModules';
import './StaffDashboard.css';

const ROLE_CONFIGS = {
  server: {
    label: 'Serveur',
    icon: '🍽️',
    accent: 'accent-server',
    modules: [
      {
        key: 'overview',
        path: '',
        label: 'Tableau de bord',
        icon: '📊',
      },
      {
        key: 'tables',
        path: 'tables',
        label: 'Tables',
        icon: '🪑',
      },
      {
        key: 'orders',
        path: 'orders',
        label: 'Commandes',
        icon: '🧾',
      },
    ],
  },
  kitchen: {
    label: 'Cuisine',
    icon: '🍳',
    accent: 'accent-kitchen',
    modules: [
      {
        key: 'overview',
        path: '',
        label: 'Tableau de bord',
        icon: '📊',
      },
      {
        key: 'queue',
        path: 'queue',
        label: 'File Cuisine',
        icon: '🔥',
      },
      {
        key: 'history',
        path: 'history',
        label: 'Historique',
        icon: '📁',
      },
    ],
  },
  barman: {
    label: 'Bar',
    icon: '🍹',
    accent: 'accent-bar',
    modules: [
      {
        key: 'overview',
        path: '',
        label: 'Tableau de bord',
        icon: '📊',
      },
      {
        key: 'queue',
        path: 'queue',
        label: 'File Bar',
        icon: '🍸',
      },
      {
        key: 'history',
        path: 'history',
        label: 'Historique',
        icon: '📁',
      },
    ],
  },
  cashier: {
    label: 'Caisse',
    icon: '💰',
    accent: 'accent-cashier',
    modules: [
      {
        key: 'overview',
        path: '',
        label: 'Tableau de bord',
        icon: '📊',
      },
      {
        key: 'payments',
        path: 'payments',
        label: 'Paiements',
        icon: '💳',
      },
      {
        key: 'cash-register',
        path: 'cash-register',
        label: 'Sorties Caisse',
        icon: '🏧',
      },
    ],
  },
};

const getModuleElement = (role, moduleKey) => {
  if (role === 'server' && moduleKey === 'overview') return <ServerOverviewModule />;
  if (role === 'server' && moduleKey === 'tables') return <ServerTablesModule />;
  if (role === 'server' && moduleKey === 'orders') return <ServerOrdersModule />;

  if (role === 'kitchen' && moduleKey === 'overview') return <KitchenOverviewModule />;
  if (role === 'kitchen' && moduleKey === 'queue') return <KitchenQueueModule />;
  if (role === 'kitchen' && moduleKey === 'history') return <KitchenHistoryModule />;

  if (role === 'barman' && moduleKey === 'overview') return <KitchenOverviewModule station="bar" />;
  if (role === 'barman' && moduleKey === 'queue') return <KitchenQueueModule station="bar" />;
  if (role === 'barman' && moduleKey === 'history') return <KitchenHistoryModule station="bar" />;

  if (role === 'cashier' && moduleKey === 'overview') return <CashierOverviewModule />;
  if (role === 'cashier' && moduleKey === 'payments') return <CashierPaymentsModule />;
  if (role === 'cashier' && moduleKey === 'cash-register') return <CashierCashRegisterModule />;

  return <div className="staff-card">Module indisponible.</div>;
};

const StaffDashboard = ({ role }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const config = useMemo(() => ROLE_CONFIGS[role], [role]);
  const homePath = getHomePathForRole(role);

  const activeModule = useMemo(() => {
    if (!config) {
      return null;
    }

    const currentPath = location.pathname.replace(/\/+$/, '') || '/';

    return (
      config.modules.find((module) => {
        const modulePath = module.path ? `${homePath}/${module.path}` : homePath;
        const normalizedModulePath = modulePath.replace(/\/+$/, '') || '/';

        if (!module.path) {
          return currentPath === normalizedModulePath;
        }

        return currentPath === normalizedModulePath || currentPath.startsWith(`${normalizedModulePath}/`);
      })
      || config.modules[0]
    );
  }, [config, homePath, location.pathname]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  if (!config) {
    return <Navigate to="/login" replace />;
  }

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className={`staff-layout ${sidebarOpen ? 'is-open' : ''}`}>
      <div className="staff-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden={!sidebarOpen} />

      <aside className={`staff-sidebar ${config.accent}`}>
        <div className="staff-brand">
          <h2>Razafimamonjy Restaurant</h2>
          <span>{config.icon} {config.label}</span>
        </div>

        <nav>
          <ul>
            {config.modules.map((module) => (
              <li key={module.key}>
                <NavLink
                  to={module.path ? `${homePath}/${module.path}` : homePath}
                  end={module.path === ''}
                  className={({ isActive }) => (isActive ? 'active' : '')}
                >
                  <span>{module.icon}</span>
                  <span>{module.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="staff-user-card">
          <div>{user?.name || 'Utilisateur'}</div>
          <small>{user?.role || 'Rôle inconnu'}</small>
        </div>
      </aside>

      <main className="staff-main">
        <header className="staff-header">
          <button
            type="button"
            className="staff-menu-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Ouvrir le menu"
          >
            ☰
          </button>
          <h1>{config.label} - {activeModule?.label || 'Tableau de bord'}</h1>
          <div className="staff-header-actions">
            <button type="button" className="staff-btn secondary" onClick={() => setShowPasswordModal(true)}>
              Changer mot de passe
            </button>
            <button type="button" className="staff-logout-btn" onClick={handleLogout}>
              Deconnexion
            </button>
          </div>
        </header>

        <Routes>
          <Route
            index
            element={getModuleElement(role, config.modules[0].key)}
          />
          {config.modules
            .filter((module) => module.path)
            .map((module) => (
              <Route
                key={module.key}
                path={module.path}
                element={getModuleElement(role, module.key)}
              />
            ))}
          <Route path="*" element={<Navigate to={homePath} replace />} />
        </Routes>

        <ChangePasswordModal
          isOpen={showPasswordModal}
          onClose={() => setShowPasswordModal(false)}
        />
      </main>
    </div>
  );
};

export default StaffDashboard;
