import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { adminAPI } from '../../services/api';
import MenuManagement from './MenuManagement';

jest.mock('../../services/api', () => ({
  adminAPI: { getMenus: jest.fn(), getIngredients: jest.fn(), createMenu: jest.fn(), updateMenu: jest.fn() },
  resolveApiAssetUrl: (value) => value,
}));
jest.mock('../common/DataTable', () => (props) => {
  const React = require('react');
  const actions = props.columns.find((column) => column.key === 'actions');
  return React.createElement('div', null, props.data.map((menu) => (
    React.createElement('div', { key: menu.id }, actions.render(menu))
  )));
});
jest.mock('../common/DialogProvider', () => ({ useDialog: () => ({ confirm: jest.fn() }) }));

beforeEach(() => {
  jest.clearAllMocks();
  adminAPI.getMenus.mockResolvedValue({ data: [] });
  adminAPI.getIngredients.mockResolvedValue({ data: [{
    id: 3, name: 'Portion farine', portion_size: 0.1, portion_unit: 'kg',
    quantity_available: 0, cost_per_portion: 100,
    raw_material: { id: 4, name: 'Farine', unit: 'kg' },
  }] });
  adminAPI.createMenu.mockResolvedValue({ data: {} });
  adminAPI.updateMenu.mockResolvedValue({ data: {} });
});

test('lets admin configure an out-of-stock recipe without silently rounding a sale price', async () => {
  render(<MenuManagement />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ajouter Menu' }));
  expect(screen.getByText('Non calculable')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Nom du menu'), { target: { value: 'Crêpe' } });
  fireEvent.change(screen.getByLabelText('Prix de vente (Ar)'), { target: { value: '500.5' } });
  const form = screen.getByRole('button', { name: 'Créer' }).closest('form');
  fireEvent.submit(form);
  expect(adminAPI.createMenu).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('Prix de vente (Ar)'), { target: { value: '500' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ajouter Ingrédient' })).not.toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter Ingrédient' }));
  fireEvent.click(await screen.findByRole('button', { name: /Portion farine/ }));
  expect(screen.getByText('400.0 %')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Prix de vente (Ar)'), { target: { value: '50' } });
  expect(screen.getByText('-50.0 %')).toHaveClass('is-negative');
  fireEvent.change(screen.getByLabelText('Prix de vente (Ar)'), { target: { value: '500' } });
  fireEvent.submit(form);

  await waitFor(() => expect(adminAPI.createMenu).toHaveBeenCalledTimes(1));
  const payload = adminAPI.createMenu.mock.calls[0][0];
  expect(payload.get('price')).toBe('500');
  expect(payload.get('ingredients[0][ingredient_id]')).toBe('3');
  expect(payload.get('ingredients[0][quantity_needed]')).toBe('1');
});

test('recalculates the pricing preview while editing an existing recipe', async () => {
  adminAPI.getMenus.mockResolvedValue({ data: [{
    id: 8, name: 'Crêpe', description: '', price: 400, category: 'main', is_available: true,
    ingredients: [{ id: 3, name: 'Portion farine', portion_size: 0.1, portion_unit: 'kg',
      pivot: { quantity_needed: 1 } }],
  }] });
  render(<MenuManagement />);
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
  expect(await screen.findByText('300.0 %')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Prix de vente (Ar)'), { target: { value: '500' } });
  expect(screen.getByText('400.0 %')).toBeInTheDocument();
  fireEvent.submit(screen.getAllByRole('button', { name: 'Modifier' }).at(-1).closest('form'));
  await waitFor(() => expect(adminAPI.updateMenu).toHaveBeenCalledWith(8, expect.any(FormData)));
  expect(adminAPI.updateMenu.mock.calls[0][1].get('price')).toBe('500');
});
