import React, { useCallback, useEffect, useRef, useState } from 'react';
import useSerializedAsyncCallback from '../../../hooks/useSerializedAsyncCallback';
import { cashierAPI } from '../../../services/api';
import { playNotificationTone } from '../../../utils/notificationSound';
import { PAYMENT_METHOD_OPTIONS, formatPaymentMethodLabel, normalizePaymentMethod } from '../../../utils/paymentMethods';
import { useToast } from '../../common/ToastProvider';

const OVERVIEW_REFRESH_INTERVAL_MS = 5000;
const PAYMENTS_REFRESH_INTERVAL_MS = 5000;
const CASHIER_NOTIFICATION_STORAGE_KEY = 'staff.notifications.cashier';
const BILL_NOTIFICATION_DEDUP_TTL_MS = 10 * 60 * 1000;
const IMMEDIATE_PAYMENT_METHOD_OPTIONS = PAYMENT_METHOD_OPTIONS.filter((option) => option.value !== 'bon');
const IMMEDIATE_PAYMENT_METHOD_VALUES = new Set(IMMEDIATE_PAYMENT_METHOD_OPTIONS.map((option) => option.value));
const INVALID_CUSTOMER_NAMES = new Set(['null', 'emporter', 'a emporter', 'aemporter', 'takeaway']);
const seenBillNotificationKeys = new Map();

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} Ar`;
};

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

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

const normalizeCustomerName = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ');

const sanitizeCustomerName = (value) => {
  const trimmed = String(value || '').trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';

  const normalized = normalizeCustomerName(trimmed);
  if (!normalized || INVALID_CUSTOMER_NAMES.has(normalized)) {
    return '';
  }

  return trimmed;
};

const sanitizeCustomers = (rawCustomers) => {
  const seen = new Set();

  return (Array.isArray(rawCustomers) ? rawCustomers : [])
    .map((customer) => {
      const id = Number(customer?.id || 0);
      const name = sanitizeCustomerName(customer?.name);

      if (id <= 0 || !name) {
        return null;
      }

      const dedupeKey = `${id}:${normalizeCustomerName(name)}`;
      if (seen.has(dedupeKey)) {
        return null;
      }

      seen.add(dedupeKey);

      return {
        ...customer,
        id,
        name,
      };
    })
    .filter(Boolean);
};

const normalizeImmediatePaymentMethod = (value, fallback = 'cash') => {
  const normalized = normalizePaymentMethod(value);
  if (IMMEDIATE_PAYMENT_METHOD_VALUES.has(normalized)) {
    return normalized;
  }

  return IMMEDIATE_PAYMENT_METHOD_VALUES.has(fallback) ? fallback : '';
};

const getTargetAccountLabelForMethod = (method) => {
  const normalizedMethod = normalizePaymentMethod(method);
  if (normalizedMethod === 'cash') return 'Caisse';
  if (normalizedMethod === 'mobile_money') return 'Mobile Money';
  if (normalizedMethod === 'transfer' || normalizedMethod === 'check') return 'Banque';
  if (normalizedMethod === 'bon') return 'En attente';
  return '-';
};

const buildBillNotificationDedupKey = (orderId, billRequestedAt) => {
  const normalizedOrderId = Number(orderId || 0);
  const normalizedDate = String(billRequestedAt || '').trim();

  if (normalizedOrderId <= 0 || normalizedDate === '') {
    return '';
  }

  return `${normalizedOrderId}:${normalizedDate}`;
};

const shouldEmitBillNotification = (orderId, billRequestedAt) => {
  const key = buildBillNotificationDedupKey(orderId, billRequestedAt);
  if (!key) {
    return false;
  }

  const now = Date.now();
  const previousAt = Number(seenBillNotificationKeys.get(key) || 0);
  if (previousAt > 0 && now - previousAt < BILL_NOTIFICATION_DEDUP_TTL_MS) {
    return false;
  }

  seenBillNotificationKeys.set(key, now);

  seenBillNotificationKeys.forEach((timestamp, existingKey) => {
    if (now - Number(timestamp || 0) > BILL_NOTIFICATION_DEDUP_TTL_MS) {
      seenBillNotificationKeys.delete(existingKey);
    }
  });

  return true;
};

const getOrderTableLabel = (orderLike) => {
  if (String(orderLike?.order_type || '') === 'takeaway') {
    return 'A emporter';
  }

  return orderLike?.table?.table_number ? `Table ${orderLike.table.table_number}` : 'Sans table';
};

const getPackagingDetails = (orderLike) => {
  const quantity = Math.max(0, Math.trunc(Number(orderLike?.packaging_quantity || 0)));
  const unitPrice = Math.max(0, Number(orderLike?.packaging_unit_price || 0));
  const total = quantity * unitPrice;

  return {
    enabled: Boolean(orderLike?.with_packaging) && quantity > 0 && unitPrice > 0,
    quantity,
    unitPrice,
    total,
  };
};

const getOrderLatestPayment = (order) => order?.latest_payment || order?.latestPayment || null;

const getSortedPayments = (rawPayments, fallbackPayment = null) => {
  const payments = Array.isArray(rawPayments) ? rawPayments.filter(Boolean) : [];
  const entries = payments.length > 0
    ? payments
    : (fallbackPayment ? [fallbackPayment] : []);

  return entries
    .slice()
    .sort((left, right) => Number(left?.id || 0) - Number(right?.id || 0));
};

const summarizePayments = (rawPayments, fallbackPayment = null) => {
  const payments = getSortedPayments(rawPayments, fallbackPayment);
  const completedPayments = payments.filter((payment) => String(payment?.status || '') === 'completed');
  const pendingPayments = payments.filter((payment) => String(payment?.status || '') === 'pending');

  return {
    payments,
    latestPayment: payments[payments.length - 1] || null,
    latestCompletedPayment: completedPayments[completedPayments.length - 1] || null,
    latestPendingPayment: pendingPayments[pendingPayments.length - 1] || null,
    completedAmount: roundMoney(completedPayments.reduce((total, payment) => total + Number(payment?.amount || 0), 0)),
    pendingAmount: roundMoney(pendingPayments.reduce((total, payment) => total + Number(payment?.amount || 0), 0)),
    hasPendingPayment: pendingPayments.length > 0,
    hasPendingVoucher: pendingPayments.some((payment) => normalizePaymentMethod(payment?.method) === 'bon'),
  };
};

const getOrderPaymentSummary = (orderLike) => summarizePayments(orderLike?.payments, getOrderLatestPayment(orderLike));
const hasLockedVoucherCustomer = (orderLike) => {
  const paymentSummary = getOrderPaymentSummary(orderLike);
  return paymentSummary.hasPendingVoucher && Number(orderLike?.customer?.id || 0) > 0;
};

const getInvoicePaymentSummary = (invoice) => summarizePayments(invoice?.payments, invoice?.payment || null);

const hasOwnPaymentFormField = (form, key) => Object.prototype.hasOwnProperty.call(form || {}, key);

const getResolvedVoucherCustomerId = (form, orderLike) => {
  if (hasOwnPaymentFormField(form, 'customer_id')) {
    return Number(form?.customer_id || 0) || 0;
  }

  return Number(orderLike?.customer?.id || 0) || 0;
};

const getResolvedVoucherCustomerName = (form) => {
  if (!hasOwnPaymentFormField(form, 'customer_name')) {
    return '';
  }

  return sanitizeCustomerName(form?.customer_name);
};

const getOrderDisplayCustomerName = (orderLike, typedName = '', selectedCustomer = null) => {
  return sanitizeCustomerName(
    selectedCustomer?.name
    || orderLike?.customer?.name
    || typedName
  );
};

const getTargetAccountLabelForPayment = (payment) => {
  const status = String(payment?.status || '').trim();
  const method = normalizePaymentMethod(payment?.settlement_method || payment?.method);

  if (status !== 'completed') {
    return normalizePaymentMethod(payment?.method) === 'bon' ? 'En attente' : '-';
  }

  return getTargetAccountLabelForMethod(method);
};

const getPaymentWorkflowState = (order) => {
  const paymentSummary = getOrderPaymentSummary(order);
  if (!paymentSummary.latestPayment) return 'to_print';
  if (paymentSummary.hasPendingVoucher) return 'voucher_pending';
  if (!paymentSummary.hasPendingPayment && paymentSummary.completedAmount > 0) return 'completed';
  return 'awaiting_collection';
};

const paymentStatusLabel = (status) => {
  const labels = {
    pending: 'En attente',
    completed: 'Encaisse',
    refunded: 'Rembourse',
  };

  return labels[status] || status || '-';
};

const getInvoiceDocumentLabel = (invoice) => {
  const paymentSummary = getInvoicePaymentSummary(invoice);
  if (paymentSummary.hasPendingVoucher) return 'Bon client';
  if (paymentSummary.completedAmount > 0 && !paymentSummary.hasPendingPayment) return 'Facture';
  return 'Addition';
};

const getInvoiceTotalLabel = (invoice) => {
  const paymentSummary = getInvoicePaymentSummary(invoice);
  if (paymentSummary.completedAmount > 0 && paymentSummary.pendingAmount > 0) {
    return 'Reste à encaisser';
  }

  return paymentSummary.hasPendingPayment ? 'Total à encaisser' : 'Total encaissé';
};

const buildInvoiceHtml = (invoice) => {
  const paymentSummary = getInvoicePaymentSummary(invoice);
  const payment = paymentSummary.latestPayment || invoice?.payment || null;
  const paymentStatus = paymentSummary.pendingAmount > 0
    ? 'pending'
    : (paymentSummary.completedAmount > 0 ? 'completed' : String(payment?.status || invoice?.payment_status || 'pending'));
  const isCompleted = paymentStatus === 'completed';
  const isVoucher = paymentSummary.hasPendingVoucher;
  const printedAt = formatDateTime(invoice?.printed_at || payment?.printed_at || invoice?.bill_requested_at || invoice?.created_at);
  const encashedAt = formatDateTime(invoice?.encashed_at || paymentSummary.latestCompletedPayment?.encashed_at || payment?.encashed_at);
  const subtotal = formatCurrency(invoice.subtotal || invoice.total);
  const itemsSubtotal = formatCurrency(invoice.items_subtotal || invoice.subtotal || invoice.total);
  const discountPercent = Number(invoice.discount_percent || 0);
  const discountAmount = formatCurrency(invoice.discount_amount || 0);
  const total = formatCurrency(invoice.total);
  const completedAmount = formatCurrency(invoice.completed_amount ?? paymentSummary.completedAmount);
  const remainingAmountValue = roundMoney(invoice.remaining_amount ?? paymentSummary.pendingAmount);
  const remainingAmount = formatCurrency(remainingAmountValue);
  const invoicePackaging = getPackagingDetails(invoice);
  const tableLabel = String(invoice?.order_type || '') === 'takeaway'
    ? 'A emporter'
    : (invoice.table ? `Table ${invoice.table}` : 'Sans table');
  const customerLabel = invoice.customer || 'Client libre';
  const methodLabel = formatPaymentMethodLabel(payment?.method || '-');
  const settlementMethodLabel = formatPaymentMethodLabel(payment?.settlement_method || payment?.method || '-');
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const documentLabel = isCompleted ? 'Facture' : (isVoucher ? 'Bon client' : 'Addition');
  const totalLabel = remainingAmountValue > 0
    ? (paymentSummary.completedAmount > 0 ? 'Reste a encaisser' : 'Total a encaisser')
    : 'Total encaisse';

  const rows = items.map((item) => {
    const menuName = item?.menu?.name || `Menu #${item.menu_id}`;
    const quantity = Number(item?.quantity || 0);
    const unitPriceRaw = Number(item?.price_at_order || 0);
    const unitPrice = formatCurrency(unitPriceRaw);
    const lineTotal = formatCurrency(unitPriceRaw * quantity);

    return `
        <div class="line-item">
          <div class="line-item-name">${escapeHtml(menuName)}</div>
          <div class="line-item-meta">
            <span>${quantity} x ${escapeHtml(unitPrice)}</span>
            <strong>${escapeHtml(lineTotal)}</strong>
          </div>
        </div>
      `;
  }).join('');

  const packagingLine = invoicePackaging.enabled
    ? `${invoicePackaging.quantity} x ${formatCurrency(invoicePackaging.unitPrice)} = ${formatCurrency(invoicePackaging.total)}`
    : 'Non';

  const paymentRows = paymentSummary.payments.map((entry) => {
    const entryStatus = String(entry?.status || '').trim();
    const entryMethod = formatPaymentMethodLabel(entry?.settlement_method || entry?.method || '-');
    const entryLabel = entryStatus === 'completed'
      ? 'Encaissement'
      : (normalizePaymentMethod(entry?.method) === 'bon' ? 'Bon client' : 'En attente');

    return `
        <div class="meta-row">
          <span>${escapeHtml(entryLabel)}</span>
          <strong>${escapeHtml(formatCurrency(entry?.amount || 0))} · ${escapeHtml(entryMethod)}</strong>
        </div>
      `;
  }).join('');

  return `
      <!doctype html>
      <html lang="fr">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(documentLabel)} commande #${escapeHtml(invoice.order_id)}</title>
        <style>
          :root {
            --paper-width: 80mm;
            --content-width: 72mm;
          }
          * { box-sizing: border-box; }
          html, body {
            width: var(--paper-width);
            margin: 0;
            padding: 0;
            background: #ffffff;
            color: #111827;
            font-family: "Courier New", Courier, monospace;
          }
          body {
            padding: 4mm;
            font-size: 11px;
            line-height: 1.35;
          }
          .receipt {
            width: var(--content-width);
            margin: 0 auto;
          }
          h1 {
            margin: 0;
            text-align: center;
            font-size: 16px;
            letter-spacing: 0.04em;
          }
          .receipt-subtitle {
            margin: 4px 0 0;
            text-align: center;
            font-size: 11px;
          }
          .divider {
            border-top: 1px dashed #111827;
            margin: 8px 0;
          }
          .meta {
            display: grid;
            gap: 3px;
          }
          .meta-row,
          .total-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 8px;
          }
          .meta-row span:first-child,
          .total-row span:first-child {
            padding-right: 8px;
          }
          .line-item {
            padding: 6px 0;
            border-bottom: 1px dashed #d1d5db;
          }
          .line-item-name {
            font-weight: 700;
            margin-bottom: 3px;
            word-break: break-word;
          }
          .line-item-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
          }
          .totals {
            display: grid;
            gap: 4px;
          }
          .grand-total {
            font-size: 14px;
            font-weight: 700;
          }
          .footer {
            text-align: center;
            margin-top: 10px;
            font-size: 10px;
          }
          @media print {
            @page {
              size: 80mm auto;
              margin: 4mm 3mm;
            }
            html, body {
              width: auto;
            }
            body {
              padding: 0;
            }
          }
        </style>
      </head>
      <body>
        <div class="receipt">
          <h1>Razafimamonjy Restaurant</h1>
          <div class="receipt-subtitle">${escapeHtml(documentLabel)} commande #${escapeHtml(invoice.order_id)}</div>
          <div class="receipt-subtitle">${escapeHtml(printedAt)}</div>

          <div class="divider"></div>

          <div class="meta">
            <div class="meta-row"><span>Table</span><strong>${escapeHtml(tableLabel)}</strong></div>
            <div class="meta-row"><span>Client</span><strong>${escapeHtml(customerLabel)}</strong></div>
            <div class="meta-row"><span>Paiement</span><strong>${escapeHtml(methodLabel)}</strong></div>
            ${isCompleted ? `<div class="meta-row"><span>Encaissé via</span><strong>${escapeHtml(settlementMethodLabel)}</strong></div>` : ''}
            ${isCompleted ? `<div class="meta-row"><span>Date encaissement</span><strong>${escapeHtml(encashedAt)}</strong></div>` : ''}
            ${paymentRows}
          </div>

          <div class="divider"></div>

          <div class="items">
            ${rows || '<div class="line-item"><div class="line-item-name">Aucun article</div></div>'}
          </div>

          <div class="divider"></div>

          <div class="totals">
            <div class="total-row"><span>Sous-total menus</span><strong>${escapeHtml(itemsSubtotal)}</strong></div>
            ${String(invoice?.order_type || '') === 'takeaway' ? `<div class="total-row"><span>Barquettes</span><strong>${escapeHtml(packagingLine)}</strong></div>` : ''}
            <div class="total-row"><span>Sous-total</span><strong>${escapeHtml(subtotal)}</strong></div>
            <div class="total-row"><span>Réduction</span><strong>${discountPercent}% (${escapeHtml(discountAmount)})</strong></div>
            <div class="total-row grand-total"><span>Total commande</span><strong>${escapeHtml(total)}</strong></div>
            ${paymentSummary.completedAmount > 0 ? `<div class="total-row"><span>Déjà encaissé</span><strong>${escapeHtml(completedAmount)}</strong></div>` : ''}
            ${remainingAmountValue > 0 ? `<div class="total-row"><span>${escapeHtml(totalLabel)}</span><strong>${escapeHtml(remainingAmount)}</strong></div>` : ''}
          </div>

          <div class="divider"></div>

          <div class="footer">
            Merci et à bientôt.
          </div>
        </div>
      </body>
      </html>
    `;
};

