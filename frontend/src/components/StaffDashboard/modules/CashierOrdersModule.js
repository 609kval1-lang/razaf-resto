import React, { useEffect, useRef, useState } from 'react';
import { cashierAPI, resolveApiAssetUrl } from '../../../services/api';
import { useAuth } from '../../../contexts/AuthContext';
import { menuAvailabilityLabel, menuAvailabilityState, menuCategoryLabel, normalizeCashierSearch } from '../../../utils/cashierDisplay';
import { buildOrderDraftCart, createCheckoutToken, getDraftStockState, persistOrderDrafts, readOrderDrafts } from '../../../utils/cashierOrderDrafts';
import { notifyCashierChanged } from '../../../hooks/useCashierRefresh';
import { CashierPaymentsModule } from './CashierModules';
import CashierOtherAdditions from './CashierOtherAdditions';
import './CashierWorkspace.css';

const EMPTY_DRAFT = { quantities: {}, notes: '' };
const formatCurrency = (value) => `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Ar`;
const apiError = (error) => Object.values(error.response?.data?.errors || {}).flat().join(' ')
  || error.response?.data?.error || error.response?.data?.message || 'Connexion impossible. Votre brouillon est conserve. Reessayez.';

const CashierOrderEntry = ({ storageKey }) => {
  const [tables, setTables] = useState([]);
  const [freeOrders, setFreeOrders] = useState([]);
  const [selectedOrderLabel, setSelectedOrderLabel] = useState('');
  const [tableId, setTableId] = useState('');
  const [tableFilter, setTableFilter] = useState('all');
  const [tableSearch, setTableSearch] = useState('');
  const [step, setStep] = useState('tables');
  const [orderId, setOrderId] = useState(null);
  const [drafts, setDrafts] = useState(() => readOrderDrafts(storageKey));
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [catalogue, setCatalogue] = useState({ data: [], categories: [], page: 1, last_page: 1 });
  const [menuCache, setMenuCache] = useState({});
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const table = tables.find((item) => String(item.id) === tableId);
  const orderType = tableId.startsWith('takeaway:') ? 'takeaway' : tableId.startsWith('other:') ? 'other' : 'dine_in';
  const draft = drafts[tableId] || EMPTY_DRAFT;
  const selectionLabel = selectedOrderLabel || (orderType === 'takeaway' ? 'A emporter' : orderType === 'other' ? draft.label || 'Autres' : `Table ${table?.table_number || tableId}`);
  const draftIds = Object.keys(draft.quantities).join(',');
  const menus = Object.values(menuCache);
  const cart = buildOrderDraftCart(draft, menus);
  const total = cart.reduce((sum, item) => sum + (item.total ?? 0), 0);
  const stock = getDraftStockState(draft, menus);
  const invalidCart = !cart.length || cart.some((item) => !item.isAvailable) || stock.exceedsStock;
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const draftCount = (item) => Object.values(drafts[item.id]?.quantities || {}).reduce((sum, quantity) => sum + quantity, 0);
  const matchesTableFilter = (item, filter) => filter === 'all'
    || (filter === 'occupied' && Boolean(item.active_order_id))
    || (filter === 'free' && !item.active_order_id && !item.reservation_locked)
    || (filter === 'draft' && !item.active_order_id && !item.reservation_locked && draftCount(item) > 0);
  const tableCounts = Object.fromEntries(['all', 'free', 'occupied', 'draft'].map((filter) => [filter, tables.filter((item) => matchesTableFilter(item, filter)).length]));
  const visibleTables = tables.filter((item) => matchesTableFilter(item, tableFilter)
    && normalizeCashierSearch(`Table ${item.table_number}`).includes(normalizeCashierSearch(tableSearch)));

  useEffect(() => {
    setStorageAvailable(persistOrderDrafts(storageKey, drafts));
  }, [drafts, storageKey]);

  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [search, query]);

  useEffect(() => {
    if (step !== 'tables') return;
    let active = true;
    setLoading(true);
    setError('');
    cashierAPI.getOrderEntryTables().then((response) => {
      if (active) setTables(Array.isArray(response.data) ? response.data : []);
    }).catch((requestError) => { if (active) setError(apiError(requestError)); })
      .finally(() => { if (active) setLoading(false); });
    if (cashierAPI.getReadyOrders) cashierAPI.getReadyOrders({ scope: 'unassigned' }).then((response) => {
      if (active) setFreeOrders(response.data);
    }).catch((requestError) => { if (active) setError(apiError(requestError)); });
    return () => { active = false; };
  }, [step, revision]);

  useEffect(() => {
    if (step !== 'menus') return;
    let active = true;
    setLoading(true);
    setError('');
    cashierAPI.getOrderEntryMenus({ paginate: 1, page, search: query, category }).then((response) => {
      if (!active) return;
      const result = response.data;
      setCatalogue(result);
      setMenuCache((current) => ({ ...current, ...Object.fromEntries(result.data.map((menu) => [menu.id, menu])) }));
    }).catch((requestError) => { if (active) setError(apiError(requestError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [step, page, query, category, revision]);

  useEffect(() => {
    if (!draftIds || !['menus', 'review'].includes(step)) return;
    let active = true;
    cashierAPI.getOrderEntryMenus({ ids: draftIds.split(',').map(Number) }).then((response) => {
      if (!active) return;
      setMenuCache((current) => {
        const next = { ...current };
        draftIds.split(',').forEach((id) => delete next[id]);
        response.data.forEach((menu) => { next[menu.id] = menu; });
        return next;
      });
    }).catch((requestError) => { if (active) setError(apiError(requestError)); });
    return () => { active = false; };
  }, [step, tableId, draftIds, revision]);

  const updateDraft = (update) => {
    if ((!table && orderType === 'dine_in') || submitting.current) return;
    setDrafts((current) => {
      const previous = current[tableId] || { ...EMPTY_DRAFT, checkoutToken: createCheckoutToken() };
      return { ...current, [tableId]: update(previous) };
    });
  };

  const changeQuantity = (menu, delta) => {
    if (delta > 0 && (!stock.canAdd(menu) || (draft.quantities[menu.id] || 0) >= 100000)) return;
    updateDraft((previous) => {
      if (delta > 0 && !getDraftStockState(previous, menus).canAdd(menu)) return previous;
      const quantities = { ...previous.quantities };
      const quantity = (quantities[menu.id] || 0) + delta;
      if (quantity > 0) quantities[menu.id] = quantity;
      else delete quantities[menu.id];
      return { ...previous, quantities };
    });
  };

  const chooseTable = (selected) => {
    setSelectedOrderLabel('');
    setTableId(String(selected.id));
    setError('');
    setSearch('');
    setQuery('');
    setCategory('');
    setPage(1);
    setOrderId(selected.active_order_id || null);
    setStep(selected.active_order_id ? 'payment' : 'menus');
  };

  const chooseFree = (type, label = '') => {
    const key = `${type}:${createCheckoutToken()}`;
    setDrafts((current) => ({ ...current, [key]: { ...EMPTY_DRAFT, quantities: {}, label, checkoutToken: createCheckoutToken() } }));
    setTableId(key); setSelectedOrderLabel(''); setOrderId(null); setError('');
    setSearch(''); setQuery(''); setCategory(''); setPage(1); setStep('menus');
  };
  const openOrder = (order) => {
    setTableId(order.table_id ? String(order.table_id) : ''); setOrderId(order.id);
    setSelectedOrderLabel(order.order_label || (order.order_type === 'takeaway' ? 'A emporter' : `Table ${order.table?.table_number || order.table_id}`));
    setStep('payment'); setError('');
  };

  const createOrder = async () => {
    if (submitting.current || invalidCart) return;
    submitting.current = true;
    setSaving(true);
    setError('');
    const checkoutToken = draft.checkoutToken || createCheckoutToken();
    const snapshot = { ...draft, checkoutToken };
    const nextDrafts = { ...drafts, [tableId]: snapshot };
    setDrafts(nextDrafts);
    persistOrderDrafts(storageKey, nextDrafts);
    try {
      const response = await cashierAPI.createOrderEntry({
        table_id: orderType === 'dine_in' ? Number(tableId) : null,
        ...(orderType !== 'dine_in' ? { order_type: orderType, ...(orderType === 'other' ? { order_label: snapshot.label } : {}) } : {}),
        checkout_token: checkoutToken, notes: snapshot.notes,
        items: Object.entries(snapshot.quantities).map(([menuId, quantity]) => ({ menu_id: Number(menuId), quantity })),
      });
      setOrderId(response.data.id);
      setSelectedOrderLabel(selectionLabel);
      const remainingDrafts = { ...nextDrafts };
      delete remainingDrafts[tableId];
      setDrafts(remainingDrafts);
      persistOrderDrafts(storageKey, remainingDrafts);
      setStep('payment');
      notifyCashierChanged();
    } catch (requestError) {
      setError(apiError(requestError));
      try {
        const response = await cashierAPI.getOrderEntryTables();
        setTables(response.data);
      } catch {}
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  const resumeOrder = table?.active_order_id;

  return (
    <div className="cq-workspace cq-orders" aria-busy={loading || saving}>
      <header className="cq-heading">
        <h2>{step === 'tables' ? 'Commandes' : step === 'other' ? 'Autres' : selectionLabel}</h2>
        <div className="cq-heading-actions">
          {step !== 'tables' ? <button type="button" className="cq-button" disabled={saving} onClick={() => setStep('tables')}>Tables</button> : null}
          {step === 'review' ? <button type="button" className="cq-button" disabled={saving} onClick={() => setStep('menus')}>Modifier les plats</button> : null}
          {step !== 'payment' ? <button type="button" className="cq-button" disabled={loading || saving} onClick={() => { setError(''); setRevision((value) => value + 1); }}>Actualiser</button> : null}
        </div>
      </header>
      <ol className="cq-progress" aria-label="Parcours de commande">{[['tables', 'Table'], ['menus', 'Plats'], ['review', 'Recapitulatif'], ['payment', 'Paiement']]
        .map(([value, label], index) => <li key={value} aria-current={step === value ? 'step' : undefined}>
          <span>{String(index + 1).padStart(2, '0')}</span>{label}
        </li>)}
      </ol>

      {error ? <div className="staff-message is-error" role="alert">{error}
        {resumeOrder ? <button type="button" className="staff-btn secondary" onClick={() => { setOrderId(resumeOrder); setError(''); setStep('payment'); }}>Reprendre la commande #{resumeOrder}</button> : null}
      </div> : null}
      {!storageAvailable ? <div className="staff-message is-error" role="alert">La sauvegarde du brouillon est indisponible dans ce navigateur. Ne quittez pas cet ecran avant la validation.</div> : null}

      {step === 'tables' ? (
        <section aria-label="Tables" className="cq-table-board">
          <nav className="cq-category-tabs co-entry-types" aria-label="Type de commande">
            <button type="button" aria-pressed="true">Tables</button>
            <button type="button" onClick={() => chooseFree('takeaway')}>A emporter</button>
            <button type="button" onClick={() => setStep('other')}>Autres</button>
          </nav>
          {freeOrders.length || Object.keys(drafts).some((key) => key.includes(':')) ? <div className="co-order-list" aria-label="Additions sans table et brouillons">
            {freeOrders.map((order) => <button type="button" key={order.id} className="cq-button" onClick={() => openOrder(order)}>{order.order_label || 'A emporter'} / #{order.id} / {formatCurrency(order.total_amount)}</button>)}
            {Object.entries(drafts).filter(([key]) => key.includes(':')).map(([key, value]) => <button type="button" key={key} className="cq-button" onClick={() => {
              setTableId(key); setSelectedOrderLabel(''); setStep('menus'); setSearch(''); setQuery(''); setCategory(''); setPage(1);
            }}>{value.label || 'A emporter'} / Brouillon</button>)}
          </div> : null}
          <div className="cq-metrics" aria-label="Vue globale des commandes">
            {[['all', 'Toutes les tables'], ['free', 'Tables libres'],
              ['occupied', 'Commandes en cours'], ['draft', 'Brouillons']]
              .map(([value, label]) => <button key={value} type="button" className={`cq-metric is-${value}`}
                aria-pressed={tableFilter === value} onClick={() => setTableFilter(value)}>
                <span>{label}</span><strong>{tableCounts[value]}</strong>
              </button>)}
          </div>
          <div className="cq-filter-bar">
            <label className="cq-search">Rechercher une table<input type="search" value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} placeholder="Numero de table..." /></label>
            <span className="cq-result-count">{visibleTables.length} / {tables.length} tables</span>
          </div>
          <div className="cq-table-grid">
            {visibleTables.map((item) => {
              const count = draftCount(item);
              const state = item.active_order_id ? 'occupied' : item.reservation_locked ? 'reserved' : count ? 'draft' : 'free';
              return <article className={`cq-table-card is-${state}`} key={item.id}>
                <div className="cq-table-card-heading"><span>Table</span><span className="cq-status">
                  {item.active_order_id ? 'En cours' : item.reservation_locked ? 'Reservee' : count ? 'Brouillon' : 'Libre'}
                </span></div>
                <strong className="cq-table-number">{String(item.table_number).padStart(2, '0')}</strong>
                <p className="cq-table-capacity">{item.capacity} places</p>
                <div className="cq-table-order">
                  {item.active_order_id ? <><span>Commande #{item.active_order_id}{item.active_order?.item_count ? ` / ${item.active_order.item_count} articles` : ''}</span>
                    {item.active_order?.total_amount != null ? <strong>{formatCurrency(item.active_order.total_amount)}</strong> : null}</>
                    : count ? <span>{count} article(s) en brouillon</span>
                      : item.reservation_locked || item.status === 'reserved' ? <span>{item.reservation_locked ? 'Reservation en cours' : 'Reservation prochaine'}</span> : null}
                </div>
                <button type="button" className="cq-button cq-table-action" disabled={loading || (!item.active_order_id && item.reservation_locked)}
                  aria-label={`Selectionner la table ${item.table_number}`} onClick={() => chooseTable(item)}>
                  {item.active_order_id ? 'Reprendre le paiement' : count ? 'Reprendre le panier' : 'Selectionner'}
                </button>
                {(item.active_orders || []).length > 1 ? item.active_orders.slice(1).map((order) => <button key={order.id} type="button" className="cq-button"
                  onClick={() => openOrder({ ...order, table_id: item.id, table: { table_number: item.table_number } })}>{order.order_label || `Addition #${order.id}`}</button>) : null}
              </article>;
            })}
          </div>
          {loading && !tables.length ? <p className="cq-empty" role="status">Chargement des tables...</p> : null}
          {!loading && !visibleTables.length && !error ? <div className="cq-empty"><h3>{tables.length ? 'Aucune table ne correspond aux filtres.' : 'Aucune table disponible.'}</h3>
            {tables.length ? <button type="button" className="cq-button" onClick={() => { setTableFilter('all'); setTableSearch(''); }}>Reinitialiser les filtres</button> : null}
          </div> : null}
        </section>
      ) : null}

      {step === 'menus' ? (
        <div className="cq-order-layout">
        <section className="cq-catalogue" aria-label="Catalogue des plats">
          <div className="cq-section-heading"><h3>Plats et boissons</h3><span>{catalogue.total ?? catalogue.data.length} plats</span></div>
          <div className="cq-filter-bar">
            <label className="cq-search">Rechercher un plat<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nom du plat..." /></label>
          </div>
          <div className="cq-category-tabs" aria-label="Categories des plats">
            <button type="button" aria-pressed={!category} onClick={() => { setCategory(''); setPage(1); }}>Toutes les categories</button>
            {catalogue.categories.map((value) => <button key={value} type="button" aria-pressed={category === value}
              onClick={() => { setCategory(value); setPage(1); }}>{menuCategoryLabel(value)}</button>)}
          </div>
          <div className="cq-order-menu-grid">
            {catalogue.data.map((menu) => {
              const quantity = draft.quantities[menu.id] || 0;
              const image = resolveApiAssetUrl(menu.image_url);
              return <button key={menu.id} type="button" className={`cq-menu-card is-${menuAvailabilityState(menu)} ${quantity ? 'is-selected' : ''}`}
                aria-label={`Ajouter ${menu.name}`} disabled={loading || !stock.canAdd(menu)} onClick={() => changeQuantity(menu, 1)}>
                <span className="cq-menu-card-heading">{image ? <img loading="lazy" className="cq-menu-thumbnail" src={image} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} /> : null}
                  <strong>{menu.name}</strong>{quantity > 0 ? <span className="cq-selected-count">{quantity}</span> : null}</span>
                <span className="cq-menu-price">{formatCurrency(menu.price)}</span>
                <span className="cq-menu-capacity"><span className="cq-status">{menuAvailabilityLabel(menu)}</span>
                  <strong>{menu.is_orderable ? `${menu.max_portions_available} possibles` : menu.availability_reason || 'Indisponible'}</strong>
                </span>
                <span className="cq-menu-action">{stock.canAdd(menu) ? 'Ajouter au panier' : menu.is_orderable ? 'Limite du panier atteinte' : 'Non commandable'}</span>
              </button>;
            })}
          </div>
          {loading ? <p className="cq-inline-loading" role="status">Actualisation du catalogue...</p> : null}
          {!loading && !catalogue.data.length && !error ? <p className="cq-empty">Aucun plat ne correspond a votre recherche.</p> : null}
          <div className="cq-pagination">
            <button type="button" className="cq-button" disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>Precedent</button>
            <span>Page {catalogue.page} / {catalogue.last_page}</span>
            <button type="button" className="cq-button" disabled={loading || page >= catalogue.last_page} onClick={() => setPage((value) => value + 1)}>Suivant</button>
          </div>
        </section>
        <aside className="cq-basket" aria-label="Panier de la table">
          <header className="cq-basket-heading"><span className="cq-eyebrow">{selectionLabel}</span>
            <h3>Votre panier <span>{cartCount}</span></h3><p>{cart.length} plats differents</p></header>
          <div className="cq-basket-items">{cart.length ? cart.map((item) => <article className="cq-basket-item" key={item.menuId}>
            <div><strong>{item.name}</strong><span>{item.total === null ? 'A verifier' : formatCurrency(item.total)}</span></div>
            <div className="cq-quantity-controls"><button type="button" aria-label={`Diminuer ${item.name}`} onClick={() => changeQuantity(menuCache[item.menuId] || { id: item.menuId }, -1)}>Moins</button>
              <output aria-label={`Quantite de ${item.name}`}>{item.quantity}</output>
              <button type="button" aria-label={`Augmenter ${item.name}`} disabled={!menuCache[item.menuId] || !stock.canAdd(menuCache[item.menuId])} onClick={() => changeQuantity(menuCache[item.menuId], 1)}>Plus</button>
            </div>
          </article>) : <p className="cq-basket-empty">Panier vide</p>}</div>
          {invalidCart && cart.length > 0 ? <p className="cq-basket-warning">Le stock ou le catalogue a change. Ajustez le panier avant de confirmer.</p> : null}
          <footer className="cq-cart-footer"><div><span>Total de la commande</span><strong>{formatCurrency(total)}</strong></div>
            <button type="button" className="cq-button is-primary" disabled={!cart.length || loading} onClick={() => setStep('review')}>
              Voir le panier ({cartCount})
            </button></footer>
        </aside>
        </div>
      ) : null}

      {step === 'review' ? (
        <section className="cq-review" aria-label="Recapitulatif">
          <div className="cq-section-heading"><h3>Recapitulatif de la commande</h3><span>{cartCount} articles / {selectionLabel}</span></div>
          {invalidCart ? <div className="staff-message is-error" role="alert">Le stock ou le catalogue a change. Modifiez les plats ou reduisez les quantites.</div> : null}
          <div className="cq-review-layout"><div className="cq-review-items">{cart.map((item) => <article className="cq-review-item" key={item.menuId}>
            <div className="cq-review-dish"><strong>{item.name}</strong><span>{item.quantity} x {item.unitPrice === null ? 'Prix indisponible' : formatCurrency(item.unitPrice)}</span></div>
            <strong className="cq-review-subtotal">{item.total === null ? 'A verifier' : formatCurrency(item.total)}</strong>
            <div className="cq-quantity-controls">
              <button type="button" disabled={saving} aria-label={`Diminuer ${item.name}`} onClick={() => changeQuantity(menuCache[item.menuId] || { id: item.menuId }, -1)}>Moins</button>
              <output>{item.quantity}</output>
              <button type="button" disabled={saving || !menuCache[item.menuId] || !stock.canAdd(menuCache[item.menuId])} aria-label={`Augmenter ${item.name}`} onClick={() => changeQuantity(menuCache[item.menuId], 1)}>Plus</button>
              <button type="button" className="cq-remove" disabled={saving} onClick={() => updateDraft((previous) => {
                const quantities = { ...previous.quantities }; delete quantities[item.menuId]; return { ...previous, quantities };
              })}>Retirer</button>
            </div>
          </article>)}</div><aside className="cq-review-summary">
          <label className="cq-field">{orderType === 'dine_in' ? 'Notes de la table' : 'Notes de la commande'}<textarea rows="3" maxLength={5000} value={draft.notes} disabled={saving}
            onChange={(event) => updateDraft((previous) => ({ ...previous, notes: event.target.value }))} /></label>
          <div className="cq-review-total"><span>Total de la commande</span><output aria-label="Total du brouillon">{formatCurrency(total)}</output></div>
          <button type="button" className="cq-button is-primary" disabled={saving || invalidCart} onClick={createOrder}>
            {saving ? 'Enregistrement...' : 'Confirmer et passer au paiement'}
          </button>
          </aside></div>
        </section>
      ) : null}

      {step === 'payment' && orderId ? <CashierPaymentsModule key={orderId} orderId={orderId} /> : null}
      {step === 'other' ? <CashierOtherAdditions onBack={() => setStep('tables')} onNewOrder={(label) => chooseFree('other', label)} onOpenOrder={openOrder} /> : null}
    </div>
  );
};

export const CashierOrdersModule = () => {
  const { user } = useAuth();
  if (!user?.id) return null;
  const storageKey = `cashier.order-entry.drafts.${user.id}`;
  return <CashierOrderEntry key={storageKey} storageKey={storageKey} />;
};
