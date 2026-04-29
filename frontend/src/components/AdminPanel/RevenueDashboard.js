import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { adminAPI } from '../../services/api';
import DataTable from '../common/DataTable';

const formatAr = (value) => {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} Ar`;
};

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
  entree: { label: 'Entrées', order: 10 },
  main: { label: 'Plats principaux', order: 20 },
  snack: { label: 'Snacks', order: 30 },
  side: { label: 'Accompagnements', order: 40 },
  dessert: { label: 'Desserts', order: 50 },
  drink: { label: 'Boissons', order: 60 },
  cocktail: { label: 'Cocktails', order: 65 },
  autres: { label: 'Autres', order: 999 },
};

const CATEGORY_ALIAS = {
  starter: 'entree',
  entree: 'entree',
  'entrée': 'entree',
  entrees: 'entree',
  'entrées': 'entree',
  main: 'main',
  plat: 'main',
  plats: 'main',
  snack: 'snack',
  side: 'side',
  accompagnement: 'side',
  accompagnements: 'side',
  dessert: 'dessert',
  desserts: 'dessert',
  drink: 'drink',
  drinks: 'drink',
  cocktail: 'cocktail',
  cocktails: 'cocktail',
  boisson: 'drink',
  boissons: 'drink',
};

const normalizeCategory = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim();

const getCategoryMeta = (rawCategory) => {
  const normalized = normalizeCategory(rawCategory);
  const categoryKey = CATEGORY_ALIAS[normalized] || normalized || 'autres';
  const meta = CATEGORY_META[categoryKey] || CATEGORY_META.autres;

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
    label: 'Benefice / cout (%)',
    bestKey: 'highest_margin',
    worstKey: 'lowest_margin',
    bestTitle: 'Plus fort benefice / cout',
    worstTitle: 'Plus faible benefice / cout',
  },
  revenue: {
    label: 'Recette brute',
    bestKey: 'highest_revenue',
    worstKey: 'lowest_revenue',
    bestTitle: 'Plus générateurs de recette',
    worstTitle: 'Moins générateurs de recette',
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
    const categoryMeta = getCategoryMeta(row?.rank_category || row?.menu_category);
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
  const [showRankingFilters, setShowRankingFilters] = useState(false);
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
      const categoryMeta = getCategoryMeta(row?.rank_category || row?.menu_category);
      map.set(categoryMeta.key, categoryMeta);
    });

    categorySummary.forEach((entry) => {
      const categoryMeta = getCategoryMeta(entry?.category);
      map.set(categoryMeta.key, categoryMeta);
    });

    menuPricingImpact.forEach((entry) => {
      const categoryMeta = getCategoryMeta(entry?.menu_category);
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

  const categoryFilterSourceRows = useMemo(() => {
    if (rankingView === 'worst') {
      return normalizeRankingRows(Array.isArray(rankings[selectedMetricConfig.worstKey]) ? rankings[selectedMetricConfig.worstKey] : []);
    }

    if (rankingView === 'best') {
      return normalizeRankingRows(Array.isArray(rankings[selectedMetricConfig.bestKey]) ? rankings[selectedMetricConfig.bestKey] : []);
    }

    return normalizeRankingRows(Array.isArray(rankings[selectedMetricConfig.bestKey]) ? rankings[selectedMetricConfig.bestKey] : [])
      .filter((row) => Number(row.total_quantity || 0) > 0);
  }, [rankingView, rankings, selectedMetricConfig.bestKey, selectedMetricConfig.worstKey]);

  const categoryRowCounts = useMemo(() => {
    const counts = categoryFilterSourceRows.reduce((accumulator, row) => {
      const key = String(row.category_key || 'autres');
      accumulator[key] = (accumulator[key] || 0) + 1;
      return accumulator;
    }, {});

    counts.all = categoryFilterSourceRows.length;
    return counts;
  }, [categoryFilterSourceRows]);

  const normalizedMenuPricingImpact = useMemo(() => {
    return menuPricingImpact
      .filter((row) => Math.abs(Number(row?.unit_cost_change_amount || 0)) >= 0.01)
      .map((row) => ({
        ...row,
        category_key: getCategoryMeta(row?.menu_category).key,
      }));
  }, [menuPricingImpact]);

  const filteredMenuPricingImpact = useMemo(() => {
    if (selectedCategory === 'all') {
      return normalizedMenuPricingImpact;
    }

    return normalizedMenuPricingImpact.filter((row) => row.category_key === selectedCategory);
  }, [normalizedMenuPricingImpact, selectedCategory]);

  useEffect(() => {
    if (selectedCategory === 'all') {
      return;
    }

    const exists = categoryOptions.some((option) => option.key === selectedCategory);
    if (!exists) {
      setSelectedCategory('all');
    }
  }, [categoryOptions, selectedCategory]);

  const rankingColumns = [
    {
      key: 'rank_in_category',
      header: 'Rang cat.',
      sortType: 'number',
      sortAccessor: (row) => Number(row.rank_in_category || 0),
      searchAccessor: (row) => String(row.rank_in_category || ''),
      render: (row) => `#${row.rank_in_category || '-'}`,
    },
    {
      key: 'category_label',
      header: 'Catégorie',
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
      key: 'total_revenue',
      header: 'Recette brute',
      sortType: 'number',
      sortAccessor: (row) => Number(row.total_revenue || 0),
      searchAccessor: (row) => String(row.total_revenue || ''),
      render: (row) => formatAr(row.total_revenue),
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
      header: 'Catégorie',
      sortAccessor: (row) => `${String(Number(row.category_order || 999)).padStart(3, '0')}-${String(Number(row.rank_in_category || 999)).padStart(3, '0')}`,
      searchAccessor: (row) => row.category_label || '',
      render: (row) => row.category_label || '-',
    },
    {
      key: 'rank_in_category',
      header: 'Rang cat.',
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
      key: 'total_revenue',
      header: 'Recette brute',
      sortType: 'number',
      sortAccessor: (row) => Number(row.total_revenue || 0),
      searchAccessor: (row) => String(row.total_revenue || ''),
      render: (row) => formatAr(row.total_revenue),
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
        : 'Top plats'
  );

  const unifiedRankingEmptyMessage = (
    selectedCategoryMeta
      ? `Aucun résultat pour ${unifiedRankingTitle.toLowerCase()} dans la catégorie ${selectedCategoryMeta.label}.`
      : `Aucun résultat pour ${unifiedRankingTitle.toLowerCase()} sur la période.`
  );

  const rankingViewOptions = [
    { value: 'top', label: 'Top plats' },
    { value: 'best', label: selectedMetricConfig.bestTitle },
    { value: 'worst', label: selectedMetricConfig.worstTitle },
  ];

  const activeRankingFilterCount = useMemo(() => (
    [
      scope !== 'rolling_week',
      selectedUserId !== 'all',
      topLimit !== 5,
      rankingMetric !== 'demand',
      rankingView !== 'top',
      selectedCategory !== 'all',
    ].filter(Boolean).length
  ), [rankingMetric, rankingView, scope, selectedCategory, selectedUserId, topLimit]);

  const menuImpactSummary = useMemo(() => {
    return filteredMenuPricingImpact.reduce((acc, row) => {
      const action = String(row?.recommended_action || '');
      const absoluteCostChange = Math.abs(Number(row?.unit_cost_change_amount || 0));

      if (action === 'increase') {
        acc.increase += 1;
      } else if (action === 'decrease') {
        acc.decrease += 1;
      } else {
        acc.keep += 1;
      }

      acc.total += 1;
      acc.absoluteCostChangeTotal += absoluteCostChange;

      return acc;
    }, {
      increase: 0,
      decrease: 0,
      keep: 0,
      total: 0,
      absoluteCostChangeTotal: 0,
    });
  }, [filteredMenuPricingImpact]);

  const openPriceEditor = (row) => {
    setEditingPriceRow(row);
    setPriceEditValue(String(Number(row?.current_catalog_price || 0)));
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

    setSavingPriceUpdate(true);

    try {
      await adminAPI.updateMenu(editingPriceRow.menu_id, {
        price: Number(priceEditValue || 0),
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

  const menuPricingImpactColumns = [
    {
      key: 'recommended_action',
      header: 'Décision',
      sortAccessor: (row) => row.recommended_action || '',
      searchAccessor: (row) => row.recommended_action || '',
      render: (row) => {
        const action = actionMetaMap[row.recommended_action] || actionMetaMap.keep;
        return <span className={action.className}>{action.label}</span>;
      },
    },
    {
      key: 'menu_name',
      header: 'Menu',
      sortAccessor: (row) => row.menu_name || '',
      searchAccessor: (row) => row.menu_name || '',
      render: (row) => row.menu_name || '-',
    },
    {
      key: 'menu_category',
      header: 'Catégorie',
      sortAccessor: (row) => getCategoryMeta(row.menu_category).label,
      searchAccessor: (row) => getCategoryMeta(row.menu_category).label,
      render: (row) => getCategoryMeta(row.menu_category).label,
    },
    {
      key: 'baseline_unit_cost',
      header: 'Coût avant',
      sortType: 'number',
      sortAccessor: (row) => Number(row.baseline_unit_cost || 0),
      searchAccessor: (row) => String(row.baseline_unit_cost || ''),
      render: (row) => formatAr(row.baseline_unit_cost),
    },
    {
      key: 'current_unit_cost',
      header: 'Coût après',
      sortType: 'number',
      sortAccessor: (row) => Number(row.current_unit_cost || 0),
      searchAccessor: (row) => String(row.current_unit_cost || ''),
      render: (row) => formatAr(row.current_unit_cost),
    },
    {
      key: 'unit_cost_change_amount',
      header: 'Impact coût',
      sortType: 'number',
      sortAccessor: (row) => Math.abs(Number(row.unit_cost_change_amount || 0)),
      searchAccessor: (row) => String(row.unit_cost_change_amount || ''),
      render: (row) => formatSignedAr(row.unit_cost_change_amount),
    },
    {
      key: 'current_catalog_price',
      header: 'Prix actuel',
      sortType: 'number',
      sortAccessor: (row) => Number(row.current_catalog_price || 0),
      searchAccessor: (row) => String(row.current_catalog_price || ''),
      render: (row) => formatAr(row.current_catalog_price),
    },
    {
      key: 'current_profit_on_cost_percent',
      header: 'Bénéfice / coût',
      sortType: 'number',
      sortAccessor: (row) => Number(row.current_profit_on_cost_percent || 0),
      searchAccessor: (row) => String(row.current_profit_on_cost_percent || ''),
      render: (row) => `${Number(row.current_profit_on_cost_percent || 0).toFixed(1)}%`,
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
            <h2>💰 Administration des Recettes</h2>
          </div>
          <button type="button" className="btn btn-secondary" onClick={() => loadReport()}>
            Actualiser
          </button>
        </div>

        <div className="revenue-dashboard-top-stats">
          <div className="stat-card">
            <h3>Recettes nettes</h3>
            <div className="stat-number">{formatAr(summary.total_revenue_net)}</div>
            <p>Après remises</p>
          </div>

          <div className="stat-card">
            <h3>Recettes globales</h3>
            <div className="stat-number">{formatAr(summary.total_revenue_gross)}</div>
            <p>Avant remises</p>
          </div>

          <div className="stat-card">
            <h3>Remises accordées</h3>
            <div className="stat-number">{formatAr(summary.total_discount)}</div>
            <p>Total des réductions</p>
          </div>

          <div className="stat-card">
            <h3>Barquettes</h3>
            <div className="stat-number">{formatAr(summary.packaging_revenue_net)}</div>
            <p>
              {Number(summary.packaging_quantity_total || 0)} unité(s) · Brut: {formatAr(summary.packaging_revenue_gross)}
            </p>
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
          <h3>📦 Détail du classement · {unifiedRankingTitle}{selectedCategoryMeta ? ` · ${selectedCategoryMeta.label}` : ''}</h3>
          <div className="revenue-dashboard-section-actions">
            <div className="form-hint revenue-dashboard-section-meta">
              Vue: <strong>{report?.filters?.scope_label || scopeLabel(scope)}</strong> · Utilisateur: <strong>{selectedUserLabel}</strong> · Intervalle analysé: du <strong>{formatDateTime(report?.filters?.from)}</strong> au <strong>{formatDateTime(report?.filters?.to)}</strong>
            </div>
            <button
              type="button"
              className={`btn btn-sm ${showRankingFilters ? 'btn-primary' : 'btn-secondary'} filter-toggle-inline`}
              onClick={() => setShowRankingFilters((previous) => !previous)}
            >
              <span aria-hidden="true">{showRankingFilters ? '▾' : '▸'}</span>
              <span>{showRankingFilters ? 'Masquer filtres' : 'Afficher filtres'}</span>
              {activeRankingFilterCount > 0 ? <strong>{activeRankingFilterCount}</strong> : null}
            </button>
          </div>
        </div>
        {showRankingFilters ? (
          <div className="revenue-ranking-toolbar">
            <div className="treasury-filter-block">
              <span className="treasury-filter-label">Période</span>
              <div className="treasury-filter-toggles">
                {SCOPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`treasury-filter-toggle ${scope === option.value ? 'is-active' : ''}`}
                    onClick={() => setScope(option.value)}
                  >
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="treasury-filter-block">
              <span className="treasury-filter-label">Utilisateur</span>
              <div className="treasury-filter-toggles">
                <button
                  type="button"
                  className={`treasury-filter-toggle ${selectedUserId === 'all' ? 'is-active' : ''}`}
                  onClick={() => setSelectedUserId('all')}
                >
                  <span>Tous les utilisateurs</span>
                </button>
                {users.map((user) => (
                  <button
                    key={user.id}
                    type="button"
                    className={`treasury-filter-toggle ${selectedUserId === String(user.id) ? 'is-active' : ''}`}
                    onClick={() => setSelectedUserId(String(user.id))}
                  >
                    <span>{user.name} ({user.role})</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="treasury-filter-block">
              <span className="treasury-filter-label">Taille du top</span>
              <div className="treasury-filter-toggles">
                {TOP_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`treasury-filter-toggle ${topLimit === option ? 'is-active' : ''}`}
                    onClick={() => setTopLimit(option)}
                  >
                    <span>Top {option}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="treasury-filter-block">
              <span className="treasury-filter-label">Indicateur</span>
              <div className="treasury-filter-toggles">
                {Object.entries(rankingMetricConfig).map(([metricKey, metricConfig]) => (
                  <button
                    key={metricKey}
                    type="button"
                    className={`treasury-filter-toggle ${rankingMetric === metricKey ? 'is-active' : ''}`}
                    onClick={() => setRankingMetric(metricKey)}
                  >
                    <span>{metricConfig.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="treasury-filter-block">
              <span className="treasury-filter-label">Vue classement</span>
              <div className="treasury-filter-toggles">
                {rankingViewOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`treasury-filter-toggle ${rankingView === option.value ? 'is-active' : ''}`}
                    onClick={() => setRankingView(option.value)}
                  >
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="treasury-filter-block">
              <span className="treasury-filter-label">Catégorie</span>
              <div className="treasury-filter-toggles">
                <button
                  type="button"
                  className={`treasury-filter-toggle ${selectedCategory === 'all' ? 'is-active' : ''}`}
                  onClick={() => setSelectedCategory('all')}
                >
                  <span>Toutes catégories</span>
                  <strong>{categoryRowCounts.all || 0}</strong>
                </button>
                {categoryOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`treasury-filter-toggle ${selectedCategory === option.key ? 'is-active' : ''}`}
                    onClick={() => setSelectedCategory(option.key)}
                  >
                    <span>{option.label}</span>
                    <strong>{categoryRowCounts[option.key] || 0}</strong>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
        <DataTable
          columns={unifiedRankingColumns}
          data={unifiedRankingRows}
          rowKey={(row) => `${row.menu_id}-${row.category_key || 'autres'}-${rankingView}-${row.rank_in_category || 0}`}
          searchPlaceholder="Rechercher un plat (menu/catégorie)..."
          initialSort={{ key: rankingView === 'top' && selectedCategory === 'all' ? 'category_label' : 'rank_in_category', direction: 'asc' }}
          emptyMessage={unifiedRankingEmptyMessage}
        />
      </div>

      <div className="card">
        <h3>🎯 Impact coûts menus et décision de prix{selectedCategoryMeta ? ` · ${selectedCategoryMeta.label}` : ''}</h3>
        <div className="pricing-insights-grid">
          <div className="pricing-insight-card danger">
            <span>Hausse proposée</span>
            <strong>{menuImpactSummary.increase}</strong>
          </div>
          <div className="pricing-insight-card success">
            <span>Baisse proposée</span>
            <strong>{menuImpactSummary.decrease}</strong>
          </div>
          <div className="pricing-insight-card stable">
            <span>Prix aligné</span>
            <strong>{menuImpactSummary.keep}</strong>
          </div>
          <div className="pricing-insight-card cool">
            <span>Menus concernés</span>
            <strong>{menuImpactSummary.total}</strong>
          </div>
          <div className="pricing-insight-card warning">
            <span>Écart coût moyen</span>
            <strong>
              {menuImpactSummary.total > 0
                ? formatAr(menuImpactSummary.absoluteCostChangeTotal / menuImpactSummary.total)
                : formatAr(0)}
            </strong>
          </div>
        </div>

        <DataTable
          columns={menuPricingImpactColumns}
          data={filteredMenuPricingImpact}
          rowKey={(row) => row.menu_id}
          searchPlaceholder="Rechercher un menu impacté..."
          initialSort={{ key: 'unit_cost_change_amount', direction: 'desc' }}
          emptyMessage={selectedCategoryMeta
            ? `Aucun menu impacté à afficher pour la catégorie ${selectedCategoryMeta.label}.`
            : 'Aucun menu impacté à afficher.'}
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
                  step="0.01"
                  value={priceEditValue}
                  onChange={(event) => setPriceEditValue(event.target.value)}
                  required
                />
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
