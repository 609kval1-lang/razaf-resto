import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { cashierAPI } from '../../../services/api';
import { CashierCashRegisterModule, CashierHistoryModule, CashierOverviewModule, CashierPaymentsModule } from './CashierModules';

jest.mock('../../../services/api', () => ({ cashierAPI: {
  getReadyOrders: jest.fn(), getCustomers: jest.fn(), processPayment: jest.fn(), preparePayment: jest.fn(),
  getCashMovements: jest.fn(), requestCashWithdrawal: jest.fn(),
  getDayStats: jest.fn(), getPaymentHistory: jest.fn(),
} }));
jest.mock('../../common/ToastProvider', () => ({ useToast: () => ({ showToast: jest.fn() }) }));

beforeEach(() => {
  jest.clearAllMocks();
  cashierAPI.getReadyOrders.mockResolvedValue({ data: [] });
  cashierAPI.getCustomers.mockResolvedValue({ data: [] });
  cashierAPI.getDayStats.mockResolvedValue({ data: {} });
});
afterEach(() => jest.restoreAllMocks());

test('loads only the selected order with its recap and has no workflow notifications or polling', async () => {
  const interval = jest.spyOn(window, 'setInterval');
  render(<CashierPaymentsModule orderId={42} />);
  await screen.findByText('Aucune commande a encaisser.');
  expect(cashierAPI.getReadyOrders).toHaveBeenCalledWith({ include_items: 1, order_id: 42 });
  expect(screen.queryByText(/Notif navigateur/)).not.toBeInTheDocument();
  expect(screen.queryByText('Notifications addition')).not.toBeInTheDocument();
  expect(interval.mock.calls.filter((call) => call[1] >= 1000)).toHaveLength(0);
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(cashierAPI.getReadyOrders).toHaveBeenCalledTimes(2));
  interval.mockRestore();
});

test('shows items in the scoped payment recap', async () => {
  cashierAPI.getReadyOrders.mockResolvedValue({ data: [{
    id: 42, total_amount: 2502, status: 'served', table: { table_number: 1 }, payments: [],
    items: [{ id: 1, quantity: 2, price_at_order: 1251, menu: { name: 'Riz poulet' } }],
  }] });
  render(<CashierPaymentsModule orderId={42} />);
  expect(await screen.findByText('Riz poulet')).toBeInTheDocument();
});

test('rejects fractional partial payments without silently rounding or contacting the API', async () => {
  cashierAPI.getReadyOrders.mockResolvedValue({ data: [{
    id: 42, total_amount: 2502, status: 'served', table: { table_number: 1 },
    payments: [{ id: 1, status: 'pending', method: 'cash', amount: 2502 }],
    items: [{ id: 1, quantity: 2, price_at_order: 1251, menu: { name: 'Riz poulet' } }],
  }] });
  render(<CashierPaymentsModule orderId={42} />);
  await screen.findByText('Riz poulet');
  fireEvent.change(screen.getByLabelText(/Type de r/), { target: { value: 'split_voucher' } });
  const amount = screen.getByLabelText(/Montant encaiss/);
  expect(amount).toHaveAttribute('min', '1');
  expect(amount).toHaveAttribute('step', '1');
  fireEvent.change(amount, { target: { value: '500.5' } });
  expect(amount).toHaveValue(500.5);
  fireEvent.click(screen.getByRole('button', { name: 'Valider encaissement' }));
  expect(await screen.findByText('Saisissez un montant entier en Ariary, sans decimales.')).toBeInTheDocument();
  expect(cashierAPI.processPayment).not.toHaveBeenCalled();
  expect(cashierAPI.preparePayment).not.toHaveBeenCalled();
});

const collectibleOrder = (deposit = 0) => ({
  id: 42, total_amount: 2502, status: 'served', table: { table_number: 1 },
  payments: [{ id: 1, status: 'pending', method: 'cash', amount: 2502, deposit_amount: deposit }],
});

test('cash tender and change stay on screen and never enter the API or browser storage', async () => {
  sessionStorage.clear();
  cashierAPI.getReadyOrders.mockResolvedValueOnce({ data: [collectibleOrder()] }).mockResolvedValue({ data: [] });
  cashierAPI.processPayment.mockResolvedValue({ data: { amount_paid: 2502 } });
  render(<CashierPaymentsModule orderId={42} />);
  fireEvent.change(await screen.findByLabelText('Montant remis'), { target: { value: '5000' } });
  expect(screen.getByLabelText('Monnaie a rendre').textContent.replace(/\s/g, '')).toBe('2498Ar');
  fireEvent.click(screen.getByRole('button', { name: 'Valider encaissement' }));
  await screen.findByText('Aucune commande a encaisser.');
  expect(cashierAPI.processPayment).toHaveBeenCalledWith(42, { method: 'cash', expected_balance: 2502, reference: null, customer_id: null, customer_name: null });
  expect(screen.getByText(/Monnaie a rendre :/).textContent.replace(/\s/g, '')).toContain('2498Ar');
  expect(sessionStorage.length).toBe(0);
});

