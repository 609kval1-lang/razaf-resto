import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { cashierAPI } from '../../../services/api';
import { CashierAvailabilityModule } from './CashierAvailabilityModule';

jest.mock('../../../services/api', () => ({ cashierAPI: { getAvailability: jest.fn() } }));
const snapshot = (available) => ({ data: {
  updated_at: '2026-10-08T12:00:00Z',
  menus: [{ id: 1, name: 'Riz poulet', category: 'Plats', is_orderable: available > 0,
    max_portions_available: available, availability_reason: available ? null : 'Stock insuffisant',
    portions: [{ name: 'Riz 100g', available: available * 2 }] }],
} });

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  cashierAPI.getAvailability.mockResolvedValue(snapshot(3));
});
afterEach(() => {
  jest.useRealTimers();
});

test('refreshes only after a cashier action and stops listening after unmount', async () => {
  const view = render(<CashierAvailabilityModule />);
  await screen.findByRole('article', { name: 'Disponibilite de Riz poulet' });
  expect(screen.getByLabelText('Quantite disponible')).toHaveTextContent('3');
  fireEvent.click(screen.getByText('Ingredients (1)'));
  expect(screen.getByText('Riz 100g : 6')).toBeInTheDocument();
  cashierAPI.getAvailability.mockResolvedValue(snapshot(0));
  await act(async () => jest.advanceTimersByTime(5000));
  expect(cashierAPI.getAvailability).toHaveBeenCalledTimes(1);
  fireEvent(window, new CustomEvent('cashier:changed', { detail: { kind: 'order' } }));
  await screen.findByText('Stock insuffisant');
  expect(screen.getByText('Stock insuffisant')).toBeInTheDocument();
  view.unmount();
  fireEvent(window, new Event('cashier:changed'));
  await act(async () => jest.advanceTimersByTime(10000));
  expect(cashierAPI.getAvailability).toHaveBeenCalledTimes(2);
});

test('idle time focus and deposits do not reload availability', async () => {
  render(<CashierAvailabilityModule />);
  await screen.findByRole('article', { name: 'Disponibilite de Riz poulet' });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  await act(async () => jest.advanceTimersByTime(15000));
  expect(cashierAPI.getAvailability).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  fireEvent(document, new Event('visibilitychange'));
  fireEvent(window, new Event('focus'));
  fireEvent(window, new CustomEvent('cashier:changed', { detail: { kind: 'deposit' } }));
  expect(cashierAPI.getAvailability).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Actualiser' })).toBeEnabled());
  expect(cashierAPI.getAvailability).toHaveBeenCalledTimes(2);
});

test('warns about stale data after a network error and does not overlap requests', async () => {
  let reject;
  cashierAPI.getAvailability.mockReturnValueOnce(new Promise((resolve, fail) => { reject = fail; }));
  render(<CashierAvailabilityModule />);
  await act(async () => jest.advanceTimersByTime(15000));
  expect(cashierAPI.getAvailability).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('Network')));
  expect(screen.getByRole('alert')).toHaveTextContent('dernieres disponibilites');
  await act(async () => jest.advanceTimersByTime(5000));
  expect(cashierAPI.getAvailability).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
  await screen.findByRole('article', { name: 'Disponibilite de Riz poulet' });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Quantite disponible')).toHaveTextContent('3');
});

