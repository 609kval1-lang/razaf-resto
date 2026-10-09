import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { cashierAPI } from '../../../services/api';
import CashierOtherAdditions from './CashierOtherAdditions';

jest.mock('../../../services/api', () => ({ cashierAPI: { getReadyOrders: jest.fn(), redistributeAdditions: jest.fn() } }));
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(window, 'crypto', { configurable: true, value: { getRandomValues: (bytes) => bytes.fill(1) } });
  cashierAPI.getReadyOrders.mockResolvedValue({ data: [1, 2].map((id) => ({ id, table_id: id, table: { table_number: id }, total_amount: 1251,
    payments: [], items: [{ id, order_id: id, source_table_id: id, quantity: 1, price_at_order: 1251, menu: { name: `Plat ${id}` } }] })) });
  cashierAPI.redistributeAdditions.mockResolvedValue({ data: [{ id: 3, order_label: 'Addition commune' }] });
});

test('regrouping existing tables requires a recap before opening payment', async () => {
  const open = jest.fn();
  render(<CashierOtherAdditions onOpenOrder={open} />);
  const checkboxes = await screen.findAllByRole('checkbox');
  checkboxes.forEach((checkbox) => fireEvent.click(checkbox));
  fireEvent.click(screen.getByRole('button', { name: 'Regrouper les additions' }));
  expect(cashierAPI.redistributeAdditions).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Verifier les additions' }));
  expect(screen.getByText('Recapitulatif des additions')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer et passer au paiement' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith({ id: 3, order_label: 'Addition commune' }));
  expect(cashierAPI.redistributeAdditions).toHaveBeenCalledWith(expect.objectContaining({ order_ids: [1, 2], groups: [
    { label: 'Addition commune', table_ids: [1, 2], items: [{ item_id: 1, quantity: 1 }, { item_id: 2, quantity: 1 }] },
  ] }));
});

test('splitting by table keeps quantities and blocks incomplete allocation', async () => {
  render(<CashierOtherAdditions />);
  (await screen.findAllByRole('checkbox')).forEach((checkbox) => fireEvent.click(checkbox));
  fireEvent.click(screen.getByRole('button', { name: 'Diviser les additions' }));
  expect(screen.getByLabelText('Nom addition 1')).toHaveValue('Table 1');
  expect(screen.getByLabelText('Nom addition 2')).toHaveValue('Table 2');
  const recap = screen.getByRole('button', { name: 'Verifier les additions' });
  expect(recap).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Quantite 1 addition 1'), { target: { value: '0' } });
  expect(recap).toBeDisabled();
});

test('a new named addition starts the normal catalogue flow', async () => {
  const create = jest.fn();
  render(<CashierOtherAdditions onNewOrder={create} />);
  await screen.findByText('Commandes en cours');
  fireEvent.change(screen.getByLabelText("Nom de l'addition"), { target: { value: 'Groupe 3 places' } });
  fireEvent.click(screen.getByRole('button', { name: 'Nouvelle addition' }));
  expect(create).toHaveBeenCalledWith('Groupe 3 places');
  expect(cashierAPI.redistributeAdditions).not.toHaveBeenCalled();
});
