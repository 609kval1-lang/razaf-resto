import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSerializedAsyncCallback from '../../../hooks/useSerializedAsyncCallback';
import { barAPI, kitchenAPI } from '../../../services/api';
import { formatPaymentMethodLabel } from '../../../utils/paymentMethods';
import {
  getBrowserNotificationToggleLabel,
  getLocalBrowserNotificationEnabled,
  isBrowserNotificationSupported,
  persistLocalBrowserNotificationEnabled,
  requestBrowserNotificationPermission,
  showBrowserNotification,
} from '../../../utils/browserNotification';
import { playNotificationTone } from '../../../utils/notificationSound';
import { useToast } from '../../common/ToastProvider';

const OVERVIEW_REFRESH_INTERVAL_MS = 10000;
const QUEUE_REFRESH_INTERVAL_MS = 7000;
const INGREDIENTS_REFRESH_INTERVAL_MS = 15000;

const STATION_CONFIGS = {
  kitchen: {
    label: 'Cuisine',
    inProgressCountLabel: 'En cuisine',
    queueTitle: 'File cuisine (temps reel)',
    ingredientsTitle: 'Etat des ingredients',
    startActionLabel: 'Demarrer',
    readyActionLabel: 'Marquer prete',
    ticketLabel: 'Ticket cuisine',
    autoPrintStorageKey: 'staff.autoprint.kitchen',
    notificationStorageKey: 'staff.notifications.kitchen',
  },
  bar: {
    label: 'Bar',
    inProgressCountLabel: 'Au bar',
    queueTitle: 'File bar (temps reel)',
    ingredientsTitle: 'Etat des ingredients bar',
    startActionLabel: 'Demarrer',
    readyActionLabel: 'Marquer pret',
    ticketLabel: 'Ticket bar',
    autoPrintStorageKey: 'staff.autoprint.bar',
    notificationStorageKey: 'staff.notifications.bar',
  },
};

const getStationConfig = (station) => {
  return station === 'bar' ? STATION_CONFIGS.bar : STATION_CONFIGS.kitchen;
};

const getPrepApi = (station) => {
  return station === 'bar' ? barAPI : kitchenAPI;
};

const extractApiError = (error, fallbackMessage) => {
  return error?.response?.data?.message || error?.response?.data?.error || fallbackMessage;
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
    ready: 'Prete',
    served: 'Servie',
    cancelled: 'Annulee',
    paid: 'Payee',
  };

  return labels[normalizedStatus] || normalizedStatus;
};

const resolveStationOrderStatus = (order) => {
  const stationStatus = String(order?.station_status || '').trim();
  if (stationStatus) {
    return normalizePreparationStatus(stationStatus);
  }

  const items = Array.isArray(order?.items) ? order.items : [];
  const statuses = items
    .map((item) => normalizePreparationStatus(item?.status))
    .filter(Boolean);

  if (statuses.length === 0) {
    return normalizePreparationStatus(order?.status);
  }

  const allReadyOrServed = statuses.every((status) => ['ready', 'served', 'cancelled'].includes(status));
  if (allReadyOrServed) {
    const allServed = statuses.every((status) => ['served', 'cancelled'].includes(status));
    return allServed ? 'served' : 'ready';
  }

  const hasStartedItems = statuses.some((status) => ['in_kitchen', 'ready', 'served'].includes(status));
  if (hasStartedItems) {
    return 'in_kitchen';
  }

  return 'pending';
};

