import React, { useCallback, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cashierAPI } from '../../../services/api';
import useCashierRefresh, { notifyCashierChanged } from '../../../hooks/useCashierRefresh';
import { createCheckoutToken } from '../../../utils/cashierOrderDrafts';
import { isWholeAriary } from '../../../utils/ariary';
import { calculateCashTender } from '../../../utils/cashTender';
import CashTenderFields from '../../common/CashTenderFields';
import { CashierCashRegisterModule, CashierPaymentsModule } from './CashierModules';
import './CashierWorkspace.css';

const currency = (value) => `${Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Ar`;
const initialForm = () => ({ customer_name: '', table_id: '', reservation_at: '', amount: '', method: 'cash', reference: '', receipt_token: createCheckoutToken() });
const errorText = (error) => Object.values(error.response?.data?.errors || {}).flat().join(' ')
  || error.response?.data?.message || error.response?.data?.error || 'Operation impossible. Reessayez.';

export function CashierDepositsModule() {
  const [deposits, setDeposits] = useState([]);
  const [tables, setTables] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [received, setReceived] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const submitting = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const response = await cashierAPI.getReservationDeposits();
      setDeposits(response.data);
      const tableResponse = await cashierAPI.getOrderEntryTables();
      setTables(tableResponse.data);
    } catch (failure) { setError(errorText(failure)); }
  }, []);
  useCashierRefresh(refresh);
  const visibleDeposits = deposits.filter((deposit) => `${deposit.customer_name} ${deposit.table?.table_number || ''}`.toLocaleLowerCase('fr')
    .includes(search.trim().toLocaleLowerCase('fr')) && (status === 'all' || (status === 'open' ? deposit.remaining_amount > 0 : deposit.remaining_amount === 0)));
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value, receipt_token: createCheckoutToken() }));

  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current) return;
    if (!isWholeAriary(form.amount) || Number(form.amount) <= 0 || Number(form.amount) > 99999999) {
      setError('Saisissez un acompte entier entre 1 et 99999999 Ar.'); return;
    }
    const tender = calculateCashTender(Number(form.amount), received);
    if (form.method === 'cash' && tender.error) { setError(tender.error); return; }
    const date = new Date(form.reservation_at);
    if (!form.customer_name.trim() || Number.isNaN(date.getTime())) { setError('Renseignez le client et la date de reservation.'); return; }
    submitting.current = true;
    setSaving(true);
    setError('');
    try {
      await cashierAPI.receiveReservationDeposit({
        customer_name: form.customer_name.trim(), table_id: form.table_id ? Number(form.table_id) : null,
        reservation_at: date.toISOString(), amount: Number(form.amount), method: form.method,
        reference: form.reference || null, receipt_token: form.receipt_token,
      });
      setReceipt({ amount: Number(form.amount), change: form.method === 'cash' ? tender.change : null });
      setForm(initialForm()); setReceived('');
      notifyCashierChanged('deposit');
      await refresh();
    } catch (failure) { setError(errorText(failure)); }
    finally { submitting.current = false; setSaving(false); }
  };

  return <div className="staff-module-stack">
    {error ? <div className="staff-message is-error" role="alert">{error}</div> : null}
    {receipt ? <div className="staff-card staff-cash-receipt" role="status">
      <strong>Acompte encaisse : {currency(receipt.amount)}</strong>
      {receipt.change != null ? <span>Monnaie a rendre : {currency(receipt.change)}</span> : null}
      <button type="button" className="staff-btn secondary" onClick={() => setReceipt(null)}>Fermer</button>
    </div> : null}
    <section className="staff-card">
      <div className="staff-card-header"><h2>Acompte de reservation</h2></div>
      <form onSubmit={submit}>
        <fieldset className="co-deposit-form" disabled={saving}>
          <label>Client<input required maxLength={120} value={form.customer_name} onChange={(event) => update('customer_name', event.target.value)} /></label>
          <label>Table<select value={form.table_id} onChange={(event) => {
            const table = tables.find((item) => String(item.id) === event.target.value);
            setForm((current) => ({ ...current, table_id: event.target.value, receipt_token: createCheckoutToken(),
              customer_name: table?.reservation_name || current.customer_name,
              reservation_at: table?.reservation_at ? (() => {
                const date = new Date(table.reservation_at.replace(' ', 'T'));
                if (Number.isNaN(date.getTime())) return current.reservation_at;
                const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
                return local.toISOString().slice(0, 16);
              })() : current.reservation_at,
            }));
          }}><option value="">Sans table attribuee</option>{tables.map((table) => <option key={table.id} value={table.id}>Table {table.table_number}</option>)}</select></label>
          <label>Date de reservation<input required type="datetime-local" value={form.reservation_at} onChange={(event) => update('reservation_at', event.target.value)} /></label>
          <label>Montant de l'acompte<input required type="number" min="1" max="99999999" step="1" value={form.amount} onChange={(event) => update('amount', event.target.value)} /></label>
          <label>Mode d'encaissement<select value={form.method} onChange={(event) => update('method', event.target.value)}>
            <option value="cash">Especes</option><option value="mobile_money">Mobile Money</option><option value="transfer">Virement</option><option value="check">Cheque</option>
          </select></label>
          <label>Reference<input maxLength={255} value={form.reference} onChange={(event) => update('reference', event.target.value)} /></label>
          {form.method === 'cash' ? <CashTenderFields due={Number(form.amount || 0)} value={received} onChange={setReceived} /> : null}
        </fieldset>
        <button className="staff-btn primary" type="submit" disabled={saving}>{saving ? 'Enregistrement...' : "Encaisser l'acompte"}</button>
      </form>
    </section>
    <section className="staff-card">
      <div className="staff-card-header"><h2>Acomptes</h2><button type="button" className="staff-btn secondary" onClick={refresh}>Actualiser</button></div>
      <div className="co-list-filters">
        <label>Rechercher un acompte<input type="search" placeholder="Client ou table" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label>Statut de l'acompte<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Tous les acomptes</option><option value="open">Avec solde</option><option value="applied">Soldes appliques</option></select></label>
        <strong>{visibleDeposits.length} acompte(s)</strong>
      </div>
      <div className="co-deposit-list">{visibleDeposits.map((deposit) => <article className="co-deposit-card" key={deposit.id}>
        <div><strong>{deposit.customer_name}</strong><span>{deposit.table ? `Table ${deposit.table.table_number}` : 'Sans table attribuee'}</span>
          <span className="co-deposit-state">{deposit.remaining_amount === 0 ? 'Applique' : deposit.available_amount < deposit.remaining_amount ? 'Addition en attente' : 'Disponible'}</span></div>
        <div className="co-reservation-date"><span>Reservation</span><time dateTime={deposit.reservation_at}>{new Date(deposit.reservation_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</time>
          <strong>{new Date(deposit.reservation_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</strong></div>
        <div className="co-deposit-amount"><span>Encaisse : {currency(deposit.amount)}</span><strong>Solde : {currency(deposit.remaining_amount)}</strong></div>
      </article>)}</div>
      {!deposits.length ? <p className="staff-muted">Aucun acompte enregistre.</p> : null}
      {deposits.length > 0 && !visibleDeposits.length ? <p className="staff-muted">Aucun acompte ne correspond aux filtres.</p> : null}
    </section>
  </div>;
}

export function CashierOperationsModule() {
  const [params, setParams] = useSearchParams();
  const tab = ['bons', 'acomptes'].includes(params.get('tab')) ? params.get('tab') : 'sorties';
  return <div className="cq-workspace co-operations">
    <nav className="cq-category-tabs co-tabs" aria-label="Operations de caisse">
      {[['sorties', 'Sorties de caisse'], ['bons', 'Encaissement des bons'], ['acomptes', 'Acomptes']].map(([value, label]) =>
        <button type="button" key={value} aria-pressed={tab === value} onClick={() => setParams({ tab: value })}>{label}</button>)}
    </nav>
    {tab === 'sorties' ? <CashierCashRegisterModule /> : tab === 'bons' ? <CashierPaymentsModule scope="vouchers" /> : <CashierDepositsModule />}
  </div>;
}
