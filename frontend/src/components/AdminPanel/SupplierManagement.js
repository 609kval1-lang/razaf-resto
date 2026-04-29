import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { adminAPI } from '../../services/api';
import { RAW_MATERIAL_UNIT_OPTIONS } from '../../utils/units';
import { normalizePaymentMethod } from '../../utils/paymentMethods';
import { useDialog } from '../common/DialogProvider';
import DataTable from '../common/DataTable';

const SUPPLIER_SETTLEMENT_OPTIONS = [
  { value: 'cash', label: 'Caisse', payment_method: 'cash', cash_source_account: 'cash', debit_account: 'cash', debit_account_label: 'Caisse' },
  { value: 'safe', label: 'Coffre', payment_method: 'cash', cash_source_account: 'safe', debit_account: 'safe', debit_account_label: 'Coffre' },
  { value: 'transfer', label: 'Virement', payment_method: 'transfer', cash_source_account: null, debit_account: 'bank', debit_account_label: 'Banque' },
  { value: 'check', label: 'Cheque', payment_method: 'check', cash_source_account: null, debit_account: 'bank', debit_account_label: 'Banque' },
  { value: 'mobile_money', label: 'Mobile Money', payment_method: 'mobile_money', cash_source_account: null, debit_account: 'mobile_money', debit_account_label: 'Mobile Money' },
];

const DEFAULT_TREASURY_BALANCES = {
  cash: 0,
  safe: 0,
  bank: 0,
  mobile_money: 0,
};

