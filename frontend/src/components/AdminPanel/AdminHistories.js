import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { adminAPI } from '../../services/api';
import { formatPaymentMethodLabel } from '../../utils/paymentMethods';
import DataTable from '../common/DataTable';

const VIEWS = [
  { id: 'treasury', label: 'Trésorerie' },
  { id: 'suppliers', label: 'Achats fournisseurs' },
  { id: 'payroll', label: 'Paie et avances' },
];

const FLOW_FILTERS = [
  { value: 'all', label: 'Tous les flux' },
  { value: 'customer', label: 'Clients' },
  { value: 'supplier', label: 'Fournisseurs' },
  { value: 'employee', label: 'Employés' },
  { value: 'transfer', label: 'Transferts' },
  { value: 'treasury_withdrawal', label: 'Décaissements admin' },
  { value: 'cash_withdrawal', label: 'Sorties caisse' },
];

const ACCOUNT_OPTIONS = [
  { value: 'all', label: 'Tous les comptes' },
  { value: 'cash', label: 'Caisse' },
  { value: 'safe', label: 'Coffre' },
  { value: 'bank', label: 'Banque' },
  { value: 'mobile_money', label: 'Mobile Money' },
];

const ACCOUNT_LABELS = Object.fromEntries(ACCOUNT_OPTIONS.map((option) => [option.value, option.label]));

