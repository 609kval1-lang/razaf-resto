import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { cashierAPI } from '../../../services/api';
import { CashierDepositsModule } from './CashierOperationsModule';

jest.mock('../../../services/api', () => ({ cashierAPI: {
  getReservationDeposits: jest.fn(), getOrderEntryTables: jest.fn(), receiveReservationDeposit: jest.fn(),
} }));
jest.mock('./CashierModules', () => ({ CashierCashRegisterModule: () => null, CashierPaymentsModule: () => null }));
jest.mock('react-router-dom', () => ({ useSearchParams: () => [new URLSearchParams(), jest.fn()] }), { virtual: true });

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'crypto', { configurable: true, value: { getRandomValues: (bytes) => bytes.fill(1) } });
  cashierAPI.getReservationDeposits.mockResolvedValue({ data: [] });
  cashierAPI.getOrderEntryTables.mockResolvedValue({ data: [] });
  cashierAPI.receiveReservationDeposit.mockResolvedValue({ data: { id: 1 } });
});

test('a reservation deposit sends only the received accounting amount, never tender or change', async () => {
  render(<CashierDepositsModule />);
  await screen.findByText('Aucun acompte enregistre.');
  fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'Alice' } });
  fireEvent.change(screen.getByLabelText('Date de reservation'), { target: { value: '2026-10-09T12:00' } });
  fireEvent.change(screen.getByLabelText("Montant de l'acompte"), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('Montant remis'), { target: { value: '2000' } });
  expect(screen.getByLabelText('Monnaie a rendre').textContent.replace(/\s/g, '')).toBe('1000Ar');
  fireEvent.click(screen.getByRole('button', { name: "Encaisser l'acompte" }));
  await waitFor(() => expect(cashierAPI.receiveReservationDeposit).toHaveBeenCalledTimes(1));
  expect(cashierAPI.receiveReservationDeposit).toHaveBeenCalledWith({ customer_name: 'Alice', table_id: null,
    reservation_at: expect.any(String), amount: 1000, method: 'cash', reference: null, receipt_token: expect.any(String) });
});
