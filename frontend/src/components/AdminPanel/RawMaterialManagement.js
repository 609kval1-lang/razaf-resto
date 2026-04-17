import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { adminAPI } from '../../services/api';
import { RAW_MATERIAL_UNIT_OPTIONS } from '../../utils/units';
import DataTable from '../common/DataTable';
import { useDialog } from '../common/DialogProvider';
import { useToast } from '../common/ToastProvider';
import { normalizePaymentMethod } from '../../utils/paymentMethods';

const formatAr = (value) => {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} Ar`;
};

const formatSignedPercent = (value, digits = 2) => {
  const amount = Number(value || 0);
  const prefix = amount > 0 ? '+' : '';
  return `${prefix}${amount.toFixed(digits)}%`;
};

const formatDateTime = (value) => {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const priceTrendMetaMap = {
  up: { label: 'Hausse', className: 'price-trend up' },
  down: { label: 'Baisse', className: 'price-trend down' },
  stable: { label: 'Stable', className: 'price-trend stable' },
};

const formatQty = (value) => {
  const qty = Number(value || 0);
  if (Number.isInteger(qty)) {
    return qty.toString();
  }

  return qty.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
};

const getTodayDateInputValue = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getFutureDateInputValue = (daysToAdd = 30) => {
  const future = new Date(Date.now() + (daysToAdd * 24 * 60 * 60 * 1000));
  const year = future.getFullYear();
  const month = String(future.getMonth() + 1).padStart(2, '0');
  const day = String(future.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const createDefaultFormData = (hasSuppliers = false) => ({
  name: '',
  description: '',
  stock: 0,
  unit: 'kg',
  cost: 0,
  reorder_level: 10,
  stock_update_mode: 'purchase',
  purchase_unit_price: '',
  preferred_supplier_id: '',
  supplier_mode: hasSuppliers ? 'existing' : 'new',
  supplier_id: '',
  new_supplier_name: '',
  new_supplier_email: '',
  new_supplier_phone: '',
  purchase_payment_mode: 'credit',
  purchase_initial_paid_amount: '',
  purchase_payment_method: 'cash',
  purchase_cash_source_account: 'cash',
  purchase_due_date: getFutureDateInputValue(30),
  purchase_reference: '',
  purchase_note: '',
});

const createExistingPurchaseDraft = () => ({
  supplier_id: '',
  raw_material_id: '',
  quantity: '',
  unit_price: '',
  payment_mode: 'credit',
  initial_paid_amount: '',
  payment_method: 'cash',
  cash_source_account: 'cash',
  due_date: getFutureDateInputValue(30),
  purchased_at: getTodayDateInputValue(),
  reference: '',
  note: '',
});

const RAW_MATERIAL_PURCHASE_SETTLEMENT_OPTIONS = [
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

const getRawMaterialPurchaseSettlementValue = (method, cashSourceAccount = 'cash') => {
  const normalizedMethod = normalizePaymentMethod(method);

  if (normalizedMethod === 'cash') {
    return cashSourceAccount === 'safe' ? 'safe' : 'cash';
  }

  if (RAW_MATERIAL_PURCHASE_SETTLEMENT_OPTIONS.some((option) => option.value === normalizedMethod)) {
    return normalizedMethod;
  }

  return 'cash';
};

const getRawMaterialPurchaseSettlementConfig = (value) => {
  return RAW_MATERIAL_PURCHASE_SETTLEMENT_OPTIONS.find((option) => option.value === value)
    || RAW_MATERIAL_PURCHASE_SETTLEMENT_OPTIONS[0];
};

const applyRawMaterialPurchaseSettlementSelection = (value, previous = {}) => {
  const selection = getRawMaterialPurchaseSettlementConfig(value);

  return {
    ...previous,
    purchase_payment_method: selection.payment_method,
    purchase_cash_source_account: selection.cash_source_account || 'cash',
  };
};

const getRawMaterialCreateDraftTotal = (formData) => {
  const quantity = Number(formData?.stock || 0);
  const unitPrice = Number(formData?.cost || 0);

  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice) || quantity <= 0 || unitPrice <= 0) {
    return 0;
  }

  return Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;
};

const getRawMaterialCreateDraftInitialPaid = (formData, totalAmount) => {
  const rawInitialPaid = formData?.purchase_initial_paid_amount;

  if (rawInitialPaid === '' || rawInitialPaid === null || rawInitialPaid === undefined) {
    return formData?.purchase_payment_mode === 'cash' ? totalAmount : 0;
  }

  const amount = Number(rawInitialPaid || 0);
  if (!Number.isFinite(amount) || amount < 0) {
    return 0;
  }

  return Math.round((Math.min(amount, totalAmount) + Number.EPSILON) * 100) / 100;
};

const getRawMaterialExistingPurchaseTotal = (purchaseDraft) => {
  const quantity = Number(purchaseDraft?.quantity || 0);
  const unitPrice = Number(purchaseDraft?.unit_price || 0);

  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice) || quantity <= 0 || unitPrice <= 0) {
    return 0;
  }

  return Math.round((quantity * unitPrice + Number.EPSILON) * 100) / 100;
};

const getRawMaterialExistingPurchaseInitialPaid = (purchaseDraft, totalAmount) => {
  const rawInitialPaid = purchaseDraft?.initial_paid_amount;

  if (rawInitialPaid === '' || rawInitialPaid === null || rawInitialPaid === undefined) {
    return purchaseDraft?.payment_mode === 'cash' ? totalAmount : 0;
  }

  const amount = Number(rawInitialPaid || 0);
  if (!Number.isFinite(amount) || amount < 0) {
    return 0;
  }

  return Math.round((Math.min(amount, totalAmount) + Number.EPSILON) * 100) / 100;
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

const extractErrorMessage = (error, fallbackMessage) => {
  const response = error?.response?.data;
  if (response?.errors && typeof response.errors === 'object') {
    const firstError = Object.values(response.errors).flat().find((value) => typeof value === 'string');
    if (firstError) return firstError;
  }

  if (typeof response?.message === 'string' && response.message.trim() !== '') {
    return response.message;
  }

  return fallbackMessage;
};

const RawMaterialManagement = () => {
  const location = useLocation();
  const { confirm } = useDialog();
  const { showToast } = useToast();
  const [materials, setMaterials] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [priceVariations, setPriceVariations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editingMaterial, setEditingMaterial] = useState(null);
  const [formData, setFormData] = useState(() => createDefaultFormData(false));
  const [purchaseForm, setPurchaseForm] = useState(() => createExistingPurchaseDraft());
  const [message, setMessage] = useState('');
  const [treasuryBalances, setTreasuryBalances] = useState(DEFAULT_TREASURY_BALANCES);
  const lastToastKeyRef = useRef('');
  const purchaseSectionRef = useRef(null);
  const purchasePrefillHandledRef = useRef(false);

  useEffect(() => {
    loadPageData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const text = String(message || '').trim();
    if (!text) {
      lastToastKeyRef.current = '';
      return;
    }

    const lowered = text.toLowerCase();
    const type = (
      lowered.includes('erreur')
      || lowered.includes('impossible')
      || lowered.includes('invalide')
    ) ? 'error' : (lowered.includes('annul') ? 'info' : 'success');

    const key = `${type}:${text}`;
    if (lastToastKeyRef.current === key) {
      return;
    }

    lastToastKeyRef.current = key;
    showToast({ type, message: text });
  }, [message, showToast]);

  const loadMaterials = async () => {
    try {
      const response = await adminAPI.getRawMaterials();
      setMaterials(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Impossible de charger les matières premières')}`);
    }
  };

  const loadSuppliers = async () => {
    try {
      const response = await adminAPI.getSuppliers();
      setSuppliers(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Impossible de charger les fournisseurs')}`);
    }
  };

  const loadPriceVariations = async () => {
    try {
      const response = await adminAPI.getRawMaterialPriceVariations();
      const variations = Array.isArray(response?.data?.variations) ? response.data.variations : [];
      setPriceVariations(variations);
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Impossible de charger les variations de prix')}`);
    }
  };

  const loadTreasuryBalances = async () => {
    try {
      const response = await adminAPI.getTreasurySnapshot();
      setTreasuryBalances(extractTreasuryBalances(response?.data));
    } catch (_error) {
      setTreasuryBalances(DEFAULT_TREASURY_BALANCES);
    }
  };

  const loadPageData = async () => {
    setLoading(true);
    await Promise.all([loadMaterials(), loadSuppliers(), loadPriceVariations(), loadTreasuryBalances()]);
    setLoading(false);
  };

  useEffect(() => {
    if (!showModal || editingMaterial || suppliers.length > 0 || formData.supplier_mode !== 'existing') {
      return;
    }

    setFormData((previous) => ({
      ...previous,
      supplier_mode: 'new',
      supplier_id: '',
    }));
  }, [editingMaterial, formData.supplier_mode, showModal, suppliers.length]);

  useEffect(() => {
    if (purchasePrefillHandledRef.current) {
      return;
    }

    const params = new URLSearchParams(location.search);
    const action = String(params.get('action') || '').trim().toLowerCase();
    const supplierIdParam = Number(params.get('supplier_id') || 0);
    const hasPurchaseAction = action === 'purchase';
    const hasSupplierPrefill = Number.isFinite(supplierIdParam) && supplierIdParam > 0;

    if (!hasPurchaseAction && !hasSupplierPrefill) {
      purchasePrefillHandledRef.current = true;
      return;
    }

    if (loading) {
      return;
    }

    if (hasSupplierPrefill && suppliers.some((supplier) => Number(supplier.id) === supplierIdParam)) {
      setPurchaseForm((previous) => ({
        ...previous,
        supplier_id: String(supplierIdParam),
      }));
    }

    if (hasPurchaseAction) {
      window.setTimeout(() => {
        if (purchaseSectionRef.current) {
          purchaseSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 80);
    }

    purchasePrefillHandledRef.current = true;
  }, [loading, location.search, suppliers]);

  const getStockStatus = (stock, reorderLevel) => {
    const value = Number(stock || 0);
    const threshold = Number(reorderLevel || 0);

    if (threshold <= 0) {
      return value <= 0 ? 'low' : 'good';
    }

    const ratio = (value / threshold) * 100;

    if (ratio < 75) return 'low';
    if (ratio <= 100) return 'warning';
    return 'good';
  };

  const getStockStatusLabel = (status) => {
    const labels = {
      low: 'Critique',
      warning: 'Sous seuil',
      good: 'Stable',
    };

    return labels[status] || 'Stable';
  };

  const getStockRatio = (stock, reorderLevel) => {
    const value = Number(stock || 0);
    const threshold = Number(reorderLevel || 0);

    if (threshold <= 0) {
      return 100;
    }

    return Math.max(0, Math.min(220, (value / threshold) * 100));
  };

  const materialsWithMeta = useMemo(() => {
    const statusPriority = {
      low: 0,
      warning: 1,
      good: 2,
    };

    return materials.map((material) => {
      const stockStatus = getStockStatus(material.stock, material.reorder_level);
      const ratio = getStockRatio(material.stock, material.reorder_level);
      const stockValue = Number(material.stock || 0) * Number(material.cost || 0);

      return {
        ...material,
        stockStatus,
        ratio,
        stockValue,
      };
    }).sort((left, right) => {
      const byStatus = (statusPriority[left.stockStatus] ?? 9) - (statusPriority[right.stockStatus] ?? 9);
      if (byStatus !== 0) {
        return byStatus;
      }

      const byRatio = left.ratio - right.ratio;
      if (byRatio !== 0) {
        return byRatio;
      }

      return String(left.name || '').localeCompare(String(right.name || ''));
    });
  }, [materials]);

  const stockSummary = useMemo(() => {
    const totalItems = materialsWithMeta.length;
    const lowCount = materialsWithMeta.filter((material) => material.stockStatus === 'low').length;
    const warningCount = materialsWithMeta.filter((material) => material.stockStatus === 'warning').length;
    const totalValue = materialsWithMeta.reduce((sum, material) => sum + material.stockValue, 0);

    return {
      totalItems,
      lowCount,
      warningCount,
      totalValue,
      alertCount: lowCount + warningCount,
    };
  }, [materialsWithMeta]);

  const priceVariationSummary = useMemo(() => {
    const summaryData = priceVariations.reduce((acc, row) => {
      const trend = String(row?.trend || 'stable');
      if (trend === 'up') {
        acc.up += 1;
      } else if (trend === 'down') {
        acc.down += 1;
      } else {
        acc.stable += 1;
      }
      return acc;
    }, { up: 0, down: 0, stable: 0 });

    summaryData.total = priceVariations.length;
    return summaryData;
  }, [priceVariations]);

  const materialUnitOptions = useMemo(() => {
    const currentUnit = String(formData.unit || '');
    const exists = RAW_MATERIAL_UNIT_OPTIONS.some((option) => option.value === currentUnit);
    if (!currentUnit || exists) {
      return RAW_MATERIAL_UNIT_OPTIONS;
    }

    return [{ value: currentUnit, label: `${currentUnit} (unité existante)` }, ...RAW_MATERIAL_UNIT_OPTIONS];
  }, [formData.unit]);

  const createPurchaseTotal = getRawMaterialCreateDraftTotal(formData);
  const createPurchaseInitialPaid = getRawMaterialCreateDraftInitialPaid(formData, createPurchaseTotal);
  const createPurchaseRemaining = Math.max(0, Math.round(((createPurchaseTotal - createPurchaseInitialPaid) + Number.EPSILON) * 100) / 100);
  const createPurchaseSettlementValue = getRawMaterialPurchaseSettlementValue(formData.purchase_payment_method, formData.purchase_cash_source_account);
  const createPurchaseSettlementConfig = getRawMaterialPurchaseSettlementConfig(createPurchaseSettlementValue);
  const createPurchaseDebitBalance = Number(treasuryBalances?.[createPurchaseSettlementConfig.debit_account] || 0);
  const selectedExistingPurchaseMaterial = useMemo(
    () => materials.find((material) => Number(material.id) === Number(purchaseForm.raw_material_id)) || null,
    [materials, purchaseForm.raw_material_id],
  );
  const selectedExistingPurchaseSupplier = useMemo(
    () => suppliers.find((supplier) => Number(supplier.id) === Number(purchaseForm.supplier_id)) || null,
    [suppliers, purchaseForm.supplier_id],
  );
  const existingPurchaseSuggestedSuppliers = useMemo(() => {
    if (!selectedExistingPurchaseMaterial) {
      return suppliers;
    }

    const materialSupplierIds = Array.isArray(selectedExistingPurchaseMaterial.suppliers)
      ? selectedExistingPurchaseMaterial.suppliers.map((supplier) => Number(supplier?.id || 0)).filter((id) => Number.isFinite(id) && id > 0)
      : [];

    if (materialSupplierIds.length === 0) {
      return suppliers;
    }

    const filtered = suppliers.filter((supplier) => materialSupplierIds.includes(Number(supplier.id)));
    return filtered.length > 0 ? filtered : suppliers;
  }, [selectedExistingPurchaseMaterial, suppliers]);
  const existingPurchaseTotal = getRawMaterialExistingPurchaseTotal(purchaseForm);
  const existingPurchaseInitialPaid = getRawMaterialExistingPurchaseInitialPaid(purchaseForm, existingPurchaseTotal);
  const existingPurchaseRemaining = Math.max(0, Math.round(((existingPurchaseTotal - existingPurchaseInitialPaid) + Number.EPSILON) * 100) / 100);
  const existingPurchaseSettlementValue = getRawMaterialPurchaseSettlementValue(purchaseForm.payment_method, purchaseForm.cash_source_account);
  const existingPurchaseSettlementConfig = getRawMaterialPurchaseSettlementConfig(existingPurchaseSettlementValue);
  const existingPurchaseDebitBalance = Number(treasuryBalances?.[existingPurchaseSettlementConfig.debit_account] || 0);

  const alertMaterials = useMemo(() => {
    return materialsWithMeta
      .filter((material) => ['low', 'warning'].includes(material.stockStatus))
      .sort((left, right) => left.stockStatus.localeCompare(right.stockStatus) || String(left.name).localeCompare(String(right.name)));
  }, [materialsWithMeta]);

  const renderAvailablePortions = (material) => {
    const ingredients = Array.isArray(material?.ingredients) ? material.ingredients : [];
    const totalAvailablePortions = Number(material?.available_portions_total || 0);

    if (ingredients.length === 0) {
      return <span>-</span>;
    }

    return (
      <div className="raw-material-portions">
        <strong>{totalAvailablePortions} portion(s)</strong>
        <div className="raw-material-portions-list">
          {ingredients.map((ingredient) => (
            <span key={`${material.id}-${ingredient.id}`}>
              {ingredient.name}: {formatQty(ingredient.quantity_available)} portion(s)
            </span>
          ))}
        </div>
      </div>
    );
  };

  const rawMaterialColumns = [
    {
      key: 'name',
      header: 'Nom',
      sortAccessor: (material) => material.name,
      searchAccessor: (material) => `${material.name} ${material.description || ''}`,
      render: (material) => (
        <>
          <strong>{material.name}</strong>
          {material.description ? <div style={{ fontSize: '0.8em', color: '#666' }}>{material.description}</div> : null}
        </>
      ),
    },
    {
      key: 'stock',
      header: 'Stock',
      sortType: 'number',
      sortAccessor: (material) => Number(material.stock || 0),
      searchAccessor: (material) => `${material.stock} ${material.unit}`,
      render: (material) => `${formatQty(material.stock)} ${material.unit}`,
    },
    {
      key: 'reorder_level',
      header: 'Seuil limite',
      sortType: 'number',
      sortAccessor: (material) => Number(material.reorder_level || 0),
      searchAccessor: (material) => `${material.reorder_level} ${material.unit}`,
      render: (material) => `${formatQty(material.reorder_level)} ${material.unit}`,
    },
    {
      key: 'ratio',
      header: 'Niveau vs seuil',
      sortType: 'number',
      sortAccessor: (material) => Number(material.ratio || 0),
      searchAccessor: (material) => `${material.ratio}% ${getStockStatusLabel(material.stockStatus)}`,
      render: (material) => (
        <div className="stock-limit-indicator">
          <div className="stock-limit-track">
            <div
              className={`stock-limit-fill ${material.stockStatus}`}
              style={{ width: `${Math.min(100, material.ratio)}%` }}
            />
          </div>
          <small>{material.ratio.toFixed(0)}% du seuil</small>
        </div>
      ),
    },
    {
      key: 'unit',
      header: 'Unité',
      sortAccessor: (material) => material.unit,
      searchAccessor: (material) => material.unit,
      render: (material) => material.unit,
    },
    {
      key: 'cost',
      header: 'Coût unitaire',
      sortType: 'number',
      sortAccessor: (material) => Number(material.cost || 0),
      searchAccessor: (material) => String(material.cost || ''),
      render: (material) => `${formatAr(material.cost)}/${material.unit}`,
    },
    {
      key: 'available_portions_total',
      header: 'Portions disponibles',
      sortType: 'number',
      sortAccessor: (material) => Number(material.available_portions_total || 0),
      searchAccessor: (material) => {
        const ingredients = Array.isArray(material?.ingredients) ? material.ingredients : [];
        return `${material.available_portions_total || 0} ${ingredients.map((ingredient) => `${ingredient.name} ${ingredient.quantity_available || 0}`).join(' ')}`;
      },
      render: (material) => renderAvailablePortions(material),
    },
    {
      key: 'suppliers',
      header: 'Fournisseurs',
      sortAccessor: (material) => (
        Array.isArray(material.suppliers)
          ? material.suppliers.map((supplier) => supplier?.name).filter(Boolean).join(', ')
          : ''
      ),
      searchAccessor: (material) => (
        Array.isArray(material.suppliers)
          ? material.suppliers.map((supplier) => supplier?.name).filter(Boolean).join(' ')
          : ''
      ),
      render: (material) => {
        const supplierNames = Array.isArray(material.suppliers)
          ? material.suppliers.map((supplier) => supplier?.name).filter(Boolean)
          : [];
        return supplierNames.length > 0 ? supplierNames.join(', ') : '-';
      },
    },
    {
      key: 'status',
      header: 'Statut brut',
      sortAccessor: (material) => getStockStatusLabel(material.stockStatus),
      searchAccessor: (material) => getStockStatusLabel(material.stockStatus),
      render: (material) => (
        <span className={`stock-status ${material.stockStatus}`}>
          {material.stockStatus === 'low' ? '🔴 ' : material.stockStatus === 'warning' ? '🟡 ' : '🟢 '}
          {getStockStatusLabel(material.stockStatus)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      sortable: false,
      searchable: false,
      render: (material) => (
        <div className="actions">
          <button className="btn btn-secondary btn-sm" onClick={() => handleEdit(material)}>
            ✏️
          </button>
          <button className="btn btn-danger btn-sm" onClick={() => requestDelete(material)}>
            🗑️
          </button>
        </div>
      ),
    },
  ];

  const priceVariationColumns = [
    {
      key: 'raw_material_name',
      header: 'Matière première',
      sortAccessor: (row) => row.raw_material_name || '',
      searchAccessor: (row) => row.raw_material_name || '',
      render: (row) => row.raw_material_name || '-',
    },
    {
      key: 'trend',
      header: 'Tendance',
      sortAccessor: (row) => row.trend || '',
      searchAccessor: (row) => row.trend || '',
      render: (row) => {
        const trend = priceTrendMetaMap[row.trend] || priceTrendMetaMap.stable;
        return <span className={trend.className}>{trend.label}</span>;
      },
    },
    {
      key: 'previous_unit_price',
      header: 'Prix précédent',
      sortType: 'number',
      sortAccessor: (row) => Number(row.previous_unit_price || 0),
      searchAccessor: (row) => String(row.previous_unit_price || ''),
      render: (row) => `${formatAr(row.previous_unit_price)} / ${row.unit || '-'}`,
    },
    {
      key: 'latest_unit_price',
      header: 'Prix actuel',
      sortType: 'number',
      sortAccessor: (row) => Number(row.latest_unit_price || 0),
      searchAccessor: (row) => String(row.latest_unit_price || ''),
      render: (row) => `${formatAr(row.latest_unit_price)} / ${row.unit || '-'}`,
    },
    {
      key: 'variation_amount',
      header: 'Écart',
      sortType: 'number',
      sortAccessor: (row) => Number(row.variation_amount || 0),
      searchAccessor: (row) => String(row.variation_amount || ''),
      render: (row) => formatAr(row.variation_amount),
    },
    {
      key: 'variation_percent',
      header: 'Variation',
      sortType: 'number',
      sortAccessor: (row) => Number(row.variation_percent || 0),
      searchAccessor: (row) => String(row.variation_percent || ''),
      render: (row) => formatSignedPercent(row.variation_percent, 2),
    },
    {
      key: 'changed_by_name',
      header: 'Modifié par',
      sortAccessor: (row) => row.changed_by_name || '',
      searchAccessor: (row) => row.changed_by_name || '',
      render: (row) => row.changed_by_name || '-',
    },
    {
      key: 'latest_change_at',
      header: 'Dernière modif.',
      sortType: 'date',
      sortAccessor: (row) => row.latest_change_at || '',
      searchAccessor: (row) => formatDateTime(row.latest_change_at),
      render: (row) => formatDateTime(row.latest_change_at),
    },
  ];

  const updateCreatePurchaseField = (key, value) => {
    setFormData((previous) => {
      if (key === 'purchase_settlement_option') {
        return applyRawMaterialPurchaseSettlementSelection(value, previous);
      }

      return {
        ...previous,
        [key]: value,
      };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      const stockValue = Number(formData.stock || 0);
      const costValue = Number(formData.cost || 0);
      const reorderLevelValue = Number(formData.reorder_level || 0);

      if (!Number.isFinite(stockValue) || stockValue < 0) {
        setMessage('Erreur: le stock doit etre un nombre positif');
        return;
      }

      if (!Number.isFinite(costValue) || costValue < 0) {
        setMessage('Erreur: le cout unitaire doit etre un nombre positif');
        return;
      }

      if (!Number.isFinite(reorderLevelValue) || reorderLevelValue < 0) {
        setMessage('Erreur: le seuil de reapprovisionnement doit etre un nombre positif');
        return;
      }

      if (!editingMaterial && stockValue < 0) {
        setMessage('Erreur: le stock initial doit etre un nombre positif ou nul');
        return;
      }

      if (!editingMaterial && costValue <= 0) {
        setMessage('Erreur: le cout unitaire doit etre superieur a 0');
        return;
      }

      const payload = {
        name: formData.name,
        description: formData.description || null,
        stock: stockValue,
        unit: formData.unit,
        cost: costValue,
        reorder_level: reorderLevelValue,
      };

      if (editingMaterial) {
        const previousStock = Number(editingMaterial.stock || 0);
        const isStockIncrease = stockValue > previousStock;
        const preferredSupplierId = Number(formData.preferred_supplier_id);

        if (Number.isFinite(preferredSupplierId) && preferredSupplierId > 0) {
          payload.supplier_id = preferredSupplierId;
        }

        if (isStockIncrease) {
          payload.stock_update_mode = formData.stock_update_mode || 'purchase';

          if (payload.stock_update_mode === 'purchase') {
            const purchaseUnitPrice = formData.purchase_unit_price === ''
              ? costValue
              : Number(formData.purchase_unit_price);

            if (!Number.isFinite(purchaseUnitPrice) || purchaseUnitPrice < 0) {
              setMessage('Erreur: le prix d\'achat doit etre un nombre positif');
              return;
            }

            payload.purchase_unit_price = purchaseUnitPrice;
          }

          const stockIncreaseQuantity = Math.max(0, stockValue - previousStock);
          const stockIncreaseLabel = `${formatQty(stockIncreaseQuantity)} ${formData.unit}`;
          const confirmation = await confirm({
            title: payload.stock_update_mode === 'purchase'
              ? 'Confirmer un nouvel achat'
              : 'Confirmer un ajout sans achat',
            message: payload.stock_update_mode === 'purchase'
              ? `Vous allez ajouter ${stockIncreaseLabel} comme nouvel achat fournisseur. La dette fournisseur sera mise a jour.`
              : `Vous allez ajouter ${stockIncreaseLabel} sans creer d'achat fournisseur. Voulez-vous continuer ?`,
            confirmText: payload.stock_update_mode === 'purchase' ? 'Enregistrer achat' : 'Ajouter sans achat',
            cancelText: 'Annuler',
            tone: 'primary',
          });

          if (!confirmation) {
            setMessage('Action annulée: aucun changement appliqué.');
            return;
          }
        }

        await adminAPI.updateRawMaterial(editingMaterial.id, payload);
        if (isStockIncrease && payload.stock_update_mode === 'purchase') {
          setMessage('Matiere premiere modifiee et achat fournisseur enregistre');
        } else if (isStockIncrease) {
          setMessage('Matiere premiere modifiee avec ajout manuel du stock (sans achat fournisseur)');
        } else {
          setMessage('Matiere premiere modifiee avec succes');
        }
      } else {
        if (formData.supplier_mode === 'existing') {
          const supplierId = Number(formData.supplier_id);
          if (!Number.isFinite(supplierId) || supplierId <= 0) {
            setMessage('Erreur: sélectionnez un fournisseur existant');
            return;
          }

          payload.supplier_id = supplierId;
        } else {
          const supplierName = String(formData.new_supplier_name || '').trim();
          if (!supplierName) {
            setMessage('Erreur: le nom du nouveau fournisseur est obligatoire');
            return;
          }

          payload.new_supplier = {
            name: supplierName,
            email: formData.new_supplier_email ? String(formData.new_supplier_email).trim() : null,
            phone: formData.new_supplier_phone ? String(formData.new_supplier_phone).trim() : null,
          };
        }

        const purchasePaymentMode = formData.purchase_payment_mode === 'cash' ? 'cash' : 'credit';
        const purchasePaymentMethod = normalizePaymentMethod(createPurchaseSettlementConfig.payment_method || 'cash') || 'cash';
        const purchaseCashSourceAccount = purchasePaymentMethod === 'cash'
          ? (createPurchaseSettlementConfig.cash_source_account || 'cash')
          : null;
        const rawInitialPaidAmount = purchasePaymentMode === 'cash'
          ? createPurchaseTotal
          : createPurchaseInitialPaid;
        const initialPaidAmount = Math.max(0, Math.min(createPurchaseTotal, Number(rawInitialPaidAmount || 0)));
        const remainingAmount = Math.max(0, Math.round(((createPurchaseTotal - initialPaidAmount) + Number.EPSILON) * 100) / 100);
        const purchaseDueDate = remainingAmount > 0
          ? (formData.purchase_due_date ? String(formData.purchase_due_date) : null)
          : null;

        if (remainingAmount > 0 && !purchaseDueDate) {
          setMessage('Erreur: une date d\'echeance est obligatoire si la matiere premiere n\'est pas reglee integralement.');
          return;
        }

        payload.purchase_payment_mode = purchasePaymentMode;
        payload.purchase_initial_paid_amount = Number.isFinite(initialPaidAmount) ? initialPaidAmount : 0;
        payload.purchase_payment_method = purchasePaymentMethod;
        payload.purchase_cash_source_account = purchaseCashSourceAccount;
        payload.purchase_due_date = purchaseDueDate;
        payload.purchase_reference = formData.purchase_reference ? String(formData.purchase_reference).trim() : null;
        payload.purchase_note = formData.purchase_note ? String(formData.purchase_note).trim() : null;

        await adminAPI.createRawMaterial(payload);
        setMessage('Matière première créée avec achat fournisseur initial enregistré');
      }

      setShowModal(false);
      resetForm();
      await Promise.all([loadMaterials(), loadSuppliers(), loadPriceVariations()]);
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Erreur lors de la sauvegarde')}`);
    }
  };

  const handleEdit = (material) => {
    const materialSupplierId = Array.isArray(material?.suppliers) && material.suppliers.length > 0
      ? Number(material.suppliers[0]?.id || 0)
      : 0;

    setEditingMaterial(material);
    setFormData({
      ...createDefaultFormData(suppliers.length > 0),
      name: material.name || '',
      description: material.description || '',
      stock: Number(material.stock || 0),
      unit: material.unit || 'kg',
      cost: Number(material.cost || 0),
      reorder_level: Number(material.reorder_level || 0),
      preferred_supplier_id: materialSupplierId > 0 ? String(materialSupplierId) : '',
      purchase_unit_price: Number(material.cost || 0),
      stock_update_mode: 'purchase',
    });
    setShowModal(true);
  };

  const requestDelete = (material) => {
    setDeleteTarget(material);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }

    try {
      await adminAPI.deleteRawMaterial(deleteTarget.id);
      setMessage('Matière première supprimée avec succès');
      setDeleteTarget(null);
      await Promise.all([loadMaterials(), loadSuppliers(), loadPriceVariations()]);
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Erreur lors de la suppression')}`);
    }
  };

  const resetForm = () => {
    setFormData(createDefaultFormData(suppliers.length > 0));
    setEditingMaterial(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const previousStockInEdit = Number(editingMaterial?.stock || 0);
  const currentStockInForm = Number(formData.stock || 0);
  const isEditStockIncrease = Boolean(editingMaterial) && Number.isFinite(currentStockInForm) && currentStockInForm > previousStockInEdit;

  if (loading) {
    return <div className="loading">Chargement des matières premières...</div>;
  }

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', gap: '10px', flexWrap: 'wrap' }}>
          <h2>📦 Gestion des Matières Premières</h2>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => setShowAlertModal(true)} disabled={stockSummary.alertCount === 0}>
              ⚠️ Alertes stock brut ({stockSummary.alertCount})
            </button>
            <button className="btn btn-primary" onClick={openCreateModal}>
              ➕ Ajouter Matière Première
            </button>
          </div>
        </div>

        <div className="stock-summary-grid">
          <div className="stock-summary-card">
            <span>Total matières</span>
            <strong>{stockSummary.totalItems}</strong>
          </div>
          <div className="stock-summary-card danger">
            <span>En alerte critique</span>
            <strong>{stockSummary.lowCount}</strong>
          </div>
          <div className="stock-summary-card warning">
            <span>Stock limité</span>
            <strong>{stockSummary.warningCount}</strong>
          </div>
          <div className="stock-summary-card success">
            <span>Valeur stock brut</span>
            <strong>{formatAr(stockSummary.totalValue)}</strong>
          </div>
        </div>

        {message && (
          <div className={`message ${message.includes('Erreur') ? 'error-message' : 'success-message'}`}>
            {message}
          </div>
        )}

        <DataTable
          columns={rawMaterialColumns}
          data={materialsWithMeta}
          rowKey="id"
          searchPlaceholder="Rechercher une matière (nom, fournisseur, statut, unité, portions)..."
          initialSort={{ key: 'ratio', direction: 'asc' }}
          emptyMessage="Aucune matière première trouvée."
        />
      </div>

      <div className="card">
        <h3>🧾 Variation coût matières premières</h3>
        <div className="pricing-insights-grid">
          <div className="pricing-insight-card up">
            <span>En hausse</span>
            <strong>{priceVariationSummary.up}</strong>
          </div>
          <div className="pricing-insight-card down">
            <span>En baisse</span>
            <strong>{priceVariationSummary.down}</strong>
          </div>
          <div className="pricing-insight-card stable">
            <span>Stables</span>
            <strong>{priceVariationSummary.stable}</strong>
          </div>
          <div className="pricing-insight-card neutral">
            <span>Total matières suivies</span>
            <strong>{priceVariationSummary.total}</strong>
          </div>
        </div>

        <DataTable
          columns={priceVariationColumns}
          data={priceVariations}
          rowKey={(row) => row.raw_material_id}
          searchPlaceholder="Rechercher une variation de prix matière..."
          initialSort={{ key: 'variation_percent', direction: 'desc' }}
          emptyMessage="Aucune variation de coût disponible."
        />
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingMaterial ? 'Modifier Matière Première' : 'Créer Matière Première'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Nom</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(event) => setFormData({ ...formData, name: event.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  rows="2"
                  value={formData.description}
                  onChange={(event) => setFormData({ ...formData, description: event.target.value })}
                  placeholder="Optionnel"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Stock disponible</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.stock}
                    onChange={(event) => setFormData({ ...formData, stock: event.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Unité</label>
                  <select
                    value={formData.unit}
                    onChange={(event) => setFormData({ ...formData, unit: event.target.value })}
                    required
                  >
                    {materialUnitOptions.map((unitOption) => (
                      <option key={unitOption.value} value={unitOption.value}>
                        {unitOption.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Coût unitaire (Ar)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.cost}
                    onChange={(event) => setFormData({ ...formData, cost: event.target.value })}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Seuil de réapprovisionnement</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.reorder_level}
                    onChange={(event) => setFormData({ ...formData, reorder_level: event.target.value })}
                    required
                  />
                </div>
              </div>

              {editingMaterial ? (
                <>
                  <div className="form-group">
                    <label>Fournisseur principal (optionnel)</label>
                    <select
                      value={formData.preferred_supplier_id}
                      onChange={(event) => setFormData((previous) => ({ ...previous, preferred_supplier_id: event.target.value }))}
                    >
                      <option value="">Conserver fournisseur actuel</option>
                      {suppliers.map((supplier) => (
                        <option key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </option>
                      ))}
                    </select>
                    <div className="form-hint">
                      Choisissez un fournisseur pour ce réapprovisionnement ou pour lier cette matière à un nouveau fournisseur.
                    </div>
                  </div>

                  {isEditStockIncrease ? (
                    <>
                      <div className="form-group">
                        <label>Mode d'ajustement du stock</label>
                        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <input
                              type="radio"
                              name="stock_update_mode"
                              value="purchase"
                              checked={formData.stock_update_mode === 'purchase'}
                              onChange={() => setFormData((previous) => ({ ...previous, stock_update_mode: 'purchase' }))}
                            />
                            Nouvel achat matière première (génère une dette)
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <input
                              type="radio"
                              name="stock_update_mode"
                              value="manual"
                              checked={formData.stock_update_mode === 'manual'}
                              onChange={() => setFormData((previous) => ({ ...previous, stock_update_mode: 'manual' }))}
                            />
                            Ajout simple de stock (sans achat)
                          </label>
                        </div>
                      </div>

                      {formData.stock_update_mode === 'purchase' ? (
                        <div className="form-group">
                          <label>Prix d'achat unitaire (Ar)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={formData.purchase_unit_price}
                            onChange={(event) => setFormData((previous) => ({ ...previous, purchase_unit_price: event.target.value }))}
                            required
                          />
                        </div>
                      ) : (
                        <div className="form-hint" style={{ marginBottom: '12px' }}>
                          Aucun achat fournisseur ne sera créé pour cet ajout de stock.
                        </div>
                      )}
                    </>
                  ) : null}
                </>
              ) : null}

              {!editingMaterial ? (
                <>
                  <div className="form-group">
                    <label>Fournisseur lié (obligatoire)</label>
                    <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          type="radio"
                          name="supplier_mode"
                          value="existing"
                          checked={formData.supplier_mode === 'existing'}
                          onChange={() => setFormData((previous) => ({ ...previous, supplier_mode: 'existing', new_supplier_name: '', new_supplier_email: '', new_supplier_phone: '' }))}
                          disabled={suppliers.length === 0}
                        />
                        Fournisseur existant
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input
                          type="radio"
                          name="supplier_mode"
                          value="new"
                          checked={formData.supplier_mode === 'new'}
                          onChange={() => setFormData((previous) => ({ ...previous, supplier_mode: 'new', supplier_id: '' }))}
                        />
                        Nouveau fournisseur
                      </label>
                    </div>
                  </div>

                  {formData.supplier_mode === 'existing' ? (
                    <div className="form-group">
                      <label>Choisir un fournisseur</label>
                      <select
                        value={formData.supplier_id}
                        onChange={(event) => setFormData((previous) => ({ ...previous, supplier_id: event.target.value }))}
                        required
                      >
                        <option value="">Sélectionner</option>
                        {suppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.name}
                          </option>
                        ))}
                      </select>
                      {suppliers.length === 0 ? (
                        <div className="form-hint">Aucun fournisseur disponible. Créez-en un nouveau ci-dessous.</div>
                      ) : null}
                    </div>
                  ) : (
                    <>
                      <div className="form-group">
                        <label>Nom du nouveau fournisseur</label>
                        <input
                          type="text"
                          value={formData.new_supplier_name}
                          onChange={(event) => setFormData((previous) => ({ ...previous, new_supplier_name: event.target.value }))}
                          required
                        />
                      </div>
                      <div className="form-row">
                        <div className="form-group">
                          <label>Email fournisseur</label>
                          <input
                            type="email"
                            value={formData.new_supplier_email}
                            onChange={(event) => setFormData((previous) => ({ ...previous, new_supplier_email: event.target.value }))}
                            placeholder="Optionnel"
                          />
                        </div>
                        <div className="form-group">
                          <label>Téléphone fournisseur</label>
                          <input
                            type="text"
                            value={formData.new_supplier_phone}
                            onChange={(event) => setFormData((previous) => ({ ...previous, new_supplier_phone: event.target.value }))}
                            placeholder="Optionnel"
                          />
                        </div>
                      </div>
                    </>
                  )}

                  <div className="card" style={{ margin: 0, marginTop: '10px', padding: '12px' }}>
                    <h4 style={{ marginBottom: '8px' }}>Achat initial et mode de paiement</h4>
                    <p className="form-hint" style={{ marginBottom: '10px' }}>
                      La création d&apos;une matière première enregistre automatiquement un achat fournisseur initial.
                    </p>

                    <div className="form-group">
                      <label>Mode de paiement initial</label>
                      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <input
                            type="radio"
                            name="purchase_payment_mode"
                            value="credit"
                            checked={formData.purchase_payment_mode === 'credit'}
                            onChange={() => updateCreatePurchaseField('purchase_payment_mode', 'credit')}
                          />
                          Dette fournisseur (à crédit)
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <input
                            type="radio"
                            name="purchase_payment_mode"
                            value="cash"
                            checked={formData.purchase_payment_mode === 'cash'}
                            onChange={() => updateCreatePurchaseField('purchase_payment_mode', 'cash')}
                          />
                          Paiement comptant
                        </label>
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label>Mode de décaissement</label>
                        <select
                          value={createPurchaseSettlementValue}
                          onChange={(event) => updateCreatePurchaseField('purchase_settlement_option', event.target.value)}
                        >
                          {RAW_MATERIAL_PURCHASE_SETTLEMENT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="form-group">
                        <label>Montant payé à la création (Ar)</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={formData.purchase_payment_mode === 'cash' ? createPurchaseTotal : formData.purchase_initial_paid_amount}
                          onChange={(event) => updateCreatePurchaseField('purchase_initial_paid_amount', event.target.value)}
                          disabled={formData.purchase_payment_mode === 'cash'}
                          placeholder={formData.purchase_payment_mode === 'cash' ? 'Paiement total automatique' : '0'}
                        />
                        {formData.purchase_payment_mode === 'cash' ? (
                          <div className="form-hint">Le paiement comptant règle automatiquement la totalité.</div>
                        ) : null}
                      </div>
                    </div>

                    <div className="form-row">
                      <div className="form-group">
                        <label>Date d&apos;échéance</label>
                        <input
                          type="date"
                          value={formData.purchase_due_date}
                          onChange={(event) => updateCreatePurchaseField('purchase_due_date', event.target.value)}
                          disabled={createPurchaseRemaining <= 0}
                          required={createPurchaseRemaining > 0}
                        />
                        <div className="form-hint">
                          Requise uniquement s&apos;il reste un montant à payer.
                        </div>
                      </div>

                      <div className="form-group">
                        <label>Référence (optionnel)</label>
                        <input
                          type="text"
                          value={formData.purchase_reference}
                          onChange={(event) => updateCreatePurchaseField('purchase_reference', event.target.value)}
                          placeholder="Ex: ACHAT-INIT-001"
                        />
                      </div>
                    </div>

                    <div className="form-group">
                      <label>Note paiement (optionnel)</label>
                      <textarea
                        rows="2"
                        value={formData.purchase_note}
                        onChange={(event) => updateCreatePurchaseField('purchase_note', event.target.value)}
                        placeholder="Commentaire interne pour cet achat initial"
                      />
                    </div>

                    <div className="cost-summary">
                      <div>Total achat initial: <strong>{formatAr(createPurchaseTotal)}</strong></div>
                      <div>Payé à la création: <strong>{formatAr(createPurchaseInitialPaid)}</strong></div>
                      <div>Reste à payer: <strong>{formatAr(createPurchaseRemaining)}</strong></div>
                      <div>Compte débité: <strong>{createPurchaseSettlementConfig.debit_account_label}</strong> (Solde: {formatAr(createPurchaseDebitBalance)})</div>
                    </div>
                  </div>
                </>
              ) : null}

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingMaterial ? 'Modifier' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAlertModal && (
        <div className="modal-overlay" onClick={() => setShowAlertModal(false)}>
          <div className="modal modal-alert" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>⚠️ Alertes du stock brut</h3>
              <button className="modal-close" onClick={() => setShowAlertModal(false)}>×</button>
            </div>

            {alertMaterials.length === 0 ? (
              <div className="alert-empty">Aucune alerte active. Le stock brut est stable.</div>
            ) : (
              <div className="alert-list">
                {alertMaterials.map((material) => (
                  <div key={material.id} className={`alert-item ${material.stockStatus}`}>
                    <div>
                      <strong>{material.name}</strong>
                      <p>
                        Disponible: {formatQty(material.stock)} {material.unit} · Seuil: {formatQty(material.reorder_level)} {material.unit}
                      </p>
                    </div>
                    <span className={`stock-status ${material.stockStatus}`}>
                      {material.stockStatus === 'low' ? '🔴 ' : '🟡 '}
                      {getStockStatusLabel(material.stockStatus)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setShowAlertModal(false)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal modal-confirm" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Confirmer la suppression</h3>
              <button className="modal-close" onClick={() => setDeleteTarget(null)}>×</button>
            </div>

            <p>
              Vous allez supprimer <strong>{deleteTarget.name}</strong>.
              Cette action est définitive.
            </p>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>
                Annuler
              </button>
              <button type="button" className="btn btn-danger" onClick={confirmDelete}>
                Oui, supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RawMaterialManagement;
