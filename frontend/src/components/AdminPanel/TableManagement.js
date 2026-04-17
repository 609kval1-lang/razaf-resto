import React, { useCallback, useEffect, useState } from 'react';
import { adminAPI } from '../../services/api';
import DataTable from '../common/DataTable';

const extractApiError = (error, fallbackMessage) => {
  const directMessage = error?.response?.data?.message || error?.response?.data?.error;
  if (directMessage) {
    return directMessage;
  }

  const validationErrors = error?.response?.data?.errors;
  if (validationErrors && typeof validationErrors === 'object') {
    const firstErrorKey = Object.keys(validationErrors)[0];
    const firstErrorValue = validationErrors[firstErrorKey];
    if (Array.isArray(firstErrorValue) && firstErrorValue.length > 0) {
      return firstErrorValue[0];
    }
  }

  return fallbackMessage;
};

const normalizeStatus = (status) => {
  const normalized = String(status || '').toLowerCase();

  if (normalized === 'available') {
    return 'free';
  }

  if (['free', 'occupied', 'reserved'].includes(normalized)) {
    return normalized;
  }

  return 'free';
};

const normalizeEditableStatus = (status) => {
  const normalized = normalizeStatus(status);
  return normalized === 'reserved' ? 'reserved' : 'free';
};

const normalizeSection = (section) => {
  const normalized = String(section || '').toLowerCase().trim();

  if (['bar', 'barre'].includes(normalized)) {
    return 'bar';
  }

  if (['salle', 'main', 'interieur', 'intérieur'].includes(normalized)) {
    return 'salle';
  }

  return 'salle';
};

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));
const DATE_INPUT_PATTERN = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const LOCAL_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

const parseDateValue = (value) => {
  if (!value) {
    return null;
  }

  const normalizedValue = String(value).trim();
  const localMatch = normalizedValue.match(LOCAL_DATETIME_PATTERN);

  if (localMatch) {
    const [, year, month, day, hour = '00', minute = '00', second = '00'] = localMatch;

    return {
      year,
      month,
      day,
      hour,
      minute,
      second,
    };
  }

  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return {
    year: String(date.getFullYear()),
    month: String(date.getMonth() + 1).padStart(2, '0'),
    day: String(date.getDate()).padStart(2, '0'),
    hour: String(date.getHours()).padStart(2, '0'),
    minute: String(date.getMinutes()).padStart(2, '0'),
    second: String(date.getSeconds()).padStart(2, '0'),
  };
};

const toReservationInputFields = (value) => {
  if (!value) {
    return {
      reservation_date: '',
      reservation_hour: '19',
      reservation_minute: '00',
    };
  }

  const parsedDate = parseDateValue(value);
  if (!parsedDate) {
    return {
      reservation_date: '',
      reservation_hour: '19',
      reservation_minute: '00',
    };
  }

  return {
    reservation_date: `${parsedDate.day}/${parsedDate.month}/${parsedDate.year}`,
    reservation_hour: parsedDate.hour,
    reservation_minute: parsedDate.minute,
  };
};

const normalizeDateInput = (value) => {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8);

  if (digits.length <= 2) {
    return digits;
  }

  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }

  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

const buildReservationDateTimeValue = (dateInput, hourInput, minuteInput) => {
  const match = String(dateInput || '').match(DATE_INPUT_PATTERN);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(hourInput);
  const minute = Number(minuteInput);

  if (
    !Number.isInteger(day)
    || !Number.isInteger(month)
    || !Number.isInteger(year)
    || !Number.isInteger(hour)
    || !Number.isInteger(minute)
  ) {
    return null;
  }

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
    || date.getHours() !== hour
    || date.getMinutes() !== minute
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
};

const formatReservationDate = (value) => {
  const parsedDate = parseDateValue(value);
  if (!parsedDate) {
    return '-';
  }

  return `${parsedDate.day}/${parsedDate.month}/${parsedDate.year} ${parsedDate.hour}:${parsedDate.minute}`;
};

