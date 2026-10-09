import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminAPI } from '../../services/api';

const HELP_SECTIONS = [
  {
    id: 'treasury',
    label: 'Trésorerie',
    title: 'Suivre les mouvements et les comptes',
    page: '/admin/treasury',
    pageLabel: 'Ouvrir la trésorerie',
    topics: [
      { title: 'Historique des mouvements', text: 'Les encaissements clients, les paiements et les transferts sont réunis dans Finance > Historiques. Filtrez-y les mouvements par type de flux et par compte.' },
      { title: 'Paiements en attente', text: 'Un paiement client en attente ne figure pas parmi les mouvements encaissés. Les bons à encaisser restent dans la liste dédiée jusqu’à leur règlement.' },
      { title: 'Transferts et décaissements', text: 'Un transfert déplace de l’argent entre deux comptes sans changer le total de la trésorerie. Un décaissement sort de l’argent du compte choisi.' },
    ],
  },
  {
    id: 'customer-payments',
    label: 'Encaissements clients',
    title: 'Comprendre les paiements clients',
    page: '/admin/treasury',
    pageLabel: 'Voir les bons à encaisser',
    topics: [
      { title: 'Bon client', text: 'L’impression d’un bon ne crédite aucun compte. Choisissez le mode réellement utilisé au moment de l’encaissement.' },
      { title: 'Compte alimenté', text: 'Le mode de règlement détermine le compte crédité. Le compte affiché à côté du bon permet de le vérifier avant de valider.' },
      { title: 'Remises et acomptes', text: 'Consultez le montant effectivement encaissé dans l’historique des mouvements. Une remise ou un acompte ne doit pas être compté une deuxième fois comme nouvelle entrée.' },
    ],
  },
  {
    id: 'stock',
    label: 'Stocks et achats',
    title: 'Acheter et suivre les matières premières',
    page: '/admin/raw-materials',
    pageLabel: 'Ouvrir les matières premières',
    topics: [
      { title: 'Achat et fournisseur', text: 'Enregistrez l’achat sur la matière première et le fournisseur concernés. Si nécessaire, l’achat crée leur lien pour conserver la traçabilité du stock et de la dette.' },
      { title: 'Coût de référence', text: 'Lors d’un achat à un nouveau prix, choisissez si son coût de référence doit changer. Ce choix influence le calcul du coût des recettes, mais ne modifie pas automatiquement les prix de vente.' },
      { title: 'Paiement de l’achat', text: 'Pour un paiement intégral ou partiel, vérifiez le compte débité avant de valider. Un achat à crédit reste à régler au fournisseur.' },
    ],
  },
  {
    id: 'menus',
    label: 'Menus et marges',
    title: 'Gérer les prix et les coûts des menus',
    page: '/admin/menus',
    pageLabel: 'Ouvrir les menus',
    topics: [
      { title: 'Prix de vente', text: 'Saisissez le prix de vente du plat ou de la boisson dans sa fiche. Le prix modifié s’applique aux prochaines commandes uniquement.' },
      { title: 'Calcul de la marge', text: 'Bénéfice sur coût = (prix de vente - coût des ingrédients) / coût des ingrédients. Une valeur négative signale une vente à perte estimée.' },
      { title: 'Hausse d’un coût', text: 'Quand le coût de référence d’une matière augmente, vérifiez l’impact sur les menus et leur marge. La décision de changer le prix de vente reste manuelle.' },
    ],
  },
  {
    id: 'revenue',
    label: 'Recettes et analyses',
    title: 'Lire les recettes sans fausser les comptes',
    page: '/admin/revenue',
    pageLabel: 'Ouvrir les recettes',
    topics: [
      { title: 'Recettes nettes', text: 'Les recettes nettes regroupent plats et boissons après remises. Les emballages sont inclus dans les plats et les cocktails dans les boissons.' },
      { title: 'Remises et trésorerie', text: 'Une remise réduit le montant dû, mais ne crée aucun mouvement de trésorerie. Seuls les montants réellement encaissés alimentent les comptes.' },
      { title: 'Décision de prix', text: 'Le tableau d’impact des coûts aide à comparer la marge actuelle et un prix cible. La mise à jour du coût de référence ne modifie jamais automatiquement le prix du menu.' },
    ],
  },
];

