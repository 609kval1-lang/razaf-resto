import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { adminAPI } from '../../services/api';
import AdminHistories from './AdminHistories';

let mockSearch = '';
jest.mock('react-router-dom', () => ({
  Link: ({ children, to, ...props }) => <a href={to} {...props}>{children}</a>,
  useLocation: () => ({ search: mockSearch }),
}), { virtual: true });
jest.mock('../../services/api', () => ({ adminAPI: {
  getTreasuryHistory: jest.fn(), getSuppliers: jest.fn(), getSupplierLedger: jest.fn(), getEmployeePayrollSnapshot: jest.fn(),
} }));

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch = '';
  adminAPI.getTreasuryHistory.mockResolvedValue({ data: {
    data: [{ id: 5, flow_type_label: 'Encaissement client', direction: 'in', amount: 12000,
      order_id: 7, customer_name: 'Lalao', destination_account_label: 'Caisse', status: 'approved',
      effective_at: '2026-10-09 08:00:00' }],
    total: 21, current_page: 1, last_page: 2,
  } });
  adminAPI.getSuppliers.mockResolvedValue({ data: [{ id: 2, name: 'Fournisseur A' }] });
  adminAPI.getSupplierLedger.mockResolvedValue({ data: { purchases: [
    { id: 11, raw_material: { name: 'Farine' }, total_amount: 2000, paid_amount: 2000,
      remaining_amount: 0, purchased_at: '2026-10-09 08:00:00', payments: [{ id: 31, amount: 2000, method: 'cash' }] },
    { id: 12, raw_material: { name: 'Riz' }, total_amount: 1000, paid_amount: 0,
      remaining_amount: 1000, purchased_at: '2026-10-08 08:00:00', payments: [] },
  ] } });
  adminAPI.getEmployeePayrollSnapshot.mockResolvedValue({ data: {
    employees: [{ id: 3, name: 'Soa' }],
    transactions: [{ id: 41, user_id: 3, employee_name: 'Soa', transaction_type: 'advance',
      net_amount: 500, gross_amount: 500, payment_method: 'cash', source_account: 'cash', paid_at: '2026-10-09 08:00:00' }],
  } });
});

test('loads paginated treasury movements and applies the linked cash-account filter', async () => {
  mockSearch = '?view=treasury&account=cash';
  render(<AdminHistories />);

  expect(await screen.findByText('Commande #7 · Lalao')).toBeInTheDocument();
  expect(adminAPI.getTreasuryHistory).toHaveBeenCalledWith({ flow: 'all', account: 'cash', search: '', page: 1 });
  expect(adminAPI.getSupplierLedger).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
  await waitFor(() => expect(adminAPI.getTreasuryHistory).toHaveBeenLastCalledWith({ flow: 'all', account: 'cash', search: '', page: 2 }));
});

test('shows supplier purchases in a separate filtered history', async () => {
  mockSearch = '?view=suppliers&supplier=2';
  render(<AdminHistories />);

  expect(await screen.findByText('Farine')).toBeInTheDocument();
  expect(screen.getByText('Riz')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Règlement' }), { target: { value: 'settled' } });
  expect(screen.getByText('Farine')).toBeInTheDocument();
  expect(screen.queryByText('Riz')).not.toBeInTheDocument();
  expect(adminAPI.getSupplierLedger).toHaveBeenCalledWith('2');
  expect(adminAPI.getTreasuryHistory).not.toHaveBeenCalled();
});

test('keeps payroll transactions separate from treasury movements', async () => {
  mockSearch = '?view=payroll&employee=3';
  render(<AdminHistories />);

  expect(await screen.findByRole('cell', { name: 'Soa' })).toBeInTheDocument();
  expect(screen.getByText('Net : 500 Ar')).toBeInTheDocument();
  expect(adminAPI.getEmployeePayrollSnapshot).toHaveBeenCalledTimes(1);
  expect(adminAPI.getTreasuryHistory).not.toHaveBeenCalled();
});