const formatDateTime = (value) => {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const triggerBrowserNotification = (enabled, title, body, tag) => {
  void showBrowserNotification({ enabled, title, body, tag });
};

const formatQuantity = (value) => {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) {
    return '0';
  }

  if (Number.isInteger(parsed)) {
    return String(parsed);
  }

  return parsed.toFixed(2).replace(/\.00$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
};

const getStationProgress = (order) => {
  const items = Array.isArray(order?.items) ? order.items : [];
  const total = items.reduce((count, item) => count + Math.max(1, Number(item?.quantity || 1)), 0);
  const ready = items.reduce((count, item) => {
    const quantity = Math.max(1, Number(item?.quantity || 1));
    const normalizedStatus = normalizePreparationStatus(item?.status);

    return ['ready', 'served'].includes(normalizedStatus) ? count + quantity : count;
  }, 0);

  return { ready, total };
};

const getOrderItemAction = (item, stationConfig) => {
  const normalizedStatus = normalizePreparationStatus(item?.status);

  if (normalizedStatus === 'pending') {
    return {
      label: stationConfig.startActionLabel,
      action: 'start',
    };
  }

  if (normalizedStatus === 'in_kitchen') {
    return {
      label: stationConfig.readyActionLabel,
      action: 'ready',
    };
  }

  return null;
};

const escapeHtml = (value) => {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const getPaidOrderPaymentMethod = (order) => {
  if (String(order?.status || '') !== 'paid') {
    return '';
  }

  return String(order?.latest_payment?.method || '').trim();
};

const MessageBanner = ({ message }) => {
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
    if (lastToastKeyRef.current === key) return;

    lastToastKeyRef.current = key;
    showToast({ type, message: text });
  }, [message, showToast]);

  if (!message) return null;
  return (
    <div className={`staff-message ${message.type === 'error' ? 'is-error' : 'is-success'}`}>
      {message.text}
    </div>
  );
};

const StatusBadge = ({ status }) => {
  return <span className={`staff-status-badge staff-status-${status}`}>{statusLabel(status)}</span>;
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

const buildItemRecipeDetails = (item) => {
  const menuIngredients = Array.isArray(item?.menu?.ingredients) ? item.menu.ingredients : [];
  const itemQuantity = Number(item?.quantity || 0);

  return menuIngredients.map((ingredient) => {
    const portionsPerMenu = Number(ingredient?.pivot?.quantity_needed || 0);
    const totalPortions = portionsPerMenu * itemQuantity;
    const totalRawQuantity = totalPortions * Number(ingredient?.portion_size || 0);

    return {
      id: ingredient.id,
      name: ingredient.name,
      portionsPerMenu,
      totalPortions,
      totalRawQuantity,
      portionUnit: ingredient.portion_unit || '',
    };
  }).filter((entry) => entry.totalPortions > 0);
};

const buildPrintTicketHtml = (order, stationConfig) => {
  const items = Array.isArray(order?.items) ? order.items : [];

  const itemsHtml = items.map((item) => {
    const menuName = item?.menu?.name || `Menu #${item.menu_id}`;
    const recipeDetails = buildItemRecipeDetails(item);

    const recipeHtml = recipeDetails.length === 0
      ? '<p class="ticket-muted">Recette non renseignee</p>'
      : `
          <ul>
            ${recipeDetails.map((detail) => `
              <li>
                ${escapeHtml(detail.name)}: ${escapeHtml(formatQuantity(detail.totalRawQuantity))} ${escapeHtml(detail.portionUnit)}
              </li>
            `).join('')}
          </ul>
        `;

    return `
      <section class="ticket-item">
        <h3>${escapeHtml(item.quantity)} x ${escapeHtml(menuName)}</h3>
        ${recipeHtml}
      </section>
    `;
  }).join('');

  const tableLabel = order?.table?.table_number ? `Table ${order.table.table_number}` : 'Sans table';
  const waiterLabel = order?.user?.name ? `Serveur: ${order.user.name}` : 'Serveur: -';
  const customerLabel = order?.customer?.name ? `Client: ${order.customer.name}` : 'Client: -';

  return `
    <!doctype html>
    <html lang="fr">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(stationConfig.ticketLabel)} #${escapeHtml(order.id)}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 12px;
            color: #111827;
          }
          h1 {
            margin: 0 0 6px;
            font-size: 18px;
          }
          .ticket-meta {
            margin: 0 0 10px;
            font-size: 12px;
            line-height: 1.5;
          }
          .ticket-item {
            border-top: 1px dashed #9ca3af;
            padding-top: 8px;
            margin-top: 8px;
          }
          .ticket-item h3 {
            margin: 0 0 4px;
            font-size: 14px;
          }
          .ticket-item ul {
            margin: 0;
            padding-left: 18px;
            font-size: 12px;
            line-height: 1.4;
          }
          .ticket-muted {
            margin: 0;
            color: #6b7280;
            font-size: 12px;
          }
          .ticket-notes {
            margin-top: 10px;
            border-top: 1px dashed #9ca3af;
            padding-top: 8px;
            font-size: 12px;
          }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(stationConfig.ticketLabel)} - Commande #${escapeHtml(order.id)}</h1>
        <div class="ticket-meta">
          <div>${escapeHtml(tableLabel)}</div>
          <div>${escapeHtml(waiterLabel)}</div>
          <div>${escapeHtml(customerLabel)}</div>
          <div>Date: ${escapeHtml(formatDateTime(order.created_at))}</div>
          <div>Urgente: ${order?.is_urgent ? 'Oui' : 'Non'}</div>
        </div>

        ${itemsHtml || '<p class="ticket-muted">Aucun article a imprimer.</p>'}

        ${order?.special_requests ? `<div class="ticket-notes"><strong>Notes:</strong> ${escapeHtml(order.special_requests)}</div>` : ''}
      </body>
    </html>
  `;
};

const printOrderTicket = (order, stationConfig) => {
  if (typeof document === 'undefined') {
    return false;
  }

  const html = buildPrintTicketHtml(order, stationConfig);
  const iframe = document.createElement('iframe');

  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';

  document.body.appendChild(iframe);

  const frameDoc = iframe.contentWindow?.document;
  if (!frameDoc) {
    document.body.removeChild(iframe);
    return false;
  }

  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();

  const triggerPrint = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }, 1000);
    }
  };

  setTimeout(triggerPrint, 180);
  return true;
};