const AdminHelp = () => {
  const [activeSectionId, setActiveSectionId] = useState('treasury');
  const [paymentRules, setPaymentRules] = useState([]);
  const [rulesStatus, setRulesStatus] = useState('loading');
  const activeSection = HELP_SECTIONS.find((section) => section.id === activeSectionId) || HELP_SECTIONS[0];

  useEffect(() => {
    let cancelled = false;

    adminAPI.getTreasurySnapshot()
      .then((response) => {
        if (cancelled) return;
        const rules = response?.data?.config?.payment_account_rules;
        setPaymentRules(Array.isArray(rules) ? rules : []);
        setRulesStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setRulesStatus('error');
      });

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="admin-help">
      <header className="admin-help-header">
        <span className="admin-help-eyebrow">Guide d’utilisation</span>
        <h2>Aide</h2>
        <p>Choisissez une rubrique pour retrouver les règles et les étapes utiles, sans encombrer les écrans de travail.</p>
      </header>

      <div className="admin-help-layout">
        <nav className="admin-help-nav" role="tablist" aria-label="Rubriques d’aide">
          {HELP_SECTIONS.map((section, index) => (
            <button
              key={section.id}
              id={`admin-help-tab-${section.id}`}
              type="button"
              role="tab"
              aria-selected={activeSectionId === section.id}
              aria-controls="admin-help-panel"
              tabIndex={activeSectionId === section.id ? 0 : -1}
              className={`admin-help-tab ${activeSectionId === section.id ? 'is-active' : ''}`}
              onClick={() => setActiveSectionId(section.id)}
              onKeyDown={(event) => {
                if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(event.key)) return;
                event.preventDefault();
                const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
                const nextIndex = (index + direction + HELP_SECTIONS.length) % HELP_SECTIONS.length;
                setActiveSectionId(HELP_SECTIONS[nextIndex].id);
                document.getElementById(`admin-help-tab-${HELP_SECTIONS[nextIndex].id}`)?.focus();
              }}
            >
              <span className="admin-help-tab-index">{String(index + 1).padStart(2, '0')}</span>
              <span>{section.label}</span>
            </button>
          ))}
        </nav>

        <section
          id="admin-help-panel"
          className="admin-help-panel"
          role="tabpanel"
          aria-labelledby={`admin-help-tab-${activeSection.id}`}
          tabIndex={0}
        >
          <div className="admin-help-panel-header">
            <div>
              <span className="admin-help-eyebrow">{activeSection.label}</span>
              <h3>{activeSection.title}</h3>
            </div>
            <Link className="btn btn-secondary btn-sm" to={activeSection.page}>{activeSection.pageLabel}</Link>
          </div>

          <div className="admin-help-topic-grid">
            {activeSection.topics.map((topic) => (
              <article className="admin-help-topic" key={topic.title}>
                <h4>{topic.title}</h4>
                <p>{topic.text}</p>
              </article>
            ))}
          </div>

          {activeSection.id === 'treasury' ? (
            <div className="admin-help-rules">
              <div className="admin-help-rules-heading">
                <span className="admin-help-eyebrow">Modes de règlement</span>
                <h4>Règles d’alimentation des comptes</h4>
              </div>
              {rulesStatus === 'loading' ? <p className="admin-help-rules-state">Chargement des règles...</p> : null}
              {rulesStatus === 'error' ? <p className="admin-help-rules-state">Règles indisponibles pour le moment.</p> : null}
              {rulesStatus === 'ready' && paymentRules.length === 0 ? <p className="admin-help-rules-state">Aucune règle disponible.</p> : null}
              {paymentRules.length > 0 ? (
                <div className="admin-help-rule-grid">
                  {paymentRules.map((rule) => (
                    <div className="admin-help-rule" key={rule.payment_method}>
                      <div className="admin-help-rule-route">
                        <strong>{rule.payment_method_label}</strong>
                        <span aria-hidden="true">→</span>
                        <strong>{rule.target_account_label || 'En attente'}</strong>
                      </div>
                      <p>{rule.note}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
};

export default AdminHelp;
