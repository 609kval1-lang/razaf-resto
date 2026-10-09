import { buildOrderDraftCart, getDraftStockState, normalizeOrderDrafts, persistOrderDrafts, readOrderDrafts } from './cashierOrderDrafts';

beforeEach(() => sessionStorage.clear());
afterEach(() => jest.restoreAllMocks());

test('keeps only positive integer table, menu and quantity values', () => {
  expect(normalizeOrderDrafts({
    invalid: { quantities: { 1: 2 } },
    1: { quantities: { 1: 2, 2: 0, 3: -1, 4: 1.5, invalid: 2, 5: '2' }, notes: 'Sans oignon' },
  })).toEqual({ 1: { quantities: { 1: 2 }, notes: 'Sans oignon' } });
  expect(normalizeOrderDrafts(null)).toEqual({});
  expect(normalizeOrderDrafts([])).toEqual({});
});

test('persists quantities and notes but not old prices, separately for each account', () => {
  expect(persistOrderDrafts('cashier.1', { 1: { quantities: { 1: 2 }, notes: 'Sans oignon', price: 123 } })).toBe(true);
  expect(readOrderDrafts('cashier.1')).toEqual({ 1: { quantities: { 1: 2 }, notes: 'Sans oignon' } });
  expect(readOrderDrafts('cashier.2')).toEqual({});
});

test('handles invalid storage and a browser refusing session storage', () => {
  sessionStorage.setItem('invalid', '{');
  expect(readOrderDrafts('invalid')).toEqual({});
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
  expect(persistOrderDrafts('blocked', {})).toBe(false);
});

test('uses current rounded catalogue prices and keeps deleted items visible for removal', () => {
  const cart = buildOrderDraftCart({ quantities: { 1: 3, 2: 2, 3: 1 } }, [
    { id: 1, name: 'Rice', price: 1250.6, is_available: true },
    { id: 2, name: 'Drink', price: 2000, is_available: false },
  ]);
  expect(cart[0]).toMatchObject({ unitPrice: 1251, quantity: 3, total: 3753, isAvailable: true });
  expect(cart[1]).toMatchObject({ total: 4000, isAvailable: false });
  expect(cart[2]).toMatchObject({ unitPrice: null, total: null, isAvailable: false });
});

test('shares raw stock between different dishes rather than adding their capacities', () => {
  const first = { id: 1, is_orderable: true, stock_requirements: [{ raw_material_id: 1, available_units: 1000000, quantity_units: 400000 }] };
  const second = { id: 2, is_orderable: true, stock_requirements: [{ raw_material_id: 1, available_units: 1000000, quantity_units: 300000 }] };
  const state = getDraftStockState({ quantities: { 1: 2 } }, [first, second]);
  expect(state.canAdd(second)).toBe(false);
  expect(state.exceedsStock).toBe(false);
  expect(getDraftStockState({ quantities: { 1: 2, 2: 1 } }, [first, second]).exceedsStock).toBe(true);
});

test('retains valid retry tokens but drops invalid tokens and out of range quantities', () => {
  const checkoutToken = '01010101-0101-4101-8101-010101010101';
  persistOrderDrafts('retry', { 1: { quantities: { 1: 1, 2: 100001 }, notes: '', checkoutToken } });
  expect(readOrderDrafts('retry')).toEqual({ 1: { quantities: { 1: 1 }, notes: '', checkoutToken } });
  expect(normalizeOrderDrafts({ 1: { quantities: {}, notes: '', checkoutToken: '-'.repeat(36) } })).toEqual({ 1: { quantities: {}, notes: '' } });
});
