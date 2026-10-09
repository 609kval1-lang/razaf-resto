import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { adminAPI } from '../../services/api';
import RawMaterialManagement from './RawMaterialManagement';

const mockConfirm = jest.fn();

jest.mock('react-router-dom', () => ({ useLocation: () => ({ search: '' }) }), { virtual: true });
jest.mock('../../services/api', () => ({ adminAPI: {
  getRawMaterials: jest.fn(), getSuppliers: jest.fn(), getRawMaterialPriceVariations: jest.fn(),
  getTreasurySnapshot: jest.fn(), createRawMaterial: jest.fn(), createSupplierPurchase: jest.fn(),
} }));
jest.mock('../common/DataTable', () => () => null);
jest.mock('../common/DialogProvider', () => ({ useDialog: () => ({ confirm: mockConfirm }) }));
jest.mock('../common/ToastProvider', () => ({ useToast: () => ({ showToast: jest.fn() }) }));

beforeEach(() => {
  jest.clearAllMocks();
  adminAPI.getRawMaterials.mockResolvedValue({ data: [] });
  adminAPI.getSuppliers.mockResolvedValue({ data: [{ id: 1, name: 'Supplier' }] });
  adminAPI.getRawMaterialPriceVariations.mockResolvedValue({ data: { variations: [] } });
  adminAPI.getTreasurySnapshot.mockResolvedValue({ data: {} });
  adminAPI.createRawMaterial.mockResolvedValue({ data: {} });
  adminAPI.createSupplierPurchase.mockResolvedValue({ data: {} });
  mockConfirm.mockResolvedValue(true);
});

test('records an existing-material purchase with an explicit cost decision and no duplicate payment', async () => {
  adminAPI.getRawMaterials.mockResolvedValue({ data: [{
    id: 4, name: 'Farine', unit: 'kg', stock: 1, cost: 100, suppliers: [{ id: 1, name: 'Supplier' }],
  }] });
  render(<RawMaterialManagement />);

  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer un achat' }));
  fireEvent.change(screen.getByLabelText('Matière première'), { target: { value: '4' } });
  expect(screen.getByLabelText('Fournisseur')).toHaveValue('1');
  fireEvent.change(screen.getByLabelText('Quantité (kg)'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText("Prix d'achat par unité (Ar)"), { target: { value: '150' } });
  fireEvent.change(screen.getByLabelText('Paiement initial (Ar)'), { target: { value: '50' } });
  fireEvent.click(screen.getByLabelText(/nouveau coût de référence/));

  expect(screen.getByText(/Dette restante :/)).toHaveTextContent('250 Ar');
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer l’achat' }));

  await waitFor(() => expect(adminAPI.createSupplierPurchase).toHaveBeenCalledWith(1, expect.objectContaining({
    raw_material_id: 4, quantity: 2, unit_price: 150, initial_paid_amount: 50,
    payment_mode: 'credit', update_reference_cost: true,
  })));
  expect(mockConfirm).toHaveBeenCalledTimes(1);
  expect(adminAPI.createSupplierPurchase).toHaveBeenCalledTimes(1);
});

test('shows the debit account for a full purchase before entering an amount and uses the selected account', async () => {
  adminAPI.getRawMaterials.mockResolvedValue({ data: [{
    id: 4, name: 'Farine', unit: 'kg', stock: 1, cost: 100, suppliers: [{ id: 1, name: 'Supplier' }],
  }] });
  render(<RawMaterialManagement />);
  fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer un achat' }));
  fireEvent.change(screen.getByLabelText('Règlement'), { target: { value: 'cash' } });

  expect(screen.getByLabelText('Compte débité')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Matière première'), { target: { value: '4' } });
  fireEvent.change(screen.getByLabelText('Quantité (kg)'), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText("Prix d'achat par unité (Ar)"), { target: { value: '150' } });
  fireEvent.change(screen.getByLabelText('Compte débité'), { target: { value: 'safe' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer l’achat' }));

  await waitFor(() => expect(adminAPI.createSupplierPurchase).toHaveBeenCalledWith(1, expect.objectContaining({
    raw_material_id: 4, quantity: 2, unit_price: 150, payment_mode: 'cash',
    initial_paid_amount: 300, payment_method: 'cash', cash_source_account: 'safe',
  })));
  expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('depuis Coffre') }));
});

test('keeps fractional stock quantities while financial inputs and purchase totals use whole Ariary', async () => {
  render(<RawMaterialManagement />);
  fireEvent.click(await screen.findByRole('button', { name: /Ajouter Mati/ }));
  const stock = screen.getByLabelText('Stock disponible');
  const price = screen.getByLabelText(/Co.t unitaire/);
  expect(stock).toHaveAttribute('step', '0.001');
  expect(price).toHaveAttribute('step', '1');
  fireEvent.change(screen.getByLabelText('Nom'), { target: { value: 'Spice' } });
  fireEvent.change(stock, { target: { value: '0.003' } });
  fireEvent.change(price, { target: { value: '500' } });
  expect(stock.validity.stepMismatch).toBe(false);
  const supplier = screen.getByLabelText('Choisir un fournisseur');
  fireEvent.change(supplier, { target: { value: '1' } });
  expect(screen.getByText(/Total achat initial:/)).toHaveTextContent('2 Ar');
  fireEvent.submit(screen.getByRole('form', { name: 'Matiere premiere' }));
  await waitFor(() => expect(adminAPI.createRawMaterial).toHaveBeenCalledWith(expect.objectContaining({
    stock: 0.003, cost: 500, supplier_id: 1, purchase_initial_paid_amount: 0,
  })));
});
