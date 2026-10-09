import React, { useEffect, useRef, useState } from 'react';
import { cashierAPI } from '../../../services/api';
import { createCheckoutToken } from '../../../utils/cashierOrderDrafts';
import { notifyCashierChanged } from '../../../hooks/useCashierRefresh';

const currency = (value) => `${Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Ar`;
const tableIds = (order) => [...new Set([Number(order.table_id), ...(order.linked_table_ids || [])].filter(Boolean))];

export default function CashierOtherAdditions({ onNewOrder, onOpenOrder, onBack }) {
  const [orders, setOrders] = useState([]);
  const [selected, setSelected] = useState([]);
  const [groups, setGroups] = useState([]);
  const [stage, setStage] = useState('selection');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState(createCheckoutToken);
  const submitting = useRef(false);
  useEffect(() => {
    let active = true;
    cashierAPI.getReadyOrders({ include_items: 1 }).then((response) => { if (active) setOrders(response.data); })
      .catch(() => { if (active) setError('Impossible de charger les commandes.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const sources = orders.filter((order) => selected.includes(order.id));
  const items = sources.flatMap((order) => (order.items || []).map((item) => ({ ...item, source_table_id: item.source_table_id || order.table_id })));
  const allTables = [...new Set(sources.flatMap(tableIds))];
  const valid = groups.length > 0 && groups.every((group) => group.label.trim() && Object.values(group.quantities).some((value) => value > 0))
    && items.every((item) => groups.reduce((sum, group) => sum + Number(group.quantities[item.id] || 0), 0) === Number(item.quantity))
    && allTables.every((id) => groups.some((group) => group.table_ids.includes(id)))
    && groups.every((group) => Object.values(group.quantities).every((value) => Number.isSafeInteger(value) && value >= 0));
  const groupTotal = (group) => items.reduce((sum, item) => sum + Number(item.price_at_order) * (group.quantities[item.id] || 0), 0);
  const updateGroup = (index, update) => {
    setGroups((current) => current.map((group, position) => position === index ? update(group) : group));
    setToken(createCheckoutToken());
  };
  const start = (mode) => {
    setError('');
    if (mode === 'merge') {
      setGroups([{ label: 'Addition commune', table_ids: allTables, quantities: Object.fromEntries(items.map((item) => [item.id, Number(item.quantity)])) }]);
    } else {
      const partitions = new Map();
      items.forEach((item) => {
        const key = Number(item.source_table_id || 0);
        if (!partitions.has(key)) partitions.set(key, { label: key ? `Table ${orders.find((order) => Number(order.table_id) === key)?.table?.table_number || key}` : 'Addition 1',
          table_ids: key ? [key] : allTables, quantities: {} });
        partitions.get(key).quantities[item.id] = Number(item.quantity);
      });
      const next = [...partitions.values()];
      if (next.length === 1) next.push({ label: 'Addition 2', table_ids: allTables, quantities: {} });
      setGroups(next);
    }
    setToken(createCheckoutToken());
    setStage('allocation');
  };
  const submit = async () => {
    if (submitting.current || !valid) return;
    submitting.current = true; setSaving(true); setError('');
    try {
      const response = await cashierAPI.redistributeAdditions({ order_ids: selected, checkout_token: token,
        groups: groups.map((group) => ({ label: group.label.trim(), table_ids: group.table_ids,
          items: items.filter((item) => group.quantities[item.id] > 0).map((item) => ({ item_id: item.id, quantity: group.quantities[item.id] })),
        })),
      });
      notifyCashierChanged();
      onOpenOrder(response.data[0]);
    } catch (failure) {
      setError(Object.values(failure.response?.data?.errors || {}).flat().join(' ') || failure.response?.data?.message || 'Repartition impossible. Reessayez.');
    } finally { submitting.current = false; setSaving(false); }
  };

  return <section className="co-other" aria-label="Autres additions">
    <div className="cq-section-heading"><h3>{stage === 'review' ? 'Recapitulatif des additions' : stage === 'allocation' ? 'Repartition des additions' : 'Autres'}</h3>
      <button type="button" className="cq-button" disabled={saving} onClick={stage === 'selection' ? onBack : () => setStage(stage === 'review' ? 'allocation' : 'selection')}>Retour</button></div>
    {error ? <div className="staff-message is-error" role="alert">{error}</div> : null}
    {stage === 'selection' ? <>
      <form className="co-new-addition" onSubmit={(event) => { event.preventDefault(); if (label.trim()) onNewOrder(label.trim()); }}>
        <label className="cq-field">Nom de l'addition<input required maxLength={120} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
        <button type="submit" className="cq-button is-primary">Nouvelle addition</button>
      </form>
      <h4>Commandes en cours</h4>
      {loading ? <p role="status">Chargement...</p> : null}
      <div className="co-order-list">{orders.map((order) => {
        const editable = !(order.payments || []).length && (order.items || []).length > 0;
        return <article key={order.id} className="co-order-card">
          <label><input type="checkbox" checked={selected.includes(order.id)} disabled={!editable}
            onChange={() => setSelected((current) => current.includes(order.id) ? current.filter((id) => id !== order.id) : [...current, order.id])} />
            <strong>{order.order_label || (order.order_type === 'takeaway' ? 'A emporter' : `Table ${order.table?.table_number || '-'}`)}</strong>
            <span>Commande #{order.id}</span></label>
          <strong>{currency(order.total_amount)}</strong>
          <button type="button" className="cq-button" onClick={() => onOpenOrder(order)}>Reprendre</button>
        </article>;
      })}</div>
      <div className="cq-heading-actions">
        <button type="button" className="cq-button" disabled={selected.length < 2} onClick={() => start('merge')}>Regrouper les additions</button>
        <button type="button" className="cq-button" disabled={!selected.length} onClick={() => start('split')}>Diviser les additions</button>
      </div>
    </> : stage === 'allocation' ? <>
      <div className="co-group-list">{groups.map((group, index) => <article key={index} className="co-group-card">
        <label className="cq-field">Addition {index + 1}<input aria-label={`Nom addition ${index + 1}`} maxLength={120} value={group.label}
          onChange={(event) => updateGroup(index, (current) => ({ ...current, label: event.target.value }))} /></label>
        <div className="co-table-checks">{allTables.map((id) => <label key={id}><input type="checkbox" checked={group.table_ids.includes(id)}
          onChange={() => updateGroup(index, (current) => ({ ...current, table_ids: current.table_ids.includes(id) ? current.table_ids.filter((value) => value !== id) : [...current.table_ids, id] }))} />
          Table {orders.find((order) => Number(order.table_id) === id)?.table?.table_number || id}</label>)}</div>
        {items.map((item) => <label key={item.id} className="co-quantity-line"><span>{item.menu?.name || 'Plat archive'} / #{item.order_id}</span>
          <input aria-label={`Quantite ${item.id} addition ${index + 1}`} type="number" min="0" max={item.quantity} step="1" value={group.quantities[item.id] || 0}
            onChange={(event) => updateGroup(index, (current) => ({ ...current, quantities: { ...current.quantities, [item.id]: Number(event.target.value) } }))} /></label>)}
        <strong>{currency(groupTotal(group))}</strong>
        {groups.length > 1 ? <button type="button" className="cq-button" onClick={() => { setGroups((current) => current.filter((_, position) => position !== index)); setToken(createCheckoutToken()); }}>Retirer cette addition</button> : null}
      </article>)}</div>
      <div className="co-allocation-status" role="status">{items.map((item) => <span key={item.id}>{item.menu?.name || 'Plat archive'} : {groups.reduce((sum, group) => sum + (group.quantities[item.id] || 0), 0)} / {item.quantity}</span>)}</div>
      <div className="cq-heading-actions"><button type="button" className="cq-button" disabled={groups.length >= 20} onClick={() => {
        setGroups((current) => [...current, { label: `Addition ${current.length + 1}`, table_ids: allTables, quantities: {} }]); setToken(createCheckoutToken());
      }}>Ajouter une addition</button>
        <button type="button" className="cq-button is-primary" disabled={!valid} onClick={() => setStage('review')}>Verifier les additions</button></div>
    </> : <>
      <div className="co-group-list">{groups.map((group, index) => <article key={index} className="co-group-card"><h4>{group.label}</h4>
        {items.filter((item) => group.quantities[item.id] > 0).map((item) => <div key={item.id} className="co-quantity-line"><span>{group.quantities[item.id]} x {item.menu?.name || 'Plat archive'}</span>
          <strong>{currency(group.quantities[item.id] * Number(item.price_at_order))}</strong></div>)}
        <strong>Total : {currency(groupTotal(group))}</strong></article>)}</div>
      <button type="button" className="cq-button is-primary" disabled={!valid || saving} onClick={submit}>{saving ? 'Enregistrement...' : 'Confirmer et passer au paiement'}</button>
    </>}
  </section>;
}
