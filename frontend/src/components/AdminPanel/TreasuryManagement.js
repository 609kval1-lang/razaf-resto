import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminAPI } from '../../services/api';
import useSerializedAsyncCallback from '../../hooks/useSerializedAsyncCallback';
import { PAYMENT_METHOD_OPTIONS, formatPaymentMethodLabel, normalizePaymentMethod } from '../../utils/paymentMethods';
import DataTable from '../common/DataTable';

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} Ar`;
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

const extractErrorMessage = (error, fallbackMessage) => {
  const errors = error?.response?.data?.errors;
  if (errors && typeof errors === 'object') {
    const first = Object.values(errors).flat().find((item) => typeof item === 'string');
    if (first) return first;
  }

  return error?.response?.data?.message || error?.response?.data?.error || fallbackMessage;
};

const MOVEMENT_TYPE_LABELS = {
  sale: 'Encaissement',
  transfer: 'Transfert',
  withdrawal: 'Retrait',
};

const STATUS_LABELS = {
  pending: 'En attente',
  completed: 'Payé',
  approved: 'Valide',
  rejected: 'Refuse',
};

const ACCOUNT_ORDER = ['cash', 'safe', 'bank', 'mobile_money'];
const IMMEDIATE_PAYMENT_METHOD_OPTIONS = PAYMENT_METHOD_OPTIONS.filter((option) => option.value !== 'bon');
const TREASURY_REFRESH_INTERVAL_MS = 5000;
const MOVEMENT_FLOW_FILTERS = [
  { value: 'all', label: 'Tous les flux', flowTypes: [] },
  { value: 'customer', label: 'Clients', flowTypes: ['customer_payment', 'customer_voucher_settlement'] },
  { value: 'supplier', label: 'Fournisseurs', flowTypes: ['supplier_payment'] },
  { value: 'employee', label: 'Employés', flowTypes: ['employee_advance_payment', 'employee_salary_payment'] },
  { value: 'transfer', label: 'Transferts', flowTypes: ['treasury_transfer'] },
  { value: 'treasury_withdrawal', label: 'Décaissements admin', flowTypes: ['treasury_withdrawal'] },
  { value: 'cash_withdrawal', label: 'Sorties caisse', flowTypes: ['cash_withdrawal_request', 'cash_withdrawal'] },
];

const getTargetAccountLabelForMethod = (method) => {
  const normalizedMethod = normalizePaymentMethod(method);
  if (normalizedMethod === 'cash') return 'Caisse';
  if (normalizedMethod === 'mobile_money') return 'Mobile Money';
  if (normalizedMethod === 'transfer' || normalizedMethod === 'check') return 'Banque';
  return '';
};

const defaultTreasuryConfig = {
  payment_account_rules: [],
  withdrawal_reason_options: [
    {
      value: 'packaging',
      label: 'Emballages / consommables',
      hint: 'Barquettes, gobelets, sacs, serviettes, pailles, boîtes pizza et autres consommables de service.',
      beneficiary_label: 'Fournisseur / magasin',
      beneficiary_placeholder: 'Ex: Grossiste emballages',
      details_placeholder: 'Ex: Barquettes, sacs kraft, serviettes',
    },
    {
      value: 'kitchen_fuel',
      label: 'Gaz / charbon / combustible',
      hint: 'Gaz de cuisine, charbon, bois ou autre combustible utilisé en production.',
      beneficiary_label: 'Fournisseur',
      beneficiary_placeholder: 'Ex: Dépôt gaz',
      details_placeholder: 'Ex: Recharge bouteille gaz cuisine',
    },
    {
      value: 'non_consumable_supplies',
      label: 'Achat fournitures non consommables',
      hint: 'Balais, serpillières, poubelles, seaux, petits équipements et autres achats durables.',
      beneficiary_label: 'Fournisseur / magasin',
      beneficiary_placeholder: 'Ex: Quincaillerie Analakely',
      details_placeholder: 'Ex: Balais, serpillières et sacs poubelles',
    },
    {
      value: 'cleaning_products',
      label: 'Produits de nettoyage',
      hint: 'Détergents, désinfectants, savon, javel et autres produits d’hygiène du restaurant.',
      beneficiary_label: 'Fournisseur / magasin',
      beneficiary_placeholder: 'Ex: Magasin hygiène',
      details_placeholder: 'Ex: Javel, savon main, désinfectant cuisine',
    },
    {
      value: 'electricity',
      label: 'Paiement électricité',
      hint: 'Facture d’électricité ou charge d’énergie.',
      beneficiary_label: 'Prestataire',
      beneficiary_placeholder: 'Ex: JIRAMA',
      details_placeholder: 'Ex: Facture avril 2026',
    },
    {
      value: 'water',
      label: 'Paiement eau',
      hint: 'Règlement eau ou consommation liée au local.',
      beneficiary_label: 'Prestataire',
      beneficiary_placeholder: 'Ex: JIRAMA Eau',
      details_placeholder: 'Ex: Eau avril 2026',
    },
    {
      value: 'internet_phone',
      label: 'Internet / téléphone',
      hint: 'Forfaits téléphone, internet, communication client ou ligne utilisée par le restaurant.',
      beneficiary_label: 'Opérateur',
      beneficiary_placeholder: 'Ex: Telma / Orange',
      details_placeholder: 'Ex: Recharge internet caisse et commandes',
    },
    {
      value: 'rent',
      label: 'Paiement loyer',
      hint: 'Loyer, avance de loyer ou charge liée au local.',
      beneficiary_label: 'Bailleur',
      beneficiary_placeholder: 'Ex: Propriétaire local',
      details_placeholder: 'Ex: Loyer avril 2026',
    },
    {
      value: 'maintenance',
      label: 'Entretien / maintenance',
      hint: 'Réparation, maintenance machine ou dépannage.',
      beneficiary_label: 'Technicien / prestataire',
      beneficiary_placeholder: 'Ex: Technicien froid',
      details_placeholder: 'Ex: Réparation congélateur bar',
    },
    {
      value: 'delivery_transport',
      label: 'Transport / livraison',
      hint: 'Course taxi, livraison fournisseur, transport marchandises ou dépense logistique.',
      beneficiary_label: 'Transporteur / livreur',
      beneficiary_placeholder: 'Ex: Taxi fournisseur',
      details_placeholder: 'Ex: Transport stock marché -> restaurant',
    },
    {
      value: 'marketing',
      label: 'Marketing / publicité',
      hint: 'Flyers, affiches, promotions, sponsorisation réseaux sociaux ou communication commerciale.',
      beneficiary_label: 'Prestataire / agence',
      beneficiary_placeholder: 'Ex: Imprimerie locale',
      details_placeholder: 'Ex: Impression flyers menu du jour',
    },
    {
      value: 'tax',
      label: 'Taxes / frais administratifs',
      hint: 'Impôts, taxes, frais bancaires ou frais administratifs.',
      beneficiary_label: 'Organisme',
      beneficiary_placeholder: 'Ex: Centre fiscal',
      details_placeholder: 'Ex: TVA du mois',
    },
    {
      value: 'other',
      label: 'Autre décaissement',
      hint: 'Pour un besoin exceptionnel non couvert par les motifs standards.',
      beneficiary_label: 'Bénéficiaire',
      beneficiary_placeholder: 'Ex: Nom du bénéficiaire',
      details_placeholder: 'Ex: Précisez clairement le motif',
    },
  ],
};

const defaultSummary = {
  cash_available: 0,
  pending_requests_count: 0,
  pending_vouchers_count: 0,
  pending_vouchers_amount: 0,
  total_internal_balance: 0,
  accounts: {},
};

const TreasuryManagement = () => {
  const [loading, setLoading] = useState(true);
  const [submittingTransfer, setSubmittingTransfer] = useState(false);
  const [submittingWithdrawal, setSubmittingWithdrawal] = useState(false);
  const [processingVoucherId, setProcessingVoucherId] = useState(null);
  const [message, setMessage] = useState('');
  const [activeTreasuryAction, setActiveTreasuryAction] = useState('transfer');
  const [summary, setSummary] = useState(defaultSummary);
  const [config, setConfig] = useState(defaultTreasuryConfig);
  const [movements, setMovements] = useState([]);
  const [pendingVouchers, setPendingVouchers] = useState([]);
  const [recentCustomerPayments, setRecentCustomerPayments] = useState([]);
  const [movementFilters, setMovementFilters] = useState({
    flow: 'all',
    account: 'all',
  });
  const [showMovementFilters, setShowMovementFilters] = useState(false);
  const [voucherSettlementForms, setVoucherSettlementForms] = useState({});
  const [transferForm, setTransferForm] = useState({
    amount: '',
    source_account: 'cash',
    destination_account: 'safe',
    reason: 'Vidage ou transfert de trésorerie',
    description: '',
  });
  const [withdrawalForm, setWithdrawalForm] = useState({
    amount: '',
    source_account: 'bank',
    reason_category: '',
    beneficiary_name: '',
    reason_details: '',
    description: '',
  });

  const loadDataInternal = useCallback(async (options = {}) => {
    const { silent = false } = options || {};

    if (silent && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }

    if (!silent) {
      setLoading(true);
      setMessage('');
    }

    try {
      const response = await adminAPI.getTreasurySnapshot();
      const data = response?.data || {};
      setSummary(data.summary || defaultSummary);
      setConfig(data.config || defaultTreasuryConfig);
      setMovements(Array.isArray(data.movements) ? data.movements : []);
      setPendingVouchers(Array.isArray(data.pending_vouchers) ? data.pending_vouchers : []);
      setRecentCustomerPayments(Array.isArray(data.recent_customer_payments) ? data.recent_customer_payments : []);
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Impossible de charger la trésorerie.')}`);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);
  const loadData = useSerializedAsyncCallback(loadDataInternal);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      loadData({ silent: true });
    }, TREASURY_REFRESH_INTERVAL_MS);

    const handleWindowFocus = () => {
      loadData({ silent: true });
    };

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        loadData({ silent: true });
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleWindowFocus);
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      clearInterval(intervalId);

      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleWindowFocus);
      }

      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [loadData]);

  useEffect(() => {
    setVoucherSettlementForms((previous) => {
      const next = {};

      pendingVouchers.forEach((voucher) => {
        const current = previous[voucher.id] || {};
        next[voucher.id] = {
          settlement_method: normalizePaymentMethod(current.settlement_method) || '',
        };
      });

      return next;
    });
  }, [pendingVouchers]);

  const accountCards = useMemo(() => {
    const accountMap = summary?.accounts && typeof summary.accounts === 'object' ? summary.accounts : {};

    return ACCOUNT_ORDER
      .map((key) => accountMap[key])
      .filter(Boolean);
  }, [summary]);

  const accountOptions = useMemo(() => {
    if (accountCards.length > 0) {
      return accountCards;
    }

    return ACCOUNT_ORDER.map((key) => ({
      key,
      label: key,
      balance: 0,
      approved_in_total: 0,
      approved_out_total: 0,
      pending_out_total: 0,
    }));
  }, [accountCards]);

  const filteredTransferDestinations = useMemo(() => {
    return accountOptions.filter((account) => account.key !== transferForm.source_account);
  }, [accountOptions, transferForm.source_account]);

  useEffect(() => {
    if (!filteredTransferDestinations.some((account) => account.key === transferForm.destination_account)) {
      setTransferForm((prev) => ({
        ...prev,
        destination_account: filteredTransferDestinations[0]?.key || '',
      }));
    }
  }, [filteredTransferDestinations, transferForm.destination_account]);

  const sourceAccountBalance = useMemo(() => {
    const source = accountOptions.find((account) => account.key === transferForm.source_account);
    return Number(source?.balance || 0);
  }, [accountOptions, transferForm.source_account]);

  const withdrawalSourceBalance = useMemo(() => {
    const source = accountOptions.find((account) => account.key === withdrawalForm.source_account);
    return Number(source?.balance || 0);
  }, [accountOptions, withdrawalForm.source_account]);

  const withdrawalReasonOptions = useMemo(() => {
    const options = Array.isArray(config?.withdrawal_reason_options) && config.withdrawal_reason_options.length > 0
      ? config.withdrawal_reason_options
      : defaultTreasuryConfig.withdrawal_reason_options;

    return options;
  }, [config]);

  const selectedWithdrawalReason = useMemo(() => {
    return withdrawalReasonOptions.find((option) => option.value === withdrawalForm.reason_category) || null;
  }, [withdrawalForm.reason_category, withdrawalReasonOptions]);

  const movementAccountFilterOptions = useMemo(() => ([
    { value: 'all', label: 'Tous les comptes' },
    ...accountOptions.map((account) => ({
      value: account.key,
      label: account.label,
    })),
  ]), [accountOptions]);

  const filteredMovements = useMemo(() => {
    const activeFlowFilter = MOVEMENT_FLOW_FILTERS.find((option) => option.value === movementFilters.flow)
      || MOVEMENT_FLOW_FILTERS[0];
    const flowTypes = Array.isArray(activeFlowFilter.flowTypes) ? activeFlowFilter.flowTypes : [];

    return movements.filter((movement) => {
      const matchesFlow = flowTypes.length === 0
        || flowTypes.includes(String(movement.flow_type || ''));

      const matchesAccount = movementFilters.account === 'all'
        || String(movement.source_account || '') === movementFilters.account
        || String(movement.destination_account || '') === movementFilters.account;

      return matchesFlow && matchesAccount;
    });
  }, [movementFilters.account, movementFilters.flow, movements]);

  const filteredMovementAmount = useMemo(() => (
    filteredMovements.reduce((total, movement) => total + Number(movement.amount || 0), 0)
  ), [filteredMovements]);

  const activeMovementFilterCount = useMemo(() => (
    [
      movementFilters.flow !== 'all',
      movementFilters.account !== 'all',
    ].filter(Boolean).length
  ), [movementFilters.account, movementFilters.flow]);

  const resetMovementFilters = () => {
    setMovementFilters({
      flow: 'all',
      account: 'all',
    });
  };

  const submitTransfer = async (event) => {
    event.preventDefault();
    setSubmittingTransfer(true);
    setMessage('');

    try {
      await adminAPI.createTreasuryTransfer({
        amount: Number(transferForm.amount),
        source_account: transferForm.source_account,
        destination_account: transferForm.destination_account,
        reason: String(transferForm.reason || '').trim(),
        description: transferForm.description ? String(transferForm.description).trim() : null,
      });

      setMessage('Transfert de trésorerie enregistré.');
      setTransferForm((prev) => ({
        ...prev,
        amount: '',
        description: '',
      }));
      await loadData({ silent: true });
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Impossible d’enregistrer le transfert.')}`);
    } finally {
      setSubmittingTransfer(false);
    }
  };

  const submitWithdrawal = async (event) => {
    event.preventDefault();
    setSubmittingWithdrawal(true);
    setMessage('');

    try {
      await adminAPI.createTreasuryWithdrawal({
        amount: Number(withdrawalForm.amount),
        source_account: withdrawalForm.source_account,
        reason_category: withdrawalForm.reason_category,
        beneficiary_name: withdrawalForm.beneficiary_name ? String(withdrawalForm.beneficiary_name).trim() : null,
        reason_details: withdrawalForm.reason_details ? String(withdrawalForm.reason_details).trim() : null,
        description: withdrawalForm.description ? String(withdrawalForm.description).trim() : null,
      });

      setMessage('Autre décaissement de trésorerie enregistré.');
      setWithdrawalForm((prev) => ({
        ...prev,
        amount: '',
        reason_category: '',
        beneficiary_name: '',
        reason_details: '',
        description: '',
      }));
      await loadData({ silent: true });
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Impossible d’enregistrer le décaissement.')}`);
    } finally {
      setSubmittingWithdrawal(false);
    }
  };

  const updateVoucherSettlementField = (voucherId, key, value) => {
    setVoucherSettlementForms((previous) => ({
      ...previous,
      [voucherId]: {
        ...(previous[voucherId] || { settlement_method: '' }),
        [key]: key === 'settlement_method' ? normalizePaymentMethod(value) : value,
      },
    }));
  };

  const encashVoucher = async (voucher) => {
    const settlementMethod = normalizePaymentMethod(voucherSettlementForms[voucher.id]?.settlement_method) || '';
    if (!settlementMethod) {
      setMessage(`Erreur: choisissez le mode d’encaissement du bon #${voucher.id}.`);
      return;
    }

    setProcessingVoucherId(voucher.id);
    setMessage('');

    try {
      await adminAPI.processAdminOrderPayment(voucher.order_id, {
        method: settlementMethod,
        reference: voucher.reference || null,
      });

      setMessage(`Bon #${voucher.id} encaissé via ${formatPaymentMethodLabel(settlementMethod)}.`);
      await loadData({ silent: true });
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Impossible d’encaisser ce bon.')}`);
    } finally {
      setProcessingVoucherId(null);
    }
  };

  const renderMovementPurpose = (movement) => {
    const primary = movement.reason_label || movement.reason || movement.description || '-';
    const secondary = [
      movement.description,
      movement.reason_details,
      movement.beneficiary_name ? `Bénéficiaire: ${movement.beneficiary_name}` : '',
      movement.payment_method ? `Mode: ${formatPaymentMethodLabel(movement.payment_method)}` : '',
    ]
      .filter((value) => typeof value === 'string' && value.trim() !== '' && value.trim() !== primary)
      .filter((value, index, array) => array.indexOf(value) === index);

    return (
      <div className="cash-movement-detail">
        <strong>{primary}</strong>
        {secondary.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
    );
  };

  const movementColumns = [
    {
      key: 'movement_type',
      header: 'Flux',
      sortAccessor: (movement) => movement.flow_type_label || MOVEMENT_TYPE_LABELS[movement.movement_type] || movement.movement_type || '-',
      searchAccessor: (movement) => `${movement.flow_type_label || ''} ${MOVEMENT_TYPE_LABELS[movement.movement_type] || movement.movement_type || ''}`,
      render: (movement) => (
        <span className={`cash-movement-kind ${movement.movement_type || 'withdrawal'}`}>
          {movement.flow_type_label || MOVEMENT_TYPE_LABELS[movement.movement_type] || movement.movement_type || '-'}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Montant',
      sortType: 'number',
      sortAccessor: (movement) => Number(movement.amount || 0),
      searchAccessor: (movement) => String(movement.amount || ''),
      render: (movement) => formatCurrency(movement.amount),
    },
    {
      key: 'source_account',
      header: 'Depuis',
      sortAccessor: (movement) => movement.source_account_label || '',
      searchAccessor: (movement) => movement.source_account_label || '',
      render: (movement) => movement.source_account_label || 'Externe',
    },
    {
      key: 'destination_account',
      header: 'Vers',
      sortAccessor: (movement) => movement.destination_account_label || '',
      searchAccessor: (movement) => movement.destination_account_label || '',
      render: (movement) => movement.destination_account_label || 'Externe',
    },
    {
      key: 'reason',
      header: 'Motif / Description',
      sortAccessor: (movement) => movement.reason_label || movement.reason || movement.description || '',
      searchAccessor: (movement) => `${movement.reason_label || ''} ${movement.reason || ''} ${movement.description || ''} ${movement.reason_details || ''} ${movement.beneficiary_name || ''}`,
      render: (movement) => renderMovementPurpose(movement),
    },
    {
      key: 'status',
      header: 'Statut',
      sortAccessor: (movement) => STATUS_LABELS[movement.status] || movement.status || '',
      searchAccessor: (movement) => `${STATUS_LABELS[movement.status] || movement.status || ''} ${movement.approved_by_name || ''}`,
      render: (movement) => (
        <>
          <span className={`cash-movement-status ${movement.status || 'pending'}`}>
            {STATUS_LABELS[movement.status] || movement.status || '-'}
          </span>
          {movement.approved_by_name ? <div className="form-hint">Par: {movement.approved_by_name}</div> : null}
        </>
      ),
    },
    {
      key: 'effective_at',
      header: 'Date effet',
      sortType: 'date',
      sortAccessor: (movement) => movement.effective_at || movement.created_at,
      searchAccessor: (movement) => formatDateTime(movement.effective_at || movement.created_at),
      render: (movement) => formatDateTime(movement.effective_at || movement.created_at),
    },
  ];

  if (loading) {
    return <div className="loading">Chargement de la trésorerie...</div>;
  }

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <div>
            <h2>🏛️ Trésorerie multi-comptes</h2>
            <p className="form-hint" style={{ marginTop: '6px' }}>
              Gérez ici les transferts et décaissements entre caisse, coffre, banque et mobile money. Les demandes envoyées depuis la caisse restent validées dans la page Mouvements de caisse.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => loadData()}>
              Actualiser
            </button>
            <Link className="btn btn-secondary" to="/admin/cash-movements">
              Voir validations caisse
            </Link>
          </div>
        </div>

        {message ? (
          <div className={`message ${message.includes('Erreur') ? 'error-message' : 'success-message'}`}>
            {message}
          </div>
        ) : null}

        <div className="stats-grid" style={{ marginBottom: '10px' }}>
          {accountCards.map((account) => (
            <div className="stat-card" key={account.key}>
              <h3>{account.label}</h3>
              <div className="stat-number">{formatCurrency(account.balance)}</div>
              <p>
                Entrées: {formatCurrency(account.approved_in_total)} · Sorties: {formatCurrency(account.approved_out_total)}
              </p>
            </div>
          ))}
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <h3>Total trésorerie</h3>
            <div className="stat-number">{formatCurrency(summary.total_internal_balance)}</div>
            <p>Total cumulé des comptes internes</p>
          </div>
          <div className="stat-card">
            <h3>Caisse disponible</h3>
            <div className="stat-number">{formatCurrency(summary.cash_available)}</div>
            <p>Solde disponible immédiatement en caisse</p>
          </div>
          <div className="stat-card">
            <h3>Demandes en attente</h3>
            <div className="stat-number">{Number(summary.pending_requests_count || 0)}</div>
            <p>Demandes de sortie à valider dans la page caisse</p>
          </div>
          <div className="stat-card">
            <h3>Bons à encaisser</h3>
            <div className="stat-number">{Number(summary.pending_vouchers_count || 0)}</div>
            <p>Montant en attente: {formatCurrency(summary.pending_vouchers_amount)}</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
          <div>
            <h3 style={{ marginBottom: '6px' }}>Action trésorerie</h3>
            <p className="form-hint">
              Choisissez d&apos;abord le type d&apos;opération. Une seule interface d&apos;action s&apos;affiche à la fois.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`btn btn-sm ${activeTreasuryAction === 'transfer' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTreasuryAction('transfer')}
            >
              Transfert entre comptes
            </button>
            <button
              type="button"
              className={`btn btn-sm ${activeTreasuryAction === 'withdrawal' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTreasuryAction('withdrawal')}
            >
              Autres décaissements
            </button>
          </div>
        </div>
        <div className="form-hint">
          {activeTreasuryAction === 'transfer'
            ? 'Mode transfert: déplacement interne entre caisse, coffre, banque et mobile money.'
            : 'Mode décaissement: sortie directe depuis un compte pour une autre charge du restaurant.'}
        </div>
      </div>

      {activeTreasuryAction === 'transfer' ? (
        <div className="card">
          <h3 style={{ marginBottom: '10px' }}>Transfert entre comptes</h3>
          <form onSubmit={submitTransfer}>
            <div className="form-row">
              <div className="form-group">
                <label>Compte source</label>
                <select
                  value={transferForm.source_account}
                  onChange={(event) => setTransferForm((prev) => ({ ...prev, source_account: event.target.value }))}
                  required
                >
                  {accountOptions.map((account) => (
                    <option key={account.key} value={account.key}>
                      {account.label}
                    </option>
                  ))}
                </select>
                <div className="form-hint">Solde disponible: {formatCurrency(sourceAccountBalance)}</div>
              </div>

              <div className="form-group">
                <label>Compte destination</label>
                <select
                  value={transferForm.destination_account}
                  onChange={(event) => setTransferForm((prev) => ({ ...prev, destination_account: event.target.value }))}
                  required
                >
                  {filteredTransferDestinations.map((account) => (
                    <option key={account.key} value={account.key}>
                      {account.label}
                    </option>
                  ))}
                </select>
                <div className="form-hint">Pour vider la caisse, choisissez ici le compte de dépôt.</div>
              </div>

              <div className="form-group">
                <label>Montant (Ar)</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={transferForm.amount}
                  onChange={(event) => setTransferForm((prev) => ({ ...prev, amount: event.target.value }))}
                  required
                />
                <div className="form-hint">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setTransferForm((prev) => ({ ...prev, amount: String(sourceAccountBalance || '') }))}
                  >
                    Utiliser tout le solde source
                  </button>
                </div>
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Objet court</label>
                <input
                  type="text"
                  value={transferForm.description}
                  onChange={(event) => setTransferForm((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="Ex: Vidage caisse fin de journée"
                />
              </div>
              <div className="form-group">
                <label>Motif</label>
                <textarea
                  rows="2"
                  value={transferForm.reason}
                  onChange={(event) => setTransferForm((prev) => ({ ...prev, reason: event.target.value }))}
                  required
                />
              </div>
            </div>

            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={submittingTransfer}>
                {submittingTransfer ? 'Enregistrement...' : 'Enregistrer le transfert'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="card">
          <h3 style={{ marginBottom: '10px' }}>Autres décaissements depuis un compte</h3>
          <p className="form-hint" style={{ marginBottom: '12px' }}>
            Débitez directement la caisse, le coffre, la banque ou le mobile money uniquement pour les autres charges
            du restaurant: fournitures non consommables, factures, transport, entretien ou frais externes. Les achats de
            matières premières et les paiements fournisseur se gèrent dans Fournisseurs, et les salaires / avances sur
            salaire dans Employés &amp; paie.
          </p>
          <form onSubmit={submitWithdrawal}>
            <div className="form-row">
              <div className="form-group">
                <label>Compte à débiter</label>
                <select
                  value={withdrawalForm.source_account}
                  onChange={(event) => setWithdrawalForm((prev) => ({ ...prev, source_account: event.target.value }))}
                  required
                >
                  {accountOptions.map((account) => (
                    <option key={account.key} value={account.key}>
                      {account.label}
                    </option>
                  ))}
                </select>
                <div className="form-hint">Solde disponible: {formatCurrency(withdrawalSourceBalance)}</div>
              </div>

              <div className="form-group">
                <label>Montant (Ar)</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={withdrawalForm.amount}
                  onChange={(event) => setWithdrawalForm((prev) => ({ ...prev, amount: event.target.value }))}
                  required
                />
                <div className="form-hint">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setWithdrawalForm((prev) => ({ ...prev, amount: String(withdrawalSourceBalance || '') }))}
                  >
                    Utiliser tout le solde du compte
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label>Motif de l&apos;autre décaissement</label>
                <select
                  value={withdrawalForm.reason_category}
                  onChange={(event) => setWithdrawalForm((prev) => ({ ...prev, reason_category: event.target.value }))}
                  required
                >
                  <option value="">Sélectionner un motif</option>
                  {withdrawalReasonOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {selectedWithdrawalReason?.hint ? (
                  <div className="form-hint">{selectedWithdrawalReason.hint}</div>
                ) : null}
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>{selectedWithdrawalReason?.beneficiary_label || 'Bénéficiaire / payé à'}</label>
                <input
                  type="text"
                  value={withdrawalForm.beneficiary_name}
                  onChange={(event) => setWithdrawalForm((prev) => ({ ...prev, beneficiary_name: event.target.value }))}
                  placeholder={selectedWithdrawalReason?.beneficiary_placeholder || 'Ex: Nom du bénéficiaire'}
                />
              </div>

              <div className="form-group">
                <label>Objet court</label>
                <input
                  type="text"
                  value={withdrawalForm.description}
                  onChange={(event) => setWithdrawalForm((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="Ex: Dépense urgente"
                />
              </div>
            </div>

            <div className="form-group">
              <label>Précisions</label>
              <textarea
                rows="2"
                value={withdrawalForm.reason_details}
                onChange={(event) => setWithdrawalForm((prev) => ({ ...prev, reason_details: event.target.value }))}
                placeholder={selectedWithdrawalReason?.details_placeholder || 'Précisez la sortie'}
                required={withdrawalForm.reason_category === 'other'}
              />
            </div>

            <div className="form-actions">
              <button className="btn btn-primary" type="submit" disabled={submittingWithdrawal}>
                {submittingWithdrawal ? 'Enregistrement...' : 'Enregistrer l\'autre décaissement'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginBottom: '10px' }}>Bons à encaisser</h3>
        {pendingVouchers.length === 0 ? (
          <div className="alert-empty">Aucun bon en attente d&apos;encaissement.</div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Bon</th>
                  <th>Commande</th>
                  <th>Table</th>
                  <th>Client</th>
                  <th>Montant</th>
                  <th>Référence</th>
                  <th>Imprimé le</th>
                  <th>Mode paiement</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingVouchers.map((voucher) => {
                  const voucherSettlementMethod = normalizePaymentMethod(voucherSettlementForms[voucher.id]?.settlement_method) || '';
                  const voucherTargetAccountLabel = getTargetAccountLabelForMethod(voucherSettlementMethod);

                  return (
                  <tr key={voucher.id}>
                    <td data-label="Bon">#{voucher.id}</td>
                    <td data-label="Commande">#{voucher.order_id}</td>
                    <td data-label="Table">{voucher.order_type === 'takeaway' ? 'A emporter' : (voucher.table_number ? `Table ${voucher.table_number}` : 'Sans table')}</td>
                    <td data-label="Client">{voucher.customer_name || 'Client non renseigné'}</td>
                    <td data-label="Montant">{formatCurrency(voucher.amount)}</td>
                    <td data-label="Reference">{voucher.reference || '-'}</td>
                    <td data-label="Imprime le">{formatDateTime(voucher.printed_at || voucher.created_at)}</td>
                    <td data-label="Mode paiement">
                      <select
                        className="voucher-encash-select"
                        value={voucherSettlementMethod}
                        onChange={(event) => updateVoucherSettlementField(voucher.id, 'settlement_method', event.target.value)}
                        disabled={processingVoucherId === voucher.id}
                      >
                        <option value="">Choisir un mode</option>
                        {IMMEDIATE_PAYMENT_METHOD_OPTIONS.map((methodOption) => (
                          <option key={methodOption.value} value={methodOption.value}>
                            {methodOption.label}
                          </option>
                        ))}
                      </select>
                      <div className="form-hint">
                        {voucherTargetAccountLabel
                          ? `Compte alimenté: ${voucherTargetAccountLabel}`
                          : 'Choisissez un mode pour définir le compte à alimenter.'}
                      </div>
                    </td>
                    <td data-label="Action">
                      <div className="actions voucher-encash-actions">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm voucher-encash-button"
                          onClick={() => encashVoucher(voucher)}
                          disabled={processingVoucherId === voucher.id}
                        >
                          {processingVoucherId === voucher.id ? 'Traitement...' : 'Encaisser'}
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-header-inline">
          <h3 style={{ marginBottom: 0 }}>Historique de trésorerie</h3>
          <button
            type="button"
            className={`btn btn-sm ${showMovementFilters ? 'btn-primary' : 'btn-secondary'} filter-toggle-inline`}
            onClick={() => setShowMovementFilters((previous) => !previous)}
          >
            <span aria-hidden="true">{showMovementFilters ? '▾' : '▸'}</span>
            <span>{showMovementFilters ? 'Masquer filtres' : 'Afficher filtres'}</span>
            {activeMovementFilterCount > 0 ? <strong>{activeMovementFilterCount}</strong> : null}
          </button>
        </div>
        <p className="form-hint" style={{ marginBottom: '10px' }}>
          Cet historique suit tous les comptes internes. Pour les seules sorties et validations liées à la caisse, utilise plutôt la page Mouvements de caisse.
        </p>
        {showMovementFilters ? (
          <div className="treasury-history-toolbar">
            <div className="treasury-filter-block">
              <span className="treasury-filter-label">Famille de flux</span>
              <div className="treasury-filter-toggles">
                {MOVEMENT_FLOW_FILTERS.map((option) => {
                  const optionCount = option.value === 'all'
                    ? movements.length
                    : movements.filter((movement) => option.flowTypes.includes(String(movement.flow_type || ''))).length;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`treasury-filter-toggle ${movementFilters.flow === option.value ? 'is-active' : ''}`}
                      onClick={() => setMovementFilters((previous) => ({ ...previous, flow: option.value }))}
                    >
                      <span>{option.label}</span>
                      <strong>{optionCount}</strong>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="treasury-filter-block">
              <span className="treasury-filter-label">Compte concerné</span>
              <div className="treasury-filter-toggles">
                {movementAccountFilterOptions.map((option) => {
                  const optionCount = option.value === 'all'
                    ? movements.length
                    : movements.filter((movement) => (
                      String(movement.source_account || '') === option.value
                      || String(movement.destination_account || '') === option.value
                    )).length;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`treasury-filter-toggle ${movementFilters.account === option.value ? 'is-active' : ''}`}
                      onClick={() => setMovementFilters((previous) => ({ ...previous, account: option.value }))}
                    >
                      <span>{option.label}</span>
                      <strong>{optionCount}</strong>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="treasury-history-summary">
              <div className="supplier-ledger-active-pill">
                <span>Résultat</span>
                <strong>{filteredMovements.length} mouvement(s)</strong>
              </div>
              <div className="supplier-ledger-active-pill">
                <span>Total visible</span>
                <strong>{formatCurrency(filteredMovementAmount)}</strong>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={resetMovementFilters}
                disabled={movementFilters.flow === 'all' && movementFilters.account === 'all'}
              >
                Réinitialiser les filtres
              </button>
            </div>
          </div>
        ) : null}
        {movements.length === 0 ? (
          <div className="alert-empty">Aucun mouvement de trésorerie.</div>
        ) : (
          <DataTable
            columns={movementColumns}
            data={filteredMovements}
            rowKey="id"
            searchPlaceholder="Rechercher un mouvement (compte, motif, type, statut)..."
            initialSort={{ key: 'effective_at', direction: 'desc' }}
            emptyMessage="Aucun mouvement ne correspond aux filtres sélectionnés."
          />
        )}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '10px' }}>Paiements clients récents</h3>
        <p className="form-hint" style={{ marginBottom: '10px' }}>
          Contrôle informatif des encaissements récents: seul le cash doit alimenter la caisse, les chèques et virements la banque, et le mobile money son compte dédié.
        </p>
        {recentCustomerPayments.length === 0 ? (
          <div className="alert-empty">Aucun paiement client récent.</div>
        ) : (
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Commande</th>
                  <th>Client</th>
                  <th>Table</th>
                  <th>Statut</th>
                  <th>Mode choisi</th>
                  <th>Mode encaissé</th>
                  <th>Compte alimenté</th>
                  <th>Montant</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentCustomerPayments.map((payment) => (
                  <tr key={payment.id}>
                    <td data-label="Commande">#{payment.order_id}</td>
                    <td data-label="Client">{payment.customer_name || 'Client libre'}</td>
                    <td data-label="Table">{payment.order_type === 'takeaway' ? 'A emporter' : (payment.table_number ? `Table ${payment.table_number}` : 'Sans table')}</td>
                    <td data-label="Statut">{STATUS_LABELS[payment.status] || payment.status || '-'}</td>
                    <td data-label="Mode choisi">{formatPaymentMethodLabel(payment.method)}</td>
                    <td data-label="Mode encaisse">{formatPaymentMethodLabel(payment.settlement_method || payment.method)}</td>
                    <td data-label="Compte alimente">{payment.target_account_label || 'En attente'}</td>
                    <td data-label="Montant">{formatCurrency(payment.amount)}</td>
                    <td data-label="Date">{formatDateTime(payment.encashed_at || payment.printed_at || payment.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '10px' }}>Règles d&apos;alimentation des comptes</h3>
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mode client</th>
                <th>Compte alimenté</th>
                <th>Règle</th>
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(config?.payment_account_rules) ? config.payment_account_rules : []).map((rule) => (
                <tr key={rule.payment_method}>
                  <td data-label="Mode client">{rule.payment_method_label}</td>
                  <td data-label="Compte alimente">{rule.target_account_label || 'Aucun'}</td>
                  <td data-label="Regle">{rule.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TreasuryManagement;
