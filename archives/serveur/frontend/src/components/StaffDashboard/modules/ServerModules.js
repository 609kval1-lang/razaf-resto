import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { serverAPI, resolveApiAssetUrl } from '../../../services/api';
import { useAuth } from '../../../contexts/AuthContext';
import { getSuggestedMenuImageUrl } from '../../../utils/menuImage';
import { playNotificationTone } from '../../../utils/notificationSound';
import { formatPaymentMethodLabel } from '../../../utils/paymentMethods';
import {
  getBrowserNotificationToggleLabel,
  getLocalBrowserNotificationEnabled,
  isBrowserNotificationSupported,
  persistLocalBrowserNotificationEnabled,
  requestBrowserNotificationPermission,
} from '../../../utils/browserNotification';
import { useDialog } from '../../common/DialogProvider';
import { useToast } from '../../common/ToastProvider';

const LIVE_REFRESH_INTERVAL_MS = 5000;
const SNAPSHOT_REFRESH_INTERVAL_MS = 60000;
const SERVER_NOTIFICATION_STORAGE_KEY = 'staff.notifications.server';
const CATEGORY_RULES = [
  { key: 'plats', label: 'Plats', order: 10, keywords: ['plat', 'main', 'repas', 'meal'] },
  { key: 'cocktails', label: 'Cocktails (Bar)', order: 20, keywords: ['cocktail', 'mocktail'] },
  { key: 'boissons', label: 'Boissons', order: 21, keywords: ['boisson', 'drink', 'beverage', 'jus', 'soda', 'eau', 'cafe', 'the'] },
  { key: 'snacks', label: 'Snacks', order: 25, keywords: ['snack', 'street food', 'burger', 'sandwich', 'panini', 'frite', 'tacos'] },
  { key: 'desserts', label: 'Desserts', order: 30, keywords: ['dessert', 'sweet', 'gateau'] },
  { key: 'entrees', label: 'Entrées', order: 40, keywords: ['entree', 'entrée', 'starter', 'appetizer'] },
  { key: 'accompagnements', label: 'Accompagnements', order: 50, keywords: ['accompagnement', 'side'] },
];

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} Ar`;
};

const roundAriary = (value) => Math.round(Number(value || 0) + Number.EPSILON);

const LOCAL_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

const parseDateTimeValue = (value) => {
  if (!value) {
    return null;
  }

  const normalizedValue = String(value).trim();
  const localMatch = normalizedValue.match(LOCAL_DATETIME_PATTERN);

  if (localMatch) {
    const [, year, month, day, hour = '00', minute = '00'] = localMatch;
    return { year, month, day, hour, minute };
  }

  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    day: String(date.getDate()).padStart(2, '0'),
    hour: String(date.getHours()).padStart(2, '0'),
    minute: String(date.getMinutes()).padStart(2, '0'),
  };
};

const formatDateTime = (value) => {
  const parsedDate = parseDateTimeValue(value);
  if (!parsedDate) return '-';

  return `${parsedDate.day}/${parsedDate.month}/${parsedDate.year} ${parsedDate.hour}:${parsedDate.minute}`;
};

const extractApiError = (error, fallbackMessage) => {
  return error?.response?.data?.message || error?.response?.data?.error || fallbackMessage;
};

const normalizeText = (value) => String(value || '').toLowerCase().trim();

const getCategoryMeta = (menu) => {
  const category = normalizeText(menu?.category);
  const name = normalizeText(menu?.name);
  const source = `${category} ${name}`;

  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => source.includes(keyword))) {
      return { key: rule.key, label: rule.label, order: rule.order };
    }
  }

  if (category) {
    const formatted = String(menu?.category || 'Autres').trim();
    const label = formatted.charAt(0).toUpperCase() + formatted.slice(1);
    return { key: `cat-${category.replace(/[^a-z0-9]+/g, '-')}`, label, order: 60 };
  }

  return { key: 'autres', label: 'Autres', order: 70 };
};

const buildMenuPlaceholder = (menuName = 'Menu') => {
  const safeName = String(menuName || 'Menu').trim() || 'Menu';
  const initials = safeName
    .split(/\s+/)
    .map((chunk) => chunk[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0f766e"/>
          <stop offset="100%" stop-color="#115e59"/>
        </linearGradient>
      </defs>
      <rect width="640" height="420" fill="url(#bg)"/>
      <circle cx="520" cy="80" r="90" fill="rgba(255,255,255,0.15)"/>
      <circle cx="120" cy="360" r="110" fill="rgba(255,255,255,0.1)"/>
      <text x="50%" y="48%" dominant-baseline="middle" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="120" fill="#ffffff" font-weight="700">${initials || 'M'}</text>
      <text x="50%" y="80%" dominant-baseline="middle" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="30" fill="#d1fae5">${safeName}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

const getMenuImage = (menu) => {
  const remoteImage = resolveApiAssetUrl(menu?.image_url);
  if (remoteImage && !remoteImage.includes('loremflickr.com')) {
    return remoteImage;
  }

  return getSuggestedMenuImageUrl(menu);
};

const normalizePreparationStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'preparing' ? 'in_kitchen' : normalized;
};

const statusLabel = (status) => {
  const normalizedStatus = normalizePreparationStatus(status);
  const labels = {
    pending: 'En attente',
    in_kitchen: 'En preparation',
    ready: 'Prête',
    served: 'Servie',
    paid: 'Payée',
  };

  return labels[normalizedStatus] || normalizedStatus;
};

const normalizeStationKey = (station) => {
  return String(station || '').toLowerCase() === 'bar' ? 'bar' : 'kitchen';
};

const getOrderTableLabel = (order) => {
  return order?.order_type === 'takeaway'
    ? 'A emporter'
    : (order?.table?.table_number ? `Table ${order.table.table_number}` : 'Sans table');
};

const getStationSummaryStatus = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return 'pending';
  }

  const statuses = items.map((item) => normalizePreparationStatus(item?.status));
  const allReadyOrServed = statuses.every((status) => ['ready', 'served', 'cancelled'].includes(status));

  if (allReadyOrServed) {
    const allServed = statuses.every((status) => ['served', 'cancelled'].includes(status));
    return allServed ? 'served' : 'ready';
  }

  const hasInProgress = statuses.some((status) => ['in_kitchen', 'ready', 'served'].includes(status));
  return hasInProgress ? 'in_kitchen' : 'pending';
};

const getOrderStationSummaries = (order) => {
  const items = Array.isArray(order?.items) ? order.items : [];
  const summary = {
    bar: { key: 'bar', label: 'Bar', total: 0, ready: 0, items: [] },
    kitchen: { key: 'kitchen', label: 'Cuisine', total: 0, ready: 0, items: [] },
  };

  items.forEach((item) => {
    const stationKey = normalizeStationKey(item?.station);
    const quantity = Math.max(1, Number(item?.quantity || 1));
    const status = normalizePreparationStatus(item?.status);

    summary[stationKey].total += quantity;
    summary[stationKey].items.push(item);
    if (['ready', 'served'].includes(status)) {
      summary[stationKey].ready += quantity;
    }
  });

  return ['bar', 'kitchen']
    .map((key) => ({
      ...summary[key],
      status: getStationSummaryStatus(summary[key].items),
    }))
    .filter((entry) => entry.total > 0);
};

const getOrderStationProgress = (order) => {
  return getOrderStationSummaries(order).map(({ label, total, ready }) => ({ label, total, ready }));
};

const formatOrderStationProgress = (order) => {
  return getOrderStationProgress(order)
    .map((entry) => `${entry.label}: ${entry.ready}/${entry.total} prêt${entry.ready > 1 ? 's' : ''}`)
    .join(' · ');
};

const getPaidOrderPaymentMethod = (order) => {
  if (String(order?.status || '') !== 'paid') {
    return '';
  }

  return String(order?.latest_payment?.method || '').trim();
};

const getOrderItemSummary = (order) => {
  const items = Array.isArray(order?.items) ? order.items : [];

  const summary = items
    .map((item) => `${item.quantity}x ${item?.menu?.name || `Menu #${item.menu_id}`}`)
    .join(', ');

  return summary || 'Aucun menu';
};

const canRequestBillForOrder = (order) => {
  const items = Array.isArray(order?.items) ? order.items : [];
  const orderStatus = normalizePreparationStatus(order?.status);

  if (items.length === 0 || order?.bill_requested_at || ['paid', 'archived'].includes(orderStatus)) {
    return false;
  }

  return items.every((item) => ['ready', 'served', 'cancelled'].includes(normalizePreparationStatus(item?.status)));
};

const canServeOrderItem = (item) => {
  return normalizePreparationStatus(item?.status) === 'ready';
};

const PaidOrderStatusMeta = ({ order }) => {
  const paymentMethod = getPaidOrderPaymentMethod(order);
  if (!paymentMethod) {
    return null;
  }

  return (
    <small className="staff-status-caption">
      {formatPaymentMethodLabel(paymentMethod)}
    </small>
  );
};

const buildCustomerContextNote = (customer) => {
  if (!customer) {
    return '';
  }

  const allergies = String(customer?.allergies || '').trim();
  const preferredCooking = String(customer?.preferred_cooking || '').trim();
  const notes = String(customer?.notes || '').trim();

  if (!allergies && !preferredCooking) {
    return notes;
  }

  const isAlreadyFormatted = /(?:Allergies:|Cuisson préférée:|Notes:)/i.test(notes);
  if (notes && isAlreadyFormatted) {
    return notes;
  }

  const parts = [];
  if (allergies) {
    parts.push(`Allergies: ${allergies}`);
  }

  if (preferredCooking) {
    parts.push(`Cuisson préférée: ${preferredCooking}`);
  }

  if (notes) {
    parts.push(`Notes: ${notes}`);
  }

  return parts.join(' | ');
};

const getMenuIngredients = (menu) => {
  return Array.isArray(menu?.ingredients) ? menu.ingredients : [];
};

const getIngredientRequiredPortions = (ingredient) => {
  const value = Number(
    ingredient?.required_portions_per_menu
    ?? ingredient?.quantity_needed_per_menu
    ?? ingredient?.pivot?.quantity_needed
    ?? 0
  );

  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
};

const getIngredientAvailablePortions = (ingredient) => {
  const value = Number(ingredient?.available_portions ?? ingredient?.quantity_available ?? 0);

  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
};

const getMenuMaxPortionsAvailable = (menu) => {
  const explicitMax = Number(menu?.max_portions_available);
  if (Number.isFinite(explicitMax)) {
    return Math.max(0, Math.trunc(explicitMax));
  }

  const ingredients = getMenuIngredients(menu);
  if (ingredients.length === 0) {
    return 0;
  }

  return ingredients.reduce((currentMin, ingredient) => {
    const required = getIngredientRequiredPortions(ingredient);
    const available = getIngredientAvailablePortions(ingredient);
    const maxForIngredient = required > 0 ? Math.floor(available / required) : 0;

    return Math.min(currentMin, maxForIngredient);
  }, Number.POSITIVE_INFINITY);
};

const isMenuOrderable = (menu) => {
  if (typeof menu?.is_orderable === 'boolean') {
    return menu.is_orderable;
  }

  if (typeof menu?.is_available === 'boolean') {
    return menu.is_available;
  }

  return getMenuMaxPortionsAvailable(menu) > 0;
};

const getMenuAvailabilityReasons = (menu) => {
  if (Array.isArray(menu?.availability_reasons)) {
    return menu.availability_reasons.filter((reason) => String(reason || '').trim() !== '');
  }

  if (typeof menu?.is_available === 'boolean' && !menu.is_available) {
    return ['Menu indisponible actuellement.'];
  }

  if (getMenuMaxPortionsAvailable(menu) <= 0) {
    return ['Stock insuffisant (information uniquement).'];
  }

  return [];
};

const getMenuInsufficientIngredients = (menu) => {
  return Array.isArray(menu?.insufficient_ingredients) ? menu.insufficient_ingredients : [];
};

const getMenuAlternatives = (menu) => {
  return Array.isArray(menu?.alternative_menus) ? menu.alternative_menus : [];
};

const formatInsufficientIngredientLabel = (entry, variant = 'full') => {
  const name = String(entry?.name || '').trim() || 'Ingrédient';
  const reason = String(entry?.reason || '').trim();

  if (reason === 'raw_material_missing') {
    return variant === 'short'
      ? `${name} (matière première non liée)`
      : `${name}: matière première non liée`;
  }

  const required = Number(entry?.required || 0);
  const available = Number(entry?.available || 0);

  return variant === 'short'
    ? `${name} (requis ${required}, dispo ${available})`
    : `${name}: requis ${required}, dispo ${available}`;
};

const buildOrderCreationErrorMessage = (error) => {
  const payload = error?.response?.data || {};
  const rawError = String(payload?.error || payload?.message || '').trim();
  const insufficient = Array.isArray(payload?.insufficient) ? payload.insufficient : [];
  const alternatives = Array.isArray(payload?.alternatives) ? payload.alternatives : [];
  const rawMaterials = Array.isArray(payload?.raw_materials) ? payload.raw_materials : [];

  if (insufficient.length === 0 && alternatives.length === 0 && rawMaterials.length === 0) {
    return rawError || extractApiError(error, 'Création de commande impossible.');
  }

  const insufficientLabel = insufficient
    .slice(0, 3)
    .map((entry) => formatInsufficientIngredientLabel(entry))
    .join(' | ');

  const alternativesLabel = alternatives
    .slice(0, 3)
    .map((entry) => entry?.name)
    .filter(Boolean)
    .join(', ');

  const rawMaterialsLabel = rawMaterials
    .slice(0, 3)
    .map((entry) => `${entry.name}: requis ${Number(entry.required || 0).toFixed(2)}, dispo ${Number(entry.available || 0).toFixed(2)} ${entry.unit || ''}`.trim())
    .join(' | ');

  const parts = [];
  if (rawError) parts.push(rawError);
  if (insufficientLabel) parts.push(`Ingrédients manquants: ${insufficientLabel}.`);
  if (alternativesLabel) parts.push(`Alternatives: ${alternativesLabel}.`);
  if (rawMaterialsLabel) parts.push(`Matières premières: ${rawMaterialsLabel}.`);

  return parts.join(' ');
};

const buildOrderCreationErrorDetails = (error) => {
  const payload = error?.response?.data || {};
  const insufficient = Array.isArray(payload?.insufficient) ? payload.insufficient : [];
  const alternatives = Array.isArray(payload?.alternatives) ? payload.alternatives : [];
  const rawMaterials = Array.isArray(payload?.raw_materials) ? payload.raw_materials : [];
  const existingServerName = String(
    payload?.existing_server?.name
    || payload?.existing_server_name
    || ''
  ).trim();
  const existingOrderId = Number(payload?.existing_order_id || 0);

  return {
    text: buildOrderCreationErrorMessage(error),
    insufficient: insufficient.slice(0, 6),
    alternatives: alternatives.slice(0, 6),
    rawMaterials: rawMaterials.slice(0, 6),
    requireConfirmation: Boolean(payload?.require_confirmation),
    confirmationReason: String(payload?.confirmation_reason || '').trim(),
    existingServerName,
    existingOrderId: Number.isFinite(existingOrderId) && existingOrderId > 0 ? existingOrderId : null,
    missingIngredientsNote: String(payload?.missing_ingredients_note || '').trim(),
  };
};

const buildMissingIngredientsSpecialRequest = (baseSpecialRequests, insufficient, suggestedNote = '') => {
  const base = String(baseSpecialRequests || '').trim();
  const note = String(suggestedNote || '').trim();

  if (note) {
    return base.includes(note) ? base : (base ? `${base} | ${note}` : note);
  }

  const ingredientNames = Array.from(new Set(
    (Array.isArray(insufficient) ? insufficient : [])
      .map((entry) => String(entry?.name || '').trim())
      .filter(Boolean)
  ));

  if (ingredientNames.length === 0) {
    return base;
  }

  const fallbackNote = `Adaptation stock: servir sans ${ingredientNames.join(', ')}.`;
  return base ? `${base} | ${fallbackNote}` : fallbackNote;
};

const buildStockShortageConfirmationMessage = (details) => {
  const ingredientsLabel = (Array.isArray(details?.insufficient) ? details.insufficient : [])
    .slice(0, 5)
    .map((entry) => formatInsufficientIngredientLabel(entry, 'short'))
    .join(' · ');

  const rawMaterialsLabel = (Array.isArray(details?.rawMaterials) ? details.rawMaterials : [])
    .slice(0, 3)
    .map((entry) => `${entry.name} (${Number(entry.available || 0).toFixed(2)} ${entry.unit || ''} dispo)`)
    .join(' · ');

  const parts = ['Des ingrédients manquent pour cette commande.'];
  if (ingredientsLabel) parts.push(`Manquants: ${ingredientsLabel}.`);
  if (rawMaterialsLabel) parts.push(`Stocks concernés: ${rawMaterialsLabel}.`);
  parts.push('Vous pouvez poursuivre la commande sans ces ingrédients ou l’annuler.');

  return parts.join(' ');
};

const buildForeignServerAppendConfirmationMessage = ({ tableNumber, orderId, serverName }) => {
  const orderLabel = Number(orderId) > 0 ? `commande #${orderId}` : 'commande en cours';
  const ownerLabel = String(serverName || '').trim() || 'un autre serveur';
  const tableLabel = Number(tableNumber) > 0 ? `La table ${tableNumber}` : 'Cette table';

  return `${tableLabel} est rattachée à la ${orderLabel} prise par ${ownerLabel}. Voulez-vous quand même ajouter des articles à cette commande ?`;
};

