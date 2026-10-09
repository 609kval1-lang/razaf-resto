import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminAPI } from '../../services/api';
import useSerializedAsyncCallback from '../../hooks/useSerializedAsyncCallback';
import { PAYMENT_METHOD_OPTIONS, formatPaymentMethodLabel, normalizePaymentMethod } from '../../utils/paymentMethods';

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

const ACCOUNT_ORDER = ['cash', 'safe', 'bank', 'mobile_money'];
const IMMEDIATE_PAYMENT_METHOD_OPTIONS = PAYMENT_METHOD_OPTIONS.filter((option) => option.value !== 'bon');
const TREASURY_REFRESH_INTERVAL_MS = 5000;
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
      details_placeholder: 'Ex: Réparation congélateur',
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
  const [pendingVouchers, setPendingVouchers] = useState([]);
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
      setPendingVouchers(Array.isArray(data.pending_vouchers) ? data.pending_vouchers : []);
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

  if (loading) {
    return <div className="loading">Chargement de la trésorerie...</div>;
  }

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <div>
            <h2>Trésorerie multi-comptes</h2>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => loadData()}>
              Actualiser
            </button>
            <Link className="btn btn-secondary" to="/admin/cash-movements">
              Voir validations caisse
            </Link>
            <Link className="btn btn-secondary" to="/admin/histories?view=treasury">
              Historiques
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
          </div>
          <div className="stat-card">
            <h3>Caisse disponible</h3>
            <div className="stat-number">{formatCurrency(summary.cash_available)}</div>
          </div>
          <div className="stat-card">
            <h3>Demandes en attente</h3>
            <div className="stat-number">{Number(summary.pending_requests_count || 0)}</div>
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
              </div>

              <div className="form-group">
                <label>Montant (Ar)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={transferForm.amount}
                  onChange={(event) => setTransferForm((prev) => ({ ...prev, amount: event.target.value }))}
                  required
                />
                <div className="form-hint">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setTransferForm((prev) => ({ ...prev, amount: String(Math.floor(sourceAccountBalance) || '') }))}
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
                  min="1"
                  step="1"
                  value={withdrawalForm.amount}
                  onChange={(event) => setWithdrawalForm((prev) => ({ ...prev, amount: event.target.value }))}
                  required
                />
                <div className="form-hint">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setWithdrawalForm((prev) => ({ ...prev, amount: String(Math.floor(withdrawalSourceBalance) || '') }))}
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

    </div>
  );
};

export default TreasuryManagement;
