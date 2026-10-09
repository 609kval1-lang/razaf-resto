import React, { useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import ChangePasswordModal from '../common/ChangePasswordModal';
import WorkspaceHeader from '../common/WorkspaceHeader';
import { CashierDashboardModule } from './modules/CashierDashboardModule';
import { CashierOperationsModule } from './modules/CashierOperationsModule';
import { CashierOrdersModule } from './modules/CashierOrdersModule';
import './StaffDashboard.css';
import '../common/RestaurantWorkspace.css';
import './CashierShell.css';

const modules = [
  { path: '/cashier', label: 'Tableau de bord' },
  { path: '/cashier/orders', label: 'Commandes' },
  { path: '/cashier/cash-register', label: 'Operations de caisse' },
];

export default function StaffDashboard({ role }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [passwordOpen, setPasswordOpen] = useState(false);
  if (role !== 'cashier') return <Navigate to="/login" replace />;
  return <div className="staff-layout restaurant-workspace cashier-shell">
    <WorkspaceHeader className="cashier-topbar" section="Caisse" groups={modules} pathname={location.pathname.replace(/\/$/, '')}
      navigationLabel="Menu principal de la caisse" userName={user?.name}
      onPasswordChange={() => setPasswordOpen(true)} onLogout={() => { logout(); navigate('/login'); }} />
    <main className="staff-main cashier-content">
      <Routes>
        <Route index element={<CashierDashboardModule />} />
        <Route path="orders" element={<CashierOrdersModule />} />
        <Route path="cash-register" element={<CashierOperationsModule />} />
        <Route path="payments" element={<Navigate to="/cashier/cash-register?tab=bons" replace />} />
        <Route path="availability" element={<Navigate to="/cashier" replace />} />
        <Route path="*" element={<Navigate to="/cashier" replace />} />
      </Routes>
    </main>
    <ChangePasswordModal isOpen={passwordOpen} onClose={() => setPasswordOpen(false)} />
  </div>;
}
