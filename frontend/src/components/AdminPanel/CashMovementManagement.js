import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminAPI } from '../../services/api';
import useSerializedAsyncCallback from '../../hooks/useSerializedAsyncCallback';
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

const statusLabel = (status) => {
  const labels = {
    pending: 'En attente',
    approved: 'Valide',
    rejected: 'Refuse',
  };

  return labels[status] || status;
};

const renderMovementDetails = (movement, { preferReason = false } = {}) => {
  const reason = String(movement?.reason_label || movement?.reason || '').trim();
  const description = [
    String(movement?.description || '').trim(),
    String(movement?.reason_details || '').trim(),
    movement?.beneficiary_name ? `Bénéficiaire: ${String(movement.beneficiary_name).trim()}` : '',
  ]
    .filter((value) => value && value !== reason)
    .filter((value, index, array) => array.indexOf(value) === index)
    .join(' · ');
  const primary = preferReason
    ? (reason || description)
    : (description || reason);
  const secondary = preferReason
    ? (description && description !== primary ? description : '')
    : (reason && reason !== primary ? reason : '');

  return (
    <div className="cash-movement-detail">
      <strong>{primary || '-'}</strong>
      {secondary ? <span>{secondary}</span> : null}
    </div>
  );
};

const defaultSummary = {
  cash_in_approved: 0,
  cash_out_approved: 0,
  cash_out_pending: 0,
  cash_available: 0,
  pending_requests_count: 0,
  entries_today: 0,
  exits_today: 0,
};

const defaultRevenue = {
  dishes: 0,
  drinks: 0,
  total: 0,
};

const CASH_MOVEMENTS_REFRESH_INTERVAL_MS = 5000;

