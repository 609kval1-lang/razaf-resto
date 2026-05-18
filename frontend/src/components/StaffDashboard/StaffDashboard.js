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

const normalizeRoutePath = (path) => String(path || '').replace(/\/+$/, '') || '/';

const getModuleTargetPath = (module, homePath) => normalizeRoutePath(
  module.path ? `${homePath}/${module.path}` : homePath
);

const isModulePathActive = (pathname, module, homePath) => {
  const currentPath = normalizeRoutePath(pathname);
  const modulePath = getModuleTargetPath(module, homePath);

  if (!module.path) {
    return currentPath === modulePath;
  }

  return currentPath === modulePath || currentPath.startsWith(`${modulePath}/`);
};

const flattenModules = (modules = []) => modules.flatMap((module) => (
  Array.isArray(module.children) && module.children.length > 0 ? module.children : [module]
));

const buildInitialOpenGroups = (modules = [], pathname, homePath) => {
  return modules.reduce((groups, module) => {
    if (
      Array.isArray(module.children)
      && module.children.some((child) => isModulePathActive(pathname, child, homePath))
    ) {
      groups[module.key] = true;
    }

    return groups;
  }, {});
};

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
        children: [
          {
            key: 'my-orders',
            path: 'orders/my-orders',
            label: 'Mes commandes',
            icon: '📋',
          },
          {
            key: 'orders-manage',
            path: 'orders/manage',
            label: 'Créer / ajouter',
            icon: '➕',
          },
        ],
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
  if (role === 'server' && moduleKey === 'my-orders') return <ServerOrdersModule view="my-orders" />;
  if (role === 'server' && moduleKey === 'orders-manage') return <ServerOrdersModule view="manage" />;

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
  const flatModules = useMemo(() => flattenModules(config?.modules || []), [config]);
  const [openGroups, setOpenGroups] = useState(() => buildInitialOpenGroups(config?.modules || [], location.pathname, homePath));

  const activeModule = useMemo(() => {
    if (!config || flatModules.length === 0) {
      return null;
    }

    return flatModules.find((module) => isModulePathActive(location.pathname, module, homePath)) || flatModules[0];
  }, [config, flatModules, homePath, location.pathname]);

  useEffect(() => {
    setSidebarOpen(false);
    setOpenGroups((current) => {
      const nextGroups = { ...current };
      let hasChanged = false;

      (config?.modules || []).forEach((module) => {
        if (!Array.isArray(module.children) || module.children.length === 0) {
          return;
        }

        const shouldBeOpen = module.children.some((child) => isModulePathActive(location.pathname, child, homePath));
        if (shouldBeOpen && !nextGroups[module.key]) {
          nextGroups[module.key] = true;
          hasChanged = true;
        }
      });

      return hasChanged ? nextGroups : current;
    });
  }, [config, homePath, location.pathname]);

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
            {config.modules.map((module) => {
              const hasChildren = Array.isArray(module.children) && module.children.length > 0;
              const isGroupOpen = Boolean(openGroups[module.key]);
              const isGroupActive = hasChildren
                ? module.children.some((child) => isModulePathActive(location.pathname, child, homePath))
                : isModulePathActive(location.pathname, module, homePath);

              if (!hasChildren) {
                return (
                  <li key={module.key}>
                    <NavLink
                      to={getModuleTargetPath(module, homePath)}
                      end={module.path === ''}
                      className={({ isActive }) => `staff-nav-link${isActive ? ' active' : ''}`}
                    >
                      <span className="staff-menu-icon" aria-hidden="true">{module.icon}</span>
                      <span className="staff-menu-text">
                        <span>{module.label}</span>
                        {module.subLabel ? <small className="staff-menu-subtext">{module.subLabel}</small> : null}
                      </span>
                    </NavLink>
                  </li>
                );
              }

              return (
                <li
                  key={module.key}
                  className={`staff-nav-group ${isGroupOpen ? 'is-open' : ''} ${isGroupActive ? 'is-active' : ''}`}
                >
                  <button
                    type="button"
                    className={`staff-nav-group-toggle${isGroupActive ? ' active' : ''}`}
                    onClick={() => setOpenGroups((current) => ({ ...current, [module.key]: !current[module.key] }))}
                    aria-expanded={isGroupOpen}
                  >
                    <span className="staff-menu-icon" aria-hidden="true">{module.icon}</span>
                    <span className="staff-menu-text">
                      <span>{module.label}</span>
                      {module.subLabel ? <small className="staff-menu-subtext">{module.subLabel}</small> : null}
                    </span>
                    <span className="staff-nav-group-arrow" aria-hidden="true">{isGroupOpen ? '▾' : '▸'}</span>
                  </button>

                  {isGroupOpen ? (
                    <ul className="staff-sidebar-submenu">
                      {module.children.map((child) => (
                        <li key={child.key}>
                          <NavLink
                            to={getModuleTargetPath(child, homePath)}
                            className={({ isActive }) => `staff-nav-link${isActive ? ' active' : ''}`}
                          >
                            <span className="staff-sidebar-submenu-icon" aria-hidden="true">{child.icon || '•'}</span>
                            <span>{child.label}</span>
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
            element={getModuleElement(role, flatModules[0]?.key || config.modules[0].key)}
          />
          {config.modules
            .filter((module) => module.path && Array.isArray(module.children) && module.children.length > 0)
            .map((module) => (
              <Route
                key={`${module.key}-redirect`}
                path={module.path}
                element={<Navigate to={getModuleTargetPath(module.children[0], homePath)} replace />}
              />
            ))}
          {flatModules
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