const tableSectionLabel = (section) => {
  const normalized = normalizeText(section);

  if (!normalized) {
    return 'Salle';
  }

  if (['bar', 'barre'].includes(normalized)) {
    return 'Bar';
  }

  return 'Salle';
};

const tableStatusLabel = (status) => {
  const labels = {
    free: 'Libre',
    reserved: 'Réservée',
    occupied: 'Occupée',
  };

  return labels[status] || status;
};

const getTableReservationHint = (table) => {
  if (String(table?.status || '') !== 'reserved') {
    return '';
  }

  if (table?.reservation_locked) {
    return `Bloquée à partir de ${formatDateTime(table?.reservation_lock_at)}`;
  }

  return `Réservée mais encore utilisable jusqu'à ${formatDateTime(table?.reservation_lock_at)}`;
};

const StatusBadge = ({ status }) => {
  return <span className={`staff-status-badge staff-status-${status}`}>{statusLabel(status)}</span>;
};

const StationStatusBadge = ({ station }) => {
  const summary = `${station.ready}/${station.total}`;

  return (
    <span
      className={`staff-status-badge staff-station-status-badge is-${station.key} staff-status-${station.status}`}
      title={`${station.label}: ${summary} prêt${station.ready > 1 ? 's' : ''} · ${statusLabel(station.status)}`}
    >
      <strong>{station.label}</strong>
      <small>{statusLabel(station.status)} · {summary}</small>
    </span>
  );
};

const MessageBanner = ({ message, hideInline = false }) => {
  const { showToast } = useToast();
  const lastToastKeyRef = useRef('');

  useEffect(() => {
    const text = String(message?.text || '').trim();
    if (!text) {
      lastToastKeyRef.current = '';
      return;
    }

    const type = message?.type === 'error' ? 'error' : 'success';
    const key = `${type}:${text}`;
    if (lastToastKeyRef.current === key) {
      return;
    }

    lastToastKeyRef.current = key;
    showToast({ type, message: text });
  }, [message, showToast]);

  if (!message || hideInline) return null;
  return (
    <div className={`staff-message ${message.type === 'error' ? 'is-error' : 'is-success'}`}>
      {message.text}
    </div>
  );
};