const printInvoiceDocument = (invoice) => {
  if (typeof document === 'undefined') {
    return false;
  }

  const html = buildInvoiceHtml(invoice);
  const iframe = document.createElement('iframe');
  let cleaned = false;
  let printTriggered = false;

  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');

  const cleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    iframe.onload = null;
    setTimeout(() => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    }, 1200);
  };

  const triggerPrint = () => {
    if (cleaned || printTriggered) {
      return;
    }

    const printWindow = iframe.contentWindow;
    if (!printWindow) {
      return;
    }

    printTriggered = true;

    try {
      printWindow.focus();
      printWindow.print();
    } catch (_error) {
      cleanup();
      return;
    }

    setTimeout(cleanup, 1200);
  };

  iframe.onload = () => {
    setTimeout(triggerPrint, 180);
  };

  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  setTimeout(triggerPrint, 1200);
  return true;
};

const buildLocalDayUtcRange = (dateInput) => {
  const raw = String(dateInput || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const startLocal = new Date(year, month - 1, day, 0, 0, 0, 0);
  const endLocal = new Date(year, month - 1, day, 23, 59, 59, 999);

  if (Number.isNaN(startLocal.getTime()) || Number.isNaN(endLocal.getTime())) {
    return null;
  }

  return {
    from: startLocal.toISOString(),
    to: endLocal.toISOString(),
  };
};

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const extractApiError = (error, fallbackMessage) => {
  return error?.response?.data?.message || error?.response?.data?.error || fallbackMessage;
};

const requestBrowserNotificationPermission = async () => {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  try {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  } catch (_error) {
    return false;
  }
};

const isBrowserNotificationSupported = () => {
  return typeof window !== 'undefined' && 'Notification' in window;
};

const getInitialCashierNotificationEnabled = () => {
  if (!isBrowserNotificationSupported()) {
    return false;
  }

  const stored = window.localStorage.getItem(CASHIER_NOTIFICATION_STORAGE_KEY);
  if (stored !== null) {
    return stored === '1' && Notification.permission === 'granted';
  }

  return Notification.permission === 'granted';
};

const getNotificationButtonLabel = (enabled) => {
  return `Notif navigateur: ${enabled ? 'ON' : 'OFF'}`;
};

const getDiscountedAmount = (baseAmount, discountPercent) => {
  const gross = Number(baseAmount || 0);
  const percent = Math.max(0, Math.min(10, Number(discountPercent || 0)));
  const discountAmount = (gross * percent) / 100;
  return Math.max(0, gross - discountAmount);
};

const statusLabel = (status) => {
  const labels = {
    ready: 'Prete',
    served: 'Servie',
    paid: 'Payee',
  };

  return labels[status] || status;
};

const movementStatusLabel = (status) => {
  const labels = {
    pending: 'En attente',
    approved: 'Valide',
    rejected: 'Refuse',
  };

  return labels[status] || status;
};

const movementDirectionLabel = (direction) => {
  if (direction === 'in') return 'Entree';
  if (direction === 'out') return 'Sortie';
  return direction || '-';
};

const renderMovementDetails = (movement, { preferReason = false } = {}) => {
  const reason = String(movement?.reason || '').trim();
  const description = String(movement?.description || '').trim();
  const primary = preferReason
    ? (reason || description)
    : (description || reason);
  const secondary = preferReason
    ? (description && description !== primary ? description : '')
    : (reason && reason !== primary ? reason : '');

  return (
    <div className="staff-movement-detail">
      <strong>{primary || '-'}</strong>
      {secondary ? <span>{secondary}</span> : null}
    </div>
  );
};

const StatusBadge = ({ status }) => {
  return <span className={`staff-status-badge staff-status-${status}`}>{statusLabel(status)}</span>;
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
    if (lastToastKeyRef.current === key) {
      return;
    }

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

export const CashierOverviewModule = () => {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [stats, setStats] = useState({ total_revenue: 0, total_orders: 0, by_method: [], by_account: [], recent_customer_payments: [] });
  const [readyOrders, setReadyOrders] = useState([]);
  const [billNotifications, setBillNotifications] = useState([]);
  const [browserNotificationEnabled, setBrowserNotificationEnabled] = useState(() => getInitialCashierNotificationEnabled());
  const firstLoadRef = useRef(true);
  const previousOrdersRef = useRef(new Map());

  const billRequestsCount = readyOrders.filter((order) => Boolean(order?.bill_requested_at)).length;

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
      const [statsRes, readyRes] = await Promise.all([
        cashierAPI.getDayStats(),
        cashierAPI.getReadyOrders({ include_items: 0 }),
      ]);

      setStats(statsRes.data || { total_revenue: 0, total_orders: 0, by_method: [], by_account: [], recent_customer_payments: [] });
      const nextOrders = Array.isArray(readyRes.data) ? readyRes.data : [];

      if (!firstLoadRef.current) {
        const previousMap = previousOrdersRef.current;
        const newEntries = [];

        nextOrders.forEach((order) => {
          const previous = previousMap.get(Number(order.id));
          const previousBillRequestAt = String(previous?.bill_requested_at || '');
          const currentBillRequestAt = String(order?.bill_requested_at || '');

          if (
            currentBillRequestAt
            && currentBillRequestAt !== previousBillRequestAt
            && shouldEmitBillNotification(order.id, currentBillRequestAt)
          ) {
            const tableLabel = getOrderTableLabel(order);
            newEntries.push({
              key: `bill-overview-${order.id}-${Date.now()}`,
              orderId: order.id,
              tableLabel,
              createdAt: new Date().toISOString(),
            });

            playNotificationTone('new-order');

            if (
              browserNotificationEnabled
              && typeof window !== 'undefined'
              && 'Notification' in window
              && Notification.permission === 'granted'
            ) {
              try {
                new Notification(`Addition demandée · Commande #${order.id}`, {
                  body: tableLabel,
                });
              } catch (_error) {
                // Ignorer les erreurs de notification navigateur.
              }
            }
          }
        });

        if (newEntries.length > 0) {
          setBillNotifications((previous) => [...newEntries, ...previous].slice(0, 10));
          setMessage({
            type: 'success',
            text: newEntries.length === 1
              ? `Demande d'addition reçue pour la commande #${newEntries[0].orderId}.`
              : `${newEntries.length} nouvelles demandes d'addition reçues.`,
          });
        }
      }

      setReadyOrders(nextOrders);
      previousOrdersRef.current = new Map(nextOrders.map((item) => [Number(item.id), item]));
      firstLoadRef.current = false;
    } catch (error) {
      if (!silent) {
        setMessage({
          type: 'error',
          text: extractApiError(error, 'Impossible de charger le tableau de bord caisse.'),
        });
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [browserNotificationEnabled]);
  const loadData = useSerializedAsyncCallback(loadDataInternal);

  useEffect(() => {
    loadData();

    const intervalId = setInterval(() => {
      loadData({ silent: true });
    }, OVERVIEW_REFRESH_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [loadData]);

  useEffect(() => {
    if (!isBrowserNotificationSupported()) {
      return;
    }

    setBrowserNotificationEnabled(getInitialCashierNotificationEnabled());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(CASHIER_NOTIFICATION_STORAGE_KEY, browserNotificationEnabled ? '1' : '0');
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
        text: 'Notifications navigateur désactivées pour la caisse sur ce navigateur.',
      });
      return;
    }

    const granted = await requestBrowserNotificationPermission();
    setBrowserNotificationEnabled(granted);
    setMessage({
      type: granted ? 'success' : 'error',
      text: granted
        ? 'Notifications navigateur activées (caisse).'
        : 'Notifications bloquées. Sur Firefox, autorisez-les dans la barre d’adresse puis réessayez.',
    });
  }, [browserNotificationEnabled]);

  if (loading) {
    return <div className="staff-card">Chargement des donnees caisse...</div>;
  }

  return (
    <div className="staff-module-stack">
      <MessageBanner message={message} />

      {billNotifications.length > 0 ? (
        <div className="staff-card staff-ready-feed">
          <div className="staff-card-header compact">
            <h3>Notifications addition</h3>
            <button type="button" className="staff-btn secondary" onClick={() => setBillNotifications([])}>
              Effacer
            </button>
          </div>
          <div className="staff-ready-list">
            {billNotifications.map((entry) => (
              <div key={entry.key} className="staff-ready-item">
                <strong>Commande #{entry.orderId}</strong>
                <span>{entry.tableLabel} · Demande d'addition reçue</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="staff-stat-grid">
        <div className="staff-stat-card"><span>CA du jour</span><strong>{formatCurrency(stats.total_revenue)}</strong></div>
        <div className="staff-stat-card"><span>Commandes payees</span><strong>{stats.total_orders || 0}</strong></div>
        <div className="staff-stat-card"><span>A encaisser</span><strong>{readyOrders.length}</strong></div>
        <div className="staff-stat-card"><span>Additions demandées</span><strong>{billRequestsCount}</strong></div>
        <div className="staff-stat-card"><span>Caisse disponible</span><strong>{formatCurrency(stats?.cash_register?.cash_available)}</strong></div>
        <div className="staff-stat-card"><span>Entrées cash (jour)</span><strong>{formatCurrency(stats?.cash_register?.cash_in_approved)}</strong></div>
        <div className="staff-stat-card"><span>Restaurant (jour)</span><strong>{formatCurrency(stats?.sales_breakdown?.restaurant)}</strong></div>
        <div className="staff-stat-card"><span>Boissons (jour)</span><strong>{formatCurrency(stats?.sales_breakdown?.boissons)}</strong></div>
        <div className="staff-stat-card"><span>Cocktails (jour)</span><strong>{formatCurrency(stats?.sales_breakdown?.cocktails)}</strong></div>
      </div>

      <div className="staff-card">
        <div className="staff-card-header">
          <h2>Repartition des encaissements</h2>
          <div className="staff-inline-actions">
            <button type="button" className="staff-btn secondary" onClick={toggleBrowserNotifications}>
              {getNotificationButtonLabel(browserNotificationEnabled)}
            </button>
            <button type="button" className="staff-btn secondary" onClick={() => loadData()}>Actualiser</button>
          </div>
        </div>

        {!Array.isArray(stats.by_method) || stats.by_method.length === 0 ? (
          <p className="staff-muted">Aucun paiement enregistre aujourd'hui.</p>
        ) : (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Methode</th>
                  <th>Compte alimente</th>
                  <th>Transactions</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {stats.by_method.map((method) => (
                  <tr key={method.method}>
                    <td data-label="Methode">{formatPaymentMethodLabel(method.method)}</td>
                    <td data-label="Compte alimente">{method.account_label || '-'}</td>
                    <td data-label="Transactions">{method.count}</td>
                    <td data-label="Total">{formatCurrency(method.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="staff-card">
        <div className="staff-card-header">
          <h2>Paiements clients récents</h2>
        </div>

        {!Array.isArray(stats.recent_customer_payments) || stats.recent_customer_payments.length === 0 ? (
          <p className="staff-muted">Aucun encaissement récent.</p>
        ) : (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Commande</th>
                  <th>Client</th>
                  <th>Table</th>
                  <th>Mode client</th>
                  <th>Mode encaissé</th>
                  <th>Compte alimenté</th>
                  <th>Montant</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent_customer_payments.map((payment) => (
                  <tr key={payment.id}>
                    <td data-label="Commande">#{payment.order_id}</td>
                    <td data-label="Client">{payment?.order?.customer?.name || 'Client libre'}</td>
                    <td data-label="Table">{getOrderTableLabel(payment?.order)}</td>
                    <td data-label="Mode client">{formatPaymentMethodLabel(payment.method)}</td>
                    <td data-label="Mode encaisse">{formatPaymentMethodLabel(payment.settlement_method || payment.method)}</td>
                    <td data-label="Compte alimente">{payment.target_account_label || 'En attente'}</td>
                    <td data-label="Montant">{formatCurrency(payment.amount)}</td>
                    <td data-label="Date">{formatDateTime(payment.encashed_at || payment.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export const CashierPaymentsModule = () => {
  const [loading, setLoading] = useState(true);
  const [processingOrderId, setProcessingOrderId] = useState(null);
  const [message, setMessage] = useState(null);
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [paymentForms, setPaymentForms] = useState({});
  const [billNotifications, setBillNotifications] = useState([]);
  const [browserNotificationEnabled, setBrowserNotificationEnabled] = useState(() => getInitialCashierNotificationEnabled());
  const firstLoadRef = useRef(true);
  const previousOrdersRef = useRef(new Map());
  const processingActionOrderIdsRef = useRef(new Set());

  const loadCustomers = useCallback(async () => {
    try {
      const response = await cashierAPI.getCustomers();
      const nextCustomers = Array.isArray(response.data)
        ? response.data
        : Array.isArray(response.data?.data)
          ? response.data.data
          : Array.isArray(response.data?.customers)
            ? response.data.customers
            : [];

      setCustomers(sanitizeCustomers(nextCustomers));
    } catch (_error) {
      setCustomers([]);
    }
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
      const response = await cashierAPI.getReadyOrders({ include_items: 0 });
      const nextOrders = Array.isArray(response.data) ? response.data : [];

      if (!firstLoadRef.current) {
        const previousMap = previousOrdersRef.current;
        const newEntries = [];

        nextOrders.forEach((order) => {
          const previous = previousMap.get(Number(order.id));
          const previousBillRequestAt = String(previous?.bill_requested_at || '');
          const currentBillRequestAt = String(order?.bill_requested_at || '');

          if (
            currentBillRequestAt
            && currentBillRequestAt !== previousBillRequestAt
            && shouldEmitBillNotification(order.id, currentBillRequestAt)
          ) {
            const tableLabel = getOrderTableLabel(order);
            newEntries.push({
              key: `bill-${order.id}-${Date.now()}`,
              orderId: order.id,
              tableLabel,
              createdAt: new Date().toISOString(),
            });

            playNotificationTone('new-order');

            if (
              browserNotificationEnabled
              && typeof window !== 'undefined'
              && 'Notification' in window
              && Notification.permission === 'granted'
            ) {
              try {
                new Notification(`Addition demandée · Commande #${order.id}`, {
                  body: tableLabel,
                });
              } catch (_error) {
                // Ignorer les erreurs de notification navigateur.
              }
            }
          }
        });

        if (newEntries.length > 0) {
          setBillNotifications((previous) => [...newEntries, ...previous].slice(0, 10));
          setMessage({
            type: 'success',
            text: newEntries.length === 1
              ? `Demande d'addition reçue pour la commande #${newEntries[0].orderId}.`
              : `${newEntries.length} nouvelles demandes d'addition reçues.`,
          });
        }
      }

      setOrders(nextOrders);
      previousOrdersRef.current = new Map(nextOrders.map((item) => [Number(item.id), item]));
      firstLoadRef.current = false;

      setPaymentForms((previous) => {
        const next = {};

        nextOrders.forEach((order) => {
          const latestPayment = getOrderLatestPayment(order);
          const previousForm = previous[order.id] || {};
          const paymentSummary = getOrderPaymentSummary(order);
          const discountPercent = Math.max(0, Math.min(10, Number(latestPayment?.discount_percent ?? previousForm.discount_percent ?? 0)));
          const computedAmount = paymentSummary.pendingAmount > 0
            ? paymentSummary.pendingAmount
            : getDiscountedAmount(order.total_amount, discountPercent);
          const hasSplitVoucher = paymentSummary.completedAmount > 0 && paymentSummary.hasPendingVoucher;
          const isVoucherCustomerLocked = hasLockedVoucherCustomer(order);

          next[order.id] = {
            amount: computedAmount,
            discount_percent: Number(latestPayment?.discount_percent ?? discountPercent),
            method: normalizePaymentMethod(latestPayment?.method) || 'cash',
            reference: latestPayment?.reference || '',
            customer_id: Number(order?.customer?.id || previousForm.customer_id || 0) || '',
            customer_name: previousForm.customer_name || '',
            settlement_method: normalizeImmediatePaymentMethod(
              latestPayment?.settlement_method,
              normalizePaymentMethod(latestPayment?.method) === 'bon' ? '' : normalizePaymentMethod(latestPayment?.method)
            ),
            payment_type: hasSplitVoucher
              ? 'split_voucher'
              : (String(previousForm.payment_type || '') === 'split_voucher' ? 'split_voucher' : 'single'),
            split_immediate_amount: roundMoney(
              previousForm.split_immediate_amount
              || paymentSummary.completedAmount
              || (computedAmount > 1 ? computedAmount / 2 : computedAmount)
            ),
            split_immediate_method: normalizeImmediatePaymentMethod(
              previousForm.split_immediate_method,
              paymentSummary.latestCompletedPayment?.settlement_method
              || paymentSummary.latestCompletedPayment?.method
              || 'cash'
            ),
          };

          if (previousForm && typeof previousForm === 'object') {
            next[order.id] = {
              ...next[order.id],
              ...previousForm,
              amount: computedAmount,
              discount_percent: discountPercent,
            };
          }

          if (isVoucherCustomerLocked) {
            next[order.id].customer_id = Number(order?.customer?.id || 0) || '';
            next[order.id].customer_name = '';
          }
        });

        return next;
      });
    } catch (error) {
      if (!silent) {
        setMessage({
          type: 'error',
          text: extractApiError(error, 'Impossible de charger les commandes a encaisser.'),
        });
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [browserNotificationEnabled]);
  const loadOrders = useSerializedAsyncCallback(loadOrdersInternal);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    loadOrders();

    const intervalId = setInterval(() => {
      loadOrders({ silent: true });
    }, PAYMENTS_REFRESH_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [loadOrders]);

  useEffect(() => {
    if (!isBrowserNotificationSupported()) {
      return;
    }

    setBrowserNotificationEnabled(getInitialCashierNotificationEnabled());
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(CASHIER_NOTIFICATION_STORAGE_KEY, browserNotificationEnabled ? '1' : '0');
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
        text: 'Notifications navigateur désactivées pour la caisse sur ce navigateur.',
      });
      return;
    }

    const granted = await requestBrowserNotificationPermission();
    setBrowserNotificationEnabled(granted);
    setMessage({
      type: granted ? 'success' : 'error',
      text: granted
        ? 'Notifications navigateur activées (caisse).'
        : 'Notifications bloquées. Sur Firefox, autorisez-les dans la barre d’adresse puis réessayez.',
    });
  }, [browserNotificationEnabled]);

  const updatePaymentField = (orderId, key, value) => {
    setPaymentForms((previous) => ({
      ...previous,
      [orderId]: (() => {
        const current = previous[orderId] || {};
        const nextForm = {
          ...current,
          [key]: value,
        };

        if (key === 'discount_percent') {
          const order = orders.find((item) => Number(item.id) === Number(orderId));
          const discountPercent = Math.max(0, Math.min(10, Number(value || 0)));
          nextForm.discount_percent = discountPercent;
          nextForm.amount = getDiscountedAmount(order?.total_amount, discountPercent);
        }

        if (key === 'customer_id' && Number(value || 0) > 0) {
          nextForm.customer_name = '';
        }

        if (key === 'customer_name' && String(value || '').trim() !== '') {
          nextForm.customer_id = '';
        }

        if (key === 'payment_type') {
          nextForm.payment_type = value === 'split_voucher' ? 'split_voucher' : 'single';

          if (nextForm.payment_type === 'split_voucher') {
            const totalAmount = roundMoney(nextForm.amount);
            const currentSplitAmount = roundMoney(nextForm.split_immediate_amount);

            if (currentSplitAmount <= 0 || currentSplitAmount >= totalAmount) {
              const suggestedAmount = totalAmount > 1
                ? roundMoney(totalAmount / 2)
                : roundMoney(Math.max(totalAmount - 0.01, 0.01));
              nextForm.split_immediate_amount = suggestedAmount;
            }

            nextForm.split_immediate_method = normalizeImmediatePaymentMethod(
              nextForm.split_immediate_method,
              normalizeImmediatePaymentMethod(nextForm.method, 'cash')
            );
          }
        }

        if (key === 'settlement_method') {
          nextForm.settlement_method = normalizeImmediatePaymentMethod(value, '');
        }

        if (key === 'split_immediate_method') {
          nextForm.split_immediate_method = normalizeImmediatePaymentMethod(value, 'cash');
        }

        if (key === 'split_immediate_amount') {
          nextForm.split_immediate_amount = roundMoney(value);
        }

        return nextForm;
      })(),
    }));
  };

  const prepareOrderPayment = async (order) => {
    const orderId = Number(order?.id || 0);
    if (!orderId || processingActionOrderIdsRef.current.has(orderId)) {
      return;
    }

    const form = paymentForms[order.id] || {};
    const paymentType = String(form.payment_type || 'single') === 'split_voucher' ? 'split_voucher' : 'single';
    const isSplitVoucher = paymentType === 'split_voucher';
    const discountPercent = Math.max(0, Math.min(10, Number(form.discount_percent || 0)));
    const splitImmediateMethod = normalizeImmediatePaymentMethod(form.split_immediate_method, 'cash');
    const splitImmediateAmount = roundMoney(form.split_immediate_amount);
    const amountDue = roundMoney(form.amount);
    const method = isSplitVoucher
      ? splitImmediateMethod
      : (normalizePaymentMethod(form.method) || 'cash');
    const isVoucherCustomerLocked = hasLockedVoucherCustomer(order);
    const customerId = getResolvedVoucherCustomerId(form, order);
    const customerName = getResolvedVoucherCustomerName(form);

    if ((method === 'bon' || isSplitVoucher) && customerId <= 0 && customerName === '') {
      setMessage({ type: 'error', text: 'Un bon exige un client. Sélectionnez un client existant ou saisissez un nouveau client.' });
      return;
    }

    if (Number(form.amount || 0) <= 0) {
      setMessage({ type: 'error', text: 'Le montant doit etre superieur a 0.' });
      return;
    }

    if (isSplitVoucher && (splitImmediateAmount <= 0 || splitImmediateAmount >= amountDue)) {
      setMessage({
        type: 'error',
        text: 'Saisissez un premier paiement supérieur à 0 et inférieur au total pour garder un reliquat en bon client.',
      });
      return;
    }

    processingActionOrderIdsRef.current.add(orderId);
    setProcessingOrderId(order.id);
    setMessage(null);

    try {
      await cashierAPI.preparePayment(order.id, {
        method,
        reference: form.reference || null,
        discount_percent: discountPercent,
        customer_id: !isVoucherCustomerLocked && customerId > 0 ? customerId : null,
        customer_name: !isVoucherCustomerLocked && customerId <= 0 && customerName !== '' ? customerName : null,
      });

      const invoiceResponse = await cashierAPI.generateInvoice(order.id);
      const printed = printInvoiceDocument(invoiceResponse.data);
      if (!printed) {
        setMessage({ type: 'error', text: 'Impossible d’imprimer la facture. Vérifiez les autorisations du navigateur.' });
        await loadOrders({ silent: true });
        return;
      }

      setMessage({
        type: 'success',
        text: isSplitVoucher
          ? `Addition de la commande #${order.id} imprimée. Vous pouvez maintenant encaisser une partie et laisser le reste en bon client.`
          : (method === 'bon'
          ? `Bon client de la commande #${order.id} imprimé. Encaissement à faire plus tard.`
          : `Addition de la commande #${order.id} imprimée. Validez ensuite l’encaissement.`),
      });
      await loadCustomers();
      await loadOrders({ silent: true });
    } catch (error) {
      setMessage({
        type: 'error',
        text: extractApiError(error, 'Echec de la préparation de l’addition.'),
      });
    } finally {
      processingActionOrderIdsRef.current.delete(orderId);
      setProcessingOrderId(null);
    }
  };

  const reprintOrderPaymentDocument = async (order) => {
    const orderId = Number(order?.id || 0);
    if (!orderId || processingActionOrderIdsRef.current.has(orderId)) {
      return;
    }

    processingActionOrderIdsRef.current.add(orderId);
    setProcessingOrderId(order.id);
    setMessage(null);

    try {
      const invoiceResponse = await cashierAPI.generateInvoice(order.id);
      const invoice = invoiceResponse?.data || null;
      const printed = printInvoiceDocument(invoice);

      if (!printed) {
        setMessage({ type: 'error', text: 'Impossible d’imprimer la facture. Vérifiez les autorisations du navigateur.' });
        return;
      }

      setMessage({
        type: 'success',
        text: `${getInvoiceDocumentLabel(invoice)} de la commande #${order.id} réimprimé sans recalcul.`,
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: extractApiError(error, 'Impossible de réimprimer cette addition.'),
      });
    } finally {
      processingActionOrderIdsRef.current.delete(orderId);
      setProcessingOrderId(null);
    }
  };

  const confirmOrderPayment = async (order) => {
    const orderId = Number(order?.id || 0);
    if (!orderId || processingActionOrderIdsRef.current.has(orderId)) {
      return;
    }

    const form = paymentForms[order.id] || {};
    const latestPayment = getOrderLatestPayment(order);
    const workflowState = getPaymentWorkflowState(order);
    const paymentType = String(form.payment_type || 'single') === 'split_voucher' ? 'split_voucher' : 'single';
    const isSplitVoucher = workflowState !== 'voucher_pending' && paymentType === 'split_voucher';
    const splitImmediateMethod = normalizeImmediatePaymentMethod(form.split_immediate_method, '');
    const splitImmediateAmount = roundMoney(form.split_immediate_amount);
    const amountDue = roundMoney(form.amount);
    const actualMethod = workflowState === 'voucher_pending'
      ? normalizeImmediatePaymentMethod(
        form.settlement_method,
        normalizeImmediatePaymentMethod(latestPayment?.settlement_method, '')
      )
      : (isSplitVoucher
        ? splitImmediateMethod
        : (normalizePaymentMethod(form.method || latestPayment?.settlement_method || latestPayment?.method) || 'cash'));
    const isVoucherCustomerLocked = hasLockedVoucherCustomer(order);
    const customerId = getResolvedVoucherCustomerId(form, order);
    const customerName = getResolvedVoucherCustomerName(form);
    const selectedMethod = normalizePaymentMethod(form.method || latestPayment?.method);

    if (workflowState === 'to_print') {
      setMessage({ type: 'error', text: 'Imprimez d’abord l’addition avant l’encaissement.' });
      return;
    }

    if (workflowState !== 'voucher_pending' && !isSplitVoucher && selectedMethod === 'bon') {
      setMessage({
        type: 'error',
        text: 'Pour passer cette commande en bon client, cliquez sur "Imprimer le bon". L’encaissement se fera plus tard depuis la caisse ou la trésorerie admin.',
      });
      return;
    }

    if ((workflowState === 'voucher_pending' || isSplitVoucher) && customerId <= 0 && customerName === '') {
      setMessage({ type: 'error', text: 'Sélectionnez le client du bon ou saisissez un nouveau client avant encaissement.' });
      return;
    }

    if (isSplitVoucher && (splitImmediateAmount <= 0 || splitImmediateAmount >= amountDue)) {
      setMessage({
        type: 'error',
        text: 'Le premier paiement doit être supérieur à 0 et inférieur au total pour créer un bon client sur le reliquat.',
      });
      return;
    }

    if (workflowState === 'voucher_pending' && actualMethod === '') {
      setMessage({ type: 'error', text: 'Choisissez le mode d’encaissement du bon (cash, mobile money, virement ou cheque).' });
      return;
    }

    if (isSplitVoucher && actualMethod === '') {
      setMessage({ type: 'error', text: 'Choisissez le mode du premier paiement avant validation.' });
      return;
    }

    if (actualMethod === 'bon') {
      setMessage({ type: 'error', text: 'Choisissez un vrai mode d’encaissement.' });
      return;
    }

    processingActionOrderIdsRef.current.add(orderId);
    setProcessingOrderId(order.id);
    setMessage(null);

    try {
      await cashierAPI.processPayment(order.id, isSplitVoucher
        ? {
          method: actualMethod,
          reference: form.reference || null,
          customer_id: !isVoucherCustomerLocked && customerId > 0 ? customerId : null,
          customer_name: !isVoucherCustomerLocked && customerId <= 0 && customerName !== '' ? customerName : null,
          split_with_voucher: true,
          split_immediate_amount: splitImmediateAmount,
          split_immediate_method: actualMethod,
        }
        : {
          method: actualMethod,
          reference: form.reference || null,
          customer_id: !isVoucherCustomerLocked && customerId > 0 ? customerId : null,
          customer_name: !isVoucherCustomerLocked && customerId <= 0 && customerName !== '' ? customerName : null,
        });

      setMessage({
        type: 'success',
        text: isSplitVoucher
          ? `Paiement partiel enregistré pour la commande #${order.id}. Le reste est passé en bon client.`
          : (workflowState === 'voucher_pending'
          ? `Bon de la commande #${order.id} encaissé avec succès.`
          : `Encaissement de la commande #${order.id} validé.`),
      });
      await loadCustomers();
      await loadOrders({ silent: true });
    } catch (error) {
      setMessage({
        type: 'error',
        text: extractApiError(error, 'Echec de l’encaissement.'),
      });
    } finally {
      processingActionOrderIdsRef.current.delete(orderId);
      setProcessingOrderId(null);
    }
  };

  const releaseVoucherTable = async (order) => {
    const orderId = Number(order?.id || 0);
    if (!orderId || processingActionOrderIdsRef.current.has(orderId)) {
      return;
    }

    processingActionOrderIdsRef.current.add(orderId);
    setProcessingOrderId(order.id);
    setMessage(null);

    try {
      await cashierAPI.releaseOrderTable(order.id);
      setMessage({
        type: 'success',
        text: `Table libérée pour le bon de la commande #${order.id}. Le bon reste en attente d'encaissement.`,
      });
      await loadOrders({ silent: true });
    } catch (error) {
      setMessage({
        type: 'error',
        text: extractApiError(error, 'Impossible de libérer la table pour ce bon.'),
      });
    } finally {
      processingActionOrderIdsRef.current.delete(orderId);
      setProcessingOrderId(null);
    }
  };

  if (loading) {
    return <div className="staff-card">Chargement des encaissements...</div>;
  }

  const pendingOrders = orders;

  const renderOrderCard = (order, { voucherSection = false } = {}) => {
    const paymentSummary = getOrderPaymentSummary(order);
    const latestPayment = paymentSummary.latestPayment || getOrderLatestPayment(order);
    const workflowState = getPaymentWorkflowState(order);
    const form = paymentForms[order.id] || {
      amount: Number(order.total_amount || 0),
      discount_percent: 0,
      method: 'cash',
      reference: '',
      customer_id: Number(order?.customer?.id || 0) || '',
      customer_name: '',
      settlement_method: '',
      payment_type: 'single',
      split_immediate_amount: '',
      split_immediate_method: 'cash',
    };
    const grossAmount = Number(order.total_amount || 0);
    const discountPercent = Math.max(0, Math.min(10, Number(form.discount_percent || 0)));
    const discountAmount = (grossAmount * discountPercent) / 100;
    const packaging = getPackagingDetails(order);
    const isPrinted = workflowState !== 'to_print';
    const isVoucherPending = workflowState === 'voucher_pending';
    const isAwaitingCollection = workflowState === 'awaiting_collection';
    const isSplitVoucher = !voucherSection && !isVoucherPending && String(form.payment_type || 'single') === 'split_voucher';
    const splitImmediateMethod = normalizeImmediatePaymentMethod(form.split_immediate_method, 'cash');
    const splitImmediateAmount = roundMoney(form.split_immediate_amount);
    const splitRemainingAmount = roundMoney(Math.max(0, Number(form.amount || 0) - splitImmediateAmount));
    const completedAmount = roundMoney(paymentSummary.completedAmount);
    const pendingAmount = roundMoney(paymentSummary.pendingAmount || form.amount);
    const selectedCustomerId = getResolvedVoucherCustomerId(form, order);
    const selectedVoucherCustomer = customers.find((customer) => Number(customer.id) === selectedCustomerId) || null;
    const typedCustomerName = getResolvedVoucherCustomerName(form);
    const displayedCustomerName = getOrderDisplayCustomerName(order, typedCustomerName, selectedVoucherCustomer);
    const hasRegisteredCustomer = Boolean(sanitizeCustomerName(selectedVoucherCustomer?.name || order?.customer?.name));
    const isRegisteredCustomerLocked = typedCustomerName !== '';
    const isNewCustomerLocked = selectedCustomerId > 0;
    const showVoucherCustomerField = voucherSection || normalizePaymentMethod(form.method) === 'bon' || isVoucherPending || isSplitVoucher;
    const isVoucherCustomerLocked = showVoucherCustomerField && hasLockedVoucherCustomer(order);
    const paymentLabel = voucherSection
      ? 'Mode d\'encaissement du bon'
      : (isVoucherPending
        ? 'Mode de paiement du bon'
        : (isSplitVoucher ? 'Mode du 1er paiement' : 'Mode d\'encaissement'));
    const selectedPaymentMethod = isSplitVoucher
      ? splitImmediateMethod
      : (normalizePaymentMethod(form.method) || 'cash');
    const paymentValue = voucherSection || isVoucherPending
      ? normalizeImmediatePaymentMethod(form.settlement_method, '')
      : selectedPaymentMethod;
    const accountPreviewLabel = voucherSection || isVoucherPending
      ? (paymentValue ? getTargetAccountLabelForMethod(paymentValue) : '')
      : (selectedPaymentMethod === 'bon' ? 'En attente' : getTargetAccountLabelForMethod(paymentValue));
    const wantsVoucherIssuance = !voucherSection && !isVoucherPending && !isSplitVoucher && isAwaitingCollection && selectedPaymentMethod === 'bon';
    const canManageVoucherTable = voucherSection && Number(order?.table_id || 0) > 0;

    return (
      <article key={order.id} className="staff-payment-card">
        <header>
          <div>
            <strong>{voucherSection ? `Bon commande #${order.id}` : `Commande #${order.id}`}</strong>
            <span>
              {getOrderTableLabel(order)} · {formatCurrency(order.total_amount)}
            </span>
            {order?.bill_requested_at ? (
              <span>
                Addition demandée: {formatDateTime(order.bill_requested_at)}
              </span>
            ) : null}
            {latestPayment ? (
              <span>
                Etat paiement: {paymentStatusLabel(latestPayment.status)} · Mode choisi: {formatPaymentMethodLabel(latestPayment.method)}
                {latestPayment?.printed_at ? ` · Imprimé: ${formatDateTime(latestPayment.printed_at)}` : ''}
              </span>
            ) : null}
            {latestPayment?.settlement_method ? (
              <span>
                Mode encaissé: {formatPaymentMethodLabel(latestPayment.settlement_method)}
                {latestPayment?.encashed_at ? ` · ${formatDateTime(latestPayment.encashed_at)}` : ''}
              </span>
            ) : null}
            {completedAmount > 0 ? (
              <span>
                Déjà encaissé: {formatCurrency(completedAmount)}
                {paymentSummary.hasPendingVoucher ? ` · Reste en bon: ${formatCurrency(pendingAmount)}` : ''}
              </span>
            ) : null}
            <span>
              {displayedCustomerName ? `Client: ${displayedCustomerName}` : 'Client libre'}
              {order?.occupies_table ? ' · Table occupée' : ' · Table libérée'}
            </span>
            <span>
              Total brut: {formatCurrency(grossAmount)} · Reduction: {discountPercent}% ({formatCurrency(discountAmount)})
            </span>
            {String(order?.order_type || '') === 'takeaway' ? (
              <span>
                {packaging.enabled
                  ? `Barquettes: ${packaging.quantity} x ${formatCurrency(packaging.unitPrice)} = ${formatCurrency(packaging.total)}`
                  : 'Barquettes: non'}
              </span>
            ) : null}
          </div>
          <StatusBadge status={order.status} />
        </header>

        <div className="staff-payment-form-grid">
          <label>
            Montant
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(event) => updatePaymentField(order.id, 'amount', event.target.value)}
              readOnly
            />
          </label>

          <label>
            Reduction
            <select
              value={discountPercent}
              onChange={(event) => updatePaymentField(order.id, 'discount_percent', event.target.value)}
              disabled={isPrinted || voucherSection}
            >
              <option value={0}>Aucune</option>
              <option value={1}>1%</option>
              <option value={2}>2%</option>
              <option value={3}>3%</option>
              <option value={4}>4%</option>
              <option value={5}>5%</option>
              <option value={6}>6%</option>
              <option value={7}>7%</option>
              <option value={8}>8%</option>
              <option value={9}>9%</option>
              <option value={10}>10%</option>
            </select>
          </label>

          <label>
            Reference
            <input
              type="text"
              value={form.reference}
              onChange={(event) => updatePaymentField(order.id, 'reference', event.target.value)}
              placeholder="Optionnel"
            />
          </label>

          {!voucherSection && !isVoucherPending ? (
            <label>
              Type de règlement
              <select
                value={isSplitVoucher ? 'split_voucher' : 'single'}
                onChange={(event) => updatePaymentField(order.id, 'payment_type', event.target.value)}
              >
                <option value="single">Paiement simple</option>
                <option value="split_voucher">Paiement en 2 fois + bon client</option>
              </select>
              <small className="staff-field-hint">
                Conservez les modes actuels, ou encaissez une première partie maintenant puis passez le reste en bon client.
              </small>
            </label>
          ) : null}

          {isSplitVoucher ? (
            <>
              <label>
                {paymentLabel}
                <select
                  value={splitImmediateMethod}
                  onChange={(event) => updatePaymentField(order.id, 'split_immediate_method', event.target.value)}
                >
                  {IMMEDIATE_PAYMENT_METHOD_OPTIONS.map((methodOption) => (
                    <option key={methodOption.value} value={methodOption.value}>{methodOption.label}</option>
                  ))}
                </select>
                <small className="staff-field-hint">
                  {accountPreviewLabel
                    ? `Compte alimenté maintenant: ${accountPreviewLabel}.`
                    : 'Choisissez le mode du premier paiement.'}
                </small>
              </label>

              <label>
                Montant encaissé maintenant
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.split_immediate_amount}
                  onChange={(event) => updatePaymentField(order.id, 'split_immediate_amount', event.target.value)}
                />
                <small className="staff-field-hint">
                  Reste en bon client: {formatCurrency(splitRemainingAmount)}.
                </small>
              </label>
            </>
          ) : (
            <label>
              {paymentLabel}
              <select
                value={paymentValue}
                onChange={(event) => updatePaymentField(
                  order.id,
                  voucherSection || isVoucherPending ? 'settlement_method' : 'method',
                  event.target.value
                )}
              >
                {(voucherSection || isVoucherPending) ? (
                  <option value="">Choisir un mode d&apos;encaissement</option>
                ) : null}
                {(voucherSection || isVoucherPending ? IMMEDIATE_PAYMENT_METHOD_OPTIONS : PAYMENT_METHOD_OPTIONS).map((methodOption) => (
                  <option key={methodOption.value} value={methodOption.value}>{methodOption.label}</option>
                ))}
              </select>
              <small className="staff-field-hint">
                {accountPreviewLabel
                  ? `Compte alimenté: ${accountPreviewLabel}.`
                  : 'Choisissez le mode pour déterminer le compte à alimenter (caisse, mobile money ou banque).'}
              </small>
            </label>
          )}

          {showVoucherCustomerField ? (
            <>
              {isVoucherCustomerLocked ? (
                <div className="staff-field-hint staff-payment-form-note">
                  {displayedCustomerName
                    ? (completedAmount > 0
                      ? `Client verrouillé sur le reliquat: ${displayedCustomerName}. Le 2e paiement restera rattaché au client de la 1re tranche.`
                      : `Client verrouillé sur ce bon: ${displayedCustomerName}. L'encaissement restera rattaché à ce client.`)
                    : 'Client déjà verrouillé sur ce bon.'}
                </div>
              ) : (
                <>
                  <label>
                    Client enregistré
                    <select
                      value={selectedCustomerId > 0 ? String(selectedCustomerId) : ''}
                      onChange={(event) => updatePaymentField(order.id, 'customer_id', event.target.value)}
                      disabled={isRegisteredCustomerLocked}
                    >
                      <option value="">Sélectionner un client enregistré</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>{customer.name}</option>
                      ))}
                    </select>
                    <small className="staff-field-hint">
                      {isRegisteredCustomerLocked
                        ? 'Zone grisée tant qu’un nouveau client est saisi.'
                        : customers.length > 0
                        ? 'Choisissez ici un client déjà enregistré.'
                        : 'Aucun client chargé pour le moment. Vous pouvez quand même saisir un nouveau client.'}
                    </small>
                  </label>

                  <label>
                    Nouveau client
                    <input
                      type="text"
                      value={form.customer_name || ''}
                      onChange={(event) => updatePaymentField(order.id, 'customer_name', event.target.value)}
                      placeholder="Nom du nouveau client"
                      disabled={isNewCustomerLocked}
                    />
                    <small className="staff-field-hint">
                      {isNewCustomerLocked
                        ? 'Zone grisée tant qu’un client enregistré est sélectionné.'
                        : 'Si vous saisissez un nom ici, le client sera créé automatiquement pour ce bon.'}
                    </small>
                  </label>

                  {!hasRegisteredCustomer && !typedCustomerName ? (
                    <div className="staff-field-hint staff-payment-form-note">
                      Renseignez un client enregistré ou créez un nouveau client avant l’émission du bon.
                    </div>
                  ) : null}
                </>
              )}
            </>
          ) : null}
        </div>

        <footer className={canManageVoucherTable ? 'staff-payment-footer voucher-layout' : ''}>
          {canManageVoucherTable ? (
            <div className="staff-voucher-table-panel">
              <div className="staff-voucher-table-panel-header">
                <strong>Gestion table</strong>
                <span>{order?.occupies_table ? 'Table encore occupée' : 'Table déjà libérée'}</span>
              </div>
              <button
                type="button"
                className="staff-btn secondary"
                disabled={processingOrderId === order.id || !order?.occupies_table}
                onClick={() => releaseVoucherTable(order)}
              >
                {processingOrderId === order.id
                  ? 'Traitement...'
                  : (order?.occupies_table ? 'Liberer table' : 'Table deja liberee')}
              </button>
              <div className="staff-field-hint staff-payment-form-note">
                {order?.occupies_table
                  ? 'Le serveur peut encore ajouter des articles tant que la table n’est pas libérée.'
                  : 'Après libération, cette ancienne commande ne doit plus recevoir de nouveaux articles.'}
              </div>
            </div>
          ) : null}

          <div className="staff-inline-actions">
            {!voucherSection && workflowState === 'to_print' ? (
              <button
                type="button"
                className="staff-btn primary"
                disabled={processingOrderId === order.id}
                onClick={() => prepareOrderPayment(order)}
              >
                {processingOrderId === order.id
                  ? 'Traitement...'
                  : (selectedPaymentMethod === 'bon' ? 'Imprimer le bon' : 'Imprimer l\'addition')}
              </button>
            ) : null}

            {(voucherSection || isAwaitingCollection) ? (
              <button
                type="button"
                className="staff-btn secondary"
                disabled={processingOrderId === order.id}
                onClick={() => reprintOrderPaymentDocument(order)}
              >
                {processingOrderId === order.id
                  ? 'Traitement...'
                  : (voucherSection
                    ? 'Reimprimer le bon'
                    : (wantsVoucherIssuance ? 'Imprimer le bon' : 'Reimprimer'))}
              </button>
            ) : null}

            {(voucherSection || (isAwaitingCollection && !wantsVoucherIssuance)) ? (
              <button
                type="button"
                className="staff-btn primary"
                disabled={processingOrderId === order.id}
                onClick={() => confirmOrderPayment(order)}
              >
                {processingOrderId === order.id
                  ? 'Traitement...'
                  : (voucherSection ? 'Encaisser le bon' : 'Valider encaissement')}
              </button>
            ) : null}
          </div>

          {wantsVoucherIssuance ? (
            <div className="staff-field-hint staff-payment-form-note">
              Le bon client sera imprimé et restera en attente d&apos;encaissement jusqu&apos;à validation par la caisse ou l&apos;admin.
            </div>
          ) : null}

          {isSplitVoucher ? (
            <div className="staff-field-hint staff-payment-form-note">
              La validation encaissera le premier montant tout de suite, puis créera automatiquement un bon client pour le reliquat.
            </div>
          ) : null}
        </footer>
      </article>
    );
  };

  return (
    <div className="staff-module-stack">
      <MessageBanner message={message} />

      {billNotifications.length > 0 ? (
        <div className="staff-card staff-ready-feed">
          <div className="staff-card-header compact">
            <h3>Notifications addition</h3>
            <button type="button" className="staff-btn secondary" onClick={() => setBillNotifications([])}>
              Effacer
            </button>
          </div>
          <div className="staff-ready-list">
            {billNotifications.map((entry) => (
              <div key={entry.key} className="staff-ready-item">
                <strong>Commande #{entry.orderId}</strong>
                <span>{entry.tableLabel} · Demande d'addition reçue</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="staff-card">
        <div className="staff-card-header">
          <h2>Paiements en attente</h2>
          <div className="staff-inline-actions">
            <button type="button" className="staff-btn secondary" onClick={toggleBrowserNotifications}>
              {getNotificationButtonLabel(browserNotificationEnabled)}
            </button>
            <button
              type="button"
              className="staff-btn secondary"
              onClick={async () => {
                await loadCustomers();
                await loadOrders();
              }}
            >
              Actualiser
            </button>
          </div>
        </div>

        {pendingOrders.length === 0 ? (
          <p className="staff-muted">Aucune commande a encaisser.</p>
        ) : (
          <div className="staff-payment-list">
            {pendingOrders.map((order) => renderOrderCard(order, { voucherSection: getPaymentWorkflowState(order) === 'voucher_pending' }))}
          </div>
        )}
      </div>
    </div>
  );
};

export const CashierHistoryModule = () => {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [historyDate, setHistoryDate] = useState('');
  const [payments, setPayments] = useState([]);
  const [selectedInvoice, setSelectedInvoice] = useState(null);

  const loadHistory = useCallback(async (dateValue) => {
    setLoading(true);
    setMessage(null);

    try {
      const range = dateValue ? buildLocalDayUtcRange(dateValue) : null;
      const response = await cashierAPI.getPaymentHistory(range ? { from: range.from, to: range.to } : undefined);
      const data = Array.isArray(response.data?.data)
        ? response.data.data
        : Array.isArray(response.data)
          ? response.data
          : [];

      setPayments(data);
    } catch (error) {
      setMessage({
        type: 'error',
        text: extractApiError(error, 'Impossible de charger l\'historique des paiements et bons.'),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory('');
  }, [loadHistory]);

  const loadInvoice = async (orderId, { printAfterLoad = false } = {}) => {
    setMessage(null);

    try {
      const response = await cashierAPI.generateInvoice(orderId);
      const invoice = response?.data || null;
      setSelectedInvoice(invoice);

      if (printAfterLoad) {
        const printed = printInvoiceDocument(invoice);
        if (!printed) {
          setMessage({
            type: 'error',
            text: 'Impossible d’imprimer la facture. Vérifiez les autorisations du navigateur.',
          });
          return;
        }

        setMessage({
          type: 'success',
          text: `${getInvoiceDocumentLabel(invoice)} de la commande #${orderId} envoyée à l’impression.`,
        });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: extractApiError(error, 'Facture indisponible pour cette commande.'),
      });
    }
  };

  const printInvoice = (invoice) => {
    if (!invoice) {
      setMessage({ type: 'error', text: 'Aucune facture à imprimer.' });
      return;
    }
    const printed = printInvoiceDocument(invoice);
    if (!printed) {
      setMessage({
        type: 'error',
        text: 'Impossible d’imprimer la facture. Vérifiez les autorisations du navigateur.',
      });
      return;
    }

    setMessage({
      type: 'success',
      text: `${getInvoiceDocumentLabel(invoice)} de la commande #${invoice.order_id} envoyée à l’impression.`,
    });
  };

  const selectedInvoicePaymentSummary = selectedInvoice ? getInvoicePaymentSummary(selectedInvoice) : null;

  if (loading) {
    return <div className="staff-card">Chargement de l'historique...</div>;
  }

  return (
    <div className="staff-module-stack">
      <MessageBanner message={message} />

      <div className="staff-card">
        <div className="staff-card-header">
          <h2>Historique paiements et bons</h2>
          <div className="staff-inline-actions">
            <input
              type="date"
              className="staff-date-input"
              value={historyDate}
              onChange={(event) => setHistoryDate(event.target.value)}
            />
            <button type="button" className="staff-btn secondary" onClick={() => loadHistory(historyDate)}>Filtrer</button>
            <button
              type="button"
              className="staff-btn secondary"
              onClick={() => {
                setHistoryDate('');
                loadHistory('');
              }}
            >
              Reinitialiser
            </button>
          </div>
        </div>

        {payments.length === 0 ? (
          <p className="staff-muted">Aucun paiement ou bon trouve.</p>
        ) : (
          <div className="staff-table-wrap staff-table-wrap-history-payments">
            <table className="staff-table staff-table-history-payments">
              <thead>
                <tr>
                  <th>Commande</th>
                  <th>Table</th>
                  <th>Client</th>
                  <th>Statut</th>
                  <th>Methode</th>
                  <th>Encaissement</th>
                  <th>Compte cible</th>
                  <th>Reduction</th>
                  <th>Montant</th>
                  <th>Date impression</th>
                  <th>Date encaissement</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td data-label="Commande">#{payment.order_id}</td>
                    <td data-label="Table">
                      {getOrderTableLabel(payment?.order)}
                    </td>
                    <td data-label="Client">{payment?.order?.customer?.name || 'Client libre'}</td>
                    <td data-label="Statut">{paymentStatusLabel(payment.status)}</td>
                    <td data-label="Methode">{formatPaymentMethodLabel(payment.method)}</td>
                    <td data-label="Encaissement">{formatPaymentMethodLabel(payment.settlement_method || payment.method)}</td>
                    <td data-label="Compte cible">{payment.target_account_label || (payment.status === 'pending' ? 'En attente' : '-')}</td>
                    <td data-label="Reduction">{Number(payment.discount_percent || 0)}%</td>
                    <td data-label="Montant">{formatCurrency(payment.amount)}</td>
                    <td data-label="Date impression">{formatDateTime(payment.printed_at || payment.created_at)}</td>
                    <td data-label="Date encaissement">{formatDateTime(payment.encashed_at)}</td>
                    <td data-label="Action">
                      <button type="button" className="staff-btn secondary" onClick={() => loadInvoice(payment.order_id, { printAfterLoad: true })}>
                        Imprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedInvoice ? (
        <div className="staff-card">
          <div className="staff-card-header">
            <h2>{getInvoiceDocumentLabel(selectedInvoice)} commande #{selectedInvoice.order_id}</h2>
            <button type="button" className="staff-btn primary" onClick={() => printInvoice(selectedInvoice)}>
              Imprimer
            </button>
          </div>

          <div className="staff-invoice-summary">
            <p>
              <strong>Table :</strong>{' '}
              {String(selectedInvoice?.order_type || '') === 'takeaway'
                ? 'A emporter'
                : (selectedInvoice.table ? `Table ${selectedInvoice.table}` : 'Sans table')}
            </p>
            {String(selectedInvoice?.order_type || '') === 'takeaway' ? (
              <p>
                <strong>Barquettes :</strong>{' '}
                {getPackagingDetails(selectedInvoice).enabled
                  ? `${getPackagingDetails(selectedInvoice).quantity} x ${formatCurrency(getPackagingDetails(selectedInvoice).unitPrice)} = ${formatCurrency(getPackagingDetails(selectedInvoice).total)}`
                  : 'Non'}
              </p>
            ) : null}
            <p><strong>Client :</strong> {selectedInvoice.customer || 'Client libre'}</p>
            <p><strong>Statut :</strong> {paymentStatusLabel(selectedInvoice?.payment?.status || selectedInvoice?.payment_status)}</p>
            <p><strong>Mode choisi :</strong> {formatPaymentMethodLabel(selectedInvoice?.payment?.method)}</p>
            <p><strong>Mode encaissé :</strong> {formatPaymentMethodLabel(selectedInvoice?.payment?.settlement_method || selectedInvoice?.payment?.method)}</p>
            <p><strong>Compte cible :</strong> {getTargetAccountLabelForPayment(selectedInvoice?.payment)}</p>
            <p><strong>Date impression :</strong> {formatDateTime(selectedInvoice.printed_at || selectedInvoice?.payment?.printed_at || selectedInvoice.bill_requested_at)}</p>
            <p><strong>Date encaissement :</strong> {formatDateTime(selectedInvoice.encashed_at || selectedInvoice?.payment?.encashed_at)}</p>
            <p><strong>Sous-total menus :</strong> {formatCurrency(selectedInvoice.items_subtotal || selectedInvoice.subtotal || selectedInvoice.total)}</p>
            <p><strong>Sous-total :</strong> {formatCurrency(selectedInvoice.subtotal || selectedInvoice.total)}</p>
            <p><strong>Reduction :</strong> {Number(selectedInvoice.discount_percent || 0)}% ({formatCurrency(selectedInvoice.discount_amount || 0)})</p>
            <p><strong>Total commande :</strong> {formatCurrency(selectedInvoice.total)}</p>
            {Number((selectedInvoice?.completed_amount ?? selectedInvoicePaymentSummary?.completedAmount) || 0) > 0 ? (
              <p><strong>Déjà encaissé :</strong> {formatCurrency(selectedInvoice?.completed_amount ?? selectedInvoicePaymentSummary?.completedAmount)}</p>
            ) : null}
            {Number((selectedInvoice?.remaining_amount ?? selectedInvoicePaymentSummary?.pendingAmount) || 0) > 0 ? (
              <p><strong>{getInvoiceTotalLabel(selectedInvoice)} :</strong> {formatCurrency(selectedInvoice?.remaining_amount ?? selectedInvoicePaymentSummary?.pendingAmount)}</p>
            ) : null}
          </div>

          {selectedInvoicePaymentSummary?.payments?.length > 0 ? (
            <div className="staff-table-wrap">
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>Statut</th>
                    <th>Mode</th>
                    <th>Montant</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedInvoicePaymentSummary.payments.map((paymentPart) => (
                    <tr key={paymentPart.id}>
                      <td data-label="Statut">{paymentStatusLabel(paymentPart.status)}</td>
                      <td data-label="Mode">{formatPaymentMethodLabel(paymentPart.settlement_method || paymentPart.method)}</td>
                      <td data-label="Montant">{formatCurrency(paymentPart.amount)}</td>
                      <td data-label="Date">{formatDateTime(paymentPart.encashed_at || paymentPart.printed_at || paymentPart.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Quantite</th>
                  <th>Prix</th>
                </tr>
              </thead>
              <tbody>
                {(selectedInvoice.items || []).map((item) => (
                  <tr key={item.id}>
                    <td data-label="Article">{item?.menu?.name || `Menu #${item.menu_id}`}</td>
                    <td data-label="Quantite">{item.quantity}</td>
                    <td data-label="Prix">{formatCurrency(item.price_at_order)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const CashierCashRegisterModule = () => {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const [summary, setSummary] = useState({
    cash_in_approved: 0,
    cash_out_approved: 0,
    cash_out_pending: 0,
    cash_available: 0,
    pending_requests_count: 0,
  });
  const [revenueBreakdown, setRevenueBreakdown] = useState({
    restaurant: 0,
    boissons: 0,
    cocktails: 0,
    total: 0,
  });
  const [pending, setPending] = useState([]);
  const [movements, setMovements] = useState([]);
  const [formData, setFormData] = useState({
    amount: '',
    reason: '',
    description: '',
  });

  const parseError = (error, fallbackMessage) => {
    const errors = error?.response?.data?.errors;
    if (errors && typeof errors === 'object') {
      const first = Object.values(errors).flat().find((item) => typeof item === 'string');
      if (first) return first;
    }
    return extractApiError(error, fallbackMessage);
  };

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
      const response = await cashierAPI.getCashMovements();
      const data = response?.data || {};
      setSummary(data.summary || {
        cash_in_approved: 0,
        cash_out_approved: 0,
        cash_out_pending: 0,
        cash_available: 0,
        pending_requests_count: 0,
      });
      setRevenueBreakdown(data.revenue_breakdown_today || {
        restaurant: 0,
        boissons: 0,
        cocktails: 0,
        total: 0,
      });
      setPending(Array.isArray(data.pending_withdrawals) ? data.pending_withdrawals : []);
      setMovements(Array.isArray(data.movements) ? data.movements : []);
    } catch (error) {
      if (!silent) {
        setMessage({
          type: 'error',
          text: parseError(error, 'Impossible de charger les mouvements de caisse.'),
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);
  const loadData = useSerializedAsyncCallback(loadDataInternal);

  useEffect(() => {
    loadData();

    const intervalId = setInterval(() => {
      loadData({ silent: true });
    }, OVERVIEW_REFRESH_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [loadData]);

  const submitWithdrawalRequest = async (event) => {
    event.preventDefault();
    setMessage(null);

    const amount = Number(formData.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage({ type: 'error', text: 'Montant invalide.' });
      return;
    }

    if (!String(formData.reason || '').trim()) {
      setMessage({ type: 'error', text: 'Le motif de sortie est obligatoire.' });
      return;
    }

    setSubmitting(true);
    try {
      await cashierAPI.requestCashWithdrawal({
        amount,
        reason: String(formData.reason).trim(),
        description: formData.description ? String(formData.description).trim() : null,
      });

      setMessage({ type: 'success', text: 'Demande de sortie envoyee a l\'administrateur.' });
      setFormData({ amount: '', reason: '', description: '' });
      await loadData({ silent: true });
    } catch (error) {
      setMessage({
        type: 'error',
        text: parseError(error, 'Impossible d\'envoyer la demande de sortie.'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="staff-card">Chargement des mouvements de caisse...</div>;
  }

  return (
    <div className="staff-module-stack">
      <MessageBanner message={message} />

      <div className="staff-stat-grid">
        <div className="staff-stat-card"><span>Caisse disponible</span><strong>{formatCurrency(summary.cash_available)}</strong></div>
        <div className="staff-stat-card"><span>Entrees cash (jour)</span><strong>{formatCurrency(summary.cash_in_approved)}</strong></div>
        <div className="staff-stat-card"><span>Sorties validees (jour)</span><strong>{formatCurrency(summary.cash_out_approved)}</strong></div>
        <div className="staff-stat-card"><span>Sorties en attente (jour)</span><strong>{formatCurrency(summary.cash_out_pending)}</strong></div>
      </div>

      <div className="staff-stat-grid">
        <div className="staff-stat-card"><span>Recettes Restaurant (jour)</span><strong>{formatCurrency(revenueBreakdown.restaurant)}</strong></div>
        <div className="staff-stat-card"><span>Recettes Boissons (jour)</span><strong>{formatCurrency(revenueBreakdown.boissons)}</strong></div>
        <div className="staff-stat-card"><span>Recettes Cocktails (jour)</span><strong>{formatCurrency(revenueBreakdown.cocktails)}</strong></div>
        <div className="staff-stat-card"><span>Total Recettes (jour)</span><strong>{formatCurrency(revenueBreakdown.total)}</strong></div>
      </div>

      <div className="staff-card">
        <div className="staff-card-header">
          <h2>Demander une sortie de caisse</h2>
          <button type="button" className="staff-btn secondary" onClick={() => loadData()}>
            Actualiser
          </button>
        </div>

        <form onSubmit={submitWithdrawalRequest} className="staff-form-grid">
          <label className="staff-field">
            Montant (Ar)
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={formData.amount}
              onChange={(event) => setFormData((prev) => ({ ...prev, amount: event.target.value }))}
              required
            />
          </label>

          <label className="staff-field">
            Objet court
            <input
              type="text"
              value={formData.description}
              onChange={(event) => setFormData((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Ex: avance urgence, achat immediate..."
            />
          </label>

          <label className="staff-field full-width">
            Motif de sortie (obligatoire)
            <textarea
              rows="3"
              value={formData.reason}
              onChange={(event) => setFormData((prev) => ({ ...prev, reason: event.target.value }))}
              required
            />
          </label>

          <div className="staff-inline-actions full-width">
            <button type="submit" className="staff-btn primary" disabled={submitting}>
              {submitting ? 'Envoi...' : 'Envoyer pour validation admin'}
            </button>
          </div>
        </form>
      </div>

      <div className="staff-card">
        <h2>Sorties en attente</h2>
        {pending.length === 0 ? (
          <p className="staff-muted">Aucune demande en attente.</p>
        ) : (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Montant</th>
                  <th>Motif</th>
                  <th>Demandeur</th>
                  <th>Date</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {pending.map((movement) => (
                  <tr key={movement.id}>
                    <td data-label="#">#{movement.id}</td>
                    <td data-label="Montant">{formatCurrency(movement.amount)}</td>
                    <td data-label="Motif">{renderMovementDetails(movement, { preferReason: true })}</td>
                    <td data-label="Demandeur">{movement.requested_by_name || '-'}</td>
                    <td data-label="Date">{formatDateTime(movement.created_at)}</td>
                    <td data-label="Statut">
                      <span className={`staff-movement-badge ${movement.status || 'pending'}`}>
                        {movementStatusLabel(movement.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="staff-card">
        <h2>Mouvements de caisse du jour</h2>
        <p className="staff-muted">L&apos;historique complet des flux reste disponible côté administration.</p>
        {movements.length === 0 ? (
          <p className="staff-muted">Aucun mouvement enregistre aujourd&apos;hui.</p>
        ) : (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Type</th>
                  <th>Montant</th>
                  <th>Mode</th>
                  <th>Motif / Description</th>
                  <th>Demandeur</th>
                  <th>Validation</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td data-label="#">#{movement.id}</td>
                    <td data-label="Type">{movementDirectionLabel(movement.direction)}</td>
                    <td data-label="Montant">{formatCurrency(movement.amount)}</td>
                    <td data-label="Mode">{formatPaymentMethodLabel(movement.payment_method || '-')}</td>
                    <td data-label="Motif / Description">{renderMovementDetails(movement, { preferReason: true })}</td>
                    <td data-label="Demandeur">{movement.requested_by_name || '-'}</td>
                    <td data-label="Validation">
                      <span className={`staff-movement-badge ${movement.status || 'pending'}`}>
                        {movementStatusLabel(movement.status)}
                      </span>
                    </td>
                    <td data-label="Date">{formatDateTime(movement.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