test('counts distinct dishes rather than adding shared capacities and filters all categories without a new request', async () => {
  cashierAPI.getAvailability.mockResolvedValue({ data: { updated_at: '2026-10-08T12:00:00Z', menus: [
    { id: 1, name: 'Riz poulet', category: 'Plats', is_orderable: true, max_portions_available: 10 },
    { id: 2, name: 'Creme dessert', category: 'Desserts', is_orderable: true, max_portions_available: 2 },
    { id: 3, name: 'Riz poisson', category: 'Plats', is_orderable: false, max_portions_available: 0, availability_reason: 'Stock insuffisant' },
  ] } });
  render(<CashierAvailabilityModule />);
  await screen.findByRole('article', { name: 'Disponibilite de Riz poulet' });
  expect(screen.getByRole('option', { name: 'Disponibles (2)' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Disponibilite'), { target: { value: 'low' } });
  expect(screen.getByRole('article', { name: 'Disponibilite de Creme dessert' })).toBeInTheDocument();
  expect(screen.queryByRole('article', { name: 'Disponibilite de Riz poulet' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Disponibilite'), { target: { value: 'all' } });
  fireEvent.change(screen.getByLabelText('Categorie'), { target: { value: 'Desserts' } });
  expect(screen.getAllByRole('article')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Rechercher un plat'), { target: { value: 'creme' } });
  expect(screen.getByRole('article', { name: 'Disponibilite de Creme dessert' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Rechercher un plat'), { target: { value: 'inconnu' } });
  expect(screen.getByText('Aucun plat ne correspond a votre recherche.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reinitialiser les filtres' }));
  expect(screen.getAllByRole('article')).toHaveLength(3);
  expect(cashierAPI.getAvailability).toHaveBeenCalledTimes(1);
});

test('manual refresh is unavailable during a request and runs after completion', async () => {
  let resolve;
  cashierAPI.getAvailability.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  render(<CashierAvailabilityModule />);
  expect(screen.getByRole('button', { name: 'Actualiser' })).toBeDisabled();
  await act(async () => resolve(snapshot(3)));
  fireEvent.click(screen.getByRole('button', { name: 'Actualiser' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Actualiser' })).toBeEnabled());
  expect(cashierAPI.getAvailability).toHaveBeenCalledTimes(2);
});

test('keeps the title refresh and accessible filters in one toolbar with compact ingredient details', async () => {
  render(<CashierAvailabilityModule />);
  const card = await screen.findByRole('article', { name: 'Disponibilite de Riz poulet' });
  const toolbar = screen.getByRole('heading', { name: 'Disponibilites' }).closest('header');
  expect(within(toolbar).getByRole('button', { name: 'Actualiser' })).toHaveAttribute('title', expect.stringContaining('Derniere actualisation'));
  expect(within(toolbar).getByLabelText('Rechercher un plat')).toBeInTheDocument();
  expect(within(toolbar).getByLabelText('Categorie')).toBeInTheDocument();
  expect(within(toolbar).getByLabelText('Disponibilite')).toBeInTheDocument();
  expect(within(card).getByRole('heading', { name: 'Riz poulet' })).toBeInTheDocument();
  expect(within(card).getByText('Stock faible')).toBeInTheDocument();
  expect(within(card).getByLabelText('Quantite disponible')).toHaveTextContent('3');
  expect(within(card).getByText('Ingredients (1)').closest('details')).not.toHaveAttribute('open');
  expect(within(card).queryByText('Plats')).not.toBeInTheDocument();
  expect(screen.queryByText(/Voir les portions|disponible\(s\)/)).not.toBeInTheDocument();
  expect(screen.queryByText(/La carte en temps reel|en un coup d'oeil|partagent aussi son stock|Actualisation toutes/)).not.toBeInTheDocument();
});

test('keeps unavailability reasons in the ingredient detail while showing the state and zero quantity', async () => {
  cashierAPI.getAvailability.mockResolvedValue(snapshot(0));
  render(<CashierAvailabilityModule />);
  const card = await screen.findByRole('article', { name: 'Disponibilite de Riz poulet' });
  expect(within(card).getByText('Indisponible')).toBeInTheDocument();
  expect(within(card).getByLabelText('Quantite disponible')).toHaveTextContent('0');
  const details = within(card).getByText('Ingredients (1)').closest('details');
  expect(details).not.toHaveAttribute('open');
  expect(within(details).getByText('Stock insuffisant')).toBeInTheDocument();
  expect(within(details).getByText('Riz 100g : 0')).toBeInTheDocument();
});

test('shows a readable first batch and reveals the remaining dishes on demand', async () => {
  cashierAPI.getAvailability.mockResolvedValue({ data: { menus: Array.from({ length: 15 }, (_, index) => ({
    id: index + 1, name: `Plat ${index + 1}`, category: 'Plats', is_orderable: true,
    max_portions_available: 2,
  })) } });
  render(<CashierAvailabilityModule />);
  await screen.findByRole('article', { name: 'Disponibilite de Plat 1' });
  expect(screen.getAllByRole('article')).toHaveLength(12);
  expect(screen.queryByRole('article', { name: 'Disponibilite de Plat 9' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Afficher 12 suivants' }));
  expect(screen.getAllByRole('article')).toHaveLength(15);
  fireEvent.change(screen.getByLabelText('Rechercher un plat'), { target: { value: 'Plat 15' } });
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByRole('article', { name: 'Disponibilite de Plat 15' })).toBeInTheDocument();
});

test('coalesces changes during a request without overlapping or losing the final stock update', async () => {
  let resolve;
  cashierAPI.getAvailability.mockReturnValueOnce(new Promise((done) => { resolve = done; })).mockResolvedValue(snapshot(0));
  render(<CashierAvailabilityModule />);
  fireEvent(window, new Event('cashier:changed'));
  fireEvent(window, new Event('cashier:changed'));
  expect(cashierAPI.getAvailability).toHaveBeenCalledTimes(1);
  await act(async () => resolve(snapshot(3)));
  await screen.findByText('Stock insuffisant');
  expect(cashierAPI.getAvailability).toHaveBeenCalledTimes(2);
});
