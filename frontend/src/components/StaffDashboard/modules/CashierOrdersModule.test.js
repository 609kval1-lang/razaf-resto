import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { cashierAPI } from '../../../services/api';
import { CashierOrdersModule } from './CashierOrdersModule';

let mockUser = { id: 7 };
jest.mock('../../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../../../services/api', () => ({
  cashierAPI: { getOrderEntryTables: jest.fn(), getOrderEntryMenus: jest.fn(), createOrderEntry: jest.fn(), getReadyOrders: jest.fn() },
  resolveApiAssetUrl: () => '',
}));
jest.mock('./CashierModules', () => ({
  CashierPaymentsModule: ({ orderId }) => <div>Paiement commande {orderId}</div>,
}));

const tables = [
  { id: 1, table_number: 1, capacity: 4, status: 'free' },
  { id: 2, table_number: 2, capacity: 2, status: 'occupied', active_order_id: 42 },
  { id: 3, table_number: 3, capacity: 2, status: 'reserved', reservation_locked: true },
];
const menu = {
  id: 1, name: 'Riz poulet', price: 1251, category: 'Plats', is_available: true, is_orderable: true,
  max_portions_available: 2, stock_requirements: [{ raw_material_id: 1, available_units: 400000, quantity_units: 200000 }],
};
const unavailable = { ...menu, id: 2, name: 'Riz vide', is_orderable: false, max_portions_available: 0 };

beforeEach(() => {
  Object.defineProperty(window, 'crypto', { configurable: true, value: { getRandomValues: (bytes) => bytes.fill(1) } });
  jest.clearAllMocks();
  sessionStorage.clear();
  mockUser = { id: 7 };
  cashierAPI.getOrderEntryTables.mockResolvedValue({ data: tables });
  cashierAPI.getReadyOrders.mockResolvedValue({ data: [] });
  cashierAPI.getOrderEntryMenus.mockImplementation(async (params) => ({
    data: params?.ids ? [menu].filter((item) => params.ids.includes(item.id))
      : { data: [menu, unavailable], categories: ['Plats'], page: params?.page || 1, last_page: 2 },
  }));
  cashierAPI.createOrderEntry.mockResolvedValue({ data: { id: 90 } });
});
afterEach(() => jest.restoreAllMocks());

const flushMenuRequests = async () => {
  await act(async () => {
    await Promise.all(cashierAPI.getOrderEntryMenus.mock.results.map((result) => result.value));
  });
};

const chooseTable = async (number = 1) => {
  const button = await screen.findByRole('button', { name: `Selectionner la table ${number}` });
  fireEvent.click(button);
  await flushMenuRequests();
};
const addMenu = async () => {
  const button = await screen.findByRole('button', { name: 'Ajouter Riz poulet' });
  fireEvent.click(button);
  await flushMenuRequests();
};
const review = async () => {
  const button = await screen.findByRole('button', { name: /Voir le panier/ });
  fireEvent.click(button);
  await flushMenuRequests();
};

test('loads only tables until a table is chosen', async () => {
  render(<CashierOrdersModule />);
  await screen.findByRole('button', { name: 'Selectionner la table 1' });
  expect(cashierAPI.getOrderEntryMenus).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('Catalogue des plats')).not.toBeInTheDocument();
  await chooseTable();
  expect(await screen.findByRole('button', { name: 'Ajouter Riz vide' })).toBeDisabled();
  expect(cashierAPI.getOrderEntryMenus).toHaveBeenCalledWith(expect.objectContaining({ paginate: 1, page: 1 }));
  expect(screen.queryByLabelText('Tables')).not.toBeInTheDocument();
});

