import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { adminAPI } from '../../services/api';
import TreasuryManagement from './TreasuryManagement';

jest.mock('react-router-dom', () => ({ Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a> }), { virtual: true });
jest.mock('../../services/api', () => ({ adminAPI: { getTreasurySnapshot: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
  adminAPI.getTreasurySnapshot.mockResolvedValue({ data: {
    movements: [
      {
        id: 1, direction: 'in', status: 'approved', movement_type: 'sale',
        flow_type: 'customer_payment', flow_type_label: 'Encaissement client', amount: 12000,
        destination_account: 'cash', destination_account_label: 'Caisse',
        order_id: 4, customer_name: 'Lalao', table_number: 'T7', payment_method: 'cash',
        effective_at: '2026-10-09 08:00:00',
      },
      {
        id: 2, direction: 'out', status: 'approved', movement_type: 'transfer',
        flow_type: 'treasury_transfer', flow_type_label: 'Transfert de trésorerie', amount: 5000,
        source_account: 'cash', source_account_label: 'Caisse',
        destination_account: 'bank', destination_account_label: 'Banque',
        effective_at: '2026-10-09 09:00:00',
      },
    ],
    pending_vouchers: [],
    recent_customer_payments: [{ id: 99, status: 'pending', amount: 9000, customer_name: 'Non encaissé' }],
  } });
});

test('keeps treasury actions and moves its history to the dedicated page', async () => {
  render(<TreasuryManagement />);

  await screen.findByRole('heading', { name: 'Trésorerie multi-comptes' });
  expect(screen.getByRole('link', { name: 'Historiques' })).toHaveAttribute('href', '/admin/histories?view=treasury');
  expect(screen.queryByRole('heading', { name: 'Historique des mouvements' })).not.toBeInTheDocument();
  expect(screen.queryByText('Non encaissé')).not.toBeInTheDocument();
  expect(screen.queryByText(/Les paiements clients en attente ne figurent pas/)).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Règles d’alimentation des comptes' })).not.toBeInTheDocument();
  await waitFor(() => expect(adminAPI.getTreasurySnapshot).toHaveBeenCalledTimes(1));
});