const TableManagement = () => {
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTable, setEditingTable] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [formData, setFormData] = useState({
    table_number: '',
    capacity: 4,
    status: 'free',
    section: 'salle',
    reservation_name: '',
    reservation_phone: '',
    reservation_date: '',
    reservation_hour: '19',
    reservation_minute: '00',
    reservation_notes: '',
  });

  const showToast = useCallback((text, type = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((previous) => [...previous, { id, text, type }]);

    setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id));
    }, 3200);
  }, []);

  const loadTables = useCallback(async () => {
    try {
      const response = await adminAPI.getTables();
      setTables(response.data);
    } catch (error) {
      showToast(extractApiError(error, 'Erreur lors du chargement des tables'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadTables();
  }, [loadTables]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const isReserved = normalizeStatus(formData.status) === 'reserved';
    const reservationAt = isReserved
      ? buildReservationDateTimeValue(formData.reservation_date, formData.reservation_hour, formData.reservation_minute)
      : null;

    if (isReserved && !reservationAt) {
      showToast('Date de réservation invalide. Utilise le format JJ/MM/AAAA avec une heure valide.', 'error');
      return;
    }

    const payload = {
      table_number: Number(formData.table_number),
      capacity: Number(formData.capacity),
      status: normalizeStatus(formData.status),
      section: normalizeSection(formData.section),
      reservation_name: formData.reservation_name ? String(formData.reservation_name).trim() : null,
      reservation_phone: formData.reservation_phone ? String(formData.reservation_phone).trim() : null,
      reservation_at: reservationAt,
      reservation_notes: formData.reservation_notes ? String(formData.reservation_notes).trim() : null,
    };

    try {
      if (editingTable) {
        await adminAPI.updateTable(editingTable.id, {
          capacity: payload.capacity,
          status: payload.status,
          section: payload.section,
          reservation_name: payload.reservation_name,
          reservation_phone: payload.reservation_phone,
          reservation_at: payload.reservation_at,
          reservation_notes: payload.reservation_notes,
        });
        showToast('Table modifiée avec succès');
      } else {
        await adminAPI.createTable(payload);
        showToast('Table créée avec succès');
      }
      loadTables();
      setShowModal(false);
      resetForm();
    } catch (error) {
      showToast(extractApiError(error, 'Erreur lors de la sauvegarde'), 'error');
    }
  };

  const handleEdit = (table) => {
    const reservationFields = toReservationInputFields(table.reservation_at);

    setEditingTable(table);
    setFormData({
      table_number: table.table_number,
      capacity: table.capacity,
      status: normalizeEditableStatus(table.recorded_status || table.status),
      section: normalizeSection(table.section || table.location),
      reservation_name: table.reservation_name || '',
      reservation_phone: table.reservation_phone || '',
      reservation_date: reservationFields.reservation_date,
      reservation_hour: reservationFields.reservation_hour,
      reservation_minute: reservationFields.reservation_minute,
      reservation_notes: table.reservation_notes || '',
    });
    setShowModal(true);
  };

  const requestDelete = (table) => {
    setDeleteTarget(table);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }

    try {
      await adminAPI.deleteTable(deleteTarget.id);
      showToast('Table supprimée avec succès');
      setDeleteTarget(null);
      loadTables();
    } catch (error) {
      showToast(extractApiError(error, 'Erreur lors de la suppression'), 'error');
    }
  };

  const resetForm = () => {
    setFormData({
      table_number: '',
      capacity: 4,
      status: 'free',
      section: 'salle',
      reservation_name: '',
      reservation_phone: '',
      reservation_date: '',
      reservation_hour: '19',
      reservation_minute: '00',
      reservation_notes: '',
    });
    setEditingTable(null);
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const getStatusBadgeClass = (table) => {
    const status = normalizeStatus(table?.recorded_status || table?.status);
    const classes = {
      free: 'status-available',
      available: 'status-available',
      occupied: 'status-occupied',
      reserved: 'status-reserved',
    };
    return classes[status] || 'status-available';
  };

  const getServiceStatus = (table) => normalizeStatus(table?.service_status || table?.status);

  const getServiceStatusBadgeClass = (table) => {
    const status = getServiceStatus(table);
    const classes = {
      free: 'status-available',
      occupied: 'status-occupied',
      reserved: 'status-reserved',
    };
    return classes[status] || 'status-available';
  };

  const getStatusLabel = (table) => {
    const configuredStatus = normalizeStatus(table?.recorded_status || table?.status);

    if (configuredStatus === 'free' && table?.has_active_orders) {
      return 'Libre (occupée côté service)';
    }

    const labels = {
      free: 'Libre',
      available: 'Disponible',
      occupied: 'Occupée',
      reserved: 'Réservée',
    };
    return labels[configuredStatus] || 'Libre';
  };

  const getServiceStatusLabel = (table) => {
    const serviceStatus = getServiceStatus(table);
    const labels = {
      free: 'Disponible serveur',
      occupied: 'Occupée (commande impayée)',
      reserved: 'Réservée (T-2h)',
    };

    const baseLabel = labels[serviceStatus] || 'Disponible serveur';
    const reason = String(table?.server_block_reason || '').trim();
    return reason ? `${baseLabel} · ${reason}` : baseLabel;
  };

  const getSectionLabel = (section) => {
    const normalized = normalizeSection(section);
    const labels = {
      bar: 'Bar',
      salle: 'Salle',
    };
    return labels[normalized] || 'Salle';
  };

  const tableColumns = [
    {
      key: 'table_number',
      header: 'N° Table',
      sortType: 'number',
      sortAccessor: (table) => Number(table.table_number || 0),
      searchAccessor: (table) => `Table ${table.table_number}`,
      render: (table) => `Table ${table.table_number}`,
    },
    {
      key: 'capacity',
      header: 'Capacité',
      sortType: 'number',
      sortAccessor: (table) => Number(table.capacity || 0),
      searchAccessor: (table) => `${table.capacity} personnes`,
      render: (table) => `${table.capacity} personnes`,
    },
    {
      key: 'section',
      header: 'Emplacement',
      sortAccessor: (table) => getSectionLabel(table.section || table.location),
      searchAccessor: (table) => getSectionLabel(table.section || table.location),
      render: (table) => getSectionLabel(table.section || table.location),
    },
    {
      key: 'status',
      header: 'Statut admin',
      sortAccessor: (table) => getStatusLabel(table),
      searchAccessor: (table) => getStatusLabel(table),
      render: (table) => (
        <span className={`status-badge ${getStatusBadgeClass(table)}`}>
          {getStatusLabel(table)}
        </span>
      ),
    },
    {
      key: 'service_status',
      header: 'Statut serveur',
      sortAccessor: (table) => getServiceStatusLabel(table),
      searchAccessor: (table) => `${getServiceStatusLabel(table)} ${table?.server_block_reason || ''}`,
      render: (table) => (
        <span className={`status-badge ${getServiceStatusBadgeClass(table)}`}>
          {getServiceStatusLabel(table)}
        </span>
      ),
    },
    {
      key: 'reservation',
      header: 'Réservation',
      sortAccessor: (table) => table.reservation_at || '',
      searchAccessor: (table) => `${table.reservation_name || ''} ${formatReservationDate(table.reservation_at)}`,
      render: (table) => {
        const recordedStatus = normalizeStatus(table.recorded_status || table.status);
        if (recordedStatus !== 'reserved') {
          return '-';
        }

        return (
          <div style={{ fontSize: '0.82rem' }}>
            <strong>{table.reservation_name || 'Client non renseigné'}</strong>
            <div>{formatReservationDate(table.reservation_at)}</div>
            <div style={{ color: '#666' }}>
              {table.reservation_locked
                ? 'Bloquée maintenant (fenêtre T-2h atteinte)'
                : `Bloquée à partir de ${formatReservationDate(table.reservation_lock_at)}`}
            </div>
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      sortable: false,
      searchable: false,
      render: (table) => (
        <div className="actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => handleEdit(table)}
          >
            ✏️
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => requestDelete(table)}
          >
            🗑️
          </button>
        </div>
      ),
    },
  ];

  if (loading) {
    return <div className="loading">Chargement des tables...</div>;
  }

  return (
    <div>
      <div className="toast-stack" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast-item ${toast.type === 'error' ? 'error' : 'success'}`}>
            {toast.text}
          </div>
        ))}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2>🍽️ Gestion des Tables</h2>
          <button className="btn btn-primary" onClick={openCreateModal}>
            ➕ Ajouter Table
          </button>
        </div>

        <DataTable
          columns={tableColumns}
          data={tables}
          rowKey="id"
          searchPlaceholder="Rechercher une table (numéro, section, statut, réservation)..."
          initialSort={{ key: 'table_number', direction: 'asc' }}
          emptyMessage="Aucune table configurée."
        />
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingTable ? 'Modifier Table' : 'Créer Table'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Numéro de table</label>
                <input
                  type="number"
                  value={formData.table_number}
                  onChange={(e) => setFormData({...formData, table_number: e.target.value})}
                  required
                  min="1"
                />
              </div>

              <div className="form-group">
                <label>Capacité (personnes)</label>
                <input
                  type="number"
                  value={formData.capacity}
                  onChange={(e) => setFormData({...formData, capacity: e.target.value})}
                  required
                  min="1"
                  max="20"
                />
              </div>

              <div className="form-group">
                <label>Emplacement</label>
                <select
                  value={formData.section}
                  onChange={(e) => setFormData({...formData, section: e.target.value})}
                  required
                >
                  <option value="salle">🏠 Salle</option>
                  <option value="bar">🍸 Bar</option>
                </select>
              </div>

              <div className="form-group">
                <label>Statut</label>
                <select
                  value={formData.status}
                  onChange={(e) => {
                    const nextStatus = e.target.value;
                    if (nextStatus === 'reserved') {
                      setFormData({ ...formData, status: nextStatus });
                      return;
                    }

                    setFormData({
                      ...formData,
                      status: nextStatus,
                      reservation_name: '',
                      reservation_phone: '',
                      reservation_date: '',
                      reservation_hour: '19',
                      reservation_minute: '00',
                      reservation_notes: '',
                    });
                  }}
                  required
                >
                  <option value="free">✅ Libre</option>
                  <option value="reserved">📅 Réservée</option>
                </select>
                <span className="form-hint">
                  Le statut "Occupée" est automatique quand une commande est active et non payée.
                </span>
              </div>

              {formData.status === 'reserved' && (
                <>
                  <div className="form-group">
                    <label>Nom du client (réservation)</label>
                    <input
                      type="text"
                      value={formData.reservation_name}
                      onChange={(e) => setFormData({ ...formData, reservation_name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Téléphone client</label>
                    <input
                      type="text"
                      value={formData.reservation_phone}
                      onChange={(e) => setFormData({ ...formData, reservation_phone: e.target.value })}
                      placeholder="+261..."
                    />
                  </div>

                  <div className="form-group">
                    <label>Date et heure de réservation</label>
                    <div className="reservation-datetime-grid">
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="JJ/MM/AAAA"
                        value={formData.reservation_date}
                        onChange={(e) => setFormData({ ...formData, reservation_date: normalizeDateInput(e.target.value) })}
                        maxLength={10}
                        required
                      />
                      <select
                        value={formData.reservation_hour}
                        onChange={(e) => setFormData({ ...formData, reservation_hour: e.target.value })}
                        required
                      >
                        {HOUR_OPTIONS.map((hour) => (
                          <option key={hour} value={hour}>{hour}</option>
                        ))}
                      </select>
                      <span className="reservation-time-separator">:</span>
                      <select
                        value={formData.reservation_minute}
                        onChange={(e) => setFormData({ ...formData, reservation_minute: e.target.value })}
                        required
                      >
                        {MINUTE_OPTIONS.map((minute) => (
                          <option key={minute} value={minute}>{minute}</option>
                        ))}
                      </select>
                    </div>
                    <span className="form-hint">Format: JJ/MM/AAAA (ex: 26/03/2026 à 19:30)</span>
                  </div>

                  <div className="form-group">
                    <label>Note de réservation</label>
                    <textarea
                      rows="2"
                      value={formData.reservation_notes}
                      onChange={(e) => setFormData({ ...formData, reservation_notes: e.target.value })}
                      placeholder="Ex: anniversaire, table terrasse..."
                    />
                  </div>
                </>
              )}

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingTable ? 'Modifier' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal modal-confirm" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Confirmer la suppression</h3>
              <button className="modal-close" onClick={() => setDeleteTarget(null)}>×</button>
            </div>

            <p>
              Vous allez supprimer <strong>Table {deleteTarget.table_number}</strong>.
              Cette action est définitive.
            </p>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>
                Annuler
              </button>
              <button type="button" className="btn btn-danger" onClick={confirmDelete}>
                Oui, supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TableManagement;
