import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import Login from './components/Login';
import ProtectedRoute from './components/ProtectedRoute';
import { DialogProvider } from './components/common/DialogProvider';
import { ToastProvider } from './components/common/ToastProvider';
import { getHomePathForRole } from './utils/roleRoutes';
import './App.css';

const AdminPanel = lazy(() => import('./components/AdminPanel/AdminPanel'));
const StaffDashboard = lazy(() => import('./components/StaffDashboard/StaffDashboard'));

const RouteLoader = () => (
  <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
    Chargement...
  </div>
);

const RoleIndexRedirect = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        Vérification de session...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={getHomePathForRole(user.role)} replace />;
};

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <DialogProvider>
          <Router>
            <div className="App">
              <Suspense fallback={<RouteLoader />}>
                <Routes>
                  <Route path="/login" element={<Login />} />

                  <Route
                    path="/admin/*"
                    element={
                      <ProtectedRoute allowedRoles={['admin']}>
                        <AdminPanel />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/server/*"
                    element={
                      <ProtectedRoute allowedRoles={['server']}>
                        <StaffDashboard role="server" />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/kitchen/*"
                    element={
                      <ProtectedRoute allowedRoles={['kitchen']}>
                        <StaffDashboard role="kitchen" />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/cashier/*"
                    element={
                      <ProtectedRoute allowedRoles={['cashier']}>
                        <StaffDashboard role="cashier" />
                      </ProtectedRoute>
                    }
                  />
                  <Route
                    path="/bar/*"
                    element={
                      <ProtectedRoute allowedRoles={['barman']}>
                        <StaffDashboard role="barman" />
                      </ProtectedRoute>
                    }
                  />

                  <Route path="/" element={<RoleIndexRedirect />} />

                  <Route path="*" element={<RoleIndexRedirect />} />
                </Routes>
              </Suspense>
            </div>
          </Router>
        </DialogProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