export const ServerOverviewModule = () => {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [tables, setTables] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [menus, setMenus] = useState([]);
  const [orders, setOrders] = useState([]);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setMessage(null);
    }

    try {
      const response = await serverAPI.getDashboardSnapshot();
      const snapshot = response?.data || {};

      setTables(Array.isArray(snapshot.tables) ? snapshot.tables : []);
      setCustomers(Array.isArray(snapshot.customers) ? snapshot.customers : []);
      setMenus(Array.isArray(snapshot.menus) ? snapshot.menus : []);
      setOrders(Array.isArray(snapshot.orders) ? snapshot.orders : []);
    } catch (error) {
      setMessage({
        type: 'error',
        text: extractApiError(error, 'Impossible de charger le tableau de bord serveur.'),
      });
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  const loadOrders = useCallback(async ({ silent = false } = {}) => {
    try {
      const ordersRes = await serverAPI.getMyOrders();
      setOrders(Array.isArray(ordersRes.data) ? ordersRes.data : []);
    } catch (error) {
      if (!silent) {
        setMessage({
          type: 'error',
          text: extractApiError(error, 'Impossible de charger les commandes serveur.'),
        });
      }
    }
  }, []);

  const loadTables = useCallback(async ({ silent = false } = {}) => {
    try {
      const tablesRes = await serverAPI.getAvailableTables();
      setTables(Array.isArray(tablesRes.data) ? tablesRes.data : []);
    } catch (error) {
      if (!silent) {
        setMessage({
          type: 'error',
          text: extractApiError(error, 'Impossible de charger les tables serveur.'),
        });
      }
    }
  }, []);

  useEffect(() => {
    loadData();

    const liveIntervalId = setInterval(() => {
      loadOrders({ silent: true });
      loadTables({ silent: true });
    }, LIVE_REFRESH_INTERVAL_MS);

    const snapshotIntervalId = setInterval(() => {
      loadData({ silent: true });
    }, SNAPSHOT_REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(liveIntervalId);
      clearInterval(snapshotIntervalId);
    };
  }, [loadData, loadOrders, loadTables]);

  const activeOrders = useMemo(() => {
    return orders.filter((order) => ['pending', 'in_kitchen', 'ready', 'served'].includes(order.status)).length;
  }, [orders]);

  const orderableMenusCount = useMemo(() => {
    return menus.filter((menu) => isMenuOrderable(menu)).length;
  }, [menus]);

  const freeTablesCount = useMemo(() => {
    return tables.filter((table) => table?.status === 'free').length;
  }, [tables]);

  const occupiedTablesCount = useMemo(() => {
    return tables.filter((table) => table?.status === 'occupied').length;
  }, [tables]);

  const reservedTablesCount = useMemo(() => {
    return tables.filter((table) => table?.status === 'reserved').length;
  }, [tables]);

  if (loading) {
    return <div className="staff-card">Chargement des données serveur...</div>;
  }

  return (
    <div className="staff-module-stack">
      <MessageBanner message={message} hideInline />

      <div className="staff-stat-grid">
        <div className="staff-stat-card">
          <span>Tables libres</span>
          <strong>{freeTablesCount}</strong>
        </div>
        <div className="staff-stat-card">
          <span>Tables réservées</span>
          <strong>{reservedTablesCount}</strong>
        </div>
        <div className="staff-stat-card">
          <span>Tables occupées</span>
          <strong>{occupiedTablesCount}</strong>
        </div>
        <div className="staff-stat-card">
          <span>Clients enregistrés</span>
          <strong>{customers.length}</strong>
        </div>
        <div className="staff-stat-card">
          <span>Menus disponibles</span>
          <strong>{orderableMenusCount}</strong>
        </div>
        <div className="staff-stat-card">
          <span>Commandes actives</span>
          <strong>{activeOrders}</strong>
        </div>
      </div>

      <div className="staff-card">
        <div className="staff-card-header">
          <h2>Dernières commandes</h2>
          <button type="button" className="staff-btn secondary" onClick={() => loadData()}>Actualiser</button>
        </div>

        {orders.length === 0 ? (
          <p className="staff-muted">Aucune commande pour le moment.</p>
        ) : (
          <div className="staff-list">
            {orders.slice(0, 8).map((order) => (
              <div className="staff-list-item" key={order.id}>
                <div className="staff-list-item-main">
                  <strong>{order?.table?.table_number ? `Table ${order.table.table_number}` : `Commande #${order.id}`}</strong>
                  <span>
                    {order?.customer?.name ? `Client: ${order.customer.name}` : 'Client non enregistré'} · {formatCurrency(order.total_amount)}
                  </span>
                  <span className="staff-item-summary">{getOrderItemSummary(order)}</span>
                </div>
                <div className="staff-status-stack">
                  <StatusBadge status={order.status} />
                  <PaidOrderStatusMeta order={order} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const ServerTablesModule = () => {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [tables, setTables] = useState([]);

  const loadTables = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setMessage(null);
    }

    try {
      const response = await serverAPI.getAvailableTables();
      setTables(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setMessage({
        type: 'error',
        text: extractApiError(error, 'Impossible de charger les tables disponibles.'),
      });
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadTables();

    const intervalId = setInterval(() => {
      loadTables({ silent: true });
    }, LIVE_REFRESH_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [loadTables]);

  if (loading) {
    return <div className="staff-card">Chargement des tables...</div>;
  }

  const freeTables = tables.filter((table) => table?.status === 'free');
  const reservedTables = tables.filter((table) => table?.status === 'reserved');
  const occupiedTables = tables.filter((table) => table?.status === 'occupied');

  return (
    <div className="staff-module-stack">
      <MessageBanner message={message} />

      <div className="staff-card">
        <div className="staff-card-header">
          <h2>État des tables (serveur)</h2>
          <button type="button" className="staff-btn secondary" onClick={() => loadTables()}>Actualiser</button>
        </div>

        {freeTables.length === 0 && reservedTables.length === 0 && occupiedTables.length === 0 ? (
          <p className="staff-muted">Aucune table trouvée.</p>
        ) : (
          <>
            <div className="staff-card-header compact">
              <h3>Tables libres</h3>
            </div>
            {freeTables.length === 0 ? (
              <p className="staff-muted">Aucune table libre.</p>
            ) : (
              <div className="staff-table-grid">
                {freeTables.map((table) => (
                  <div className="staff-table-tile" key={table.id}>
                    <strong>Table {table.table_number}</strong>
                    <p>{table.capacity} places</p>
                    <small>{tableSectionLabel(table.section)} · {tableStatusLabel(table.status)}</small>
                    {table?.reservation_usage_status === 'usable' ? (
                      <small>{getTableReservationHint(table)}</small>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <div className="staff-card-header compact">
              <h3>Tables réservées</h3>
            </div>
            {reservedTables.length === 0 ? (
              <p className="staff-muted">Aucune table réservée.</p>
            ) : (
              <div className="staff-table-grid">
                {reservedTables.map((table) => (
                  <div className="staff-table-tile" key={table.id}>
                    <strong>Table {table.table_number}</strong>
                    <p>{table.capacity} places</p>
                    <small>{tableSectionLabel(table.section)} · {tableStatusLabel(table.status)}</small>
                    <small>{getTableReservationHint(table)}</small>
                  </div>
                ))}
              </div>
            )}

            <div className="staff-card-header compact">
              <h3>Tables occupées</h3>
            </div>
            {occupiedTables.length === 0 ? (
              <p className="staff-muted">Aucune table occupée.</p>
            ) : (
              <div className="staff-table-grid">
                {occupiedTables.map((table) => (
                  <div className="staff-table-tile" key={table.id}>
                    <strong>Table {table.table_number}</strong>
                    <p>{table.capacity} places</p>
                    <small>{tableSectionLabel(table.section)} · {tableStatusLabel(table.status)}</small>
                    {table?.reservation_usage_status ? (
                      <small>{getTableReservationHint(table)}</small>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export const ServerOrdersModule = ({ view = 'all' }) => {
  const { confirm } = useDialog();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [billRequestingOrderId, setBillRequestingOrderId] = useState(null);
  const [servingItemId, setServingItemId] = useState(null);
  const [message, setMessage] = useState(null);
  const [menus, setMenus] = useState([]);
  const [tables, setTables] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [customerInsights, setCustomerInsights] = useState(null);
  const [customerInsightsLoading, setCustomerInsightsLoading] = useState(false);
  const [itemsByMenuId, setItemsByMenuId] = useState({});
  const [readyNotifications, setReadyNotifications] = useState([]);
  const [browserNotificationEnabled, setBrowserNotificationEnabled] = useState(() => (
    getLocalBrowserNotificationEnabled(SERVER_NOTIFICATION_STORAGE_KEY)
  ));
  const [orderFormAlert, setOrderFormAlert] = useState(null);
  const [tableSelectionError, setTableSelectionError] = useState(false);
  const [activeCategory, setActiveCategory] = useState('all');
  const orderFormAlertRef = useRef(null);
  const [form, setForm] = useState({
    order_type: 'dine_in',
    order_action: 'new',
    with_packaging: false,
    packaging_quantity: '1',
    packaging_unit_price: '0',
    table_id: '',
    customer_id: '',
    customer_name: '',
    preferred_cooking: '',
    allergies: '',
    special_requests: '',
    is_urgent: false,
  });

  const selectedCustomer = useMemo(() => {
    if (!form.customer_id) {
      return null;
    }

    return customers.find((customer) => Number(customer.id) === Number(form.customer_id)) || null;
  }, [customers, form.customer_id]);

  const selectedTable = useMemo(() => {
    if (!form.table_id) {
      return null;
    }

    return tables.find((table) => Number(table.id) === Number(form.table_id)) || null;
  }, [form.table_id, tables]);

  const isTakeawayOrder = form.order_type === 'takeaway';
  const isAppendMode = !isTakeawayOrder && form.order_action === 'append';
  const packagingQuantity = Math.max(0, Number(form.packaging_quantity || 0));
  const packagingUnitPrice = Math.max(0, roundAriary(form.packaging_unit_price || 0));
  const packagingCartQuantity = Math.max(0, Math.trunc(packagingQuantity));
  const packagingTotal = isTakeawayOrder && form.with_packaging
    ? packagingQuantity * packagingUnitPrice
    : 0;
  const showPackagingInCart = isTakeawayOrder && form.with_packaging && packagingCartQuantity > 0;

  const orderableTables = useMemo(() => {
    return tables.filter((table) => table?.is_orderable_now);
  }, [tables]);

  const appendableTables = useMemo(() => {
    return tables.filter((table) => table?.can_append_to_order);
  }, [tables]);

  const selectableTables = useMemo(() => {
    if (isTakeawayOrder) {
      return [];
    }

    return isAppendMode ? appendableTables : orderableTables;
  }, [appendableTables, isAppendMode, isTakeawayOrder, orderableTables]);

  const selectedTableActiveOrder = selectedTable?.current_order || null;
  const selectedTableOwnerId = Number(selectedTableActiveOrder?.user?.id || 0);
  const selectedTableOwnerName = String(selectedTableActiveOrder?.user?.name || '').trim();
  const selectedTableBelongsToAnotherServer = Boolean(
    !isTakeawayOrder
    && isAppendMode
    && selectedTableActiveOrder
    && selectedTableOwnerId > 0
    && Number(user?.id || 0) > 0
    && selectedTableOwnerId !== Number(user.id)
  );

  const orderStatusMemoryRef = useRef(new Map());
  const orderStationStatusMemoryRef = useRef(new Map());
  const firstLoadRef = useRef(true);

  const pushReadyNotification = useCallback((order) => {
    const stationDetails = getOrderStationSummaries(order)
      .map((entry) => `${entry.label}: ${entry.ready}/${entry.total}`)
      .join(' · ');

    const entry = {
      key: `${order.id}-${Date.now()}`,
      title: 'Commande complète prête',
      tone: 'complete',
      orderId: order.id,
      createdAt: new Date().toISOString(),
      tableLabel: getOrderTableLabel(order),
      detail: stationDetails || 'Tous les menus sont prêts à servir',
    };

    setReadyNotifications((previous) => [entry, ...previous].slice(0, 8));
    playNotificationTone('order-ready');

    if (
      browserNotificationEnabled
      && typeof window !== 'undefined'
      && 'Notification' in window
      && Notification.permission === 'granted'
    ) {
      try {
        new Notification(`Commande #${order.id} complète`, {
          body: `${entry.tableLabel} - ${entry.detail}`,
        });
      } catch (_error) {
        // Ignorer les erreurs de notification navigateur
      }
    }
  }, [browserNotificationEnabled]);

  const pushInProgressNotification = useCallback((order, stationsInProgress = []) => {
    const stationLabelText = stationsInProgress.length > 0
      ? stationsInProgress.map((entry) => entry.label).join(' + ')
      : 'Préparation';

    const entry = {
      key: `in-progress-${order.id}-${Date.now()}`,
      title: 'Préparation lancée',
      tone: stationsInProgress.length === 1 ? stationsInProgress[0].key : 'complete',
      orderId: order.id,
      createdAt: new Date().toISOString(),
      tableLabel: getOrderTableLabel(order),
      detail: `${stationLabelText} en préparation`,
    };

    setReadyNotifications((previous) => [entry, ...previous].slice(0, 8));
    playNotificationTone('new-order');

    if (
      browserNotificationEnabled
      && typeof window !== 'undefined'
      && 'Notification' in window
      && Notification.permission === 'granted'
    ) {
      try {
        new Notification(`Commande #${order.id} en préparation`, {
          body: `${entry.tableLabel} - ${entry.detail}`,
        });
      } catch (_error) {
        // Ignorer les erreurs de notification navigateur
      }
    }
  }, [browserNotificationEnabled]);

  const pushStationReadyNotification = useCallback((order, stationSummary, hasMultipleStations) => {
    const menuNames = (stationSummary?.items || [])
      .map((item) => item?.menu?.name || `Menu #${item?.menu_id || '?'}`)
      .filter(Boolean)
      .join(', ');

    const entry = {
      key: `${order.id}-${stationSummary.key}-${Date.now()}`,
      title: `${stationSummary.label} prête`,
      tone: stationSummary.key,
      orderId: order.id,
      createdAt: new Date().toISOString(),
      tableLabel: getOrderTableLabel(order),
      detail: hasMultipleStations
        ? `${stationSummary.label}: ${stationSummary.ready}/${stationSummary.total} prêts · ${menuNames || 'Menus prêts'}`
        : `${menuNames || 'Menus prêts'} · ${stationSummary.ready}/${stationSummary.total} prêts`,
    };

    setReadyNotifications((previous) => [entry, ...previous].slice(0, 8));
    playNotificationTone('order-ready');

    if (
      browserNotificationEnabled
      && typeof window !== 'undefined'
      && 'Notification' in window
      && Notification.permission === 'granted'
    ) {
      try {
        new Notification(`Commande #${order.id} - ${stationSummary.label} prête`, {
          body: `${entry.tableLabel} - ${entry.detail}`,
        });
      } catch (_error) {
        // Ignorer les erreurs de notification navigateur
      }
    }
  }, [browserNotificationEnabled]);

  const trackReadyTransitions = useCallback((nextOrders, isInitialLoad = false) => {
    const memory = orderStatusMemoryRef.current;
    const stationMemory = orderStationStatusMemoryRef.current;
    const currentIds = new Set();
    const currentStationKeys = new Set();

    nextOrders.forEach((order) => {
      const id = String(order.id);
      const previousStatus = memory.get(id);
      const currentStatus = order.status;
      const stationSummaries = getOrderStationSummaries(order);
      currentIds.add(id);

      if (
        !isInitialLoad
        && currentStatus === 'ready'
        && previousStatus !== 'ready'
        && stationSummaries.length > 1
      ) {
        pushReadyNotification(order);
      } else if (
        !isInitialLoad
        && currentStatus === 'in_kitchen'
        && previousStatus
        && previousStatus !== 'in_kitchen'
      ) {
        pushInProgressNotification(
          order,
          stationSummaries.filter((entry) => entry.status === 'in_kitchen')
        );
      }

      stationSummaries.forEach((stationSummary) => {
        const stationKey = `${id}-${stationSummary.key}`;
        const previousStationStatus = stationMemory.get(stationKey);
        currentStationKeys.add(stationKey);

        if (
          !isInitialLoad
          && stationSummary.status === 'ready'
          && previousStationStatus !== 'ready'
        ) {
          pushStationReadyNotification(order, stationSummary, stationSummaries.length > 1);
        }

        stationMemory.set(stationKey, stationSummary.status);
      });

      memory.set(id, currentStatus);
    });

    Array.from(memory.keys()).forEach((id) => {
      if (!currentIds.has(id)) {
        memory.delete(id);
      }
    });

    Array.from(stationMemory.keys()).forEach((stationKey) => {
      if (!currentStationKeys.has(stationKey)) {
        stationMemory.delete(stationKey);
      }
    });
  }, [pushInProgressNotification, pushReadyNotification, pushStationReadyNotification]);

  const applyOrdersState = useCallback((nextOrders) => {
    setOrders(nextOrders);
    trackReadyTransitions(nextOrders, firstLoadRef.current);
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
    }
  }, [trackReadyTransitions]);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }

    try {
      const response = await serverAPI.getDashboardSnapshot();
      const snapshot = response?.data || {};

      setTables(Array.isArray(snapshot.tables) ? snapshot.tables : []);
      setCustomers(Array.isArray(snapshot.customers) ? snapshot.customers : []);
      setMenus(Array.isArray(snapshot.menus) ? snapshot.menus : []);
      applyOrdersState(Array.isArray(snapshot.orders) ? snapshot.orders : []);
    } catch (error) {
      setMessage({
        type: 'error',
        text: extractApiError(error, 'Impossible de charger les données de commande.'),
      });
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [applyOrdersState]);

  const loadOrdersOnly = useCallback(async ({ silent = false } = {}) => {
    try {
      const ordersRes = await serverAPI.getMyOrders();
      applyOrdersState(Array.isArray(ordersRes.data) ? ordersRes.data : []);
    } catch (error) {
      if (!silent) {
        setMessage({
          type: 'error',
          text: extractApiError(error, 'Impossible de charger les commandes.'),
        });
      }
    }
  }, [applyOrdersState]);

  const loadTablesOnly = useCallback(async ({ silent = false } = {}) => {
    try {
      const tablesRes = await serverAPI.getAvailableTables();
      setTables(Array.isArray(tablesRes.data) ? tablesRes.data : []);
    } catch (error) {
      if (!silent) {
        setMessage({
          type: 'error',
          text: extractApiError(error, 'Impossible de charger les tables.'),
        });
      }
    }
  }, []);

  const loadCustomerInsights = useCallback(async (customerId) => {
    if (!customerId) {
      setCustomerInsights(null);
      return;
    }

    setCustomerInsightsLoading(true);

    try {
      const response = await serverAPI.getCustomerInsights(customerId);
      setCustomerInsights(response?.data || null);
    } catch (_error) {
      setCustomerInsights(null);
    } finally {
      setCustomerInsightsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();

    const liveIntervalId = setInterval(() => {
      loadOrdersOnly({ silent: true });
      loadTablesOnly({ silent: true });
    }, LIVE_REFRESH_INTERVAL_MS);

    const snapshotIntervalId = setInterval(() => {
      loadData({ silent: true });
    }, SNAPSHOT_REFRESH_INTERVAL_MS);

    return () => {
      clearInterval(liveIntervalId);
      clearInterval(snapshotIntervalId);
    };
  }, [loadData, loadOrdersOnly, loadTablesOnly]);

  useEffect(() => {
    const customerId = Number(form.customer_id || 0);

    if (!customerId) {
      setCustomerInsights(null);
      return;
    }

    loadCustomerInsights(customerId);
  }, [form.customer_id, loadCustomerInsights]);

  useEffect(() => {
    if (!isBrowserNotificationSupported()) {
      return;
    }

    setBrowserNotificationEnabled(getLocalBrowserNotificationEnabled(SERVER_NOTIFICATION_STORAGE_KEY));
  }, []);

  useEffect(() => {
    persistLocalBrowserNotificationEnabled(SERVER_NOTIFICATION_STORAGE_KEY, browserNotificationEnabled);
  }, [browserNotificationEnabled]);

  const toggleBrowserNotifications = useCallback(async () => {
    if (!isBrowserNotificationSupported()) {
      setBrowserNotificationEnabled(false);
      setMessage({
        type: 'error',
        text: 'Notifications navigateur non prises en charge sur cet appareil.',
      });
      return;
    }

    if (browserNotificationEnabled) {
      setBrowserNotificationEnabled(false);
      setMessage({
        type: 'success',
        text: 'Notifications navigateur désactivées pour le compte serveur sur ce navigateur.',
      });
      return;
    }

    const granted = await requestBrowserNotificationPermission();
    setBrowserNotificationEnabled(granted);
    setMessage({
      type: granted ? 'success' : 'error',
      text: granted
        ? 'Notifications navigateur activées pour les mises à jour de préparation.'
        : 'Notifications bloquées. Sur Firefox, autorisez-les dans la barre d’adresse puis réessayez.',
    });
  }, [browserNotificationEnabled]);

  useEffect(() => {
    if (isTakeawayOrder || !form.table_id) {
      if (isTakeawayOrder) {
        setTableSelectionError(false);
      }
      return;
    }

    const stillAvailable = selectableTables.some((table) => Number(table.id) === Number(form.table_id));
    if (!stillAvailable) {
      setForm((previous) => ({ ...previous, table_id: '' }));
    }
  }, [form.table_id, isTakeawayOrder, selectableTables]);

  useEffect(() => {
    if (!isTakeawayOrder || form.order_action === 'new') {
      return;
    }

    setForm((previous) => ({
      ...previous,
      order_action: 'new',
      table_id: '',
    }));
  }, [form.order_action, isTakeawayOrder]);

  const groupedMenus = useMemo(() => {
    const buckets = new Map();

    menus.forEach((menu) => {
      const meta = getCategoryMeta(menu);
      const existing = buckets.get(meta.key);

      if (existing) {
        existing.items.push(menu);
      } else {
        buckets.set(meta.key, {
          key: meta.key,
          label: meta.label,
          order: meta.order,
          items: [menu],
        });
      }
    });

    return Array.from(buckets.values())
      .map((group) => ({
        ...group,
        items: group.items.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
      }))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  }, [menus]);

  const categoryTabs = useMemo(() => {
    return [
      { key: 'all', label: 'Tous les menus', count: menus.length },
      ...groupedMenus.map((group) => ({
        key: group.key,
        label: group.label,
        count: group.items.length,
      })),
    ];
  }, [groupedMenus, menus.length]);

  const visibleMenuGroups = useMemo(() => {
    if (activeCategory === 'all') {
      return groupedMenus;
    }

    return groupedMenus.filter((group) => group.key === activeCategory);
  }, [activeCategory, groupedMenus]);

  useEffect(() => {
    if (!categoryTabs.some((tab) => tab.key === activeCategory)) {
      setActiveCategory('all');
    }
  }, [activeCategory, categoryTabs]);

  const selectedItems = useMemo(() => {
    const menuById = new Map(menus.map((menu) => [String(menu.id), menu]));

    return Object.entries(itemsByMenuId)
      .map(([menuId, quantity]) => {
        const menu = menuById.get(String(menuId));
        const safeQuantity = Number(quantity || 0);

        if (!menu || safeQuantity <= 0) {
          return null;
        }

        return {
          menu,
          quantity: safeQuantity,
          lineTotal: roundAriary(menu.price || 0) * safeQuantity,
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.menu.name.localeCompare(right.menu.name));
  }, [itemsByMenuId, menus]);

  const estimatedTotal = useMemo(() => {
    const itemsTotal = selectedItems.reduce((total, item) => total + item.lineTotal, 0);
    return itemsTotal + packagingTotal;
  }, [packagingTotal, selectedItems]);

  const suggestedFavoriteMenus = useMemo(() => {
    const suggestions = Array.isArray(customerInsights?.favorite_menus)
      ? customerInsights.favorite_menus
      : [];
    const menuById = new Map(menus.map((menu) => [Number(menu.id), menu]));

    return suggestions
      .map((suggestion) => {
        const menuId = Number(suggestion.menu_id);
        const menu = menuById.get(menuId);

        return {
          ...suggestion,
          menu,
          isAvailable: Boolean(menu && isMenuOrderable(menu)),
        };
      })
      .slice(0, 6);
  }, [customerInsights?.favorite_menus, menus]);

  const recentCustomerOrders = useMemo(() => {
    return Array.isArray(customerInsights?.recent_orders)
      ? customerInsights.recent_orders
      : [];
  }, [customerInsights?.recent_orders]);

  const increaseMenuQuantity = (menuId) => {
    const key = String(menuId);
    const selectedMenu = menus.find((menu) => String(menu.id) === key);
    const maxPortions = selectedMenu ? getMenuMaxPortionsAvailable(selectedMenu) : Number.POSITIVE_INFINITY;
    const hardCap = maxPortions > 0 ? maxPortions : 99;

    setItemsByMenuId((previous) => ({
      ...previous,
      [key]: Math.min(Number(previous[key] || 0) + 1, hardCap),
    }));
  };

  const decreaseMenuQuantity = (menuId) => {
    const key = String(menuId);
    setItemsByMenuId((previous) => {
      const current = Number(previous[key] || 0);
      const next = { ...previous };

      if (current <= 1) {
        delete next[key];
      } else {
        next[key] = current - 1;
      }

      return next;
    });
  };

  const clearCart = () => setItemsByMenuId({});

  const applySuggestedMenu = (menuId) => {
    const key = String(menuId);
    const selectedMenu = menus.find((menu) => String(menu.id) === key);
    if (!selectedMenu) {
      return;
    }

    const maxPortions = getMenuMaxPortionsAvailable(selectedMenu);
    const hardCap = maxPortions > 0 ? maxPortions : 99;

    setItemsByMenuId((previous) => {
      const current = Number(previous[key] || 0);
      const nextQuantity = Math.min(hardCap, current + 1);

      return {
        ...previous,
        [key]: nextQuantity,
      };
    });
  };

  const showOrderFormError = useCallback((details) => {
    const payload = (typeof details === 'string')
      ? { text: details, insufficient: [], alternatives: [], rawMaterials: [] }
      : {
        text: details?.text || 'Création de commande impossible.',
        insufficient: Array.isArray(details?.insufficient) ? details.insufficient : [],
        alternatives: Array.isArray(details?.alternatives) ? details.alternatives : [],
        rawMaterials: Array.isArray(details?.rawMaterials) ? details.rawMaterials : [],
      };

    setOrderFormAlert(payload);

    if (typeof window !== 'undefined') {
      setTimeout(() => {
        orderFormAlertRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }, 40);
    }
  }, []);

  const buildCreateOrderPayload = useCallback((options = {}) => {
    const customerName = form.customer_name.trim();
    const specialRequests = typeof options.specialRequests === 'string'
      ? options.specialRequests.trim()
      : String(form.special_requests || '').trim();

    return {
      order_type: isTakeawayOrder ? 'takeaway' : 'dine_in',
      append_to_existing: !isTakeawayOrder && form.order_action === 'append',
      with_packaging: isTakeawayOrder ? Boolean(form.with_packaging) : false,
      packaging_quantity: isTakeawayOrder && form.with_packaging ? Math.trunc(packagingQuantity) : 0,
      packaging_unit_price: isTakeawayOrder && form.with_packaging ? roundAriary(packagingUnitPrice) : 0,
      table_id: !isTakeawayOrder && form.table_id ? Number(form.table_id) : null,
      customer_id: form.customer_id ? Number(form.customer_id) : null,
      customer_name: !form.customer_id && customerName ? customerName : null,
      preferred_cooking: form.preferred_cooking || null,
      allergies: form.allergies || null,
      special_requests: specialRequests || null,
      is_urgent: form.is_urgent,
      allow_missing_ingredients: Boolean(options.allowMissingIngredients),
      confirm_other_server_append: Boolean(options.confirmOtherServerAppend),
      items: selectedItems.map((item) => ({
        menu_id: Number(item.menu.id),
        quantity: Number(item.quantity),
      })),
    };
  }, [
    form.allergies,
    form.customer_id,
    form.customer_name,
    form.order_action,
    form.is_urgent,
    form.preferred_cooking,
    form.special_requests,
    form.table_id,
    form.with_packaging,
    isTakeawayOrder,
    packagingQuantity,
    packagingUnitPrice,
    selectedItems,
  ]);

  const submitOrder = async (event) => {
    event.preventDefault();
    setMessage(null);
    setOrderFormAlert(null);
    setTableSelectionError(false);

    if (!isTakeawayOrder && !form.table_id) {
      const text = 'Sélectionnez une table pour une commande sur place.';
      setMessage({ type: 'error', text });
      setTableSelectionError(true);
      showOrderFormError(text);
      return;
    }

    if (selectedItems.length === 0) {
      const text = 'Ajoutez au moins un menu ou une boisson.';
      setMessage({ type: 'error', text });
      showOrderFormError(text);
      return;
    }

    if (isTakeawayOrder && form.with_packaging && packagingQuantity <= 0) {
      const text = 'Le nombre de barquettes doit être supérieur à 0.';
      setMessage({ type: 'error', text });
      showOrderFormError(text);
      return;
    }

    if (isTakeawayOrder && form.with_packaging && packagingUnitPrice <= 0) {
      const text = 'Le prix unitaire de la barquette doit être supérieur à 0.';
      setMessage({ type: 'error', text });
      showOrderFormError(text);
      return;
    }

    let confirmOtherServerAppend = false;
    if (selectedTableBelongsToAnotherServer) {
      const shouldProceed = await confirm({
        title: 'Ajouter à la commande d’un autre serveur',
        message: buildForeignServerAppendConfirmationMessage({
          tableNumber: selectedTable?.table_number,
          orderId: selectedTableActiveOrder?.id,
          serverName: selectedTableOwnerName,
        }),
        confirmText: 'Ajouter quand même',
        cancelText: 'Annuler',
        tone: 'primary',
      });

      if (!shouldProceed) {
        setMessage({
          type: 'error',
          text: `Ajout annulé: cette table reste rattachée à ${selectedTableOwnerName || 'un autre serveur'}.`,
        });
        return;
      }

      confirmOtherServerAppend = true;
    }

    setSubmitting(true);
    const handleCreatedOrder = (response) => {
      const hasStockWarning = Boolean(response?.data?.stock_warnings?.has_shortage);
      const appendedToExisting = Boolean(response?.data?.appended_to_existing);
      const billRequestReset = Boolean(response?.data?.bill_request_reset);
      const responseOwnerId = Number(response?.data?.user?.id || 0);
      const responseOwnerName = String(response?.data?.user?.name || '').trim();
      const appendedToAnotherServer = appendedToExisting
        && responseOwnerId > 0
        && Number(user?.id || 0) > 0
        && responseOwnerId !== Number(user.id);
      setMessage({
        type: 'success',
        text: hasStockWarning
          ? `Commande #${response.data.id} enregistrée avec adaptation stock confirmée.`
          : appendedToAnotherServer
            ? `Articles ajoutés à la commande #${response.data.id} rattachée à ${responseOwnerName || 'un autre serveur'}${billRequestReset ? ' · demande d’addition réinitialisée' : ''}.`
            : appendedToExisting
            ? `Articles ajoutés à la commande #${response.data.id}${billRequestReset ? ' · demande d’addition réinitialisée' : ''}.`
            : `Commande #${response.data.id} envoyée en préparation (cuisine/bar).`,
      });
      setOrderFormAlert(null);
      setForm((previous) => ({
        ...previous,
        order_action: previous.order_type === 'takeaway' ? 'new' : previous.order_action,
        with_packaging: false,
        packaging_quantity: '1',
        packaging_unit_price: '0',
        customer_id: '',
        customer_name: '',
        preferred_cooking: '',
        allergies: '',
        special_requests: '',
        is_urgent: false,
      }));
      clearCart();
      // Garder les mêmes flux de refresh, mais sans bloquer le bouton "Envoi..."
      // pour éviter l'impression de lag.
      void loadData({ silent: true });
    };

    const confirmMissingIngredientsAndRetry = async (
      details,
      { forceForeignServerAppend = false } = {}
    ) => {
      setMessage({
        type: 'error',
        text: details.text,
      });
      showOrderFormError(details);

      const shouldProceed = await confirm({
        title: 'Ingrédients manquants',
        message: buildStockShortageConfirmationMessage(details),
        confirmText: 'Poursuivre sans ingrédient',
        cancelText: 'Annuler la commande',
        tone: 'danger',
      });

      if (!shouldProceed) {
        setMessage({
          type: 'error',
          text: 'Commande annulée: ingrédients manquants non validés.',
        });
        return;
      }

      const specialRequests = buildMissingIngredientsSpecialRequest(
        form.special_requests,
        details.insufficient,
        details.missingIngredientsNote
      );

      try {
        const retryResponse = await serverAPI.createOrder(buildCreateOrderPayload({
          allowMissingIngredients: true,
          confirmOtherServerAppend: Boolean(forceForeignServerAppend || confirmOtherServerAppend),
          specialRequests,
        }));
        await handleCreatedOrder(retryResponse);
      } catch (retryError) {
        const retryDetails = buildOrderCreationErrorDetails(retryError);

        if (retryDetails.requireConfirmation && retryDetails.confirmationReason === 'foreign_server_append') {
          const shouldProceedForeign = await confirm({
            title: 'Ajouter à la commande d’un autre serveur',
            message: buildForeignServerAppendConfirmationMessage({
              tableNumber: selectedTable?.table_number,
              orderId: retryDetails.existingOrderId || selectedTableActiveOrder?.id,
              serverName: retryDetails.existingServerName || selectedTableOwnerName,
            }),
            confirmText: 'Ajouter quand même',
            cancelText: 'Annuler',
            tone: 'primary',
          });

          if (!shouldProceedForeign) {
            setMessage({
              type: 'error',
              text: `Ajout annulé: cette table reste rattachée à ${retryDetails.existingServerName || selectedTableOwnerName || 'un autre serveur'}.`,
            });
            return;
          }

          confirmOtherServerAppend = true;

          try {
            const foreignRetryResponse = await serverAPI.createOrder(buildCreateOrderPayload({
              allowMissingIngredients: true,
              confirmOtherServerAppend: true,
              specialRequests,
            }));
            await handleCreatedOrder(foreignRetryResponse);
          } catch (foreignRetryError) {
            const foreignRetryDetails = buildOrderCreationErrorDetails(foreignRetryError);
            setMessage({
              type: 'error',
              text: foreignRetryDetails.text,
            });
            showOrderFormError(foreignRetryDetails);
          }

          return;
        }

        setMessage({
          type: 'error',
          text: retryDetails.text,
        });
        showOrderFormError(retryDetails);
      }
    };

    try {
      const response = await serverAPI.createOrder(buildCreateOrderPayload({
        confirmOtherServerAppend,
      }));
      await handleCreatedOrder(response);
    } catch (error) {
      const details = buildOrderCreationErrorDetails(error);

      if (details.requireConfirmation && details.confirmationReason === 'foreign_server_append') {
        setMessage({
          type: 'error',
          text: details.text,
        });

        const shouldProceed = await confirm({
          title: 'Ajouter à la commande d’un autre serveur',
          message: buildForeignServerAppendConfirmationMessage({
            tableNumber: selectedTable?.table_number,
            orderId: details.existingOrderId || selectedTableActiveOrder?.id,
            serverName: details.existingServerName || selectedTableOwnerName,
          }),
          confirmText: 'Ajouter quand même',
          cancelText: 'Annuler',
          tone: 'primary',
        });

        if (!shouldProceed) {
          setMessage({
            type: 'error',
            text: `Ajout annulé: cette table reste rattachée à ${details.existingServerName || selectedTableOwnerName || 'un autre serveur'}.`,
          });
          return;
        }

        confirmOtherServerAppend = true;

        try {
          const retryResponse = await serverAPI.createOrder(buildCreateOrderPayload({
            confirmOtherServerAppend: true,
          }));
          await handleCreatedOrder(retryResponse);
        } catch (retryError) {
          const retryDetails = buildOrderCreationErrorDetails(retryError);

          if (retryDetails.requireConfirmation && retryDetails.confirmationReason !== 'foreign_server_append') {
            await confirmMissingIngredientsAndRetry(retryDetails, { forceForeignServerAppend: true });
            return;
          }

          setMessage({
            type: 'error',
            text: retryDetails.text,
          });
          showOrderFormError(retryDetails);
        }

        return;
      }

      if (details.requireConfirmation) {
        await confirmMissingIngredientsAndRetry(details);
        return;
      }

      setMessage({
        type: 'error',
        text: details.text,
      });
      showOrderFormError(details);
    } finally {
      setSubmitting(false);
    }
  };

  const requestBillForOrder = async (order) => {
    if (!order || !order.id) {
      return;
    }

    setBillRequestingOrderId(order.id);
    setMessage(null);

    try {
      await serverAPI.requestBill(order.id);
      setMessage({
        type: 'success',
        text: `Addition demandée pour la commande #${order.id}.`,
      });
      await loadOrdersOnly({ silent: true });
    } catch (error) {
      setMessage({
        type: 'error',
        text: extractApiError(error, 'Impossible de transmettre la demande d’addition à la caisse.'),
      });
    } finally {
      setBillRequestingOrderId(null);
    }
  };

  const markItemServed = async (order, item) => {
    if (!order?.id || !item?.id) {
      return;
    }

    setServingItemId(item.id);
    setMessage(null);

    try {
      await serverAPI.markOrderItemServed(item.id);
      setMessage({
        type: 'success',
        text: `${item?.menu?.name || `Menu #${item.menu_id}`} servie sur la commande #${order.id}.`,
      });
      await loadOrdersOnly({ silent: true });
    } catch (error) {
      setMessage({
        type: 'error',
        text: extractApiError(error, 'Impossible de marquer ce menu comme servie.'),
      });
    } finally {
      setServingItemId(null);
    }
  };

  if (loading) {
    return <div className="staff-card">Chargement des commandes...</div>;
  }

  const showManageView = view !== 'my-orders';
  const showOrdersView = view !== 'manage';

  const renderMenuSection = (title, menuList, emptyMessage) => {
    return (
      <div className="full-width">
        <div className="staff-card-header compact">
          <h3>{title}</h3>
        </div>

        {menuList.length === 0 ? (
          <p className="staff-muted">{emptyMessage}</p>
        ) : (
          <div className="staff-menu-grid">
            {menuList.map((menu) => {
              const quantity = Number(itemsByMenuId[String(menu.id)] || 0);
              const ingredients = getMenuIngredients(menu);
              const maxPortionsAvailable = getMenuMaxPortionsAvailable(menu);
              const orderable = isMenuOrderable(menu);
              const stockLimited = maxPortionsAvailable <= 0;
              const availabilityReasons = getMenuAvailabilityReasons(menu);
              const insufficientIngredients = getMenuInsufficientIngredients(menu);
              const alternatives = getMenuAlternatives(menu);
              const ingredientsPreview = ingredients.slice(0, 4);
              const ingredientsDetails = ingredients
                .map((ingredient) => {
                  const required = getIngredientRequiredPortions(ingredient);
                  const ingredientName = String(ingredient?.name || '').trim();
                  if (!ingredientName) {
                    return null;
                  }

                  return required > 0
                    ? `${ingredientName} · ${required}p`
                    : ingredientName;
                })
                .filter(Boolean);

              return (
                <button
                  key={menu.id}
                  type="button"
                  className={`staff-menu-card ${quantity > 0 ? 'is-selected' : ''} ${orderable ? '' : 'is-disabled'}`}
                  onClick={() => increaseMenuQuantity(menu.id)}
                  disabled={!orderable}
                  title={orderable
                    ? (stockLimited
                      ? 'Cliquer pour ajouter (stock faible - bypass informatif)'
                      : 'Cliquer pour ajouter')
                    : (availabilityReasons.join(' ') || 'Menu indisponible')}
                >
                  <div className="staff-menu-image-wrap">
                    <img
                      src={getMenuImage(menu)}
                      alt={menu.name}
                      className="staff-menu-image"
                      onError={(event) => {
                        event.currentTarget.src = buildMenuPlaceholder(menu.name);
                      }}
                    />
                  </div>

                  <div className="staff-menu-card-body">
                    <strong>{menu.name}</strong>
                    <span>{getCategoryMeta(menu).label}</span>
                    <small>{formatCurrency(menu.price)}</small>
                    <small className={`staff-menu-stock ${stockLimited ? 'is-empty' : ''}`}>
                      {stockLimited
                        ? 'Stock faible/insuffisant (info)'
                        : `Max ${maxPortionsAvailable} portion(s)`}
                    </small>
                    {availabilityReasons.length > 0 ? (
                      <small className="staff-menu-ingredient-missing">
                        {availabilityReasons.join(' ')}
                      </small>
                    ) : null}
                    {orderable && stockLimited && insufficientIngredients.length > 0 ? (
                      <small className="staff-menu-ingredient-missing">
                        Manque: {insufficientIngredients
                          .slice(0, 2)
                          .map((entry) => `${entry.ingredient_name} (${entry.available_portions}/${entry.required_portions_per_menu})`)
                          .join(' · ')}
                      </small>
                    ) : null}
                    {!orderable && alternatives.length > 0 ? (
                      <small className="staff-menu-ingredient-missing">
                        Alternatives: {alternatives.map((item) => item.name).join(', ')}
                      </small>
                    ) : null}

                    {ingredientsPreview.length > 0 ? (
                      <div className="staff-menu-ingredients">
                        {ingredientsPreview.map((ingredient) => (
                          <span key={`${menu.id}-${ingredient.id || ingredient.name}`} className="staff-menu-ingredient-chip">
                            {ingredient.name} · {getIngredientRequiredPortions(ingredient)}p
                          </span>
                        ))}
                        {ingredients.length > ingredientsPreview.length ? (
                          <span className="staff-menu-ingredient-more">+{ingredients.length - ingredientsPreview.length} ingr.</span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="staff-menu-ingredient-missing">Recette non renseignée</span>
                    )}
                  </div>

                  <div className="staff-menu-count-badge">
                    {quantity > 0 ? `x${quantity}` : (orderable ? '+' : '!')}
                  </div>

                  {ingredientsDetails.length > 0 ? (
                    <div className="staff-menu-ingredients-overlay" aria-hidden="true">
                      <div className="staff-menu-ingredients-overlay-header">
                        <img
                          src={getMenuImage(menu)}
                          alt={menu.name}
                          className="staff-menu-ingredients-overlay-image"
                          onError={(event) => {
                            event.currentTarget.src = buildMenuPlaceholder(menu.name);
                          }}
                        />
                        <div className="staff-menu-ingredients-overlay-heading">
                          <strong className="staff-menu-ingredients-overlay-menu-name">{menu.name}</strong>
                          <span>{getCategoryMeta(menu).label}</span>
                        </div>
                      </div>
                      <strong className="staff-menu-ingredients-overlay-title">Ingrédients</strong>
                      <div className="staff-menu-ingredients-overlay-list">
                        {ingredientsDetails.map((label, index) => (
                          <span key={`${menu.id}-ing-detail-${index}`} className="staff-menu-ingredients-overlay-chip">
                            {label}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="staff-module-stack">
      <MessageBanner message={message} />

      {readyNotifications.length > 0 ? (
        <div className="staff-card staff-ready-feed">
          <div className="staff-card-header compact">
            <h3>Notifications preparation</h3>
            <button type="button" className="staff-btn secondary" onClick={() => setReadyNotifications([])}>
              Effacer
            </button>
          </div>

          <div className="staff-ready-list">
            {readyNotifications.map((entry) => (
              <div key={entry.key} className={`staff-ready-item ${entry.tone ? `is-${entry.tone}` : ''}`}>
                <strong>{entry.title || `Commande #${entry.orderId}`}</strong>
                <span>{entry.tableLabel} · {entry.detail}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {showManageView ? (
      <div className="staff-card">
        <div className="staff-card-header">
          <h2>Nouvelle commande</h2>
          <div className="staff-inline-actions">
            <button type="button" className="staff-btn secondary" onClick={toggleBrowserNotifications}>
              {getBrowserNotificationToggleLabel(browserNotificationEnabled)}
            </button>
            <span className="staff-muted">Total estimé: {formatCurrency(estimatedTotal)}</span>
          </div>
        </div>

        <form className="staff-form-grid" onSubmit={submitOrder}>
          <label className="staff-field">
            Type de commande
            <select
              value={form.order_type}
              onChange={(event) => {
                const nextType = event.target.value === 'takeaway' ? 'takeaway' : 'dine_in';
                setForm((prev) => ({
                  ...prev,
                  order_type: nextType,
                  order_action: nextType === 'takeaway' ? 'new' : prev.order_action,
                  table_id: nextType === 'takeaway' ? '' : prev.table_id,
                  with_packaging: nextType === 'takeaway' ? prev.with_packaging : false,
                  packaging_quantity: nextType === 'takeaway' ? prev.packaging_quantity : '1',
                  packaging_unit_price: nextType === 'takeaway' ? prev.packaging_unit_price : '0',
                }));
              }}
            >
              <option value="dine_in">Sur place</option>
              <option value="takeaway">A emporter</option>
            </select>
          </label>

          {!isTakeawayOrder ? (
            <label className="staff-field">
              Action sur la commande
              <select
                value={form.order_action}
                onChange={(event) => {
                  const nextAction = event.target.value === 'append' ? 'append' : 'new';
                  setForm((prev) => ({
                    ...prev,
                    order_action: nextAction,
                    table_id: '',
                  }));
                  setTableSelectionError(false);
                }}
              >
                <option value="new">Nouvelle commande</option>
                <option value="append" disabled={appendableTables.length === 0}>
                  Ajouter à une commande existante
                </option>
              </select>
            </label>
          ) : null}

          <label className={`staff-field ${tableSelectionError ? 'has-error' : ''}`}>
            Table
            <select
              value={form.table_id}
              disabled={isTakeawayOrder}
              onChange={(event) => {
                const nextValue = event.target.value;
                setForm((prev) => ({ ...prev, table_id: nextValue }));
                if (nextValue) {
                  setTableSelectionError(false);
                }
              }}
            >
              <option value="" disabled>
                {isAppendMode ? 'Sélectionner une table avec commande active' : 'Sélectionner une table'}
              </option>
              {selectableTables.map((table) => (
                <option key={table.id} value={table.id}>
                  Table {table.table_number}
                  {!isAppendMode && table?.status === 'reserved' ? ` · réservée` : ''}
                  {isAppendMode && table?.current_order ? ` · Cmd #${table.current_order.id}` : ''}
                  {isAppendMode && table?.current_order?.user?.name ? ` · Serveur: ${table.current_order.user.name}` : ''}
                </option>
              ))}
            </select>
            {tableSelectionError ? (
              <small className="staff-field-error">
                {isAppendMode
                  ? 'Sélectionnez une table avec une commande active non payée.'
                  : 'La table est obligatoire pour une commande sur place.'}
              </small>
            ) : null}
          </label>

          {!isTakeawayOrder && isAppendMode && selectedTableActiveOrder ? (
            <p className="staff-muted full-width staff-identity-hint">
              Ajout à la commande #{selectedTableActiveOrder.id}
              {selectedTableActiveOrder?.customer?.name ? ` · Client: ${selectedTableActiveOrder.customer.name}` : ''}
              {selectedTableActiveOrder?.user?.name ? ` · Serveur: ${selectedTableActiveOrder.user.name}` : ''}
              {selectedTableActiveOrder?.bill_requested_at ? ' · Addition déjà demandée (elle sera réinitialisée si vous ajoutez des articles).' : ''}
            </p>
          ) : null}

          {!isTakeawayOrder && isAppendMode && selectedTableBelongsToAnotherServer ? (
            <p className="staff-muted full-width staff-identity-hint">
              Confirmation requise: cette table est rattachée à {selectedTableOwnerName || 'un autre serveur'}.
            </p>
          ) : null}

          {!isTakeawayOrder && !isAppendMode && selectedTable?.status === 'reserved' ? (
            <p className="staff-muted full-width staff-identity-hint">
              Table réservée
              {selectedTable?.reservation_name ? ` pour ${selectedTable.reservation_name}` : ''}
              {selectedTable?.reservation_at ? ` · Échéance: ${formatDateTime(selectedTable.reservation_at)}` : ''}
              {selectedTable?.reservation_locked
                ? ' · Elle n’est plus disponible.'
                : ` · Elle reste utilisable jusqu’à ${formatDateTime(selectedTable?.reservation_lock_at)}.`}
            </p>
          ) : null}

          {isTakeawayOrder ? (
            <label className="staff-check">
              <input
                type="checkbox"
                checked={Boolean(form.with_packaging)}
                onChange={(event) => setForm((prev) => ({
                  ...prev,
                  with_packaging: event.target.checked,
                  packaging_quantity: event.target.checked ? (Number(prev.packaging_quantity || 0) > 0 ? prev.packaging_quantity : '1') : '0',
                  packaging_unit_price: event.target.checked ? prev.packaging_unit_price : '0',
                }))}
              />
              Proposer/ajouter des barquettes
            </label>
          ) : null}

          {isTakeawayOrder && form.with_packaging ? (
            <>
              <label className="staff-field">
                Nombre de barquettes
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.packaging_quantity}
                  onChange={(event) => setForm((prev) => ({ ...prev, packaging_quantity: event.target.value }))}
                  placeholder="Ex: 2"
                />
              </label>

              <label className="staff-field">
                Prix unitaire barquette (Ar)
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.packaging_unit_price}
                  onChange={(event) => setForm((prev) => ({ ...prev, packaging_unit_price: event.target.value }))}
                  placeholder="Ex: 500"
                />
              </label>
            </>
          ) : null}

          <label className="staff-field">
            Client existant
            <select
              value={form.customer_id}
              onChange={(event) => {
                const nextCustomerId = event.target.value;
                const selected = customers.find((customer) => Number(customer.id) === Number(nextCustomerId));
                const hasSelectedCustomer = Boolean(nextCustomerId && selected);
                setForm((prev) => ({
                  ...prev,
                  customer_id: nextCustomerId,
                  customer_name: '',
                  allergies: hasSelectedCustomer ? String(selected?.allergies || '') : '',
                  preferred_cooking: hasSelectedCustomer ? String(selected?.preferred_cooking || '') : '',
                  special_requests: hasSelectedCustomer ? buildCustomerContextNote(selected) : '',
                }));
              }}
            >
              <option value="">Aucun</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}</option>
              ))}
            </select>
          </label>

          <label className="staff-field full-width">
            Nom client (nouveau)
            <input
              type="text"
              value={form.customer_name}
              disabled={Boolean(form.customer_id)}
              onChange={(event) => setForm((prev) => ({ ...prev, customer_name: event.target.value }))}
              placeholder="Ex: Rakoto Jean"
            />
          </label>

          <p className="staff-muted full-width staff-identity-hint">
            Sans table uniquement pour les commandes a emporter. Le client reste optionnel.
          </p>

          {isTakeawayOrder && form.with_packaging ? (
            <p className="staff-muted full-width staff-identity-hint">
              Supplément barquettes: {Math.trunc(packagingQuantity)} x {formatCurrency(packagingUnitPrice)} = {formatCurrency(packagingTotal)}
            </p>
          ) : null}

          {form.customer_id && (
            <p className="staff-muted full-width staff-identity-hint">
              {String(selectedCustomer?.notes || '').trim()
                ? `Notes client enregistrées: ${selectedCustomer.notes}`
                : 'Aucune note enregistrée pour ce client.'}
            </p>
          )}

          {(form.customer_id || form.customer_name) && (
            <div className="staff-customer-profile full-width">
              <div className="staff-card-header compact">
                <h3>Préférences client</h3>
              </div>

              <div className="staff-customer-profile-grid">
                <label className="staff-field">
                  Allergies
                  <input
                    type="text"
                    value={form.allergies}
                    onChange={(event) => setForm((prev) => ({ ...prev, allergies: event.target.value }))}
                    placeholder="Ex: arachides, fruits de mer..."
                  />
                </label>

                <label className="staff-field">
                  Mode de cuisson préféré
                  <input
                    type="text"
                    value={form.preferred_cooking}
                    onChange={(event) => setForm((prev) => ({ ...prev, preferred_cooking: event.target.value }))}
                    placeholder="Ex: saignant, à point, bien cuit..."
                  />
                </label>
              </div>

              {form.customer_id ? (
                <div className="staff-customer-habits">
                  {customerInsightsLoading ? (
                    <p className="staff-muted">Chargement des habitudes client...</p>
                  ) : (
                    <>
                      {suggestedFavoriteMenus.length > 0 ? (
                        <div className="staff-customer-suggestions">
                          <h4>Menus habituels</h4>
                          <div className="staff-customer-suggestion-list">
                            {suggestedFavoriteMenus.map((suggestion) => (
                              <button
                                key={`${suggestion.menu_id}-${suggestion.last_ordered_at || 'x'}`}
                                type="button"
                                className="staff-customer-suggestion-btn"
                                disabled={!suggestion.isAvailable}
                                onClick={() => applySuggestedMenu(suggestion.menu_id)}
                                title={
                                  suggestion.isAvailable
                                    ? `Ajouter 1x ${suggestion.menu_name}`
                                    : 'Menu actuellement indisponible'
                                }
                              >
                                <strong>{suggestion.menu_name}</strong>
                                <span>
                                  {suggestion.times_ordered} commande(s) · Qté conseillée: {suggestion.recommended_quantity}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {recentCustomerOrders.length > 0 ? (
                        <div className="staff-customer-recent">
                          <h4>Dernières commandes</h4>
                          <div className="staff-customer-recent-list">
                            {recentCustomerOrders.map((order) => (
                              <div key={order.order_id} className="staff-customer-recent-item">
                                <strong>Commande #{order.order_id}</strong>
                                <span>
                                  {(order.items || [])
                                    .map((item) => `${item.quantity}x ${item.menu_name}`)
                                    .join(', ')}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {!suggestedFavoriteMenus.length && !recentCustomerOrders.length ? (
                        <p className="staff-muted">Aucune habitude enregistrée pour ce client pour le moment.</p>
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          )}

          <label className="staff-field full-width">
            Notes
            <textarea
              rows="2"
              value={form.special_requests}
              onChange={(event) => setForm((prev) => ({ ...prev, special_requests: event.target.value }))}
              placeholder="Allergies, cuisson, remarques..."
            />
          </label>

          <label className="staff-check full-width">
            <input
              type="checkbox"
              checked={form.is_urgent}
              onChange={(event) => setForm((prev) => ({ ...prev, is_urgent: event.target.checked }))}
            />
            Commande urgente
          </label>

          <div className="full-width">
            <div className="staff-card-header compact">
              <h3>Sous-menus des catégories</h3>
            </div>
            <div className="staff-submenu-tabs">
              {categoryTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`staff-submenu-tab ${activeCategory === tab.key ? 'is-active' : ''}`}
                  onClick={() => setActiveCategory(tab.key)}
                >
                  {tab.label} ({tab.count})
                </button>
              ))}
            </div>
          </div>

          {visibleMenuGroups.length === 0 ? (
            <p className="staff-muted full-width">Aucun menu disponible dans cette catégorie.</p>
          ) : (
            visibleMenuGroups.map((group) => renderMenuSection(group.label, group.items, `Aucun menu dans ${group.label}.`))
          )}

          <div className="staff-order-cart full-width">
            <div className="staff-card-header compact">
              <h3>Panier de commande</h3>
              <button type="button" className="staff-btn secondary" onClick={clearCart} disabled={selectedItems.length === 0}>
                Vider
              </button>
            </div>

            {selectedItems.length === 0 && !showPackagingInCart ? (
              <p className="staff-muted">Cliquez sur les images des menus pour ajouter la commande.</p>
            ) : (
              <div className="staff-cart-list">
                {selectedItems.map((item) => {
                  const ingredientNeeds = getMenuIngredients(item.menu)
                    .map((ingredient) => {
                      const totalRequired = getIngredientRequiredPortions(ingredient) * item.quantity;
                      if (totalRequired <= 0) {
                        return null;
                      }

                      return `${totalRequired}p ${ingredient.name}`;
                    })
                    .filter(Boolean);

                  const ingredientPreview = ingredientNeeds.slice(0, 3);
                  const hiddenIngredientsCount = ingredientNeeds.length - ingredientPreview.length;

                  return (
                    <div className="staff-cart-item" key={item.menu.id}>
                      <div>
                        <strong>{item.menu.name}</strong>
                        <span>{formatCurrency(item.menu.price)} x {item.quantity} = {formatCurrency(item.lineTotal)}</span>
                        {ingredientPreview.length > 0 ? (
                          <span className="staff-cart-ingredients">
                            {ingredientPreview.join(' · ')}
                            {hiddenIngredientsCount > 0 ? ` · +${hiddenIngredientsCount} ingr.` : ''}
                          </span>
                        ) : null}
                      </div>

                      <div className="staff-cart-actions">
                        <button type="button" className="staff-btn secondary small" onClick={() => decreaseMenuQuantity(item.menu.id)}>-</button>
                        <button type="button" className="staff-btn secondary small" onClick={() => increaseMenuQuantity(item.menu.id)}>+</button>
                      </div>
                    </div>
                  );
                })}

                {showPackagingInCart ? (
                  <div className="staff-cart-item" key="packaging-line">
                    <div>
                      <strong>Barquettes</strong>
                      <span>{formatCurrency(packagingUnitPrice)} x {packagingCartQuantity} = {formatCurrency(packagingCartQuantity * packagingUnitPrice)}</span>
                      <span className="staff-cart-ingredients">Supplément emballage</span>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {orderFormAlert ? (
            <div ref={orderFormAlertRef} className="staff-message is-error full-width staff-order-form-alert">
              <strong>Commande non créée</strong>
              <div>{orderFormAlert.text}</div>
              {orderFormAlert.insufficient.length > 0 ? (
                <div className="staff-order-form-error-extra">
                  Ingrédients manquants: {orderFormAlert.insufficient
                    .map((entry) => formatInsufficientIngredientLabel(entry, 'short'))
                    .join(' · ')}
                </div>
              ) : null}
              {orderFormAlert.alternatives.length > 0 ? (
                <div className="staff-order-form-error-extra">
                  Alternatives suggérées: {orderFormAlert.alternatives
                    .map((entry) => entry?.name)
                    .filter(Boolean)
                    .join(', ')}
                </div>
              ) : null}
              {orderFormAlert.rawMaterials.length > 0 ? (
                <div className="staff-order-form-error-extra">
                  Stocks concernés: {orderFormAlert.rawMaterials
                    .map((entry) => `${entry.name} (${Number(entry.available || 0).toFixed(2)} ${entry.unit || ''} dispo)`)
                    .join(' · ')}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="staff-inline-actions full-width">
            <button type="button" className="staff-btn secondary" onClick={() => loadData()}>Actualiser</button>
            <button type="submit" className="staff-btn primary" disabled={submitting}>
              {submitting ? 'Envoi...' : (isAppendMode ? 'Ajouter à la commande' : 'Créer la commande')}
            </button>
          </div>
        </form>
      </div>
      ) : null}

      {showOrdersView ? (
      <div className="staff-card">
        <div className="staff-card-header">
          <h2>Mes commandes</h2>
          <button type="button" className="staff-btn secondary" onClick={() => loadOrdersOnly()}>
            Actualiser
          </button>
        </div>

        {orders.length === 0 ? (
          <p className="staff-muted">Aucune commande enregistrée.</p>
        ) : (
          <div className="staff-list">
            {orders.slice(0, 12).map((order) => {
              const itemSummary = getOrderItemSummary(order);
              const orderItems = Array.isArray(order?.items) ? order.items : [];
              const stationSummaries = getOrderStationSummaries(order);

              return (
                <div className="staff-list-item" key={order.id}>
                  <div className="staff-list-item-main">
                    <strong>
                      {order?.order_type === 'takeaway'
                        ? 'A emporter'
                        : (order?.table?.table_number ? `Table ${order.table.table_number}` : `Commande #${order.id}`)}
                    </strong>
                    <span>
                      {order?.customer?.name ? `Client: ${order.customer.name}` : 'Client non enregistré'} · {formatCurrency(order.total_amount)}
                    </span>
                    {itemSummary ? <span className="staff-item-summary">{itemSummary}</span> : null}
                    {orderItems.length > 0 ? (
                      <span className="staff-item-summary">
                        {formatOrderStationProgress(order)}
                      </span>
                    ) : null}
                    {order?.bill_requested_at ? (
                      <span className="staff-item-summary">
                        Addition demandée: {formatDateTime(order.bill_requested_at)}
                      </span>
                    ) : null}
                    {stationSummaries.length > 0 ? (
                      <div className="staff-order-station-list">
                        {stationSummaries.map((station) => (
                          <div key={`${order.id}-${station.key}`} className={`staff-order-station-block is-${station.key}`}>
                            <div className="staff-order-station-header">
                              <strong>{station.label}</strong>
                              <span>
                                {station.ready}/{station.total} prêt{station.ready > 1 ? 's' : ''} · {statusLabel(station.status)}
                              </span>
                            </div>
                            <div className="staff-order-item-status-grid">
                              {station.items.map((item) => (
                                <div key={item.id} className="staff-order-item-status-row">
                                  <span className="staff-order-item-status-chip">
                                    {item.quantity}x {item?.menu?.name || `Menu #${item.menu_id}`} · {statusLabel(item?.status)}
                                  </span>
                                  {canServeOrderItem(item) && !['paid', 'archived'].includes(normalizePreparationStatus(order?.status)) ? (
                                    <button
                                      type="button"
                                      className="staff-btn secondary small"
                                      disabled={servingItemId === item.id}
                                      onClick={() => markItemServed(order, item)}
                                    >
                                      {servingItemId === item.id ? '...' : 'Servie'}
                                    </button>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {order.special_requests ? <span className="staff-item-summary">Notes: {order.special_requests}</span> : null}
                  </div>
                  <div className="staff-list-item-side">
                    <div className="staff-status-stack">
                      <StatusBadge status={order.status} />
                      {stationSummaries.length > 0 ? (
                        <div className="staff-station-status-row">
                          {stationSummaries.map((station) => (
                            <StationStatusBadge key={`${order.id}-badge-${station.key}`} station={station} />
                          ))}
                        </div>
                      ) : null}
                      <PaidOrderStatusMeta order={order} />
                    </div>
                    {canRequestBillForOrder(order) ? (
                      <button
                        type="button"
                        className="staff-btn secondary"
                        disabled={billRequestingOrderId === order.id}
                        onClick={() => requestBillForOrder(order)}
                      >
                        {billRequestingOrderId === order.id ? 'Envoi...' : 'Demander addition'}
                      </button>
                      ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      ) : null}
    </div>
  );
};
