const isValidId = (value) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
const isValidDraftKey = (value) => isValidId(value) || /^(takeaway|other):[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value);

export const normalizeOrderDrafts = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(Object.entries(value)
    .filter(([tableId, draft]) => isValidDraftKey(tableId) && draft && typeof draft === 'object')
    .map(([tableId, draft]) => [tableId, {
      notes: typeof draft.notes === 'string' ? draft.notes : '',
      ...(!isValidId(tableId) ? { label: typeof draft.label === 'string' ? draft.label.slice(0, 120) : '' } : {}),
      ...(typeof draft.checkoutToken === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(draft.checkoutToken) ? { checkoutToken: draft.checkoutToken } : {}),
      quantities: Object.fromEntries(Object.entries(draft.quantities || {})
        .filter(([menuId, quantity]) => isValidId(menuId) && Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 100000)),
    }]));
};

export const readOrderDrafts = (storageKey) => {
  try {
    return normalizeOrderDrafts(JSON.parse(sessionStorage.getItem(storageKey)));
  } catch {
    return {};
  }
};

export const persistOrderDrafts = (storageKey, drafts) => {
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(normalizeOrderDrafts(drafts)));
    return true;
  } catch {
    return false;
  }
};

export const buildOrderDraftCart = (draft, menus) => {
  const menusById = new Map(menus.map((menu) => [String(menu.id), menu]));

  return Object.entries(draft.quantities || {}).map(([menuId, quantity]) => {
    const menu = menusById.get(menuId);
    const price = menu ? Math.round(Number(menu.price)) : null;
    const unitPrice = Number.isSafeInteger(price) && price >= 0 ? price : null;

    return {
      menuId,
      name: menu?.name || `Plat supprime (#${menuId})`,
      quantity,
      unitPrice,
      total: unitPrice === null ? null : unitPrice * quantity,
      isAvailable: Boolean(menu?.is_orderable ?? menu?.is_available) && unitPrice !== null,
    };
  });
};

export const getDraftStockState = (draft, menus) => {
  const remaining = new Map();
  menus.forEach((menu) => (menu.stock_requirements || []).forEach((item) => {
    const id = String(item.raw_material_id);
    remaining.set(id, Math.min(remaining.get(id) ?? Infinity, item.available_units));
  }));
  menus.forEach((menu) => (menu.stock_requirements || []).forEach((item) => {
    const id = String(item.raw_material_id);
    remaining.set(id, remaining.get(id) - item.quantity_units * (draft.quantities[menu.id] || 0));
  }));
  return {
    exceedsStock: Array.from(remaining.values()).some((value) => value < 0),
    canAdd: (menu) => Boolean(menu.is_orderable) && (menu.stock_requirements || []).length > 0
      && menu.stock_requirements.every((item) => remaining.get(String(item.raw_material_id)) >= item.quantity_units),
  };
};

export const createCheckoutToken = () => {
  if (window.crypto.randomUUID) return window.crypto.randomUUID();
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
