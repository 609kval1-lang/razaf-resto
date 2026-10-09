import React, { useEffect, useState } from 'react';
import { cashierAPI } from '../../../services/api';
import { menuAvailabilityLabel, menuAvailabilityState, menuCategoryLabel, normalizeCashierSearch } from '../../../utils/cashierDisplay';
import './CashierWorkspace.css';

const VISIBLE_BATCH = 12;

export const CashierAvailabilityModule = () => {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('all');
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(VISIBLE_BATCH);

  useEffect(() => {
    let active = true;
    let inFlight = false;
    let queued = false;
    const refresh = async () => {
      if (!active) return;
      if (inFlight) { queued = true; return; }
      inFlight = true;
      setRefreshing(true);
      try {
        const response = await cashierAPI.getAvailability();
        if (active) {
          setSnapshot(response.data);
          setError('');
        }
      } catch {
        if (active) setError('Actualisation impossible. Les dernieres disponibilites affichees peuvent avoir change.');
      } finally {
        inFlight = false;
        if (active) setRefreshing(false);
        if (active && queued) { queued = false; refresh(); }
      }
    };
    const changed = (event) => {
      if (event.detail?.kind !== 'deposit' && document.visibilityState !== 'hidden') refresh();
    };
    refresh();
    window.addEventListener('cashier:changed', changed);
    return () => {
      active = false;
      window.removeEventListener('cashier:changed', changed);
    };
  }, [refreshKey]);

  const menus = Array.isArray(snapshot?.menus) ? snapshot.menus : [];
  const compareCategories = (a, b) => Number(menuCategoryLabel(b) === 'Plats') - Number(menuCategoryLabel(a) === 'Plats')
    || menuCategoryLabel(a).localeCompare(menuCategoryLabel(b), 'fr');
  const categories = [...new Set(menus.map((menu) => menu.category).filter(Boolean))].sort(compareCategories);
  const counts = {
    all: menus.length,
    available: menus.filter((menu) => menu.is_orderable).length,
    low: menus.filter((menu) => menuAvailabilityState(menu) === 'low').length,
    unavailable: menus.filter((menu) => !menu.is_orderable).length,
  };
  const searched = menus.filter((menu) => normalizeCashierSearch(menu.name).includes(normalizeCashierSearch(search))
    && (status === 'all' || (status === 'available' ? menu.is_orderable : menuAvailabilityState(menu) === status)));
  const visible = searched.filter((menu) => !category || menu.category === category);
  const groups = [...new Set(visible.map((menu) => menu.category || ''))].sort(compareCategories)
    .map((value) => ({ category: value, menus: visible.filter((menu) => (menu.category || '') === value)
      .sort((a, b) => Number(b.is_orderable) - Number(a.is_orderable) || a.name.localeCompare(b.name, 'fr')) }));
  const orderedMenus = groups.flatMap((group) => group.menus);
  const updatedAt = snapshot?.updated_at ? new Date(snapshot.updated_at) : null;
  const updateLabel = updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt.toLocaleTimeString('fr-FR') : null;

  return (
    <section className="cq-workspace cq-availability" aria-label="Disponibilites des plats">
      <header className="cq-availability-toolbar">
        <h2>Disponibilites</h2>
        <div className="cq-availability-controls" aria-label="Filtres des disponibilites">
          <label className="cq-search"><span className="cq-filter-label">Rechercher un plat</span><input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setVisibleLimit(VISIBLE_BATCH); }} placeholder="Rechercher un plat..." /></label>
          <label className="cq-field"><span className="cq-filter-label">Categorie</span><select value={category} onChange={(event) => { setCategory(event.target.value); setVisibleLimit(VISIBLE_BATCH); }}>
            <option value="">Toutes les categories</option>
            {categories.map((value) => <option key={value} value={value}>{menuCategoryLabel(value)}</option>)}
          </select></label>
          <label className="cq-field"><span className="cq-filter-label">Disponibilite</span><select value={status} onChange={(event) => { setStatus(event.target.value); setVisibleLimit(VISIBLE_BATCH); }}>
            <option value="all">Tous les plats ({counts.all})</option>
            <option value="available">Disponibles ({counts.available})</option>
            <option value="low">Stock faible ({counts.low})</option>
            <option value="unavailable">Indisponibles ({counts.unavailable})</option>
          </select></label>
        </div>
        <button type="button" className="cq-button" disabled={refreshing}
          title={error ? 'Donnees a reverifier' : updateLabel ? `Derniere actualisation a ${updateLabel}` : 'Chargement...'}
          onClick={() => setRefreshKey((value) => value + 1)}>Actualiser</button>
      </header>
      {error ? <div className="staff-message is-error" role="alert">{error}</div> : null}
      {!snapshot && !error ? <p className="cq-empty" role="status">Chargement des disponibilites...</p> : null}
      {visible.length > 0 ? <div className="cq-availability-grid">{orderedMenus.slice(0, visibleLimit).map((menu) => <article key={menu.id} aria-label={`Disponibilite de ${menu.name}`} className={`cq-availability-card is-${menuAvailabilityState(menu)}`}>
          <h4 className="cq-dish-name">{menu.name}</h4>
          <div className="cq-capacity"><span className="cq-status">{menuAvailabilityLabel(menu)}</span>
            <strong aria-label="Quantite disponible">{menu.is_orderable ? menu.max_portions_available : '0'}</strong>
          </div>
          <details className="cq-ingredients"><summary>Ingredients ({(menu.portions || []).length})</summary>
            {!menu.is_orderable ? <p className="cq-unavailable-reason">{menu.availability_reason || 'Indisponible au catalogue'}</p> : null}
            {(menu.portions || []).map((portion, index) => <p key={index}>{portion.name} : {portion.available}</p>)}
            {!menu.portions?.length ? <p>Aucun ingredient renseigne.</p> : null}
          </details>
        </article>)}</div> : null}
      {visible.length > VISIBLE_BATCH ? <div className="cq-list-progress">
        <span>{Math.min(visibleLimit, visible.length)} sur {visible.length} plats affiches</span>
        {visibleLimit < visible.length ? <button type="button" className="cq-button" onClick={() => setVisibleLimit((limit) => limit + VISIBLE_BATCH)}>Afficher 12 suivants</button> : null}
        {visibleLimit > VISIBLE_BATCH ? <button type="button" className="cq-button" onClick={() => setVisibleLimit(VISIBLE_BATCH)}>Voir moins</button> : null}
      </div> : null}
      {snapshot && !visible.length ? <div className="cq-empty"><h3>Aucun plat ne correspond a votre recherche.</h3>
        <button type="button" className="cq-button" onClick={() => { setSearch(''); setCategory(''); setStatus('all'); }}>Reinitialiser les filtres</button>
      </div> : null}
    </section>
  );
};
