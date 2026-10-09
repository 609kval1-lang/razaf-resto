import { menuAvailabilityLabel, menuAvailabilityState, menuCategoryLabel, normalizeCashierSearch } from './cashierDisplay';

test('availability hints do not override whether a dish can be ordered', () => {
  expect(menuAvailabilityState({ is_orderable: true, max_portions_available: 6 })).toBe('available');
  expect(menuAvailabilityState({ is_orderable: true, max_portions_available: 5 })).toBe('low');
  expect(menuAvailabilityState({ is_orderable: false, max_portions_available: 10 })).toBe('unavailable');
  expect(menuAvailabilityLabel({ is_orderable: false })).toBe('Indisponible');
});

test('search ignores accents while category values keep meaningful labels', () => {
  expect(normalizeCashierSearch('  Cr\u00e8me Br\u00fbl\u00e9e  ')).toBe('creme brulee');
  expect(menuCategoryLabel('main')).toBe('Plats');
  expect(menuCategoryLabel('drink')).toBe('Boissons');
  expect(menuCategoryLabel('Specialites')).toBe('Specialites');
  expect(menuCategoryLabel(null)).toBe('Sans categorie');
});
