export const normalizeCashierSearch = (value) => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr').trim();

export const menuCategoryLabel = (value) => ({
  main: 'Plats', entree: 'Entrees', starter: 'Entrees', drink: 'Boissons',
  cocktail: 'Cocktails', dessert: 'Desserts', snack: 'Snacks', side: 'Accompagnements',
}[normalizeCashierSearch(value)] || value || 'Sans categorie');

export const menuAvailabilityState = (menu) => !menu.is_orderable ? 'unavailable'
  : Number(menu.max_portions_available) <= 5 ? 'low' : 'available';

export const menuAvailabilityLabel = (menu) => ({
  available: 'Disponible', low: 'Stock faible', unavailable: 'Indisponible',
}[menuAvailabilityState(menu)]);