const SUPPLIER_FOLLOW_SCROLL_EXTRA_Y = 0;
const SUPPLIER_FOLLOW_FOCUS_PARAM = 'supplier-payments';

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} Ar`;
};

const formatDate = (value, withTime = false) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return withTime
    ? date.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('fr-FR');
};

const statusLabel = (status) => {
  if (status === 'paid') return 'Paye';
  if (status === 'partial') return 'Partiel';
  return 'Impaye';
};

const roundCurrency = (value) => {
  const amount = Number(value || 0);
  return Math.round((amount + Number.EPSILON) * 100) / 100;
};

const buildLedgerSummary = (purchaseList) => {
  const purchases = Array.isArray(purchaseList) ? purchaseList : [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let totalPurchased = 0;
  let totalPaid = 0;
  let totalRemaining = 0;
  let unpaidPurchasesCount = 0;
  let overduePurchasesCount = 0;

  purchases.forEach((purchase) => {
    const totalAmount = Number(purchase?.total_amount || 0);
    const paidAmount = Number(purchase?.paid_amount || 0);
    const remainingAmount = Number(purchase?.remaining_amount || 0);

    totalPurchased += totalAmount;
    totalPaid += paidAmount;
    totalRemaining += remainingAmount;

    if (remainingAmount > 0) {
      unpaidPurchasesCount += 1;

      if (purchase?.due_date) {
        const dueDate = new Date(purchase.due_date);
        if (!Number.isNaN(dueDate.getTime())) {
          dueDate.setHours(0, 0, 0, 0);
          if (dueDate < today) {
            overduePurchasesCount += 1;
          }
        }
      }
    }
  });

  return {
    purchases_count: purchases.length,
    total_purchased: roundCurrency(totalPurchased),
    total_paid: roundCurrency(totalPaid),
    total_remaining: roundCurrency(totalRemaining),
    unpaid_purchases_count: unpaidPurchasesCount,
    overdue_purchases_count: overduePurchasesCount,
  };
};

const toTimestamp = (value) => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
};

const buildGroupedSupplierAlerts = (alertList) => {
  const alerts = Array.isArray(alertList) ? alertList : [];
  const groupedAlerts = new Map();

  alerts.forEach((alert) => {
    const supplierId = Number(alert?.supplier_id || 0);
    const supplierName = String(alert?.supplier_name || 'Fournisseur inconnu').trim() || 'Fournisseur inconnu';
    const alertKey = supplierId > 0
      ? `supplier-${supplierId}`
      : `supplier-name-${supplierName.toLowerCase()}`;
    const remainingAmount = roundCurrency(Number(alert?.remaining_amount || 0));
    const dueDate = alert?.due_date ? String(alert.due_date) : null;
    const purchasedAt = alert?.purchased_at || null;
    const rawMaterialName = String(alert?.raw_material_name || '').trim();
    const isOverdue = Boolean(alert?.is_overdue);

    if (!groupedAlerts.has(alertKey)) {
      groupedAlerts.set(alertKey, {
        supplier_id: supplierId > 0 ? supplierId : null,
        supplier_name: supplierName,
        total_remaining_amount: 0,
        unpaid_purchases_count: 0,
        overdue_purchases_count: 0,
        next_due_date: dueDate,
        latest_purchased_at: purchasedAt,
        raw_material_names: [],
        is_overdue: false,
        severity: isOverdue ? 'low' : (alert?.severity || 'warning'),
      });
    }

    const currentGroup = groupedAlerts.get(alertKey);

    currentGroup.total_remaining_amount = roundCurrency(currentGroup.total_remaining_amount + remainingAmount);
    currentGroup.unpaid_purchases_count += 1;
    currentGroup.overdue_purchases_count += isOverdue ? 1 : 0;
    currentGroup.is_overdue = currentGroup.is_overdue || isOverdue;
    currentGroup.severity = currentGroup.is_overdue ? 'low' : currentGroup.severity;

    if (rawMaterialName && !currentGroup.raw_material_names.includes(rawMaterialName)) {
      currentGroup.raw_material_names.push(rawMaterialName);
    }

    const currentDueTimestamp = toTimestamp(currentGroup.next_due_date);
    const incomingDueTimestamp = toTimestamp(dueDate);
    if (incomingDueTimestamp !== null && (currentDueTimestamp === null || incomingDueTimestamp < currentDueTimestamp)) {
      currentGroup.next_due_date = dueDate;
    }

    const currentPurchaseTimestamp = toTimestamp(currentGroup.latest_purchased_at);
    const incomingPurchaseTimestamp = toTimestamp(purchasedAt);
    if (incomingPurchaseTimestamp !== null && (currentPurchaseTimestamp === null || incomingPurchaseTimestamp > currentPurchaseTimestamp)) {
      currentGroup.latest_purchased_at = purchasedAt;
    }
  });

  return Array.from(groupedAlerts.values())
    .map((group) => ({
      ...group,
      total_remaining_amount: roundCurrency(group.total_remaining_amount),
      visible_raw_material_names: group.raw_material_names.slice(0, 3),
      hidden_raw_materials_count: Math.max(0, group.raw_material_names.length - 3),
    }))
    .sort((left, right) => {
      if (left.is_overdue !== right.is_overdue) {
        return left.is_overdue ? -1 : 1;
      }

      const leftDueTimestamp = toTimestamp(left.next_due_date);
      const rightDueTimestamp = toTimestamp(right.next_due_date);
      if (leftDueTimestamp === null && rightDueTimestamp !== null) return 1;
      if (leftDueTimestamp !== null && rightDueTimestamp === null) return -1;
      if (leftDueTimestamp !== null && rightDueTimestamp !== null && leftDueTimestamp !== rightDueTimestamp) {
        return leftDueTimestamp - rightDueTimestamp;
      }

      return Number(right.total_remaining_amount || 0) - Number(left.total_remaining_amount || 0);
    });
};

const mergeUpdatedPurchaseIntoLedger = (currentLedger, updatedPurchase) => {
  if (!currentLedger || !updatedPurchase) return currentLedger;

  const currentPurchases = Array.isArray(currentLedger.purchases) ? currentLedger.purchases : [];
  const purchaseId = Number(updatedPurchase.id);
  const exists = currentPurchases.some((purchase) => Number(purchase.id) === purchaseId);

  const nextPurchases = exists
    ? currentPurchases.map((purchase) => (Number(purchase.id) === purchaseId ? updatedPurchase : purchase))
    : [updatedPurchase, ...currentPurchases];

  return {
    ...currentLedger,
    purchases: nextPurchases,
    summary: buildLedgerSummary(nextPurchases),
  };
};

const createNewRawMaterialDraft = () => ({
  name: '',
  description: '',
  stock: '',
  unit: 'kg',
  cost: '',
  reorder_level: '',
});

const extractErrorMessage = (error, fallbackMessage) => {
  const response = error?.response?.data;

  if (response?.errors && typeof response.errors === 'object') {
    const firstError = Object.values(response.errors)
      .flat()
      .find((value) => typeof value === 'string' && value.trim() !== '');
    if (firstError) return firstError;
  }

  if (typeof response?.message === 'string' && response.message.trim() !== '') {
    return response.message;
  }

  return fallbackMessage;
};

const extractTreasuryBalances = (treasurySnapshot) => {
  const accountMap = treasurySnapshot?.summary?.accounts && typeof treasurySnapshot.summary.accounts === 'object'
    ? treasurySnapshot.summary.accounts
    : {};

  const readBalance = (accountKey) => {
    const amount = Number(accountMap?.[accountKey]?.balance ?? 0);
    return Number.isFinite(amount) ? amount : 0;
  };

  return {
    cash: readBalance('cash'),
    safe: readBalance('safe'),
    bank: readBalance('bank'),
    mobile_money: readBalance('mobile_money'),
  };
};

const getSupplierSettlementValue = (method, cashSourceAccount = 'cash') => {
  const normalizedMethod = normalizePaymentMethod(method);

  if (normalizedMethod === 'cash') {
    return cashSourceAccount === 'safe' ? 'safe' : 'cash';
  }

  if (SUPPLIER_SETTLEMENT_OPTIONS.some((option) => option.value === normalizedMethod)) {
    return normalizedMethod;
  }

  return 'cash';
};

const getSupplierSettlementConfig = (value) => {
  return SUPPLIER_SETTLEMENT_OPTIONS.find((option) => option.value === value)
    || SUPPLIER_SETTLEMENT_OPTIONS[0];
};

const applySupplierSettlementSelection = (value, previous = {}) => {
  const selection = getSupplierSettlementConfig(value);

  return {
    ...previous,
    payment_method: selection.payment_method,
    cash_source_account: selection.cash_source_account || 'cash',
  };
};

const SupplierManagement = () => {
  const { confirm } = useDialog();
  const location = useLocation();
  const [suppliers, setSuppliers] = useState([]);
  const [rawMaterials, setRawMaterials] = useState([]);
  const [alertsData, setAlertsData] = useState({ summary: {}, alerts: [] });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', raw_material_ids: [] });
  const [newRawMaterials, setNewRawMaterials] = useState([]);

  const [activeSupplierId, setActiveSupplierId] = useState('');
  const [ledger, setLedger] = useState(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerReloadToken, setLedgerReloadToken] = useState(0);
  const followSectionRef = useRef(null);
  const followHeadingRef = useRef(null);
  const followScrollPendingRef = useRef(false);
  const routeFollowScrollHandledRef = useRef('');
  const [focusedPurchaseId, setFocusedPurchaseId] = useState(null);
  const [treasuryBalances, setTreasuryBalances] = useState(DEFAULT_TREASURY_BALANCES);

  const [paymentForms, setPaymentForms] = useState({});
  const [paymentLoadingId, setPaymentLoadingId] = useState(null);
  const [bulkPaymentForm, setBulkPaymentForm] = useState({
    payment_method: 'cash',
    cash_source_account: 'cash',
    reference: '',
    note: '',
  });
  const [settlingAllPurchases, setSettlingAllPurchases] = useState(false);
  const [activeSupplierPaymentAction, setActiveSupplierPaymentAction] = useState('outstanding_debts');

  const summary = alertsData?.summary || {};
  const alerts = useMemo(
    () => (Array.isArray(alertsData?.alerts) ? alertsData.alerts : []),
    [alertsData],
  );
  const groupedAlerts = useMemo(() => buildGroupedSupplierAlerts(alerts), [alerts]);
  const shouldFocusSupplierPayments = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('focus') === SUPPLIER_FOLLOW_FOCUS_PARAM;
  }, [location.search]);
  const purchases = useMemo(
    () => (Array.isArray(ledger?.purchases) ? ledger.purchases : []),
    [ledger],
  );
  const outstandingPurchases = useMemo(
    () => purchases.filter((purchase) => Number(purchase?.remaining_amount || 0) > 0),
    [purchases],
  );
  const settledPurchases = useMemo(
    () => purchases.filter((purchase) => Number(purchase?.remaining_amount || 0) <= 0),
    [purchases],
  );

  const selectedSupplier = useMemo(() => suppliers.find((item) => Number(item.id) === Number(activeSupplierId)) || null, [suppliers, activeSupplierId]);
  const outstandingPurchasesCount = outstandingPurchases.length;
  const totalOutstandingForSupplier = useMemo(() => {
    const hasLedgerRemainingValue = ledger?.summary && ledger.summary.total_remaining !== undefined && ledger.summary.total_remaining !== null;
    if (hasLedgerRemainingValue) {
      return roundCurrency(Number(ledger.summary.total_remaining || 0));
    }

    return roundCurrency(Number(selectedSupplier?.outstanding_amount || 0));
  }, [ledger, selectedSupplier]);

  const bulkSettlementValue = getSupplierSettlementValue(
    bulkPaymentForm.payment_method,
    bulkPaymentForm.cash_source_account,
  );
  const bulkSettlementConfig = getSupplierSettlementConfig(bulkSettlementValue);
  const bulkDebitAccountLabel = bulkSettlementConfig.debit_account_label;
  const bulkDebitAccountBalance = Number(treasuryBalances?.[bulkSettlementConfig.debit_account] || 0);

  const scrollToSupplierFollow = useCallback(() => {
    const target = followHeadingRef.current || followSectionRef.current;
    if (!target) return;

    const targetY = target.getBoundingClientRect().top + window.scrollY + SUPPLIER_FOLLOW_SCROLL_EXTRA_Y;
    window.scrollTo({ top: targetY, behavior: 'smooth' });
  }, []);

  const scrollToSupplierFollowAfterRender = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollToSupplierFollow();
        followScrollPendingRef.current = false;
      });
    });
  }, [scrollToSupplierFollow]);

  const queueSupplierFollowScroll = useCallback(() => {
    followScrollPendingRef.current = true;
  }, []);

  const primePaymentForm = (purchaseId, amount = '') => {
    const normalizedPurchaseId = Number(purchaseId);
    if (!Number.isFinite(normalizedPurchaseId) || normalizedPurchaseId <= 0) {
      return;
    }

    setPaymentForms((previous) => ({
      ...previous,
      [normalizedPurchaseId]: {
        payment_method: 'cash',
        cash_source_account: 'cash',
        reference: '',
        note: '',
        ...(previous[normalizedPurchaseId] || {}),
        amount: amount === '' || amount === null || amount === undefined
          ? (previous[normalizedPurchaseId]?.amount ?? '')
          : String(amount),
      },
    }));
  };

  const openSupplierFollow = (supplierId, options = {}) => {
    const nextSupplierId = String(supplierId || '');
    if (!nextSupplierId) return;
    const nextPurchaseId = Number(options?.purchaseId || 0);
    const nextRemainingAmount = Number(options?.remainingAmount || 0);

    setActiveSupplierId(nextSupplierId);
    setFocusedPurchaseId(nextPurchaseId > 0 ? nextPurchaseId : null);
    setActiveSupplierPaymentAction('outstanding_debts');
    setLedgerReloadToken((previous) => previous + 1);

    if (nextPurchaseId > 0 && nextRemainingAmount > 0) {
      primePaymentForm(nextPurchaseId, nextRemainingAmount);
    }

    queueSupplierFollowScroll();
  };

  const supplierColumns = [
    {
      key: 'name',
      header: 'Nom',
      sortAccessor: (supplier) => supplier.name,
      searchAccessor: (supplier) => `${supplier.name} ${supplier.email || ''} ${supplier.phone || ''}`,
      render: (supplier) => (
        <div className="cash-movement-detail">
          <strong>{supplier.name}</strong>
          <div className="form-hint">Créé le {formatDate(supplier.created_at)}</div>
          <button
            type="button"
            className="btn btn-secondary btn-sm supplier-follow-inline"
            onClick={() => openSupplierFollow(supplier.id)}
            title="Ouvrir le suivi paiement du fournisseur"
            aria-label={`Ouvrir le suivi paiement de ${supplier.name}`}
          >
            📒 Suivi
          </button>
        </div>
      ),
    },
    {
      key: 'raw_materials',
      header: 'Matières fournies',
      sortAccessor: (supplier) => (
        Array.isArray(supplier.raw_materials)
          ? supplier.raw_materials.map((item) => item.name).join(', ')
          : (supplier?.raw_material?.name || '')
      ),
      searchAccessor: (supplier) => (
        Array.isArray(supplier.raw_materials)
          ? supplier.raw_materials.map((item) => item.name).join(' ')
          : (supplier?.raw_material?.name || '')
      ),
      render: (supplier) => {
        const materialNames = Array.isArray(supplier.raw_materials)
          ? supplier.raw_materials.map((item) => item?.name).filter(Boolean)
          : (supplier?.raw_material?.name ? [supplier.raw_material.name] : []);

        if (materialNames.length === 0) {
          return '-';
        }

        const visibleNames = materialNames.slice(0, 3);
        const hiddenCount = Math.max(0, materialNames.length - visibleNames.length);

        return (
          <div className="supplier-materials-compact">
            {visibleNames.map((name, index) => (
              <span
                key={`supplier-material-${supplier.id}-${index}`}
                className="supplier-material-chip"
                title={name}
              >
                {name}
              </span>
            ))}
            {hiddenCount > 0 ? (
              <span className="supplier-material-chip supplier-material-chip-more" title={`${hiddenCount} matières supplémentaires`}>
                +{hiddenCount}
              </span>
            ) : null}
            <span className="form-hint supplier-materials-count">
              {materialNames.length} matière(s)
            </span>
          </div>
        );
      },
    },
    {
      key: 'outstanding_amount',
      header: 'Reste à payer',
      sortType: 'number',
      sortAccessor: (supplier) => Number(supplier.outstanding_amount || 0),
      searchAccessor: (supplier) => String(supplier.outstanding_amount || ''),
      render: (supplier) => formatCurrency(supplier.outstanding_amount),
    },
    {
      key: 'alerts',
      header: 'Alertes',
      sortType: 'number',
      sortAccessor: (supplier) => Number(supplier.overdue_purchases_count || 0),
      searchAccessor: (supplier) => `${supplier.overdue_purchases_count || 0} ${supplier.unpaid_purchases_count || 0}`,
      render: (supplier) => (
        Number(supplier.overdue_purchases_count || 0) > 0
          ? `${supplier.overdue_purchases_count} retard`
          : `${supplier.unpaid_purchases_count || 0} impaye(s)`
      ),
    },
    {
      key: 'contact',
      header: 'Contact',
      sortAccessor: (supplier) => supplier.email || supplier.phone || '',
      searchAccessor: (supplier) => `${supplier.email || ''} ${supplier.phone || ''}`,
      render: (supplier) => (
        <div className="cash-movement-detail supplier-contact-compact">
          <span>{supplier.email || 'Email non renseigné'}</span>
          <span>{supplier.phone || 'Téléphone non renseigné'}</span>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      sortable: false,
      searchable: false,
      render: (supplier) => (
        <div className="actions">
          <button className="btn btn-secondary btn-sm" onClick={() => handleEdit(supplier)}>✏️</button>
          <button className="btn btn-danger btn-sm" onClick={() => handleDelete(supplier.id)}>🗑️</button>
        </div>
      ),
    },
  ];

  const purchaseCommonColumns = [
    {
      key: 'purchased_at',
      header: 'Date',
      sortType: 'date',
      sortAccessor: (purchase) => purchase.purchased_at,
      searchAccessor: (purchase) => formatDate(purchase.purchased_at, true),
      render: (purchase) => formatDate(purchase.purchased_at, true),
    },
    {
      key: 'raw_material',
      header: 'Matière',
      sortAccessor: (purchase) => purchase?.raw_material?.name || '',
      searchAccessor: (purchase) => purchase?.raw_material?.name || '',
      render: (purchase) => (
        <>
          <strong>{purchase?.raw_material?.name || `#${purchase.raw_material_id}`}</strong>
          {Number(focusedPurchaseId) === Number(purchase?.id) ? (
            <div className="form-hint">Achat ciblé depuis une alerte</div>
          ) : null}
        </>
      ),
    },
    {
      key: 'quantity',
      header: 'Qté',
      sortType: 'number',
      sortAccessor: (purchase) => Number(purchase.quantity || 0),
      searchAccessor: (purchase) => String(purchase.quantity || ''),
      render: (purchase) => Number(purchase.quantity || 0),
    },
    {
      key: 'total_amount',
      header: 'Total',
      sortType: 'number',
      sortAccessor: (purchase) => Number(purchase.total_amount || 0),
      searchAccessor: (purchase) => String(purchase.total_amount || ''),
      render: (purchase) => formatCurrency(purchase.total_amount),
    },
    {
      key: 'paid_amount',
      header: 'Payé',
      sortType: 'number',
      sortAccessor: (purchase) => Number(purchase.paid_amount || 0),
      searchAccessor: (purchase) => String(purchase.paid_amount || ''),
      render: (purchase) => formatCurrency(purchase.paid_amount),
    },
    {
      key: 'remaining_amount',
      header: 'Reste',
      sortType: 'number',
      sortAccessor: (purchase) => Number(purchase.remaining_amount || 0),
      searchAccessor: (purchase) => String(purchase.remaining_amount || ''),
      render: (purchase) => formatCurrency(purchase.remaining_amount),
    },
    {
      key: 'payment_status',
      header: 'Statut',
      sortAccessor: (purchase) => statusLabel(purchase.payment_status),
      searchAccessor: (purchase) => statusLabel(purchase.payment_status),
      render: (purchase) => statusLabel(purchase.payment_status),
    },
    {
      key: 'due_date',
      header: 'Échéance',
      sortType: 'date',
      sortAccessor: (purchase) => purchase.due_date,
      searchAccessor: (purchase) => formatDate(purchase.due_date),
      render: (purchase) => formatDate(purchase.due_date),
    },
    {
      key: 'payments_count',
      header: 'Paiements',
      sortType: 'number',
      sortAccessor: (purchase) => (Array.isArray(purchase.payments) ? purchase.payments.length : 0),
      searchAccessor: (purchase) => String(Array.isArray(purchase.payments) ? purchase.payments.length : 0),
      render: (purchase) => (Array.isArray(purchase.payments) ? `${purchase.payments.length} paiement(s)` : '0 paiement'),
    },
  ];

  const outstandingPurchaseColumns = [
    ...purchaseCommonColumns,
    {
      key: 'regler',
      header: 'Régler',
      sortable: false,
      searchable: false,
      render: (purchase) => {
        const form = paymentForms[purchase.id] || { amount: '', payment_method: 'cash', cash_source_account: 'cash' };
        const settlementValue = getSupplierSettlementValue(form.payment_method, form.cash_source_account);
        const settlementConfig = getSupplierSettlementConfig(settlementValue);
        const debitAccountLabel = settlementConfig.debit_account_label;
        const debitAccountBalance = Number(treasuryBalances?.[settlementConfig.debit_account] || 0);

        if (Number(purchase.remaining_amount || 0) <= 0) {
          return <span className="form-hint">Solde</span>;
        }

        return (
          <div className="supplier-inline-payment">
            <input
              className="admin-input admin-input-sm"
              type="number"
              step="0.01"
              min="0"
              placeholder="Montant"
              value={form.amount}
              onChange={(event) => updatePaymentField(purchase.id, 'amount', event.target.value)}
            />
            <select
              className="admin-select admin-select-sm"
              value={settlementValue}
              onChange={(event) => updatePaymentField(purchase.id, 'settlement_option', event.target.value)}
            >
              {SUPPLIER_SETTLEMENT_OPTIONS.map((methodOption) => (
                <option key={methodOption.value} value={methodOption.value}>{methodOption.label}</option>
              ))}
            </select>
            <div className="form-hint">Solde disponible: {formatCurrency(debitAccountBalance)}</div>
            <div className="form-hint">Compte debite: {debitAccountLabel}</div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => handlePayPurchase(purchase)} disabled={paymentLoadingId === purchase.id}>{paymentLoadingId === purchase.id ? '...' : 'Payer'}</button>
          </div>
        );
      },
    },
  ];

  const historyPurchaseColumns = purchaseCommonColumns;

  const loadPageData = async ({ skipSpinner = false } = {}) => {
    if (!skipSpinner) setLoading(true);
    try {
      const [suppliersRes, rawRes, alertsRes, treasuryRes] = await Promise.all([
        adminAPI.getSuppliers(),
        adminAPI.getRawMaterials(),
        adminAPI.getSupplierPayablesAlerts(),
        adminAPI.getTreasurySnapshot(),
      ]);

      const supplierList = Array.isArray(suppliersRes.data) ? suppliersRes.data : [];
      setSuppliers(supplierList);
      setRawMaterials(Array.isArray(rawRes.data) ? rawRes.data : []);
      setAlertsData(alertsRes.data || { summary: {}, alerts: [] });
      setTreasuryBalances(extractTreasuryBalances(treasuryRes?.data));

      if (supplierList.length === 0) {
        setActiveSupplierId('');
        setLedger(null);
      } else if (!activeSupplierId || !supplierList.some((item) => Number(item.id) === Number(activeSupplierId))) {
        setActiveSupplierId(String(supplierList[0].id));
      }
    } catch (_error) {
      setMessage('Erreur lors du chargement des donnees fournisseurs');
    } finally {
      if (!skipSpinner) setLoading(false);
    }
  };

  const loadLedger = async (supplierId) => {
    if (!supplierId) {
      setLedger(null);
      return;
    }

    setLedgerLoading(true);
    try {
      const response = await adminAPI.getSupplierLedger(supplierId);
      setLedger(response.data || null);
    } catch (_error) {
      setMessage('Erreur lors du chargement du suivi fournisseur');
      setLedger(null);
    } finally {
      setLedgerLoading(false);
      if (followScrollPendingRef.current) {
        scrollToSupplierFollowAfterRender();
      }
    }
  };

  useEffect(() => {
    loadPageData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeSupplierId) loadLedger(activeSupplierId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSupplierId, ledgerReloadToken]);

  useEffect(() => {
    if (!shouldFocusSupplierPayments || !activeSupplierId) return;

    const focusKey = `${location.pathname}${location.search}`;
    if (routeFollowScrollHandledRef.current === focusKey) return;

    routeFollowScrollHandledRef.current = focusKey;
    setFocusedPurchaseId(null);
    setActiveSupplierPaymentAction('outstanding_debts');
    queueSupplierFollowScroll();
    if (ledger) {
      scrollToSupplierFollowAfterRender();
    }
  }, [
    activeSupplierId,
    ledger,
    location.pathname,
    location.search,
    queueSupplierFollowScroll,
    scrollToSupplierFollowAfterRender,
    shouldFocusSupplierPayments,
  ]);

  const resetForm = () => {
    setFormData({ name: '', email: '', phone: '', raw_material_ids: [] });
    setNewRawMaterials([]);
    setEditingSupplier(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const handleEdit = (supplier) => {
    const rawIds = Array.isArray(supplier.raw_materials) ? supplier.raw_materials.map((item) => String(item.id)) : [];
    if (rawIds.length === 0 && supplier.raw_material_id) rawIds.push(String(supplier.raw_material_id));

    setEditingSupplier(supplier);
    setFormData({
      name: supplier.name || '',
      email: supplier.email || '',
      phone: supplier.phone || '',
      raw_material_ids: Array.from(new Set(rawIds)),
    });
    setNewRawMaterials([]);
    setShowModal(true);
  };

  const toggleMaterial = (rawMaterialId) => {
    const id = String(rawMaterialId);
    setFormData((previous) => ({
      ...previous,
      raw_material_ids: previous.raw_material_ids.includes(id)
        ? previous.raw_material_ids.filter((value) => value !== id)
        : [...previous.raw_material_ids, id],
    }));
  };

  const addNewRawMaterialRow = () => {
    setNewRawMaterials((previous) => [...previous, createNewRawMaterialDraft()]);
  };

  const removeNewRawMaterialRow = (indexToRemove) => {
    setNewRawMaterials((previous) => previous.filter((_, index) => index !== indexToRemove));
  };

  const updateNewRawMaterialRow = (indexToUpdate, key, value) => {
    setNewRawMaterials((previous) => previous.map((entry, index) => (
      index === indexToUpdate ? { ...entry, [key]: value } : entry
    )));
  };

  const handleSubmitSupplier = async (event) => {
    event.preventDefault();

    const preparedNewRawMaterials = newRawMaterials
      .map((entry) => ({
        name: String(entry.name || '').trim(),
        description: entry.description ? String(entry.description).trim() : '',
        stock: entry.stock === '' ? null : Number(entry.stock),
        unit: String(entry.unit || '').trim(),
        cost: entry.cost === '' ? null : Number(entry.cost),
        reorder_level: entry.reorder_level === '' ? null : Number(entry.reorder_level),
      }))
      .filter((entry) => entry.name !== '');

    const payload = {
      name: String(formData.name || '').trim(),
      email: formData.email ? String(formData.email).trim() : null,
      phone: formData.phone ? String(formData.phone).trim() : null,
      raw_material_ids: formData.raw_material_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0),
    };

    if (!payload.name) {
      setMessage('Le nom du fournisseur est obligatoire');
      return;
    }

    if (payload.raw_material_ids.length === 0 && preparedNewRawMaterials.length === 0) {
      setMessage('Selectionnez ou creez au moins une matiere premiere');
      return;
    }

    const hasInvalidNewRawMaterial = preparedNewRawMaterials.some((entry) => (
      !entry.unit
      || !Number.isFinite(entry.stock)
      || Number(entry.stock) < 0
      || !Number.isFinite(entry.cost)
      || Number(entry.cost) <= 0
      || (entry.reorder_level !== null && (!Number.isFinite(entry.reorder_level) || Number(entry.reorder_level) < 0))
    ));

    if (hasInvalidNewRawMaterial) {
      setMessage('Verifiez les nouvelles matieres premieres: unite, stock (>=0), cout (>0) et seuil.');
      return;
    }

    if (preparedNewRawMaterials.length > 0) {
      payload.new_raw_materials = preparedNewRawMaterials.map((entry) => ({
        name: entry.name,
        description: entry.description || null,
        stock: Number(entry.stock),
        unit: entry.unit,
        cost: Number(entry.cost),
        reorder_level: entry.reorder_level === null ? null : Number(entry.reorder_level),
      }));
    }

    try {
      if (editingSupplier) {
        const response = await adminAPI.updateSupplier(editingSupplier.id, payload);
        setMessage(response?.data?.message || 'Fournisseur modifie avec succes');
      } else {
        const response = await adminAPI.createSupplier(payload);
        const createdId = response?.data?.supplier?.id;
        if (createdId) setActiveSupplierId(String(createdId));
        setMessage(response?.data?.message || 'Fournisseur cree avec succes');
      }

      setShowModal(false);
      resetForm();
      await loadPageData({ skipSpinner: true });
    } catch (error) {
      setMessage(extractErrorMessage(error, 'Erreur lors de la sauvegarde du fournisseur'));
    }
  };

  const handleDelete = async (supplierId) => {
    const isConfirmed = await confirm({
      title: 'Supprimer fournisseur',
      message: 'Voulez-vous supprimer ce fournisseur ?',
      confirmText: 'Supprimer',
      cancelText: 'Annuler',
      tone: 'danger',
    });

    if (!isConfirmed) return;

    try {
      await adminAPI.deleteSupplier(supplierId);
      setMessage('Fournisseur supprime avec succes');
      await loadPageData({ skipSpinner: true });
    } catch (_error) {
      setMessage('Impossible de supprimer ce fournisseur');
    }
  };

  const updatePaymentField = (purchaseId, key, value) => {
    setPaymentForms((previous) => ({
      ...previous,
      [purchaseId]: (() => {
        const next = {
          amount: '',
          payment_method: 'cash',
          cash_source_account: 'cash',
          reference: '',
          note: '',
          ...(previous[purchaseId] || {}),
        };

        if (key === 'settlement_option') {
          return applySupplierSettlementSelection(value, next);
        }

        return {
          ...next,
          [key]: value,
        };
      })(),
    }));
  };

  const updateBulkPaymentField = (key, value) => {
    setBulkPaymentForm((previous) => {
      const next = {
        payment_method: 'cash',
        cash_source_account: 'cash',
        reference: '',
        note: '',
        ...previous,
      };

      if (key === 'settlement_option') {
        return applySupplierSettlementSelection(value, next);
      }

      return {
        ...next,
        [key]: value,
      };
    });
  };

  const handleSettleAllPurchases = async () => {
    const supplierId = Number(activeSupplierId || 0);
    if (!Number.isFinite(supplierId) || supplierId <= 0) {
      setMessage('Erreur: fournisseur invalide');
      return;
    }

    if (outstandingPurchasesCount <= 0 || totalOutstandingForSupplier <= 0) {
      setMessage('Aucune dette impayee pour ce fournisseur');
      return;
    }

    const isConfirmed = await confirm({
      title: 'Regler toutes les dettes',
      message: `Vous allez regler ${outstandingPurchasesCount} achat(s) impaye(s) pour ${formatCurrency(totalOutstandingForSupplier)} chez ${selectedSupplier?.name || 'ce fournisseur'}. Continuer ?`,
      confirmText: 'Regler maintenant',
      cancelText: 'Annuler',
      tone: 'primary',
    });

    if (!isConfirmed) {
      return;
    }

    setSettlingAllPurchases(true);
    try {
      const normalizedMethod = normalizePaymentMethod(bulkPaymentForm.payment_method) || 'cash';
      const response = await adminAPI.settleAllSupplierPurchases(supplierId, {
        method: normalizedMethod,
        cash_source_account: normalizedMethod === 'cash'
          ? (bulkPaymentForm.cash_source_account || 'cash')
          : null,
        reference: bulkPaymentForm.reference ? String(bulkPaymentForm.reference).trim() : null,
        note: bulkPaymentForm.note ? String(bulkPaymentForm.note).trim() : null,
      });

      const paidPurchasesCount = Number(response?.data?.paid_purchases_count || 0);
      const totalPaidAmount = Number(response?.data?.total_paid_amount || 0);

      setMessage(`Reglement global enregistre: ${paidPurchasesCount} achat(s) regle(s) pour ${formatCurrency(totalPaidAmount)}.`);
      setFocusedPurchaseId(null);
      setPaymentForms({});
      setBulkPaymentForm((previous) => ({
        ...previous,
        reference: '',
        note: '',
      }));

      await Promise.all([
        loadPageData({ skipSpinner: true }),
        loadLedger(String(supplierId)),
      ]);
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Erreur lors du reglement global fournisseur')}`);
    } finally {
      setSettlingAllPurchases(false);
    }
  };

  const handlePayPurchase = async (purchase) => {
    const purchaseId = Number(purchase?.id);
    if (!Number.isFinite(purchaseId) || purchaseId <= 0) {
      setMessage('Erreur: paiement impossible, achat fournisseur invalide');
      return;
    }

    const supplierIdFromPurchase = Number(purchase?.supplier_id || purchases.find((entry) => Number(entry.id) === purchaseId)?.supplier_id || activeSupplierId || 0);
    if (!Number.isFinite(supplierIdFromPurchase) || supplierIdFromPurchase <= 0) {
      setMessage('Erreur: fournisseur introuvable pour cet achat');
      return;
    }

    const form = paymentForms[purchaseId] || {};
    const purchaseFromLedger = purchases.find((entry) => Number(entry.id) === purchaseId) || purchase;
    const remainingAmount = Number(purchaseFromLedger?.remaining_amount || 0);
    const rawAmount = form.amount;
    const amount = rawAmount === '' || rawAmount === undefined || rawAmount === null
      ? remainingAmount
      : Number(rawAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage('Erreur: montant de paiement invalide');
      return;
    }

    if (Number.isFinite(remainingAmount) && remainingAmount > 0 && amount - remainingAmount > 0.0001) {
      setMessage(`Erreur: le montant depasse le reste a payer (${formatCurrency(remainingAmount)})`);
      return;
    }

    const currentSupplierId = String(supplierIdFromPurchase);
    setPaymentLoadingId(purchaseId);
    try {
      const response = await adminAPI.paySupplierPurchase(currentSupplierId, purchaseId, {
        amount,
        method: normalizePaymentMethod(form.payment_method) || 'cash',
        cash_source_account: normalizePaymentMethod(form.payment_method) === 'cash'
          ? (form.cash_source_account || 'cash')
          : null,
        reference: form.reference ? String(form.reference).trim() : null,
        note: form.note ? String(form.note).trim() : null,
      });

      const updatedPurchase = response?.data?.purchase || null;
      if (updatedPurchase) {
        setLedger((previous) => mergeUpdatedPurchaseIntoLedger(previous, updatedPurchase));
      }

      setMessage('Paiement fournisseur enregistre');
      setPaymentForms((previous) => ({ ...previous, [purchaseId]: {
        amount: '',
        payment_method: previous[purchaseId]?.payment_method || 'cash',
        cash_source_account: previous[purchaseId]?.cash_source_account || 'cash',
        reference: '',
        note: '',
      } }));
      await Promise.all([loadPageData({ skipSpinner: true }), loadLedger(currentSupplierId)]);
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Erreur lors du paiement fournisseur')}`);
    } finally {
      setPaymentLoadingId(null);
    }
  };

  if (loading) return <div className="loading">Chargement des fournisseurs...</div>;

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
          <h2>🚚 Fournisseurs et Restes à Payer</h2>
          <button className="btn btn-primary" onClick={openCreateModal}>➕ Ajouter Fournisseur</button>
        </div>

        {message ? (
          <div className={`message ${message.includes('Erreur') || message.includes('Impossible') ? 'error-message' : 'success-message'}`}>
            {message}
          </div>
        ) : null}

        <div className="stats-grid" style={{ marginBottom: '12px' }}>
          <div className="stat-card">
            <h3>Reste global</h3>
            <div className="stat-number">{formatCurrency(summary.total_outstanding)}</div>
            <p>Dettes fournisseurs</p>
          </div>
          <div className="stat-card">
            <h3>Fournisseurs concernes</h3>
            <div className="stat-number">{Number(summary.suppliers_with_balance || 0)}</div>
            <p>Avec solde impaye</p>
          </div>
          <div className="stat-card">
            <h3>Achats impayes</h3>
            <div className="stat-number">{Number(summary.unpaid_purchases_count || 0)}</div>
            <p>En attente de reglement</p>
          </div>
          <div className="stat-card">
            <h3>Echeances depassees</h3>
            <div className="stat-number">{Number(summary.overdue_purchases_count || 0)}</div>
            <p>Alertes urgentes</p>
          </div>
        </div>

        <div className="card" style={{ margin: 0, padding: '12px' }}>
          <h3 style={{ marginBottom: '10px' }}>Alertes Paiements Fournisseur</h3>
          {groupedAlerts.length === 0 ? (
            <div className="alert-empty">Aucun reste a payer en alerte.</div>
          ) : (
            <div className="alert-list">
              {groupedAlerts.slice(0, 12).map((alert) => {
                const materialsPreview = alert.visible_raw_material_names.join(', ');
                const hasExtraMaterials = Number(alert.hidden_raw_materials_count || 0) > 0;

                return (
                  <button
                    key={`alert-${alert.supplier_id || alert.supplier_name}`}
                    type="button"
                    className={`alert-item supplier-payment-alert ${alert.severity || 'warning'}`}
                    onClick={() => openSupplierFollow(alert.supplier_id)}
                  >
                    <div>
                      <strong>{alert.supplier_name}</strong>
                      <p>{alert.unpaid_purchases_count} achat(s) impaye(s) · Total restant: {formatCurrency(alert.total_remaining_amount)}</p>
                      {materialsPreview ? (
                        <p>
                          Matieres concernees: {materialsPreview}
                          {hasExtraMaterials ? ` +${alert.hidden_raw_materials_count}` : ''}
                        </p>
                      ) : null}
                      <p>Echeance la plus proche: {formatDate(alert.next_due_date)} · Dernier achat: {formatDate(alert.latest_purchased_at, true)}</p>
                      <p className="supplier-payment-alert-hint">Cliquer pour ouvrir le suivi, choisir un achat a regler ou payer ce fournisseur en une fois.</p>
                    </div>
                    <span className={`stock-status ${alert.is_overdue ? 'low' : 'warning'}`}>
                      {alert.is_overdue ? `${alert.overdue_purchases_count} en retard` : 'A regler'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '12px' }}>Fournisseurs</h3>
        <DataTable
          columns={supplierColumns}
          data={suppliers}
          rowKey="id"
          searchPlaceholder="Rechercher un fournisseur (nom, matière, contact)..."
          initialSort={{ key: 'outstanding_amount', direction: 'desc' }}
          emptyMessage="Aucun fournisseur enregistré."
        />
      </div>

      <div className="card" ref={followSectionRef}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
          <h3 ref={followHeadingRef}>Suivi Paiement Fournisseur</h3>
          <select
            className="admin-select"
            value={activeSupplierId}
            onChange={(event) => {
              setFocusedPurchaseId(null);
              setActiveSupplierPaymentAction('outstanding_debts');
              setActiveSupplierId(event.target.value);
            }}
            style={{ minWidth: '230px' }}
          >
            {suppliers.length === 0 ? <option value="">Aucun fournisseur</option> : null}
            {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
          </select>
        </div>

        {!activeSupplierId ? (
          <p className="form-hint">Selectionnez un fournisseur.</p>
        ) : ledgerLoading ? (
          <p className="form-hint">Chargement du suivi...</p>
        ) : (
          <>
            {focusedPurchaseId ? (
              <p className="form-hint" style={{ marginBottom: '10px' }}>
                Achat ciblé: #{focusedPurchaseId}. Le montant restant a été prérempli pour faciliter le paiement.
              </p>
            ) : null}
            <div className="stats-grid" style={{ marginBottom: '12px' }}>
              <div className="stat-card"><h3>Fournisseur</h3><div className="stat-number" style={{ fontSize: '1rem' }}>{selectedSupplier?.name || '-'}</div><p>Selection active</p></div>
              <div className="stat-card"><h3>Total achats</h3><div className="stat-number">{formatCurrency(ledger?.summary?.total_purchased)}</div><p>{ledger?.summary?.purchases_count || 0} achat(s)</p></div>
              <div className="stat-card"><h3>Total paye</h3><div className="stat-number">{formatCurrency(ledger?.summary?.total_paid)}</div><p>Paiements cumules</p></div>
              <div className="stat-card"><h3>Reste a payer</h3><div className="stat-number">{formatCurrency(ledger?.summary?.total_remaining)}</div><p>{ledger?.summary?.overdue_purchases_count || 0} en retard</p></div>
            </div>

            <div className="card" style={{ margin: 0, marginBottom: '12px', padding: '12px' }}>
              <h3 style={{ marginBottom: '8px' }}>Achat matière première</h3>
              <p className="form-hint" style={{ marginBottom: '10px' }}>
                Cette section Fournisseurs sert uniquement au suivi et au règlement des dettes. Pour enregistrer un nouvel achat matière première, utilisez la section Matières premières.
              </p>
              <Link to="/admin/raw-materials" className="btn btn-primary">
                Aller à Matières premières
              </Link>
            </div>

            <div className="card" style={{ margin: 0, marginBottom: '12px', padding: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
                <div>
                  <h3 style={{ marginBottom: '6px' }}>Action paiement fournisseur</h3>
                  <p className="form-hint">
                    Choisissez d&apos;abord l&apos;action: dette détaillée ou règlement global. Une seule interface s&apos;affiche à la fois.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${activeSupplierPaymentAction === 'outstanding_debts' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setActiveSupplierPaymentAction('outstanding_debts')}
                  >
                    Dettes a regler
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${activeSupplierPaymentAction === 'global_settlement' ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setActiveSupplierPaymentAction('global_settlement')}
                  >
                    Reglement global
                  </button>
                </div>
              </div>
              <div className="form-hint">
                {activeSupplierPaymentAction === 'outstanding_debts'
                  ? 'Mode dettes: vous reglez achat par achat pour garder le detail de chaque ingredient.'
                  : 'Mode global: vous reglez d\'un coup tous les ingredients impayes du fournisseur selectionne.'}
              </div>
            </div>

            {activeSupplierPaymentAction === 'global_settlement' ? (
              <div className="card supplier-bulk-settlement-card">
                <div className="supplier-bulk-settlement-header">
                  <div>
                    <h3 style={{ marginBottom: '6px' }}>Reglement global du fournisseur</h3>
                    <p className="form-hint">
                      Cette action regle uniquement les dettes du fournisseur selectionne (tous les ingredients impayes de ce fournisseur).
                    </p>
                  </div>
                  <div className={`supplier-bulk-settlement-amount ${totalOutstandingForSupplier <= 0 ? 'is-empty' : ''}`}>
                    {formatCurrency(totalOutstandingForSupplier)}
                  </div>
                </div>

                <div className="supplier-bulk-settlement-grid">
                  <label className="form-group" style={{ marginBottom: 0 }}>
                    <span>Mode de decaissement</span>
                    <select
                      className="admin-select"
                      value={bulkSettlementValue}
                      onChange={(event) => updateBulkPaymentField('settlement_option', event.target.value)}
                    >
                      {SUPPLIER_SETTLEMENT_OPTIONS.map((methodOption) => (
                        <option key={methodOption.value} value={methodOption.value}>{methodOption.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="form-group" style={{ marginBottom: 0 }}>
                    <span>Reference (optionnel)</span>
                    <input
                      className="admin-input"
                      type="text"
                      value={bulkPaymentForm.reference}
                      onChange={(event) => updateBulkPaymentField('reference', event.target.value)}
                      placeholder="Ex: REG-SUP-2026-04"
                    />
                  </label>

                  <label className="form-group supplier-bulk-settlement-note" style={{ marginBottom: 0 }}>
                    <span>Note (optionnel)</span>
                    <textarea
                      className="admin-input"
                      rows="2"
                      value={bulkPaymentForm.note}
                      onChange={(event) => updateBulkPaymentField('note', event.target.value)}
                      placeholder="Commentaire pour le reglement global"
                    />
                  </label>
                </div>

                <div className="supplier-bulk-settlement-meta">
                  <span>Achats impayes: <strong>{outstandingPurchasesCount}</strong></span>
                  <span>Compte debite: <strong>{bulkDebitAccountLabel}</strong></span>
                  <span>Solde disponible: <strong>{formatCurrency(bulkDebitAccountBalance)}</strong></span>
                </div>

                <div className="supplier-bulk-settlement-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSettleAllPurchases}
                    disabled={settlingAllPurchases || outstandingPurchasesCount <= 0 || totalOutstandingForSupplier <= 0}
                  >
                    {settlingAllPurchases ? 'Reglement...' : 'Regler toutes les dettes du fournisseur'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="card" style={{ margin: 0, marginBottom: '12px', padding: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <h3 style={{ marginBottom: 0 }}>Dettes a regler</h3>
                  <div className="supplier-ledger-active-pill">
                    <span>Fournisseur</span>
                    <strong>{selectedSupplier?.name || ledger?.supplier?.name || '-'}</strong>
                  </div>
                </div>
                <DataTable
                  columns={outstandingPurchaseColumns}
                  data={outstandingPurchases}
                  rowKey="id"
                  searchPlaceholder="Rechercher une dette a regler (matière, statut, date)..."
                  initialSort={{ key: 'purchased_at', direction: 'desc' }}
                  emptyMessage="Aucune dette a regler pour ce fournisseur."
                />
              </div>
            )}

            <div className="card" style={{ margin: 0, padding: '12px' }}>
              <h3 style={{ marginBottom: '8px' }}>Historique des achats regles</h3>
              <p className="form-hint" style={{ marginBottom: '10px' }}>
                Cette section affiche uniquement l&apos;historique deja regle, separe des dettes en cours.
              </p>
              <DataTable
                columns={historyPurchaseColumns}
                data={settledPurchases}
                rowKey="id"
                searchPlaceholder="Rechercher dans l'historique des paiements..."
                initialSort={{ key: 'purchased_at', direction: 'desc' }}
                emptyMessage="Aucun achat totalement regle pour ce fournisseur."
              />
            </div>
          </>
        )}
      </div>

      {showModal ? (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingSupplier ? 'Modifier Fournisseur' : 'Creer Fournisseur'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>

            <form onSubmit={handleSubmitSupplier}>
              <div className="form-group">
                <label>Nom</label>
                <input type="text" value={formData.name} onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))} required />
              </div>

              <div className="form-group">
                <label>Email</label>
                <input type="email" value={formData.email} onChange={(event) => setFormData((prev) => ({ ...prev, email: event.target.value }))} placeholder="optionnel" />
              </div>

              <div className="form-group">
                <label>Telephone</label>
                <input type="text" value={formData.phone} onChange={(event) => setFormData((prev) => ({ ...prev, phone: event.target.value }))} placeholder="optionnel" />
              </div>

              <div className="form-group">
                <label>Matieres premieres fournies</label>
                {rawMaterials.length === 0 ? (
                  <div className="form-hint">Aucune matiere premiere disponible.</div>
                ) : (
                  <div className="supplier-material-picker">
                    {rawMaterials.map((rawMaterial) => {
                      const checked = formData.raw_material_ids.includes(String(rawMaterial.id));
                      return (
                        <label
                          key={rawMaterial.id}
                          className={`supplier-material-option ${checked ? 'is-selected' : ''}`}
                        >
                          <input type="checkbox" checked={checked} onChange={() => toggleMaterial(rawMaterial.id)} />
                          <span className="supplier-material-name">{rawMaterial.name}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="form-group">
                <div className="supplier-new-materials-header">
                  <label style={{ marginBottom: 0 }}>Nouvelles matieres premieres (optionnel)</label>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={addNewRawMaterialRow}>
                    + Ajouter matiere
                  </button>
                </div>

                {newRawMaterials.length === 0 ? (
                  <div className="form-hint">Vous pouvez creer de nouvelles matieres ici et les lier directement a ce fournisseur.</div>
                ) : (
                  <div className="supplier-new-material-list">
                    {newRawMaterials.map((entry, index) => (
                      <div key={`new-raw-${index}`} className="supplier-new-material-card">
                        <div className="supplier-new-material-grid">
                          <label className="form-group" style={{ marginBottom: 0 }}>
                            <span>Nom *</span>
                            <input
                              type="text"
                              value={entry.name}
                              onChange={(event) => updateNewRawMaterialRow(index, 'name', event.target.value)}
                              placeholder="Ex: Rhum blanc"
                            />
                          </label>

                          <label className="form-group" style={{ marginBottom: 0 }}>
                            <span>Unite *</span>
                            <select
                              value={entry.unit}
                              onChange={(event) => updateNewRawMaterialRow(index, 'unit', event.target.value)}
                            >
                              {RAW_MATERIAL_UNIT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </label>

                          <label className="form-group" style={{ marginBottom: 0 }}>
                            <span>Stock initial *</span>
                            <input
                              type="number"
                              step="0.001"
                              min="0"
                              value={entry.stock}
                              onChange={(event) => updateNewRawMaterialRow(index, 'stock', event.target.value)}
                              placeholder="0"
                            />
                          </label>

                          <label className="form-group" style={{ marginBottom: 0 }}>
                            <span>Cout unitaire (Ar) *</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={entry.cost}
                              onChange={(event) => updateNewRawMaterialRow(index, 'cost', event.target.value)}
                              placeholder="0"
                            />
                          </label>

                          <label className="form-group" style={{ marginBottom: 0 }}>
                            <span>Seuil alerte</span>
                            <input
                              type="number"
                              step="0.001"
                              min="0"
                              value={entry.reorder_level}
                              onChange={(event) => updateNewRawMaterialRow(index, 'reorder_level', event.target.value)}
                              placeholder="5"
                            />
                          </label>
                        </div>

                        <label className="form-group" style={{ marginBottom: 0 }}>
                          <span>Description</span>
                          <textarea
                            rows="2"
                            value={entry.description}
                            onChange={(event) => updateNewRawMaterialRow(index, 'description', event.target.value)}
                            placeholder="Optionnel"
                          />
                        </label>

                        <div className="supplier-new-material-actions">
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => removeNewRawMaterialRow(index)}>
                            Retirer
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Annuler</button>
                <button type="submit" className="btn btn-primary">{editingSupplier ? 'Modifier' : 'Creer'}</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default SupplierManagement;
