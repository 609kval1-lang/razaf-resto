import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { adminAPI } from '../../services/api';
import { isWholeAriary } from '../../utils/ariary';
import DataTable from '../common/DataTable';

const formatAr = (value) => {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} Ar`;
};

const roundAriary = (value) => Math.round(Number(value || 0) + Number.EPSILON);

const formatSignedAr = (value) => {
  const amount = Number(value || 0);
  const prefix = amount > 0 ? '+' : '';
  return `${prefix}${amount.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} Ar`;
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

const extractErrorMessage = (error, fallbackMessage) => {
  const errors = error?.response?.data?.errors;
  if (errors && typeof errors === 'object') {
    const first = Object.values(errors).flat().find((item) => typeof item === 'string');
    if (first) {
      return first;
    }
  }

  return error?.response?.data?.message || fallbackMessage;
};

const scopeLabel = (scope) => {
  const labels = {
    day: "Aujourd'hui",
    rolling_week: '7 derniers jours',
    rolling_month: '30 derniers jours',
    week: 'Semaine en cours',
    month: 'Mois en cours',
  };

  return labels[scope] || "Aujourd'hui";
};

const CATEGORY_META = {
  dishes: { label: 'Plats', order: 10 },
  drinks: { label: 'Boissons', order: 20 },
};

const DRINK_CATEGORIES = new Set([
  'drinks', 'drink', 'boisson', 'boissons', 'cocktail', 'cocktails',
  'mocktail', 'mocktails', 'bar', 'beverage', 'beverages',
]);

const normalizeCategory = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim();

const getCategoryMeta = (rawCategory) => {
  const normalized = normalizeCategory(rawCategory);
  const categoryKey = DRINK_CATEGORIES.has(normalized) ? 'drinks' : 'dishes';
  const meta = CATEGORY_META[categoryKey];

  return {
    key: categoryKey,
    label: meta.label,
    order: meta.order,
  };
};

const TOP_OPTIONS = [3, 5, 10];
const REVENUE_REFRESH_INTERVAL_MS = 5000;
const SCOPE_OPTIONS = [
  { value: 'day', label: "Aujourd'hui" },
  { value: 'rolling_week', label: '7 derniers jours' },
  { value: 'rolling_month', label: '30 derniers jours' },
  { value: 'week', label: 'Semaine en cours' },
  { value: 'month', label: 'Mois en cours' },
];

const actionMetaMap = {
  increase: { label: 'Hausse proposée', className: 'pricing-action increase' },
  decrease: { label: 'Baisse proposée', className: 'pricing-action decrease' },
  keep: { label: 'Prix aligné', className: 'pricing-action keep' },
};

const rankingMetricConfig = {
  demand: {
    label: 'Demande',
    bestKey: 'most_demanded',
    worstKey: 'least_demanded',
    bestTitle: 'Plus commandés',
    worstTitle: 'Moins commandés',
  },
  profit: {
    label: 'Rentabilité (profit)',
    bestKey: 'most_profitable',
    worstKey: 'least_profitable',
    bestTitle: 'Plus rentables',
    worstTitle: 'Moins rentables',
  },
  margin: {
    label: 'Bénéfice / coût (%)',
    bestKey: 'highest_margin',
    worstKey: 'lowest_margin',
    bestTitle: 'Plus fort benefice / cout',
    worstTitle: 'Plus faible benefice / cout',
  },
  revenue: {
    label: 'Recette nette',
    bestKey: 'highest_net_revenue',
    worstKey: 'lowest_net_revenue',
    bestTitle: 'Plus fortes recettes nettes',
    worstTitle: 'Plus faibles recettes nettes',
  },
};

const defaultReport = {
  filters: {},
  summary: {},
  category_summary: [],
  menu_stats: [],
  menu_pricing_impact: [],
  rankings: {},
  users: [],
  top_demanded: [],
  top_profitable: [],
  top_grossing: [],
};

const normalizeRankingRows = (rows) => {
  return rows.map((row) => {
    const categoryMeta = getCategoryMeta(row?.rank_category || row?.menu_family || row?.menu_category);
    return {
      ...row,
      category_key: categoryMeta.key,
      category_label: categoryMeta.label,
      category_order: categoryMeta.order,
    };
  });
};

const RevenueDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [scope, setScope] = useState('rolling_week');
  const [selectedUserId, setSelectedUserId] = useState('all');
  const [topLimit, setTopLimit] = useState(5);
  const [rankingMetric, setRankingMetric] = useState('demand');
  const [rankingView, setRankingView] = useState('top');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [impactCategory, setImpactCategory] = useState('all');
  const [impactAction, setImpactAction] = useState('all');
  const [report, setReport] = useState(defaultReport);
  const [editingPriceRow, setEditingPriceRow] = useState(null);
  const [priceEditValue, setPriceEditValue] = useState('');
  const [savingPriceUpdate, setSavingPriceUpdate] = useState(false);

  const loadReport = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }

    try {
      const params = {
        scope,
        top_limit: topLimit,
      };

      if (selectedUserId !== 'all') {
        params.user_id = Number(selectedUserId);
      }

      const response = await adminAPI.getRevenueReport(params);
      setReport(response.data || defaultReport);
      setMessage('');
    } catch (_error) {
      setMessage('Erreur lors du chargement du tableau de bord des recettes');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [scope, selectedUserId, topLimit]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  useEffect(() => {
    const refreshSilently = () => {
      if (editingPriceRow || savingPriceUpdate) {
        return;
      }

      loadReport({ silent: true });
    };

    const intervalId = setInterval(() => {
      refreshSilently();
    }, REVENUE_REFRESH_INTERVAL_MS);

    const handleWindowFocus = () => {
      refreshSilently();
    };

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        refreshSilently();
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
  }, [editingPriceRow, loadReport, savingPriceUpdate]);

  const summary = report?.summary || {};
  const users = useMemo(() => (Array.isArray(report?.users) ? report.users : []), [report?.users]);
  const categorySummary = useMemo(() => (Array.isArray(report?.category_summary) ? report.category_summary : []), [report?.category_summary]);
  const menuPricingImpact = useMemo(
    () => (Array.isArray(report?.menu_pricing_impact) ? report.menu_pricing_impact : []),
    [report?.menu_pricing_impact],
  );

  const rankings = useMemo(() => {
    const baseRankings = report?.rankings && typeof report.rankings === 'object' ? report.rankings : {};

    return {
      most_demanded: Array.isArray(baseRankings.most_demanded) ? baseRankings.most_demanded : (Array.isArray(report?.top_demanded) ? report.top_demanded : []),
      least_demanded: Array.isArray(baseRankings.least_demanded) ? baseRankings.least_demanded : [],
      most_profitable: Array.isArray(baseRankings.most_profitable) ? baseRankings.most_profitable : (Array.isArray(report?.top_profitable) ? report.top_profitable : []),
      least_profitable: Array.isArray(baseRankings.least_profitable) ? baseRankings.least_profitable : [],
      highest_margin: Array.isArray(baseRankings.highest_margin) ? baseRankings.highest_margin : [],
      lowest_margin: Array.isArray(baseRankings.lowest_margin) ? baseRankings.lowest_margin : [],
      highest_revenue: Array.isArray(baseRankings.highest_revenue) ? baseRankings.highest_revenue : (Array.isArray(report?.top_grossing) ? report.top_grossing : []),
      lowest_revenue: Array.isArray(baseRankings.lowest_revenue) ? baseRankings.lowest_revenue : [],
      highest_net_revenue: Array.isArray(baseRankings.highest_net_revenue) ? baseRankings.highest_net_revenue : [],
      lowest_net_revenue: Array.isArray(baseRankings.lowest_net_revenue) ? baseRankings.lowest_net_revenue : [],
    };
  }, [report]);

  const selectedMetricConfig = rankingMetricConfig[rankingMetric] || rankingMetricConfig.demand;

  const selectedUserLabel = useMemo(() => {
    if (selectedUserId === 'all') {
      return 'Tous les utilisateurs';
    }

    const user = users.find((item) => Number(item.id) === Number(selectedUserId));
    return user ? `${user.name} (${user.role})` : 'Utilisateur';
  }, [selectedUserId, users]);

  const bestRows = useMemo(() => {
    const key = selectedMetricConfig.bestKey;
    const source = normalizeRankingRows(Array.isArray(rankings[key]) ? rankings[key] : []);
    if (selectedCategory === 'all') {
      return source;
    }

    return source.filter((row) => row.category_key === selectedCategory);
  }, [rankings, selectedCategory, selectedMetricConfig.bestKey]);

  const worstRows = useMemo(() => {
    const key = selectedMetricConfig.worstKey;
    const source = normalizeRankingRows(Array.isArray(rankings[key]) ? rankings[key] : []);
    if (selectedCategory === 'all') {
      return source;
    }

    return source.filter((row) => row.category_key === selectedCategory);
  }, [rankings, selectedCategory, selectedMetricConfig.worstKey]);

  const allRankingRows = useMemo(() => {
    return Object.values(rankings).flatMap((rows) => (Array.isArray(rows) ? rows : []));
  }, [rankings]);

  const categoryOptions = useMemo(() => {
    const map = new Map();

    allRankingRows.forEach((row) => {
      const categoryMeta = getCategoryMeta(row?.rank_category || row?.menu_family || row?.menu_category);
      map.set(categoryMeta.key, categoryMeta);
    });

    categorySummary.forEach((entry) => {
      const categoryMeta = getCategoryMeta(entry?.category);
      map.set(categoryMeta.key, categoryMeta);
    });

    menuPricingImpact.forEach((entry) => {
      const categoryMeta = getCategoryMeta(entry?.menu_family || entry?.menu_category);
      map.set(categoryMeta.key, categoryMeta);
    });

    return Array.from(map.values()).sort((left, right) => left.order - right.order || left.label.localeCompare(right.label));
  }, [allRankingRows, categorySummary, menuPricingImpact]);

  const selectedCategoryMeta = useMemo(() => {
    if (selectedCategory === 'all') {
      return null;
    }

    return categoryOptions.find((option) => option.key === selectedCategory) || getCategoryMeta(selectedCategory);
  }, [selectedCategory, categoryOptions]);

  const categoryTopRows = useMemo(() => {
    const key = selectedMetricConfig.bestKey;
    const source = normalizeRankingRows(Array.isArray(rankings[key]) ? rankings[key] : [])
      .filter((row) => Number(row.total_quantity || 0) > 0);

    const filtered = selectedCategory === 'all'
      ? source
      : source.filter((row) => row.category_key === selectedCategory);

    return filtered.slice().sort((left, right) => {
      if (selectedCategory === 'all') {
        const byCategory = Number(left.category_order || 999) - Number(right.category_order || 999);
        if (byCategory !== 0) {
          return byCategory;
        }
      }

      const byRank = Number(left.rank_in_category || 999) - Number(right.rank_in_category || 999);
      if (byRank !== 0) {
        return byRank;
      }

      return String(left.menu_name || '').localeCompare(String(right.menu_name || ''));
    });
  }, [rankings, selectedCategory, selectedMetricConfig.bestKey]);

  const unifiedRankingRows = useMemo(() => {
    if (rankingView === 'worst') {
      return worstRows;
    }

    if (rankingView === 'best') {
      return bestRows;
    }

    return categoryTopRows;
  }, [rankingView, categoryTopRows, bestRows, worstRows]);

  const normalizedMenuPricingImpact = useMemo(() => {
    return menuPricingImpact
      .filter((row) => Math.abs(Number(row?.unit_cost_change_amount || 0)) >= 0.01)
      .map((row) => ({
        ...row,
        category_key: getCategoryMeta(row?.menu_family || row?.menu_category).key,
      }));
  }, [menuPricingImpact]);

  const filteredMenuPricingImpact = useMemo(() => {
    return normalizedMenuPricingImpact.filter((row) => (
      (impactCategory === 'all' || row.category_key === impactCategory)
      && (impactAction === 'all' || row.recommended_action === impactAction)
    ));
  }, [normalizedMenuPricingImpact, impactCategory, impactAction]);

  useEffect(() => {
    if (selectedCategory === 'all') {
      return;
    }

    const exists = categoryOptions.some((option) => option.key === selectedCategory);
    if (!exists) {
      setSelectedCategory('all');
    }
  }, [categoryOptions, selectedCategory]);

  useEffect(() => {
    if (impactCategory !== 'all' && !categoryOptions.some((option) => option.key === impactCategory)) {
      setImpactCategory('all');
    }
  }, [categoryOptions, impactCategory]);

  const rankingColumns = [
    {
      key: 'rank_in_category',
      header: 'Rang famille',
      sortType: 'number',
      sortAccessor: (row) => Number(row.rank_in_category || 0),
      searchAccessor: (row) => String(row.rank_in_category || ''),
      render: (row) => `#${row.rank_in_category || '-'}`,
    },
    {
      key: 'category_label',
      header: 'Famille',
      sortAccessor: (row) => row.category_label || '',
      searchAccessor: (row) => row.category_label || '',
      render: (row) => row.category_label || '-',
    },
    {
      key: 'menu_name',
      header: 'Menu',
      sortAccessor: (row) => row.menu_name,
      searchAccessor: (row) => row.menu_name,
      render: (row) => row.menu_name,
    },
    {
      key: 'total_quantity',
      header: 'Qté vendue',
      sortType: 'number',
      sortAccessor: (row) => Number(row.total_quantity || 0),
      searchAccessor: (row) => String(row.total_quantity || ''),
      render: (row) => Number(row.total_quantity || 0),
    },
    {
      key: 'total_revenue_net',
      header: 'Recette nette',
      sortType: 'number',
      sortAccessor: (row) => Number(row.total_revenue_net || 0),
      searchAccessor: (row) => String(row.total_revenue_net || ''),
      render: (row) => formatAr(row.total_revenue_net),
    },
    {
      key: 'total_discount',
      header: 'Remises',
      sortType: 'number',
      sortAccessor: (row) => Number(row.total_discount || 0),
      searchAccessor: (row) => String(row.total_discount || ''),
      render: (row) => formatAr(row.total_discount),
    },
    {
      key: 'total_cost',
      header: 'Coût estimé',
      sortType: 'number',
      sortAccessor: (row) => Number(row.total_cost || 0),
      searchAccessor: (row) => String(row.total_cost || ''),
      render: (row) => formatAr(row.total_cost),
    },
    {
      key: 'total_profit',
      header: 'Profit estimé',
      sortType: 'number',
      sortAccessor: (row) => Number(row.total_profit || 0),
      searchAccessor: (row) => String(row.total_profit || ''),
      render: (row) => formatAr(row.total_profit),
    },
    {
      key: 'margin_percent',
      header: 'Benefice / cout',
      sortType: 'number',
      sortAccessor: (row) => Number(row.margin_percent || 0),
      searchAccessor: (row) => String(row.margin_percent || ''),
      render: (row) => `${Number(row.margin_percent || 0).toFixed(1)}%`,
    },
  ];

  const categoryTopColumns = [
    {
      key: 'category_label',
      header: 'Famille',
      sortAccessor: (row) => `${String(Number(row.category_order || 999)).padStart(3, '0')}-${String(Number(row.rank_in_category || 999)).padStart(3, '0')}`,
      searchAccessor: (row) => row.category_label || '',
      render: (row) => row.category_label || '-',
    },
    {
      key: 'rank_in_category',
      header: 'Rang famille',
      sortType: 'number',
      sortAccessor: (row) => Number(row.rank_in_category || 0),
      searchAccessor: (row) => String(row.rank_in_category || ''),
      render: (row) => `#${row.rank_in_category || '-'}`,
    },
    {
      key: 'menu_name',
      header: 'Menu',
      sortAccessor: (row) => row.menu_name || '',
      searchAccessor: (row) => `${row.menu_name || ''} ${row.category_label || ''}`,
      render: (row) => row.menu_name || '-',
    },
    {
      key: 'total_quantity',
      header: 'Qté totale',
      sortType: 'number',
      sortAccessor: (row) => Number(row.total_quantity || 0),
      searchAccessor: (row) => String(row.total_quantity || ''),
      render: (row) => Number(row.total_quantity || 0),
    },
    {
      key: 'total_revenue_net',
      header: 'Recette nette',
      sortType: 'number',
      sortAccessor: (row) => Number(row.total_revenue_net || 0),
      searchAccessor: (row) => String(row.total_revenue_net || ''),
      render: (row) => formatAr(row.total_revenue_net),
    },
    {
      key: 'total_profit',
      header: 'Profit estimé',
      sortType: 'number',
      sortAccessor: (row) => Number(row.total_profit || 0),
      searchAccessor: (row) => String(row.total_profit || ''),
      render: (row) => formatAr(row.total_profit),
    },
    {
      key: 'margin_percent',
      header: 'Benefice / cout',
      sortType: 'number',
      sortAccessor: (row) => Number(row.margin_percent || 0),
      searchAccessor: (row) => String(row.margin_percent || ''),
      render: (row) => `${Number(row.margin_percent || 0).toFixed(1)}%`,
    },
  ];

  const unifiedRankingColumns = rankingView === 'top' ? categoryTopColumns : rankingColumns;

  const unifiedRankingTitle = (
    rankingView === 'worst'
      ? selectedMetricConfig.worstTitle
      : rankingView === 'best'
        ? selectedMetricConfig.bestTitle
        : 'Top ventes'
  );

  const unifiedRankingEmptyMessage = (
    selectedCategoryMeta
      ? `Aucun résultat pour ${unifiedRankingTitle.toLowerCase()} dans la famille ${selectedCategoryMeta.label}.`
      : `Aucun résultat pour ${unifiedRankingTitle.toLowerCase()} sur la période.`
  );

  const rankingViewOptions = [
    { value: 'top', label: 'Top ventes' },
    { value: 'best', label: selectedMetricConfig.bestTitle },
    { value: 'worst', label: selectedMetricConfig.worstTitle },
  ];

  const menuImpactSummary = useMemo(() => {
    return filteredMenuPricingImpact.reduce((acc, row) => {
      const action = String(row?.recommended_action || '');

      if (action === 'increase') {
        acc.increase += 1;
      } else if (action === 'decrease') {
        acc.decrease += 1;
      } else {
        acc.keep += 1;
      }

      acc.total += 1;

      return acc;
    }, {
      increase: 0,
      decrease: 0,
      keep: 0,
      total: 0,
    });
  }, [filteredMenuPricingImpact]);

  const openPriceEditor = (row) => {
    setEditingPriceRow(row);
    setPriceEditValue(String(roundAriary(row?.current_catalog_price || 0)));
  };

  const closePriceEditor = (force = false) => {
    if (savingPriceUpdate && !force) {
      return;
    }

    setEditingPriceRow(null);
    setPriceEditValue('');
  };

  const submitPriceUpdate = async (event) => {
    event.preventDefault();
    if (!editingPriceRow) {
      return;
    }

    if (!isWholeAriary(priceEditValue) || Number(priceEditValue) < 0) {
      setMessage('Erreur: saisissez un prix entier en Ariary, sans decimales.');
      return;
    }

    setSavingPriceUpdate(true);

    try {
      await adminAPI.updateMenu(editingPriceRow.menu_id, {
        price: Math.max(0, roundAriary(priceEditValue || 0)),
      });

      await loadReport({ silent: true });
      closePriceEditor(true);
      setMessage(`Prix mis à jour pour ${editingPriceRow.menu_name}.`);
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Impossible de mettre à jour le prix du menu.')}`);
    } finally {
      setSavingPriceUpdate(false);
    }
  };

  const projectedPrice = isWholeAriary(priceEditValue) && Number(priceEditValue) >= 0
    ? Number(priceEditValue)
    : null;
  const projectedUnitCost = Number(editingPriceRow?.current_unit_cost || 0);
  const projectedProfitOnCost = projectedPrice !== null && projectedUnitCost > 0
    ? ((projectedPrice - projectedUnitCost) / projectedUnitCost) * 100
    : null;

  const menuPricingImpactColumns = [
    {
      key: 'menu_name',
      header: 'Menu et décision',
      sortAccessor: (row) => row.menu_name || '',
      searchAccessor: (row) => `${row.menu_name || ''} ${getCategoryMeta(row.menu_family || row.menu_category).label} ${row.recommended_action || ''}`,
      render: (row) => {
        const action = actionMetaMap[row.recommended_action] || actionMetaMap.keep;
        return (
          <div className="revenue-impact-cell">
            <strong>{row.menu_name || '-'}</strong>
            <span>{getCategoryMeta(row.menu_family || row.menu_category).label}</span>
            <span className={action.className}>{action.label}</span>
          </div>
        );
      },
    },
    {
      key: 'unit_cost_change_amount',
      header: 'Coût par portion',
      sortType: 'number',
      sortAccessor: (row) => Math.abs(Number(row.unit_cost_change_amount || 0)),
      searchAccessor: (row) => String(row.unit_cost_change_amount || ''),
      render: (row) => (
        <div className="revenue-impact-cell">
          <strong>{formatAr(row.current_unit_cost)}</strong>
          <span>Avant {formatAr(row.baseline_unit_cost)} · {formatSignedAr(row.unit_cost_change_amount)}</span>
        </div>
      ),
    },
    {
      key: 'current_catalog_price',
      header: 'Prix et bénéfice / coût',
      sortType: 'number',
      sortAccessor: (row) => Number(row.current_catalog_price || 0),
      searchAccessor: (row) => String(row.current_catalog_price || ''),
      render: (row) => (
        <div className="revenue-impact-cell">
          <strong>{formatAr(row.current_catalog_price)}</strong>
          <span>{Number(row.current_profit_on_cost_percent || 0).toFixed(1)}% de bénéfice / coût</span>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Action',
      sortable: false,
      searchable: false,
      render: (row) => (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => openPriceEditor(row)}
        >
          Modifier prix
        </button>
      ),
    },
  ];

  if (loading) {
    return <div className="loading">Chargement des recettes...</div>;
  }

  return (
    <div>
      <div className="card revenue-dashboard-shell">
        <div className="revenue-dashboard-header">
          <div>
            <h2>Administration des Recettes</h2>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => loadReport()}>
            Actualiser
          </button>
        </div>

        <div className="revenue-report-context">
          <label className="form-group">
            <span>Période analysée</span>
            <select value={scope} onChange={(event) => setScope(event.target.value)}>
              {SCOPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="form-group">
            <span>Utilisateur</span>
            <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
              <option value="all">Tous les utilisateurs</option>
              {users.map((user) => <option key={user.id} value={String(user.id)}>{user.name} ({user.role})</option>)}
            </select>
          </label>
        </div>

        <div className="revenue-dashboard-top-stats">
          <div className="stat-card">
            <h3>Recettes nettes</h3>
            <div className="stat-number">{formatAr(summary.total_revenue_net)}</div>
            <p>Après remises</p>
          </div>

          <div className="stat-card">
            <h3>Ventes avant remises</h3>
            <div className="stat-number">{formatAr(summary.total_revenue_gross)}</div>
            <p>Base avant réduction, à titre indicatif</p>
          </div>

          <div className="stat-card">
            <h3>Remises accordées</h3>
            <div className="stat-number">{formatAr(summary.total_discount)}</div>
            <p>Total des réductions</p>
          </div>

          <div className="stat-card">
            <h3>Plats</h3>
            <div className="stat-number">{formatAr(summary.dishes_revenue_net)}</div>
            <p>Net, emballages inclus</p>
          </div>

          <div className="stat-card">
            <h3>Boissons</h3>
            <div className="stat-number">{formatAr(summary.drinks_revenue_net)}</div>
            <p>Net, cocktails inclus</p>
          </div>
        </div>
      </div>

      {message ? (
        <div className="card">
          <div className="message error-message">{message}</div>
        </div>
      ) : null}

      <div className="card">
        <div className="revenue-dashboard-section-header">
          <h3>Détail du classement · {unifiedRankingTitle}{selectedCategoryMeta ? ` · ${selectedCategoryMeta.label}` : ''}</h3>
        </div>
        <p className="form-hint revenue-period-hint">{report?.filters?.scope_label || scopeLabel(scope)} · {selectedUserLabel} · du {formatDateTime(report?.filters?.from)} au {formatDateTime(report?.filters?.to)}</p>
        <div className="revenue-filter-grid" aria-label="Filtres du classement">
          <label className="form-group"><span>Famille</span><select value={selectedCategory} onChange={(event) => setSelectedCategory(event.target.value)}>
            <option value="all">Plats et boissons</option>
            {categoryOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select></label>
          <label className="form-group"><span>Indicateur</span><select value={rankingMetric} onChange={(event) => setRankingMetric(event.target.value)}>
            {Object.entries(rankingMetricConfig).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}
          </select></label>
          <label className="form-group"><span>Classement</span><select value={rankingView} onChange={(event) => setRankingView(event.target.value)}>
            {rankingViewOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select></label>
          <label className="form-group"><span>Par famille</span><select value={topLimit} onChange={(event) => setTopLimit(Number(event.target.value))}>
            {TOP_OPTIONS.map((option) => <option key={option} value={option}>Top {option}</option>)}
          </select></label>
        </div>
        <DataTable
          columns={unifiedRankingColumns}
          data={unifiedRankingRows}
          rowKey={(row) => `${row.menu_id}-${row.category_key || 'dishes'}-${rankingView}-${row.rank_in_category || 0}`}
          searchPlaceholder="Rechercher un menu ou une famille..."
          initialSort={{ key: rankingView === 'top' && selectedCategory === 'all' ? 'category_label' : 'rank_in_category', direction: 'asc' }}
          emptyMessage={unifiedRankingEmptyMessage}
        />
      </div>

      <div className="card">
        <h3>Impact coûts menus et décision de prix</h3>
        <div className="revenue-filter-grid revenue-impact-filters" aria-label="Filtres des coûts des menus">
          <label className="form-group"><span>Famille</span><select value={impactCategory} onChange={(event) => setImpactCategory(event.target.value)}>
            <option value="all">Plats et boissons</option>
            {categoryOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select></label>
          <label className="form-group"><span>Décision</span><select value={impactAction} onChange={(event) => setImpactAction(event.target.value)}>
            <option value="all">Toutes les décisions</option>
            <option value="increase">Hausse proposée</option>
            <option value="decrease">Baisse proposée</option>
            <option value="keep">Prix aligné</option>
          </select></label>
        </div>
        <p className="revenue-impact-summary">{menuImpactSummary.total} menu(s) affiché(s) · {menuImpactSummary.increase} hausse(s) · {menuImpactSummary.decrease} baisse(s) · {menuImpactSummary.keep} prix aligné(s)</p>

        <DataTable
          columns={menuPricingImpactColumns}
          data={filteredMenuPricingImpact}
          rowKey={(row) => row.menu_id}
          searchPlaceholder="Rechercher un menu impacté..."
          initialSort={{ key: 'unit_cost_change_amount', direction: 'desc' }}
          emptyMessage="Aucun menu impacté pour ces filtres."
        />
      </div>

      {editingPriceRow ? (
        <div className="modal-overlay" onClick={closePriceEditor}>
          <div className="modal modal-confirm" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Modifier le prix du menu</h3>
              <button className="modal-close" type="button" onClick={closePriceEditor}>×</button>
            </div>

            <form onSubmit={submitPriceUpdate}>
              <div className="cash-movement-detail" style={{ marginBottom: '12px' }}>
                <strong>{editingPriceRow.menu_name}</strong>
                <span>Prix actuel: {formatAr(editingPriceRow.current_catalog_price)}</span>
                <span>Coût actuel: {formatAr(editingPriceRow.current_unit_cost)}</span>
                <span>Bénéfice sur coût: {Number(editingPriceRow.current_profit_on_cost_percent || 0).toFixed(1)}%</span>
                <span>Prix cible 100% bénéfice: {formatAr(editingPriceRow.suggested_catalog_price)}</span>
              </div>

              <div className="form-group">
                <label>Nouveau prix (Ar)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={priceEditValue}
                  onChange={(event) => setPriceEditValue(event.target.value)}
                  required
                />
              </div>

              <div className="admin-pricing-preview" aria-live="polite">
                <span>Bénéfice / coût au prix choisi</span>
                <strong>{projectedProfitOnCost === null ? 'Non calculable' : `${projectedProfitOnCost.toFixed(1)}%`}</strong>
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPriceEditValue(String(Number(editingPriceRow.suggested_catalog_price || 0)))}
                >
                  Utiliser le prix cible
                </button>
                <button type="button" className="btn btn-secondary" onClick={closePriceEditor}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={savingPriceUpdate}>
                  {savingPriceUpdate ? 'Enregistrement...' : 'Enregistrer le prix'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

    </div>
  );
};

export default RevenueDashboard;