export const KitchenOverviewModule = ({ station = 'kitchen' }) => {
  const api = useMemo(() => getPrepApi(station), [station]);
  const stationConfig = useMemo(() => getStationConfig(station), [station]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [stats, setStats] = useState({});
  const [urgentOrders, setUrgentOrders] = useState([]);
  const [browserNotificationEnabled, setBrowserNotificationEnabled] = useState(() => (
    getLocalBrowserNotificationEnabled(stationConfig.notificationStorageKey)
  ));
  const orderStatusMemoryRef = useRef(new Map());
  const firstLoadRef = useRef(true);

  const trackIncomingOrders = useCallback((nextOrders) => {
    const memory = orderStatusMemoryRef.current;
    const currentIds = new Set();
    const freshPendingOrders = [];
    let shouldNotify = false;

    nextOrders.forEach((order) => {
      const id = String(order.id);
      const previousStatus = memory.get(id);
      const currentStatus = resolveStationOrderStatus(order);
      currentIds.add(id);

      const isNewPendingOrder = !memory.has(id) && currentStatus === 'pending';
      const becamePending = previousStatus && previousStatus !== 'pending' && currentStatus === 'pending';

      if (!firstLoadRef.current && (isNewPendingOrder || becamePending)) {
        shouldNotify = true;
        freshPendingOrders.push(order);
      }

      memory.set(id, currentStatus);
    });

    Array.from(memory.keys()).forEach((id) => {
      if (!currentIds.has(id)) {
        memory.delete(id);
      }
    });

    if (!firstLoadRef.current && shouldNotify) {
      playNotificationTone('new-order');
    }

    if (firstLoadRef.current) {
      firstLoadRef.current = false;
    }

    return freshPendingOrders;
  }, []);

  const loadDataInternal = useCallback(async (options = {}) => {
    const { silent = false } = options || {};

    if (silent && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }

    if (!silent) {
      setLoading(true);
      setMessage(null);
    }

    try {
      const [statsRes, ordersRes] = await Promise.all([
        api.getKitchenStats(),
        api.getPendingOrders({ lightweight: 1 }),
      ]);

      const allOrders = Array.isArray(ordersRes.data) ? ordersRes.data : [];
      setStats(statsRes.data || {});
      setUrgentOrders(allOrders.filter((order) => (
        order.is_urgent && ['pending', 'in_kitchen'].includes(resolveStationOrderStatus(order))
      )));
      const freshPendingOrders = trackIncomingOrders(allOrders);
      if (freshPendingOrders.length > 0) {
        freshPendingOrders.forEach((order) => {
          const tableLabel = order?.table?.table_number ? `Table ${order.table.table_number}` : 'Sans table';
          triggerBrowserNotification(
            browserNotificationEnabled,
            `Nouvelle commande #${order.id}`,
            `${tableLabel} - ${stationConfig.label}`,
            `${stationConfig.label.toLowerCase()}-overview-${order.id}`
          );
        });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: extractApiError(error, `Impossible de charger le tableau de bord ${stationConfig.label.toLowerCase()}.`),
      });
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [api, browserNotificationEnabled, stationConfig.label, trackIncomingOrders]);
  const loadData = useSerializedAsyncCallback(loadDataInternal);

  useEffect(() => {
    if (!isBrowserNotificationSupported()) {
      return;
    }

    setBrowserNotificationEnabled(getLocalBrowserNotificationEnabled(stationConfig.notificationStorageKey));
  }, [stationConfig.notificationStorageKey]);

  useEffect(() => {
    persistLocalBrowserNotificationEnabled(stationConfig.notificationStorageKey, browserNotificationEnabled);
  }, [browserNotificationEnabled, stationConfig.notificationStorageKey]);

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
        text: `Notifications navigateur désactivées (${stationConfig.label}) sur ce navigateur.`,
      });
      return;
    }

    const granted = await requestBrowserNotificationPermission();
    setBrowserNotificationEnabled(granted);
    setMessage({
      type: granted ? 'success' : 'error',
      text: granted
        ? `Notifications navigateur activées (${stationConfig.label}).`
        : 'Notifications bloquées. Sur Firefox, autorisez les notifications dans la barre d’adresse puis réessayez.',
    });
  }, [browserNotificationEnabled, stationConfig.label]);

  useEffect(() => {
    loadData();

    const intervalId = setInterval(() => {
      loadData({ silent: true });
    }, OVERVIEW_REFRESH_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [loadData]);

  if (loading) {
    return <div className="staff-card">Chargement des donnees {stationConfig.label.toLowerCase()}...</div>;
  }

  return (
    <div className="staff-module-stack">
      <MessageBanner message={message} />

      <div className="staff-stat-grid">
        <div className="staff-stat-card"><span>En attente</span><strong>{stats.pending || 0}</strong></div>
        <div className="staff-stat-card"><span>{stationConfig.inProgressCountLabel}</span><strong>{stats.in_kitchen || 0}</strong></div>
        <div className="staff-stat-card"><span>Pretes</span><strong>{stats.ready || 0}</strong></div>
        <div className="staff-stat-card"><span>Stock faible</span><strong>{stats.low_ingredients || 0}</strong></div>
      </div>

      <div className="staff-card">
        <div className="staff-card-header">
          <h2>Commandes urgentes</h2>
          <div className="staff-inline-actions">
            <button type="button" className="staff-btn secondary" onClick={toggleBrowserNotifications}>
              {getBrowserNotificationToggleLabel(browserNotificationEnabled)}
            </button>
            <button type="button" className="staff-btn secondary" onClick={() => loadData()}>Actualiser</button>
          </div>
        </div>

        {urgentOrders.length === 0 ? (
          <p className="staff-muted">Aucune commande urgente actuellement.</p>
        ) : (
          <div className="staff-list">
            {urgentOrders.map((order) => (
              <div key={order.id} className="staff-list-item">
                <div className="staff-list-item-main">
                  <strong>Commande #{order.id}</strong>
                  <span>
                    {order?.table?.table_number ? `Table ${order.table.table_number}` : 'Sans table'}
                    {order?.user?.name ? ` · Serveur: ${order.user.name}` : ''}
                  </span>
                </div>
                <div className="staff-status-stack">
                  <StatusBadge status={resolveStationOrderStatus(order)} />
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

export const KitchenQueueModule = ({ station = 'kitchen' }) => {
  const api = useMemo(() => getPrepApi(station), [station]);
  const stationConfig = useMemo(() => getStationConfig(station), [station]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [processingItemId, setProcessingItemId] = useState(null);
  const [orders, setOrders] = useState([]);
  const [incomingNotifications, setIncomingNotifications] = useState([]);
  const [browserNotificationEnabled, setBrowserNotificationEnabled] = useState(() => (
    getLocalBrowserNotificationEnabled(stationConfig.notificationStorageKey)
  ));
  const [autoPrintEnabled, setAutoPrintEnabled] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    const stored = window.localStorage.getItem(getStationConfig(station).autoPrintStorageKey);
    if (stored === null) {
      return false;
    }

    return stored === '1';
  });
  const orderStatusMemoryRef = useRef(new Map());
  const firstLoadRef = useRef(true);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(stationConfig.autoPrintStorageKey, autoPrintEnabled ? '1' : '0');
  }, [autoPrintEnabled, stationConfig.autoPrintStorageKey]);

  useEffect(() => {
    if (!isBrowserNotificationSupported()) {
      return;
    }

    setBrowserNotificationEnabled(getLocalBrowserNotificationEnabled(stationConfig.notificationStorageKey));
  }, [stationConfig.notificationStorageKey]);

  useEffect(() => {
    persistLocalBrowserNotificationEnabled(stationConfig.notificationStorageKey, browserNotificationEnabled);
  }, [browserNotificationEnabled, stationConfig.notificationStorageKey]);

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
        text: `Notifications navigateur désactivées (${stationConfig.label}) sur ce navigateur.`,
      });
      return;
    }

    const granted = await requestBrowserNotificationPermission();
    setBrowserNotificationEnabled(granted);
    setMessage({
      type: granted ? 'success' : 'error',
      text: granted
        ? `Notifications navigateur activées (${stationConfig.label}).`
        : 'Notifications bloquées. Sur Firefox, autorisez les notifications dans la barre d’adresse puis réessayez.',
    });
  }, [browserNotificationEnabled, stationConfig.label]);

  const trackIncomingOrders = useCallback((nextOrders) => {
    const memory = orderStatusMemoryRef.current;
    const currentIds = new Set();
    const freshPendingOrders = [];
    let shouldNotify = false;

    nextOrders.forEach((order) => {
      const id = String(order.id);
      const previousStatus = memory.get(id);
      const currentStatus = resolveStationOrderStatus(order);
      currentIds.add(id);

      const isNewPendingOrder = !memory.has(id) && currentStatus === 'pending';
      const becamePending = previousStatus && previousStatus !== 'pending' && currentStatus === 'pending';

      if (!firstLoadRef.current && (isNewPendingOrder || becamePending)) {
        shouldNotify = true;
        freshPendingOrders.push(order);
      }

      memory.set(id, currentStatus);
    });

    Array.from(memory.keys()).forEach((id) => {
      if (!currentIds.has(id)) {
        memory.delete(id);
      }
    });

    if (!firstLoadRef.current && shouldNotify) {
      playNotificationTone('new-order');
    }

    if (firstLoadRef.current) {
      firstLoadRef.current = false;
    }

    return freshPendingOrders;
  }, []);

  const loadOrdersInternal = useCallback(async (options = {}) => {
    const { silent = false } = options || {};

    if (silent && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }

    if (!silent) {
      setLoading(true);
    }

    try {
      const response = await api.getPendingOrders({ lightweight: 0 });
      const nextOrders = (Array.isArray(response.data) ? response.data : []).filter((order) => (
        ['pending', 'in_kitchen'].includes(resolveStationOrderStatus(order))
      ));
      setOrders(nextOrders);

      const freshPendingOrders = trackIncomingOrders(nextOrders);
      if (freshPendingOrders.length > 0) {
        const nowIso = new Date().toISOString();
        const newEntries = freshPendingOrders.map((order, index) => {
          const tableLabel = order?.table?.table_number ? `Table ${order.table.table_number}` : 'Sans table';
          return {
            key: `incoming-${order.id}-${Date.now()}-${index}`,
            orderId: order.id,
            tableLabel,
            createdAt: nowIso,
          };
        });

        setIncomingNotifications((previous) => [...newEntries, ...previous].slice(0, 12));

        newEntries.forEach((entry) => {
          triggerBrowserNotification(
            browserNotificationEnabled,
            `Nouvelle commande #${entry.orderId}`,
            `${entry.tableLabel} - ${stationConfig.label}`,
            `${stationConfig.label.toLowerCase()}-queue-${entry.orderId}`
          );
        });
      }

      if (autoPrintEnabled && freshPendingOrders.length > 0) {
        freshPendingOrders.forEach((order) => {
          printOrderTicket(order, stationConfig);
        });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: extractApiError(error, `Impossible de charger la file ${stationConfig.label.toLowerCase()}.`),
      });
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [api, autoPrintEnabled, browserNotificationEnabled, stationConfig, trackIncomingOrders]);
  const loadOrders = useSerializedAsyncCallback(loadOrdersInternal);

  useEffect(() => {
    loadOrders();

    const intervalId = setInterval(() => {
      loadOrders({ silent: true });
    }, QUEUE_REFRESH_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [loadOrders]);

  const moveOrderItem = useCallback(async (order, item) => {
    setMessage(null);
    setProcessingItemId(item.id);

    try {
      const itemAction = getOrderItemAction(item, stationConfig);

      if (!itemAction) {
        setMessage({
          type: 'error',
          text: 'Cet article est déjà traité.',
        });
        return;
      }

      const menuName = item?.menu?.name || `Menu #${item.menu_id}`;

      if (itemAction.action === 'start') {
        await api.startOrderItem(item.id);
      } else if (itemAction.action === 'ready') {
        await api.markOrderItemReady(item.id);
      }

      const nextItemStatus = itemAction.action === 'ready' ? 'ready' : 'in_kitchen';
      setOrders((previous) => previous.map((currentOrder) => {
        if (Number(currentOrder?.id) !== Number(order?.id)) {
          return currentOrder;
        }

        const nextItems = Array.isArray(currentOrder?.items)
          ? currentOrder.items.map((currentItem) => (
            Number(currentItem?.id) === Number(item?.id)
              ? { ...currentItem, status: nextItemStatus }
              : currentItem
          ))
          : currentOrder?.items;

        return {
          ...currentOrder,
          items: nextItems,
        };
      }));

      setMessage({
        type: 'success',
        text: itemAction.action === 'ready'
          ? `${menuName} est marque pret sur la commande #${order.id}.`
          : `${menuName} passe en preparation sur la commande #${order.id}.`,
      });
      // Conserver le refresh existant sans bloquer l'action UI.
      void loadOrders({ silent: true });
    } catch (error) {
      setMessage({
        type: 'error',
        text: extractApiError(error, 'Transition de statut impossible.'),
      });
    } finally {
      setProcessingItemId(null);
    }
  }, [api, loadOrders, stationConfig]);

  const handlePrint = (order) => {
    const didPrint = printOrderTicket(order, stationConfig);

    if (!didPrint) {
      setMessage({
        type: 'error',
        text: 'Impression impossible depuis ce navigateur.',
      });
      return;
    }

    setMessage({
      type: 'success',
      text: `Ticket de la commande #${order.id} envoye a l'impression.`,
    });
  };

  if (loading) {
    return <div className="staff-card">Chargement de la file {stationConfig.label.toLowerCase()}...</div>;
  }

  return (
    <div className="staff-module-stack">
      <MessageBanner message={message} />

      {incomingNotifications.length > 0 ? (
        <div className="staff-card staff-ready-feed">
          <div className="staff-card-header compact">
            <h3>Nouvelles commandes</h3>
            <button type="button" className="staff-btn secondary" onClick={() => setIncomingNotifications([])}>
              Effacer
            </button>
          </div>

          <div className="staff-ready-list">
            {incomingNotifications.map((entry) => (
              <div key={entry.key} className="staff-ready-item">
                <strong>Commande #{entry.orderId}</strong>
                <span>{entry.tableLabel} · Nouvelle commande reçue</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="staff-card">
        <div className="staff-card-header">
          <h2>{stationConfig.queueTitle}</h2>
          <div className="staff-inline-actions">
            <button
              type="button"
              className="staff-btn secondary"
              onClick={toggleBrowserNotifications}
            >
              {getBrowserNotificationToggleLabel(browserNotificationEnabled)}
            </button>
            <button
              type="button"
              className="staff-btn secondary"
              onClick={() => setAutoPrintEnabled((previous) => !previous)}
            >
              {autoPrintEnabled ? 'Auto-impression: ON' : 'Auto-impression: OFF'}
            </button>
            <button type="button" className="staff-btn secondary" onClick={() => loadOrders()}>Actualiser</button>
          </div>
        </div>

        {orders.length === 0 ? (
          <p className="staff-muted">Aucune commande en attente.</p>
        ) : (
          <div className="staff-order-board">
            {orders.map((order) => {
              const stationStatus = resolveStationOrderStatus(order);
              const progress = getStationProgress(order);

              return (
                <article key={order.id} className={`staff-order-card ${order.is_urgent ? 'is-urgent' : ''}`}>
                  <header>
                    <div>
                      <strong>Commande #{order.id}</strong>
                      <p>{order?.table?.table_number ? `Table ${order.table.table_number}` : 'Sans table'}</p>
                      {order?.user?.name ? <p>Serveur: {order.user.name}</p> : null}
                      {progress.total > 0 ? (
                        <p>{progress.ready}/{progress.total} menu{progress.total > 1 ? 's' : ''} pret{progress.ready > 1 ? 's' : ''}</p>
                      ) : null}
                    </div>
                    <div className="staff-status-stack">
                      <StatusBadge status={stationStatus} />
                      <PaidOrderStatusMeta order={order} />
                    </div>
                  </header>

                  {order?.special_requests ? (
                    <p className="staff-order-note">
                      <strong>Notes:</strong> {order.special_requests}
                    </p>
                  ) : null}

                  <ul>
                    {(order.items || []).map((item) => {
                      const recipeDetails = buildItemRecipeDetails(item);
                      const itemAction = getOrderItemAction(item, stationConfig);
                      const itemMenuName = item?.menu?.name || `Menu #${item.menu_id}`;
                      const itemStatus = normalizePreparationStatus(item?.status);

                      return (
                        <li key={item.id} className="staff-order-item">
                          <div className="staff-order-item-top">
                            <div className="staff-order-item-main">
                              <div className="staff-order-item-line">
                                {item.quantity} x {itemMenuName}
                              </div>
                              <span className="staff-order-item-meta">
                                Statut: {statusLabel(itemStatus)}
                              </span>
                            </div>
                            <div className="staff-order-item-actions">
                              <StatusBadge status={itemStatus} />
                              {itemAction ? (
                                <button
                                  type="button"
                                  className="staff-btn primary small"
                                  onClick={() => moveOrderItem(order, item)}
                                  disabled={processingItemId === item.id}
                                >
                                  {processingItemId === item.id ? '...' : itemAction.label}
                                </button>
                              ) : null}
                            </div>
                          </div>
                          {recipeDetails.length > 0 ? (
                            <div className="staff-order-recipe-list">
                              {recipeDetails.map((detail) => (
                                <span key={`${item.id}-${detail.id}`} className="staff-order-recipe-chip">
                                  {detail.name}: {formatQuantity(detail.totalRawQuantity)} {detail.portionUnit}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>

                  <footer>
                    <span>{formatDateTime(order.created_at)}</span>
                    <div className="staff-inline-actions">
                      <button
                        type="button"
                        className="staff-btn secondary"
                        onClick={() => handlePrint(order)}
                      >
                        Imprimer
                      </button>
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export const KitchenHistoryModule = ({ station = 'kitchen' }) => {
  const api = useMemo(() => getPrepApi(station), [station]);
  const stationConfig = useMemo(() => getStationConfig(station), [station]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [scope, setScope] = useState('today');
  const [orders, setOrders] = useState([]);

  const loadHistoryInternal = useCallback(async (options = {}) => {
    const { silent = false } = options || {};

    if (silent && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }

    if (!silent) {
      setLoading(true);
      setMessage(null);
    }

    try {
      const response = await api.getOrderHistory({ scope });
      setOrders(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setMessage({
        type: 'error',
        text: extractApiError(error, `Impossible de charger l'historique ${stationConfig.label.toLowerCase()}.`),
      });
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [api, scope, stationConfig.label]);
  const loadHistory = useSerializedAsyncCallback(loadHistoryInternal);

  useEffect(() => {
    loadHistory();

    const intervalId = setInterval(() => {
      loadHistory({ silent: true });
    }, OVERVIEW_REFRESH_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [loadHistory]);

  if (loading) {
    return <div className="staff-card">Chargement de l'historique {stationConfig.label.toLowerCase()}...</div>;
  }

  return (
    <div className="staff-module-stack">
      <MessageBanner message={message} />

      <div className="staff-card">
        <div className="staff-card-header">
          <h2>Historique {stationConfig.label}</h2>
          <div className="staff-inline-actions">
            <select
              className="staff-date-input"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            >
              <option value="today">Aujourd'hui</option>
              <option value="all">Tout</option>
            </select>
            <button type="button" className="staff-btn secondary" onClick={() => loadHistory()}>
              Actualiser
            </button>
          </div>
        </div>

        {orders.length === 0 ? (
          <p className="staff-muted">Aucune commande dans l'historique.</p>
        ) : (
          <div className="staff-list">
            {orders.map((order) => (
              <div className="staff-list-item" key={order.id}>
                <div className="staff-list-item-main">
                  <strong>Commande #{order.id}</strong>
                  <span>
                    {order?.table?.table_number ? `Table ${order.table.table_number}` : 'Sans table'}
                    {order?.customer?.name ? ` · Client: ${order.customer.name}` : ''}
                  </span>
                  <span className="staff-item-summary">
                    {Array.isArray(order?.items) && order.items.length > 0
                      ? order.items.map((item) => `${item.quantity}x ${item?.menu?.name || `Menu #${item.menu_id}`}`).join(', ')
                      : 'Aucun article'}
                  </span>
                  <span className="staff-item-summary">
                    Créée: {formatDateTime(order.created_at)} · Prête: {formatDateTime(order.ready_at)} · Servie: {formatDateTime(order.served_at)}
                  </span>
                  {order?.special_requests ? (
                    <span className="staff-item-summary">Notes: {order.special_requests}</span>
                  ) : null}
                </div>
                <div className="staff-status-stack">
                  <StatusBadge status={resolveStationOrderStatus(order)} />
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

export const KitchenIngredientsModule = ({ station = 'kitchen' }) => {
  const api = useMemo(() => getPrepApi(station), [station]);
  const stationConfig = useMemo(() => getStationConfig(station), [station]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [ingredients, setIngredients] = useState([]);

  const loadIngredientsInternal = useCallback(async (options = {}) => {
    const { silent = false } = options || {};

    if (silent && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }

    if (!silent) {
      setLoading(true);
      setMessage(null);
    }

    try {
      const response = await api.getIngredientsStatus();
      setIngredients(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setMessage({
        type: 'error',
        text: extractApiError(error, `Impossible de charger les ingredients ${stationConfig.label.toLowerCase()}.`),
      });
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [api, stationConfig.label]);
  const loadIngredients = useSerializedAsyncCallback(loadIngredientsInternal);

  useEffect(() => {
    loadIngredients();

    const intervalId = setInterval(() => {
      loadIngredients({ silent: true });
    }, INGREDIENTS_REFRESH_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [loadIngredients]);

  if (loading) {
    return <div className="staff-card">Chargement des ingredients...</div>;
  }

  return (
    <div className="staff-module-stack">
      <MessageBanner message={message} />

      <div className="staff-card">
        <div className="staff-card-header">
          <h2>{stationConfig.ingredientsTitle}</h2>
          <button type="button" className="staff-btn secondary" onClick={() => loadIngredients()}>Actualiser</button>
        </div>

        {ingredients.length === 0 ? (
          <p className="staff-muted">Aucun ingredient trouve.</p>
        ) : (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Ingredient</th>
                  <th>Matiere premiere</th>
                  <th>Portion</th>
                  <th>Disponible</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {ingredients
                  .slice()
                  .sort((a, b) => Number(a.quantity_available || 0) - Number(b.quantity_available || 0))
                  .map((ingredient) => {
                    const quantity = Number(ingredient.quantity_available || 0);
                    const stockState = quantity < 5 ? 'low' : quantity < 10 ? 'warning' : 'good';

                    return (
                      <tr key={ingredient.id}>
                        <td data-label="Ingredient">{ingredient.name}</td>
                        <td data-label="Matiere premiere">{ingredient?.raw_material?.name || '-'}</td>
                        <td data-label="Portion">{ingredient.portion_size} {ingredient.portion_unit}</td>
                        <td data-label="Disponible">{quantity}</td>
                        <td data-label="Statut">
                          <span className={`staff-stock-badge ${stockState}`}>
                            {stockState === 'low' ? 'Faible' : stockState === 'warning' ? 'Limite' : 'OK'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
