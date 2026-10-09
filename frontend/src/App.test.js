import React from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('react-router-dom', () => ({
  __esModule: true,
  BrowserRouter: ({ children }) => <div data-testid="router">{children}</div>,
  Routes: ({ children }) => <>{children}</>,
  Route: ({ element }) => element ?? null,
  Navigate: ({ to }) => <div data-testid="navigate">{to}</div>,
}), { virtual: true });

jest.mock('./contexts/AuthContext', () => ({
  __esModule: true,
  AuthProvider: ({ children }) => <>{children}</>,
  useAuth: () => ({ user: null, loading: false }),
}));

jest.mock('./components/Login', () => ({
  __esModule: true,
  default: () => <div>login-screen</div>,
}));

jest.mock('./components/AdminPanel/AdminPanel', () => ({
  __esModule: true,
  default: () => <div>admin-panel</div>,
}));

jest.mock('./components/StaffDashboard/StaffDashboard', () => ({
  __esModule: true,
  default: ({ role }) => <div>{role}-dashboard</div>,
}));

jest.mock('./components/ProtectedRoute', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));

jest.mock('./components/common/DialogProvider', () => ({
  __esModule: true,
  DialogProvider: ({ children }) => <>{children}</>,
}));

jest.mock('./components/common/ToastProvider', () => ({
  __esModule: true,
  ToastProvider: ({ children }) => <>{children}</>,
}));

import App from './App';

test('renders the application shell without crashing', async () => {
  render(<App />);

  expect(screen.getByTestId('router')).toBeInTheDocument();
  expect(await screen.findByText('login-screen')).toBeInTheDocument();
  expect(screen.queryByText('server-dashboard')).not.toBeInTheDocument();
  expect(screen.queryByText('kitchen-dashboard')).not.toBeInTheDocument();
  expect(screen.queryByText('barman-dashboard')).not.toBeInTheDocument();
});
