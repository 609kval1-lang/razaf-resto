import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { adminAPI } from '../../services/api';
import AdminHelp from './AdminHelp';

jest.mock('react-router-dom', () => ({ Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a> }), { virtual: true });
jest.mock('../../services/api', () => ({ adminAPI: { getTreasurySnapshot: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
  adminAPI.getTreasurySnapshot.mockResolvedValue({ data: { config: { payment_account_rules: [
    { payment_method: 'cash', payment_method_label: 'Cash', target_account_label: 'Caisse', note: 'Règle caisse du serveur.' },
    { payment_method: 'bon', payment_method_label: 'Bon client', target_account_label: 'En attente', note: 'Règle bon du serveur.' },
  ] } } });
});

test('groups usage guidance and shows live account rules only in the treasury rubric', async () => {
  render(<AdminHelp />);

  expect(screen.getByRole('heading', { name: 'Aide' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: /Trésorerie/ })).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByText('Règle caisse du serveur.')).toBeInTheDocument();
  expect(screen.getByText('Règle bon du serveur.')).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: /Stocks et achats/ }));
  expect(screen.getByRole('heading', { name: 'Acheter et suivre les matières premières' })).toBeInTheDocument();
  expect(screen.queryByText('Règle caisse du serveur.')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Ouvrir les matières premières' })).toHaveAttribute('href', '/admin/raw-materials');
  expect(adminAPI.getTreasurySnapshot).toHaveBeenCalledTimes(1);
});
