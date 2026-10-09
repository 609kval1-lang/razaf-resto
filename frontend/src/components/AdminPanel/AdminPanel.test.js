import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminPanel from './AdminPanel';

const mockLogout = jest.fn();

jest.mock('react-router-dom', () => {
  const React = require('react');
  const RouterContext = React.createContext(null);

  const MemoryRouter = ({ initialEntries, children }) => {
    const [pathname, setPathname] = React.useState(initialEntries[0]);
    return <RouterContext.Provider value={{ pathname, navigate: setPathname }}>{children}</RouterContext.Provider>;
  };

  const useLocation = () => ({ pathname: React.useContext(RouterContext).pathname });
  const useNavigate = () => React.useContext(RouterContext).navigate;
  const NavLink = ({ to, children, className, onClick }) => {
    const { pathname, navigate } = React.useContext(RouterContext);
    const resolvedClassName = typeof className === 'function' ? className({ isActive: pathname === to }) : className;
    return <a href={to} className={resolvedClassName} onClick={(event) => { event.preventDefault(); onClick?.(event); navigate(to); }}>{children}</a>;
  };
  const Routes = ({ children }) => {
    const { pathname } = React.useContext(RouterContext);
    const path = pathname === '/admin' ? '/' : pathname.slice('/admin'.length);
    const route = React.Children.toArray(children).find((child) => child.props.path === path);
    return route?.props.element || null;
  };

  return { MemoryRouter, Route: () => null, Routes, Link: NavLink, NavLink, useLocation, useNavigate };
}, { virtual: true });

jest.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Admin Test', role: 'admin' }, logout: mockLogout }),
}));

jest.mock('../../services/api', () => ({
  adminAPI: {
    getSummary: () => Promise.resolve({ data: {} }),
    getSupplierPayablesAlerts: () => Promise.resolve({ data: { alerts: [], summary: {} } }),
    getRevenueReport: () => Promise.resolve({ data: {} }),
    getCashMovements: () => Promise.resolve({ data: { summary: {} } }),
  },
}));

jest.mock('./UserManagement', () => () => <div>Page utilisateurs</div>);
jest.mock('./TableManagement', () => () => <div>Page tables</div>);
jest.mock('./RawMaterialManagement', () => () => <div>Page matières premières</div>);
jest.mock('./IngredientManagement', () => () => <div>Page ingrédients</div>);
jest.mock('./MenuManagement', () => () => <div>Page menus</div>);
jest.mock('./SupplierManagement', () => () => <div>Page fournisseurs</div>);
jest.mock('./EmployeePayrollManagement', () => () => <div>Page paie</div>);
jest.mock('./CashMovementManagement', () => () => <div>Page caisse admin</div>);
jest.mock('./RevenueDashboard', () => () => <div>Page recettes</div>);
jest.mock('./TreasuryManagement', () => () => <div>Page trésorerie</div>);

const renderAdmin = (initialPath = '/admin') => render(
  <MemoryRouter initialEntries={[initialPath]}>
    <AdminPanel />
  </MemoryRouter>
);

test('keeps admin pages reachable from the shared navigation', async () => {
  renderAdmin();

  fireEvent.click(screen.getByRole('link', { name: 'Tables et réservations' }));
  expect(await screen.findByText('Page tables')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('link', { name: 'Stocks & achats' }));
  fireEvent.click(screen.getByRole('link', { name: 'Matières premières' }));
  expect(await screen.findByText('Page matières premières')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('link', { name: 'Finance' }));
  fireEvent.click(screen.getByRole('link', { name: 'Trésorerie multi-comptes' }));
  expect(await screen.findByText('Page trésorerie')).toBeInTheDocument();
});

test('switches admin pages when selecting a top-level section', async () => {
  renderAdmin();

  fireEvent.click(screen.getByRole('link', { name: 'Stocks & achats' }));
  expect(await screen.findByText('Page matières premières')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Stocks & achats' })).toHaveClass('is-active');

  fireEvent.click(screen.getByRole('link', { name: 'Menus & production' }));
  expect(await screen.findByText('Page menus')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Stocks & achats' })).not.toHaveClass('is-active');
  expect(screen.getByRole('link', { name: 'Menus & production' })).toHaveClass('is-active');

  fireEvent.click(screen.getByRole('link', { name: 'Finance' }));
  expect(await screen.findByText('Page recettes')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('link', { name: 'Tables et réservations' }));
  expect(await screen.findByText('Page tables')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Finance' })).not.toHaveClass('is-active');
});

test('keeps password and logout actions available', () => {
  renderAdmin('/admin/cash-movements');

  expect(screen.getByText('Page caisse admin')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Caisse: demandes et validation' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Mot de passe' }));
  expect(screen.getByRole('heading', { name: 'Changer mon mot de passe' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));

  fireEvent.click(screen.getByRole('button', { name: 'Deconnexion' }));
  expect(mockLogout).toHaveBeenCalledTimes(1);
});