const formatCurrency = (value) => `${Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Ar`;
const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const treasuryColumns = [
  {
    key: 'effective_at', header: 'Date', sortType: 'date',
    sortAccessor: (row) => row.effective_at || row.created_at,
    render: (row) => formatDateTime(row.effective_at || row.created_at),
  },
  {
    key: 'flow_type', header: 'Mouvement',
    sortAccessor: (row) => row.flow_type_label || row.flow_type || '',
    searchAccessor: (row) => `${row.flow_type_label || ''} ${row.description || ''} ${row.reason || ''} ${row.customer_name || ''} ${row.order_id || ''} ${row.payment_reference || ''}`,
    render: (row) => (
      <div className="cash-movement-detail">
        <strong>{row.flow_type_label || row.reason_label || row.reason || 'Mouvement'}</strong>
        {row.order_id ? <span>Commande #{row.order_id}{row.customer_name ? ` · ${row.customer_name}` : ''}</span> : null}
        {row.table_number ? <span>Table {row.table_number}</span> : null}
        {row.description ? <span>{row.description}</span> : null}
        {row.payment_reference ? <span>Réf. {row.payment_reference}</span> : null}
      </div>
    ),
  },
  {
    key: 'accounts', header: 'Comptes',
    sortAccessor: (row) => `${row.source_account_label || ''} ${row.destination_account_label || ''}`,
    render: (row) => (
      <div className="cash-movement-detail">
        <span>De : {row.source_account_label || 'Externe'}</span>
        <span>Vers : {row.destination_account_label || 'Externe'}</span>
      </div>
    ),
  },
  {
    key: 'amount', header: 'Montant', sortType: 'number',
    sortAccessor: (row) => Number(row.amount || 0),
    render: (row) => (
      <strong className={`admin-history-amount ${row.movement_type === 'transfer' ? '' : (row.direction === 'in' ? 'is-inflow' : 'is-outflow')}`}>
        {row.movement_type === 'transfer' ? '' : (row.direction === 'in' ? '+' : '-')}{formatCurrency(row.amount)}
      </strong>
    ),
  },
  {
    key: 'status', header: 'Statut',
    sortAccessor: (row) => row.status || '',
    render: (row) => row.status === 'approved' ? 'Validé' : (row.status === 'pending' ? 'En attente' : 'Refusé'),
  },
];

const supplierColumns = [
  { key: 'purchased_at', header: 'Achat', sortType: 'date', sortAccessor: (row) => row.purchased_at, render: (row) => formatDateTime(row.purchased_at) },
  { key: 'material', header: 'Matière', sortAccessor: (row) => row.raw_material?.name || '', searchAccessor: (row) => row.raw_material?.name || '', render: (row) => row.raw_material?.name || `Matière #${row.raw_material_id}` },
  { key: 'total_amount', header: 'Total', sortType: 'number', sortAccessor: (row) => Number(row.total_amount || 0), render: (row) => formatCurrency(row.total_amount) },
  { key: 'paid_amount', header: 'Payé', sortType: 'number', sortAccessor: (row) => Number(row.paid_amount || 0), render: (row) => formatCurrency(row.paid_amount) },
  { key: 'remaining_amount', header: 'Reste', sortType: 'number', sortAccessor: (row) => Number(row.remaining_amount || 0), render: (row) => formatCurrency(row.remaining_amount) },
  {
    key: 'payments', header: 'Règlements', sortable: false,
    searchAccessor: (row) => (row.payments || []).map((payment) => `${payment.reference || ''} ${payment.method || ''}`).join(' '),
    render: (row) => (
      <div className="cash-movement-detail">
        {Array.isArray(row.payments) && row.payments.length > 0 ? row.payments.map((payment) => (
          <span key={payment.id}>
            {formatDateTime(payment.paid_at || payment.created_at)} · {formatCurrency(payment.amount)} · {formatPaymentMethodLabel(payment.method)}
            {payment.source_account ? ` (${ACCOUNT_LABELS[payment.source_account] || payment.source_account})` : ''}
          </span>
        )) : <span>Aucun règlement</span>}
      </div>
    ),
  },
];

const payrollColumns = [
  { key: 'paid_at', header: 'Date', sortType: 'date', sortAccessor: (row) => row.paid_at || row.created_at, render: (row) => formatDateTime(row.paid_at || row.created_at) },
  { key: 'employee_name', header: 'Employé', sortAccessor: (row) => row.employee_name || '', render: (row) => row.employee_name || '-' },
  { key: 'transaction_type', header: 'Type', sortAccessor: (row) => row.transaction_type || '', render: (row) => row.transaction_type === 'advance' ? 'Avance' : 'Salaire' },
  {
    key: 'net_amount', header: 'Montants', sortType: 'number', sortAccessor: (row) => Number(row.net_amount || 0),
    render: (row) => (
      <div className="cash-movement-detail">
        <strong>Net : {formatCurrency(row.net_amount)}</strong>
        <span>Brut : {formatCurrency(row.gross_amount)}</span>
        {Number(row.advance_deduction_amount || 0) > 0 ? <span>Avance déduite : {formatCurrency(row.advance_deduction_amount)}</span> : null}
      </div>
    ),
  },
  {
    key: 'payment_method', header: 'Paiement',
    searchAccessor: (row) => `${row.payment_method || ''} ${row.source_account || ''} ${row.reference || ''}`,
    render: (row) => (
      <div className="cash-movement-detail">
        <strong>{row.payment_method ? formatPaymentMethodLabel(row.payment_method) : 'Aucun décaissement'}</strong>
        <span>{row.source_account ? ACCOUNT_LABELS[row.source_account] || row.source_account : 'Aucun compte débité'}</span>
        {row.reference ? <span>Réf. {row.reference}</span> : null}
      </div>
    ),
  },
  { key: 'payroll_month', header: 'Mois paie', sortAccessor: (row) => row.payroll_month || '', render: (row) => row.payroll_month || '-' },
];

const AdminHistories = () => {
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const requestedView = query.get('view');
  const activeView = VIEWS.some((item) => item.id === requestedView) ? requestedView : 'treasury';
  const [flow, setFlow] = useState('all');
  const [account, setAccount] = useState(ACCOUNT_OPTIONS.some((option) => option.value === query.get('account')) ? query.get('account') : 'all');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [treasury, setTreasury] = useState({ data: [], total: 0, current_page: 1, last_page: 1 });
  const [suppliers, setSuppliers] = useState([]);
  const [supplierId, setSupplierId] = useState(query.get('supplier') || '');
  const [supplierStatus, setSupplierStatus] = useState('all');
  const [ledger, setLedger] = useState(null);
  const [payroll, setPayroll] = useState({ employees: [], transactions: [] });
  const [employeeId, setEmployeeId] = useState(query.get('employee') || 'all');
  const [payrollType, setPayrollType] = useState('all');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState({ treasury: false, suppliers: false, ledger: false, payroll: false });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    setAccount(ACCOUNT_OPTIONS.some((option) => option.value === params.get('account')) ? params.get('account') : 'all');
    setSupplierId(params.get('supplier') || '');
    setEmployeeId(params.get('employee') || 'all');
    setPage(1);
  }, [location.search]);

  useEffect(() => {
    if (activeView !== 'treasury') return undefined;
    let cancelled = false;
    setLoading((previous) => ({ ...previous, treasury: true }));
    setErrors((previous) => ({ ...previous, treasury: '' }));
    adminAPI.getTreasuryHistory({ flow, account, search, page })
      .then((response) => { if (!cancelled) setTreasury(response?.data || { data: [], total: 0, current_page: 1, last_page: 1 }); })
      .catch(() => { if (!cancelled) setErrors((previous) => ({ ...previous, treasury: 'Impossible de charger les mouvements.' })); })
      .finally(() => { if (!cancelled) setLoading((previous) => ({ ...previous, treasury: false })); });
    return () => { cancelled = true; };
  }, [activeView, flow, account, search, page, refreshKey]);

  useEffect(() => {
    if (activeView !== 'suppliers') return undefined;
    let cancelled = false;
    setLoading((previous) => ({ ...previous, suppliers: true }));
    setErrors((previous) => ({ ...previous, suppliers: '' }));
    adminAPI.getSuppliers()
      .then((response) => { if (!cancelled) setSuppliers(Array.isArray(response?.data) ? response.data : []); })
      .catch(() => { if (!cancelled) setErrors((previous) => ({ ...previous, suppliers: 'Impossible de charger les fournisseurs.' })); })
      .finally(() => { if (!cancelled) setLoading((previous) => ({ ...previous, suppliers: false })); });
    return () => { cancelled = true; };
  }, [activeView, refreshKey]);

  const effectiveSupplierId = suppliers.some((supplier) => String(supplier.id) === supplierId)
    ? supplierId : String(suppliers[0]?.id || '');

  useEffect(() => {
    if (activeView !== 'suppliers' || !effectiveSupplierId) return undefined;
    let cancelled = false;
    setLoading((previous) => ({ ...previous, ledger: true }));
    setErrors((previous) => ({ ...previous, ledger: '' }));
    adminAPI.getSupplierLedger(effectiveSupplierId)
      .then((response) => { if (!cancelled) setLedger(response?.data || null); })
      .catch(() => { if (!cancelled) setErrors((previous) => ({ ...previous, ledger: 'Impossible de charger les achats.' })); })
      .finally(() => { if (!cancelled) setLoading((previous) => ({ ...previous, ledger: false })); });
    return () => { cancelled = true; };
  }, [activeView, effectiveSupplierId, refreshKey]);

  useEffect(() => {
    if (activeView !== 'payroll') return undefined;
    let cancelled = false;
    setLoading((previous) => ({ ...previous, payroll: true }));
    setErrors((previous) => ({ ...previous, payroll: '' }));
    adminAPI.getEmployeePayrollSnapshot()
      .then((response) => { if (!cancelled) setPayroll(response?.data || { employees: [], transactions: [] }); })
      .catch(() => { if (!cancelled) setErrors((previous) => ({ ...previous, payroll: 'Impossible de charger la paie.' })); })
      .finally(() => { if (!cancelled) setLoading((previous) => ({ ...previous, payroll: false })); });
    return () => { cancelled = true; };
  }, [activeView, refreshKey]);

  const supplierPurchases = useMemo(() => (Array.isArray(ledger?.purchases) ? ledger.purchases : [])
    .filter((purchase) => supplierStatus === 'all'
      || (supplierStatus === 'settled' ? Number(purchase.remaining_amount || 0) <= 0 : Number(purchase.remaining_amount || 0) > 0)), [ledger, supplierStatus]);
  const payrollTransactions = useMemo(() => (Array.isArray(payroll?.transactions) ? payroll.transactions : [])
    .filter((transaction) => (employeeId === 'all' || String(transaction.user_id) === employeeId)
      && (payrollType === 'all' || transaction.transaction_type === payrollType)), [payroll, employeeId, payrollType]);

  return (
    <div className="admin-histories">
      <div className="card admin-histories-heading">
        <div>
          <h2>Historiques</h2>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRefreshKey((current) => current + 1)}>Actualiser</button>
      </div>

      <nav className="admin-histories-tabs" aria-label="Rubriques des historiques">
        {VIEWS.map((item) => (
          <Link key={item.id} to={`/admin/histories?view=${item.id}`} className={`admin-histories-tab ${activeView === item.id ? 'is-active' : ''}`} aria-current={activeView === item.id ? 'page' : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>

      {activeView === 'treasury' ? (
        <section className="card admin-histories-content" aria-label="Mouvements de trésorerie">
          <div className="admin-histories-section-heading"><h3>Mouvements de trésorerie</h3><span>{treasury.total || 0} résultat(s)</span></div>
          <div className="admin-histories-filters">
            <label className="form-group"><span>Type de flux</span><select value={flow} onChange={(event) => { setFlow(event.target.value); setPage(1); }}>{FLOW_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="form-group"><span>Compte concerné</span><select value={account} onChange={(event) => { setAccount(event.target.value); setPage(1); }}>{ACCOUNT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <form className="admin-histories-search" onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); setPage(1); }}>
              <label htmlFor="admin-histories-search">Recherche</label>
              <div><input id="admin-histories-search" type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Motif ou client" maxLength={100} /><button type="submit" className="btn btn-secondary btn-sm">Chercher</button></div>
            </form>
          </div>
          {errors.treasury ? <div className="message error-message">{errors.treasury}</div> : null}
          {loading.treasury ? <div className="loading">Chargement des mouvements...</div> : (
            <div className="table-responsive"><table className="data-table"><thead><tr><th>Date</th><th>Mouvement</th><th>Comptes</th><th>Montant</th><th>Statut</th></tr></thead><tbody>
              {treasury.data?.length ? treasury.data.map((row) => <tr key={row.id}>{treasuryColumns.map((column) => <td key={column.key} data-label={column.header}>{column.render(row)}</td>)}</tr>)
                : <tr><td colSpan="5">Aucun mouvement pour ces filtres.</td></tr>}
            </tbody></table></div>
          )}
          <div className="admin-histories-pagination">
            <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1 || loading.treasury} onClick={() => setPage((current) => current - 1)}>Précédent</button>
            <span>Page {treasury.current_page || page} / {treasury.last_page || 1}</span>
            <button type="button" className="btn btn-secondary btn-sm" disabled={page >= Number(treasury.last_page || 1) || loading.treasury} onClick={() => setPage((current) => current + 1)}>Suivant</button>
          </div>
        </section>
      ) : null}

      {activeView === 'suppliers' ? (
        <section className="card admin-histories-content" aria-label="Historique des achats fournisseurs">
          <div className="admin-histories-section-heading"><h3>Achats fournisseurs</h3><span>{supplierPurchases.length} achat(s)</span></div>
          <div className="admin-histories-filters">
            <label className="form-group"><span>Fournisseur</span><select value={effectiveSupplierId} onChange={(event) => setSupplierId(event.target.value)} disabled={loading.suppliers || suppliers.length === 0}>{suppliers.length === 0 ? <option value="">Aucun fournisseur</option> : suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
            <label className="form-group"><span>Règlement</span><select value={supplierStatus} onChange={(event) => setSupplierStatus(event.target.value)}><option value="all">Tous les achats</option><option value="settled">Réglés</option><option value="open">Avec reste à payer</option></select></label>
          </div>
          {errors.suppliers || errors.ledger ? <div className="message error-message">{errors.suppliers || errors.ledger}</div> : null}
          {loading.suppliers || loading.ledger ? <div className="loading">Chargement des achats...</div> : <DataTable columns={supplierColumns} data={supplierPurchases} rowKey="id" searchPlaceholder="Rechercher une matière ou un règlement..." initialSort={{ key: 'purchased_at', direction: 'desc' }} emptyMessage="Aucun achat pour ce fournisseur et ce filtre." />}
        </section>
      ) : null}

      {activeView === 'payroll' ? (
        <section className="card admin-histories-content" aria-label="Historique de la paie et des avances">
          <div className="admin-histories-section-heading"><h3>Paie et avances</h3><span>{payrollTransactions.length} transaction(s)</span></div>
          <div className="admin-histories-filters">
            <label className="form-group"><span>Employé</span><select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="all">Tous les employés</option>{(payroll.employees || []).map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
            <label className="form-group"><span>Type</span><select value={payrollType} onChange={(event) => setPayrollType(event.target.value)}><option value="all">Toutes les transactions</option><option value="advance">Avances</option><option value="salary_payment">Salaires</option></select></label>
          </div>
          {errors.payroll ? <div className="message error-message">{errors.payroll}</div> : null}
          {loading.payroll ? <div className="loading">Chargement de la paie...</div> : <DataTable columns={payrollColumns} data={payrollTransactions} rowKey="id" searchPlaceholder="Rechercher un employé, un compte ou une référence..." initialSort={{ key: 'paid_at', direction: 'desc' }} emptyMessage="Aucune transaction pour ces filtres." />}
        </section>
      ) : null}
    </div>
  );
};

export default AdminHistories;
