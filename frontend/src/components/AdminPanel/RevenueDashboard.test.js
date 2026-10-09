import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { adminAPI } from '../../services/api';
import RevenueDashboard from './RevenueDashboard';

jest.mock('../../services/api', () => ({ adminAPI: {
  getRevenueReport: jest.fn(), updateMenu: jest.fn(),
} }));

jest.mock('../common/DataTable', () => (props) => {
  const React = require('react');
  const testId = props.searchPlaceholder.includes('impacté') ? 'impact-table' : 'ranking-table';
  return React.createElement('div', { 'data-testid': testId }, props.data.map((row) => (
    React.createElement('span', { key: row.menu_id }, row.menu_name)
  )));
});

beforeEach(() => {
  jest.clearAllMocks();
  const dishes = {
    menu_id: 1, menu_name: 'Riz', menu_category: 'main', menu_family: 'dishes',
    rank_category: 'dishes', rank_in_category: 1, total_quantity: 2,
    total_revenue_net: 900,
  };
  const drinks = {
    menu_id: 2, menu_name: 'Jus', menu_category: 'drink', menu_family: 'drinks',
    rank_category: 'drinks', rank_in_category: 1, total_quantity: 1,
    total_revenue_net: 100,
  };
  adminAPI.getRevenueReport.mockResolvedValue({ data: {
    filters: { scope_label: '7 derniers jours', from: '2026-10-01 00:00:00', to: '2026-10-08 23:59:59' },
    summary: { total_revenue_net: 1000, total_revenue_gross: 1100, total_discount: 100,
      dishes_revenue_net: 900, drinks_revenue_net: 100 },
    users: [],
    category_summary: [{ category: 'dishes' }, { category: 'drinks' }],
    rankings: { most_demanded: [dishes, drinks] },
    menu_pricing_impact: [
      { ...dishes, baseline_unit_cost: 200, current_unit_cost: 250, unit_cost_change_amount: 50,
        current_catalog_price: 500, recommended_action: 'increase' },
      { ...drinks, baseline_unit_cost: 100, current_unit_cost: 80, unit_cost_change_amount: -20,
        current_catalog_price: 300, recommended_action: 'decrease' },
    ],
  } });
});

test('shows net family totals and keeps ranking and price-impact filters independent', async () => {
  render(<RevenueDashboard />);
  await screen.findByRole('heading', { name: 'Administration des Recettes' });

  expect(screen.getByRole('heading', { name: 'Plats' }).parentElement).toHaveTextContent('900 Ar');
  expect(screen.getByRole('heading', { name: 'Boissons' }).parentElement).toHaveTextContent('100 Ar');
  expect(within(screen.getByTestId('ranking-table')).getByText('Riz')).toBeInTheDocument();
  expect(within(screen.getByTestId('ranking-table')).getByText('Jus')).toBeInTheDocument();

  const familyFilters = screen.getAllByRole('combobox', { name: 'Famille' });
  fireEvent.change(familyFilters[0], { target: { value: 'dishes' } });
  expect(within(screen.getByTestId('ranking-table')).queryByText('Jus')).not.toBeInTheDocument();
  expect(within(screen.getByTestId('impact-table')).getByText('Jus')).toBeInTheDocument();

  fireEvent.change(familyFilters[1], { target: { value: 'drinks' } });
  expect(within(screen.getByTestId('impact-table')).queryByText('Riz')).not.toBeInTheDocument();
  expect(within(screen.getByTestId('impact-table')).getByText('Jus')).toBeInTheDocument();
  await waitFor(() => expect(adminAPI.getRevenueReport).toHaveBeenCalledTimes(1));
});