test('takeaway keeps catalogue review and payment steps and never submits a physical table', async () => {
  render(<CashierOrdersModule />);
  fireEvent.click(await screen.findByRole('button', { name: 'A emporter' }));
  await addMenu(); await review();
  expect(screen.queryByText('Paiement commande 90')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer et passer au paiement' }));
  await screen.findByText('Paiement commande 90');
  expect(cashierAPI.createOrderEntry).toHaveBeenCalledWith(expect.objectContaining({ table_id: null, order_type: 'takeaway' }));
});

test('other named additions keep all normal ordering steps', async () => {
  render(<CashierOrdersModule />);
  fireEvent.click(await screen.findByRole('button', { name: 'Autres' }));
  fireEvent.change(await screen.findByLabelText("Nom de l'addition"), { target: { value: 'Groupe 3 places' } });
  fireEvent.click(screen.getByRole('button', { name: 'Nouvelle addition' }));
  await addMenu(); await review();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer et passer au paiement' }));
  await screen.findByText('Paiement commande 90');
  expect(cashierAPI.createOrderEntry).toHaveBeenCalledWith(expect.objectContaining({ table_id: null, order_type: 'other', order_label: 'Groupe 3 places' }));
});

test('separates catalogue and review and submits authoritative item quantities with a token', async () => {
  render(<CashierOrdersModule />);
  await chooseTable();
  await addMenu();
  await review();
  expect(screen.queryByLabelText('Catalogue des plats')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Total du brouillon')).toHaveTextContent('1');
  fireEvent.change(screen.getByLabelText('Notes de la table'), { target: { value: 'Sans sel' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer et passer au paiement' }));
  await screen.findByText('Paiement commande 90');
  expect(cashierAPI.createOrderEntry).toHaveBeenCalledWith({
    table_id: 1, notes: 'Sans sel', checkout_token: expect.stringMatching(/^[a-f\d-]{36}$/),
    items: [{ menu_id: 1, quantity: 1 }],
  });
  await waitFor(() => expect(JSON.parse(sessionStorage.getItem('cashier.order-entry.drafts.7'))).toEqual({}));
});

test('resumes occupied tables directly and never loads the catalogue', async () => {
  render(<CashierOrdersModule />);
  await chooseTable(2);
  expect(await screen.findByText('Paiement commande 42')).toBeInTheDocument();
  expect(cashierAPI.getOrderEntryMenus).not.toHaveBeenCalled();
  expect(cashierAPI.createOrderEntry).not.toHaveBeenCalled();
});

test('reservation-locked tables cannot be selected', async () => {
  render(<CashierOrdersModule />);
  expect(await screen.findByRole('button', { name: 'Selectionner la table 3' })).toBeDisabled();
});

test('shows tables in batches while keeping search and selection available', async () => {
  cashierAPI.getOrderEntryTables.mockResolvedValue({ data: Array.from({ length: 15 }, (_, index) => ({
    id: index + 1, table_number: index + 1, capacity: 4, status: 'free',
  })) });
  render(<CashierOrdersModule />);
  await screen.findByRole('button', { name: 'Selectionner la table 1' });
  expect(screen.getAllByRole('button', { name: /Selectionner la table/ })).toHaveLength(12);
  expect(screen.queryByRole('button', { name: 'Selectionner la table 15' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Afficher 12 tables suivantes' }));
  expect(screen.getAllByRole('button', { name: /Selectionner la table/ })).toHaveLength(15);
  fireEvent.change(screen.getByLabelText('Rechercher une table'), { target: { value: '15' } });
  expect(screen.getAllByRole('button', { name: /Selectionner la table/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Selectionner la table 15' }));
  await screen.findByRole('button', { name: 'Ajouter Riz poulet' });
  expect(screen.getByRole('heading', { name: 'Table 15' })).toBeInTheDocument();
});

test('limits the basket according to shared raw stock and keeps quantity reductions available', async () => {
  render(<CashierOrdersModule />);
  await chooseTable();
  await addMenu();
  await addMenu();
  expect(screen.getByRole('button', { name: 'Ajouter Riz poulet' })).toBeDisabled();
  await review();
  expect(screen.getByLabelText('Total du brouillon').textContent.replace(/\s/g, '')).toBe('2502Ar');
  expect(screen.getByRole('button', { name: 'Augmenter Riz poulet' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Diminuer Riz poulet' }));
  expect(screen.getByRole('button', { name: 'Augmenter Riz poulet' })).toBeEnabled();
});

test('preserves drafts and reuses the same token after a failed request', async () => {
  cashierAPI.createOrderEntry.mockRejectedValueOnce(new Error('Network'));
  render(<CashierOrdersModule />);
  await chooseTable();
  await addMenu();
  await review();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer et passer au paiement' }));
  await screen.findByRole('alert');
  const first = cashierAPI.createOrderEntry.mock.calls[0][0];
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmer et passer au paiement' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer et passer au paiement' }));
  await screen.findByText('Paiement commande 90');
  expect(cashierAPI.createOrderEntry.mock.calls[1][0]).toEqual(first);
});

test('double clicks cannot create two orders', async () => {
  let resolve;
  cashierAPI.createOrderEntry.mockReturnValue(new Promise((done) => { resolve = done; }));
  render(<CashierOrdersModule />);
  await chooseTable();
  await addMenu();
  await review();
  const button = screen.getByRole('button', { name: 'Confirmer et passer au paiement' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(cashierAPI.createOrderEntry).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ data: { id: 91 } }));
  await screen.findByText('Paiement commande 91');
});

test('restores session drafts and isolates another cashier account', async () => {
  const view = render(<CashierOrdersModule />);
  await chooseTable();
  await addMenu();
  await review();
  fireEvent.change(screen.getByLabelText('Notes de la table'), { target: { value: 'Allergie' } });
  view.unmount();
  const { unmount } = render(<CashierOrdersModule />);
  await chooseTable();
  await review();
  expect(screen.getByLabelText('Notes de la table')).toHaveValue('Allergie');
  unmount();
  mockUser = { id: 8 };
  render(<CashierOrdersModule />);
  await chooseTable();
  expect(await screen.findByRole('button', { name: /Voir le panier/ })).toBeDisabled();
});

test('warns when session storage is unavailable without crashing', async () => {
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
  render(<CashierOrdersModule />);
  await chooseTable();
  expect(screen.getByRole('alert')).toHaveTextContent('sauvegarde du brouillon est indisponible');
  await addMenu();
  await review();
  expect(screen.getByRole('button', { name: 'Confirmer et passer au paiement' })).toBeEnabled();
});

test('requests pagination and debounced search from the backend', async () => {
  render(<CashierOrdersModule />);
  await chooseTable();
  await screen.findByRole('button', { name: 'Ajouter Riz poulet' });
  fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
  await waitFor(() => expect(cashierAPI.getOrderEntryMenus).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
  fireEvent.change(screen.getByLabelText('Rechercher un plat'), { target: { value: 'Riz' } });
  await waitFor(() => expect(cashierAPI.getOrderEntryMenus).toHaveBeenCalledWith(expect.objectContaining({ search: 'Riz', page: 1 })));
});

test('keeps a deleted dish visible in the recap but prevents validation', async () => {
  sessionStorage.setItem('cashier.order-entry.drafts.7', JSON.stringify({ 1: { quantities: { 99: 1 }, notes: '' } }));
  render(<CashierOrdersModule />);
  await chooseTable();
  await review();
  expect(screen.getByText('Plat supprime (#99)')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirmer et passer au paiement' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
  expect(screen.queryByText('Plat supprime (#99)')).not.toBeInTheDocument();
});

test('shows a global table overview with active additions and filters drafts without loading menus', async () => {
  sessionStorage.setItem('cashier.order-entry.drafts.7', JSON.stringify({ 1: { quantities: { 1: 2 }, notes: '' } }));
  cashierAPI.getOrderEntryTables.mockResolvedValue({ data: [tables[0], {
    ...tables[1], active_order: { id: 42, total_amount: 2502, item_count: 2 },
  }, tables[2]] });
  render(<CashierOrdersModule />);
  await screen.findByRole('button', { name: 'Selectionner la table 1' });
  expect(screen.getByText('Commande #42 / 2 articles')).toBeInTheDocument();
  expect(screen.getByText(/2\s*502 Ar/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Commandes en cours 1/ }));
  expect(screen.queryByRole('button', { name: 'Selectionner la table 1' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Selectionner la table 2' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Brouillons 1/ }));
  expect(screen.getByRole('button', { name: 'Selectionner la table 1' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Selectionner la table 2' })).not.toBeInTheDocument();
  expect(cashierAPI.getOrderEntryMenus).not.toHaveBeenCalled();
});

test('keeps the basket visible across catalogue pages and supports quantity changes without a recap round trip', async () => {
  render(<CashierOrdersModule />);
  await chooseTable();
  await addMenu();
  const basket = within(screen.getByRole('complementary', { name: 'Panier de la table' }));
  expect(basket.getByLabelText('Quantite de Riz poulet')).toHaveTextContent('1');
  fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
  await waitFor(() => expect(cashierAPI.getOrderEntryMenus).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
  await flushMenuRequests();
  expect(basket.getByLabelText('Quantite de Riz poulet')).toHaveTextContent('1');
  fireEvent.click(basket.getByRole('button', { name: 'Augmenter Riz poulet' }));
  expect(basket.getByLabelText('Quantite de Riz poulet')).toHaveTextContent('2');
  expect(screen.getByRole('button', { name: 'Ajouter Riz poulet' })).toBeDisabled();
  fireEvent.click(basket.getByRole('button', { name: 'Diminuer Riz poulet' }));
  expect(basket.getByLabelText('Quantite de Riz poulet')).toHaveTextContent('1');
  expect(screen.getByRole('button', { name: 'Ajouter Riz poulet' })).toBeEnabled();
});

test('uses table numbers without legacy zones or instructional stock copy', async () => {
  cashierAPI.getOrderEntryTables.mockResolvedValue({ data: [
    { ...tables[0], section: 'Salon prive' }, { ...tables[1], section: 'Bar' },
  ] });
  render(<CashierOrdersModule />);
  await screen.findByRole('button', { name: 'Selectionner la table 1' });
  expect(screen.queryByText('Salon prive')).not.toBeInTheDocument();
  expect(screen.queryByText('Bar')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Zone')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Rechercher une table'), { target: { value: '2' } });
  expect(screen.queryByRole('button', { name: 'Selectionner la table 1' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Selectionner la table 2' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Rechercher une table'), { target: { value: '' } });
  await chooseTable();
  await addMenu();
  await review();
  expect(screen.queryByText(/Aucun stock retire|La salle en un coup d'oeil|Tables libres, commandes/)).not.toBeInTheDocument();
  expect(screen.getByLabelText('Total du brouillon')).toHaveTextContent('1');
  expect(screen.getByRole('button', { name: 'Confirmer et passer au paiement' })).toBeEnabled();
});

test('does not reset a fast page change while the initial search is unchanged', async () => {
  jest.useFakeTimers();
  try {
    render(<CashierOrdersModule />);
    await chooseTable();
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
    await flushMenuRequests();
    expect(screen.getByText('Page 2 / 2')).toBeInTheDocument();
    const count = cashierAPI.getOrderEntryMenus.mock.calls.length;
    await act(async () => jest.advanceTimersByTime(500));
    expect(screen.getByText('Page 2 / 2')).toBeInTheDocument();
    expect(cashierAPI.getOrderEntryMenus).toHaveBeenCalledTimes(count);
  } finally {
    jest.useRealTimers();
  }
});