const CashMovementManagement = () => {
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [message, setMessage] = useState('');
  const [summary, setSummary] = useState(defaultSummary);
  const [revenue, setRevenue] = useState(defaultRevenue);
  const [pending, setPending] = useState([]);

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
      const response = await adminAPI.getCashMovements();
      const data = response?.data || {};
      setSummary(data.summary || defaultSummary);
      setRevenue(data.revenue_breakdown_today || defaultRevenue);
      setPending(Array.isArray(data.pending_withdrawals) ? data.pending_withdrawals : []);
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Impossible de charger les mouvements de caisse')}`);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);
  const loadData = useSerializedAsyncCallback(loadDataInternal);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleApprove = async (movementId) => {
    setProcessingId(movementId);
    setMessage('');

    try {
      await adminAPI.approveCashMovement(movementId);
      setMessage('Sortie de caisse validée');
      await loadData({ silent: true });
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Validation impossible')}`);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (movementId) => {
    setProcessingId(movementId);
    setMessage('');

    try {
      await adminAPI.rejectCashMovement(movementId);
      setMessage('Sortie de caisse refusée');
      await loadData({ silent: true });
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Refus impossible')}`);
    } finally {
      setProcessingId(null);
    }
  };

  useEffect(() => {
    const intervalId = setInterval(() => {
      loadData({ silent: true });
    }, CASH_MOVEMENTS_REFRESH_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [loadData]);

  const pendingColumns = [
    {
      key: 'id',
      header: '#',
      sortType: 'number',
      sortAccessor: (movement) => Number(movement.id || 0),
      searchAccessor: (movement) => String(movement.id || ''),
      render: (movement) => `#${movement.id}`,
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
      key: 'reason',
      header: 'Motif',
      sortAccessor: (movement) => movement.reason || movement.description || '',
      searchAccessor: (movement) => `${movement.reason || ''} ${movement.description || ''}`,
      render: (movement) => renderMovementDetails(movement, { preferReason: true }),
    },
    {
      key: 'requested_by_name',
      header: 'Demandeur',
      sortAccessor: (movement) => movement.requested_by_name || '',
      searchAccessor: (movement) => movement.requested_by_name || '',
      render: (movement) => movement.requested_by_name || '-',
    },
    {
      key: 'created_at',
      header: 'Date',
      sortType: 'date',
      sortAccessor: (movement) => movement.created_at,
      searchAccessor: (movement) => formatDateTime(movement.created_at),
      render: (movement) => formatDateTime(movement.created_at),
    },
    {
      key: 'status',
      header: 'Statut',
      sortAccessor: (movement) => statusLabel(movement.status),
      searchAccessor: (movement) => statusLabel(movement.status),
      render: (movement) => (
        <span className={`cash-movement-status ${movement.status || 'pending'}`}>
          {statusLabel(movement.status)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      sortable: false,
      searchable: false,
      render: (movement) => (
        <div className="actions cash-request-actions">
          <button
            className="btn btn-primary btn-sm cash-request-action"
            onClick={() => handleApprove(movement.id)}
            disabled={processingId === movement.id}
            title="Valider la sortie de caisse"
            aria-label={`Valider la sortie de caisse ${movement.reference || movement.id}`}
          >
            <span className="cash-request-action-icon" aria-hidden="true" />
            <span>{processingId === movement.id ? 'Validation...' : 'Valider'}</span>
          </button>
          <button
            className="btn btn-danger btn-sm cash-request-action"
            onClick={() => handleReject(movement.id)}
            disabled={processingId === movement.id}
            title="Refuser la sortie de caisse"
            aria-label={`Refuser la sortie de caisse ${movement.reference || movement.id}`}
          >
            <span className="cash-request-action-icon" aria-hidden="true" />
            <span>{processingId === movement.id ? 'Traitement...' : 'Refuser'}</span>
          </button>
        </div>
      ),
    },
  ];

  if (loading) {
    return <div className="loading">Chargement des mouvements de caisse...</div>;
  }

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
          <div>
            <h2>Caisse: demandes et validation</h2>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => loadData()}>
              Actualiser
            </button>
            <Link className="btn btn-secondary" to="/admin/treasury">
              Ouvrir Trésorerie
            </Link>
            <Link className="btn btn-secondary" to="/admin/histories?view=treasury&account=cash">
              Historiques caisse
            </Link>
          </div>
        </div>

        {message ? (
          <div className={`message ${message.includes('Erreur') ? 'error-message' : 'success-message'}`}>
            {message}
          </div>
        ) : null}

        <div className="stats-grid" style={{ marginBottom: '10px' }}>
          <div className="stat-card">
            <h3>Caisse disponible</h3>
            <div className="stat-number">{formatCurrency(summary.cash_available)}</div>
          </div>
          <div className="stat-card">
            <h3>Entrees cash (jour)</h3>
            <div className="stat-number">{formatCurrency(summary.entries_today)}</div>
          </div>
          <div className="stat-card">
            <h3>Sorties validées (jour)</h3>
            <div className="stat-number">{formatCurrency(summary.exits_today)}</div>
          </div>
          <div className="stat-card">
            <h3>Sorties en attente</h3>
            <div className="stat-number">{formatCurrency(summary.cash_out_pending)}</div>
            <p>{summary.pending_requests_count || 0} demande(s)</p>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <h3>Plats (emballages inclus)</h3>
            <div className="stat-number">{formatCurrency(revenue.dishes)}</div>
          </div>
          <div className="stat-card">
            <h3>Boissons (cocktails inclus)</h3>
            <div className="stat-number">{formatCurrency(revenue.drinks)}</div>
          </div>
          <div className="stat-card">
            <h3>CA du jour</h3>
            <div className="stat-number">{formatCurrency(revenue.total)}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '10px' }}>Demandes de sortie en attente</h3>
        {pending.length === 0 ? (
          <div className="alert-empty">Aucune demande en attente.</div>
        ) : (
          <DataTable
            columns={pendingColumns}
            data={pending}
            rowKey="id"
            searchPlaceholder="Rechercher une demande (motif, demandeur, statut)..."
            initialSort={{ key: 'created_at', direction: 'desc' }}
          />
        )}
      </div>

    </div>
  );
};

export default CashMovementManagement;
