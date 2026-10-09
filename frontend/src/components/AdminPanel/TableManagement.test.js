import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { adminAPI } from '../../services/api';
import TableManagement from './TableManagement';

jest.mock('../../services/api', () => ({ adminAPI: {
  getTables: jest.fn(), createTable: jest.fn(), updateTable: jest.fn(), deleteTable: jest.fn(),
} }));

beforeEach(() => {
  jest.clearAllMocks();
  adminAPI.getTables.mockResolvedValue({ data: [
    { id: 1, table_number: 1, capacity: 4, section: 'bar', status: 'free' },
    { id: 2, table_number: 2, capacity: 6, section: 'Salon prive', status: 'free' },
  ] });
  adminAPI.createTable.mockResolvedValue({ data: {} });
  adminAPI.updateTable.mockResolvedValue({ data: {} });
});

test('keeps legacy locations out of the table list and creation form', async () => {
  render(<TableManagement />);
  await screen.findByRole('button', { name: 'Ajouter Table' });
  expect(screen.queryByRole('columnheader', { name: /Emplacement/ })).not.toBeInTheDocument();
  expect(screen.queryByText('Salon prive')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter Table' }));
  const dialog = within(screen.getByRole('dialog'));
  expect(dialog.queryByText('Emplacement')).not.toBeInTheDocument();
  expect(dialog.queryByRole('option', { name: 'Bar' })).not.toBeInTheDocument();
  fireEvent.change(dialog.getByLabelText(/Num.ro de table/), { target: { value: '3' } });
  fireEvent.submit(dialog.getByRole('form', { name: 'Table' }));
  await waitFor(() => expect(adminAPI.createTable).toHaveBeenCalled());
  expect(adminAPI.createTable.mock.calls[0][0]).toMatchObject({ table_number: 3, capacity: 4, status: 'free' });
  expect(adminAPI.createTable.mock.calls[0][0]).not.toHaveProperty('section');
});

test('editing capacity leaves the historical location untouched in the API payload', async () => {
  render(<TableManagement />);
  await screen.findByRole('button', { name: 'Ajouter Table' });
  fireEvent.click(screen.getAllByRole('button', { name: 'Modifier' })[0]);
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.change(dialog.getByLabelText(/Capacit/), { target: { value: '5' } });
  fireEvent.submit(dialog.getByRole('form', { name: 'Table' }));
  await waitFor(() => expect(adminAPI.updateTable).toHaveBeenCalled());
  expect(adminAPI.updateTable.mock.calls[0]).toEqual([1, expect.objectContaining({ capacity: 5, status: 'free' })]);
  expect(adminAPI.updateTable.mock.calls[0][1]).not.toHaveProperty('section');
});