test('insufficient cash blocks collection but mobile money has no cash tender requirement', async () => {
  cashierAPI.getReadyOrders.mockResolvedValue({ data: [collectibleOrder()] });
  cashierAPI.processPayment.mockResolvedValue({ data: {} });
  render(<CashierPaymentsModule orderId={42} />);
  fireEvent.change(await screen.findByLabelText('Montant remis'), { target: { value: '2000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Valider encaissement' }));
  await screen.findByText('Le montant remis est inferieur au montant a payer.', { selector: '.staff-message' });
  expect(cashierAPI.processPayment).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/Mode d'encaissement/), { target: { value: 'mobile_money' } });
  expect(screen.queryByLabelText('Montant remis')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Valider encaissement' }));
  await waitFor(() => expect(cashierAPI.processPayment).toHaveBeenCalledWith(42, expect.objectContaining({ method: 'mobile_money' })));
});

test('deposit credit reduces cash due and the local change calculator', async () => {
  cashierAPI.getReadyOrders.mockResolvedValue({ data: [collectibleOrder(1000)] });
  render(<CashierPaymentsModule orderId={42} />);
  fireEvent.change(await screen.findByLabelText('Montant remis'), { target: { value: '2000' } });
  expect(screen.getByLabelText('Montant')).toHaveValue(1502);
  expect(screen.getByLabelText('Monnaie a rendre')).toHaveTextContent('498 Ar');
});

test('operations voucher collection requests only vouchers, not ordinary table payments', async () => {
  render(<CashierPaymentsModule scope="vouchers" />);
  await screen.findByText('Bons a encaisser');
  expect(cashierAPI.getReadyOrders).toHaveBeenCalledWith({ include_items: 0, scope: 'vouchers' });
});

test('withdrawals show the operational forms and lists without financial KPI cards', async () => {
  cashierAPI.getCashMovements.mockResolvedValue({ data: { summary: { cash_available: 7437 }, pending_withdrawals: [], movements: [] } });
  render(<CashierCashRegisterModule />);
  await screen.findByText('Demander une sortie de caisse');
  expect(screen.queryByText('Caisse disponible')).not.toBeInTheDocument();
  expect(screen.queryByText('Total Recettes (jour)')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Montant (Ar)')).toHaveAttribute('step', '1');
});

test('dashboard shows exactly five daily indicators then availability then the daily collection history', async () => {
  cashierAPI.getDayStats.mockResolvedValue({ data: { total_revenue: 29000, customer_count: 7,
    cash_register: { cash_available: 7437 }, dashboard_sales: { drinks: 9000, dishes: 20000 },
    by_method: [{ method: 'cash', count: 2, total: 4000, account_label: 'Caisse' }],
    recent_customer_payments: [{ id: 1, order_id: 42, amount: 5000, collected_amount: 4000,
      deposit_amount: 1000, method: 'cash', status: 'completed', target_account_label: 'Caisse',
      encashed_at: '2026-10-08T09:00:00Z', order: { order_type: 'takeaway' } }],
  } });
  const view = render(<CashierOverviewModule><section aria-label="Disponibilites des plats">Plats disponibles</section></CashierOverviewModule>);
  await screen.findByText('Nombre de clients');
  const cards = [...view.container.querySelectorAll('.staff-stat-card')];
  expect(cards.map((card) => card.querySelector('span').textContent)).toEqual([
    'CA du jour', 'Caisse disponible', 'Nombre de clients', 'Boissons', 'Plats',
  ]);
  expect(cards.map((card) => card.querySelector('strong').textContent.replace(/\s/g, ''))).toEqual([
    '29000Ar', '7437Ar', '7', '9000Ar', '20000Ar',
  ]);
  const availability = screen.getByRole('region', { name: 'Disponibilites des plats' });
  const distribution = screen.getByRole('heading', { name: 'Repartition des encaissements' });
  const recent = screen.getByRole('heading', { name: /Paiements clients/ });
  expect(cards[4].compareDocumentPosition(availability) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(availability.compareDocumentPosition(distribution) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(distribution.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const recentTable = recent.closest('.staff-card').querySelector('table');
  expect(within(recentTable).getByText('4 000 Ar', { exact: false })).toBeInTheDocument();
  expect(within(recentTable).queryByText('5 000 Ar', { exact: false })).not.toBeInTheDocument();
  expect(cashierAPI.getReadyOrders).not.toHaveBeenCalled();
  expect(view.container.querySelector('input[type="date"]')).not.toBeInTheDocument();
});

test('cashier payment history has no past date selector and refreshes without expanding the day', async () => {
  cashierAPI.getPaymentHistory.mockResolvedValue({ data: { data: [] } });
  const view = render(<CashierHistoryModule />);
  await screen.findByText('Historique paiements et bons');
  expect(view.container.querySelector('input[type="date"]')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Filtrer' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
  await screen.findByText('Aucun paiement ou bon trouve.');
  expect(cashierAPI.getPaymentHistory.mock.calls).toEqual([[], []]);
});
