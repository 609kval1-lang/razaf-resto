import React, { useEffect, useMemo, useState } from 'react';
import { adminAPI } from '../../services/api';
import { useDialog } from '../common/DialogProvider';
import DataTable from '../common/DataTable';

const SYSTEM_ACCESS_ROLES = ['admin', 'server', 'kitchen', 'barman', 'cashier'];
const EMPLOYEE_JOB_TITLE_OPTIONS = [
  'Fille de salle',
  'Femme de ménage',
  'Cuisinier',
  'Aide cuisine',
  'Plongeur',
  'Magasinier',
  'Gardien',
  'Chauffeur',
  'Agent d’entretien',
];

const DEFAULT_FORM_DATA = {
  name: '',
  email: '',
  password: '',
  role: 'server',
  has_system_access: true,
  job_title: '',
  job_title_option: '',
  job_title_custom: '',
  employment_status: 'active',
  monthly_salary: '',
  payment_day: '',
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

const formatDate = (value) => {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return date.toLocaleDateString('fr-FR');
};

const getRoleLabel = (role) => {
  const labels = {
    admin: 'Administrateur',
    server: 'Serveur',
    kitchen: 'Cuisine',
    barman: 'Bar',
    cashier: 'Caisse',
    employee: 'Employé simple',
  };

  return labels[role] || role;
};

const resolveDisplayedJobTitle = (user) => {
  const explicitJobTitle = String(user?.job_title || '').trim();
  if (explicitJobTitle) {
    return explicitJobTitle;
  }

  if (user?.has_system_access) {
    return getRoleLabel(user?.role);
  }

  return 'Poste non renseigné';
};

const UserManagement = () => {
  const { confirm } = useDialog();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState(DEFAULT_FORM_DATA);
  const [message, setMessage] = useState('');

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const response = await adminAPI.getUsers();
      setUsers(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Impossible de charger les utilisateurs.')}`);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData(DEFAULT_FORM_DATA);
    setEditingUser(null);
  };

  const closeModal = () => {
    setShowModal(false);
    resetForm();
  };

  const openCreateModal = () => {
    resetForm();
    setShowModal(true);
  };

  const isSystemAccess = Boolean(formData.has_system_access);
  const filteredUsers = useMemo(() => users, [users]);
  const employeesWithoutAccess = useMemo(
    () => filteredUsers.filter((user) => !user.has_system_access),
    [filteredUsers]
  );
  const usersWithAccess = useMemo(
    () => filteredUsers.filter((user) => user.has_system_access),
    [filteredUsers]
  );

  const handleSubmit = async (event) => {
    event.preventDefault();

    const resolvedJobTitle = isSystemAccess
      ? (String(formData.job_title || '').trim() || null)
      : (
          formData.job_title_option === 'custom'
            ? (String(formData.job_title_custom || '').trim() || null)
            : (String(formData.job_title_option || '').trim() || null)
        );

    const payload = {
      name: String(formData.name || '').trim(),
      email: isSystemAccess ? String(formData.email || '').trim() : null,
      password: String(formData.password || '').trim() || null,
      role: isSystemAccess ? formData.role : 'employee',
      has_system_access: isSystemAccess,
      job_title: resolvedJobTitle,
      employment_status: formData.employment_status || 'active',
      monthly_salary: formData.monthly_salary !== '' ? Number(formData.monthly_salary) : null,
      payment_day: formData.payment_day !== '' ? Number(formData.payment_day) : null,
    };

    try {
      if (editingUser) {
        await adminAPI.updateUser(editingUser.id, payload);
        setMessage('Utilisateur modifié avec succès.');
      } else {
        await adminAPI.createUser(payload);
        setMessage('Utilisateur créé avec succès.');
      }

      await loadUsers();
      closeModal();
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Impossible de sauvegarder cet utilisateur.')}`);
    }
  };

  const handleEdit = (user) => {
    const normalizedRole = SYSTEM_ACCESS_ROLES.includes(user.role) ? user.role : 'server';

    setEditingUser(user);
    setFormData({
      name: user.name || '',
      email: user.email || '',
      password: '',
      role: normalizedRole,
      has_system_access: Boolean(user.has_system_access),
      job_title: user.job_title || '',
      job_title_option: !user.has_system_access && EMPLOYEE_JOB_TITLE_OPTIONS.includes(user.job_title || '')
        ? (user.job_title || '')
        : (!user.has_system_access && (user.job_title || '') ? 'custom' : ''),
      job_title_custom: !user.has_system_access && !EMPLOYEE_JOB_TITLE_OPTIONS.includes(user.job_title || '')
        ? (user.job_title || '')
        : '',
      employment_status: user.employment_status || 'active',
      monthly_salary: user.salary_profile?.monthly_salary ?? '',
      payment_day: user.salary_profile?.payment_day ?? '',
    });
    setShowModal(true);
  };

  const handleDelete = async (userId) => {
    const isConfirmed = await confirm({
      title: 'Supprimer utilisateur',
      message: 'Êtes-vous sûr de vouloir supprimer cet utilisateur ?',
      confirmText: 'Supprimer',
      cancelText: 'Annuler',
      tone: 'danger',
    });

    if (!isConfirmed) {
      return;
    }

    try {
      await adminAPI.deleteUser(userId);
      setMessage('Utilisateur supprimé avec succès.');
      await loadUsers();
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Impossible de supprimer cet utilisateur.')}`);
    }
  };

  const getRoleBadgeClass = (role) => {
    const classes = {
      admin: 'role-admin',
      server: 'role-server',
      kitchen: 'role-kitchen',
      barman: 'role-barman',
      cashier: 'role-cashier',
      employee: 'role-employee',
    };

    return classes[role] || 'role-employee';
  };

  const getAccessBadge = (user) => {
    if (user.has_system_access) {
      return <span className="role-badge role-admin">Accès écran</span>;
    }

    return <span className="role-badge role-employee">Sans accès</span>;
  };

  const userColumns = [
    {
      key: 'name',
      header: 'Nom',
      sortAccessor: (user) => user.name || '',
      searchAccessor: (user) => `${user.name || ''} ${resolveDisplayedJobTitle(user)}`,
      render: (user) => (
        <div className="cash-movement-detail">
          <strong>{user.name}</strong>
          <span>{resolveDisplayedJobTitle(user)}</span>
        </div>
      ),
    },
    {
      key: 'access',
      header: 'Accès',
      sortAccessor: (user) => (user.has_system_access ? '1' : '0'),
      searchAccessor: (user) => (user.has_system_access ? 'Accès écran' : 'Sans accès'),
      render: (user) => getAccessBadge(user),
    },
    {
      key: 'role',
      header: 'Rôle / profil',
      sortAccessor: (user) => getRoleLabel(user.role),
      searchAccessor: (user) => `${getRoleLabel(user.role)} ${resolveDisplayedJobTitle(user)}`,
      render: (user) => (
        <span className={`role-badge ${getRoleBadgeClass(user.role)}`}>
          {getRoleLabel(user.role)}
        </span>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      sortAccessor: (user) => user.email || '',
      searchAccessor: (user) => user.email || '',
      render: (user) => user.email || 'Aucun accès de connexion',
    },
    {
      key: 'employment_status',
      header: 'Statut',
      sortAccessor: (user) => user.employment_status || 'active',
      searchAccessor: (user) => user.employment_status || 'active',
      render: (user) => (user.employment_status === 'inactive' ? 'Inactif' : 'Actif'),
    },
    {
      key: 'created_at',
      header: 'Créé le',
      sortType: 'date',
      sortAccessor: (user) => user.created_at,
      searchAccessor: (user) => formatDate(user.created_at),
      render: (user) => formatDate(user.created_at),
    },
    {
      key: 'actions',
      header: 'Actions',
      sortable: false,
      searchable: false,
      render: (user) => (
        <div className="actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => handleEdit(user)}
            type="button"
          >
            ✏️
          </button>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => handleDelete(user.id)}
            type="button"
          >
            🗑️
          </button>
        </div>
      ),
    },
  ];

  if (loading) {
    return <div className="loading">Chargement des utilisateurs...</div>;
  }

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
          <div>
            <h2>👥 Gestion des Utilisateurs</h2>
            <p className="form-hint" style={{ marginTop: '6px' }}>
              Les profils avec accès écran se connectent au système. Les employés simples restent gérés ici et dans la paie sans voir les comptes internes.
            </p>
          </div>
          <button className="btn btn-primary" onClick={openCreateModal} type="button">
            ➕ Ajouter Utilisateur
          </button>
        </div>

        {message ? (
          <div className={`message ${message.includes('Erreur') ? 'error-message' : 'success-message'}`}>
            {message}
          </div>
        ) : null}

        <div className="stats-grid" style={{ marginBottom: '18px' }}>
          <div className="stat-card">
            <h3>Utilisateurs connectables</h3>
            <div className="stat-number">{usersWithAccess.length}</div>
            <p>Profils avec écran et authentification</p>
          </div>
          <div className="stat-card">
            <h3>Employés simples</h3>
            <div className="stat-number">{employeesWithoutAccess.length}</div>
            <p>Personnel suivi sans accès au système</p>
          </div>
          <div className="stat-card">
            <h3>Total profils</h3>
            <div className="stat-number">{users.length}</div>
            <p>Utilisateurs et employés enregistrés</p>
          </div>
        </div>

        <DataTable
          columns={userColumns}
          data={filteredUsers}
          rowKey="id"
          searchPlaceholder="Rechercher un utilisateur (nom, poste, email, rôle)..."
          initialSort={{ key: 'created_at', direction: 'desc' }}
          emptyMessage="Aucun utilisateur trouvé."
        />
      </div>

      {showModal ? (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingUser ? 'Modifier Utilisateur' : 'Créer Utilisateur'}</h3>
              <button className="modal-close" onClick={closeModal} type="button">×</button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Nom complet</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Type de profil</label>
                  <select
                    value={isSystemAccess ? 'system' : 'employee'}
                    onChange={(event) => setFormData((prev) => ({
                      ...prev,
                      has_system_access: event.target.value === 'system',
                      role: event.target.value === 'system' ? prev.role || 'server' : 'employee',
                    }))}
                  >
                    <option value="system">Utilisateur avec accès écran</option>
                    <option value="employee">Employé simple sans accès</option>
                  </select>
                  <div className="form-hint">
                    Un employé simple peut être payé et suivi sans se connecter à l&apos;application.
                  </div>
                </div>

                <div className="form-group">
                  <label>{isSystemAccess ? 'Poste / fonction' : 'Poste employé'}</label>
                  {isSystemAccess ? (
                    <>
                      <input
                        type="text"
                        value={formData.job_title}
                        onChange={(event) => setFormData((prev) => ({ ...prev, job_title: event.target.value }))}
                        placeholder="Optionnel"
                      />
                      <div className="form-hint">
                        Si vous laissez vide, le niveau du compte sera utilisé comme poste affiché.
                      </div>
                    </>
                  ) : (
                    <>
                      <select
                        value={formData.job_title_option}
                        onChange={(event) => setFormData((prev) => ({
                          ...prev,
                          job_title_option: event.target.value,
                          job_title_custom: event.target.value === 'custom' ? prev.job_title_custom : '',
                        }))}
                        required
                      >
                        <option value="">Choisir un poste</option>
                        {EMPLOYEE_JOB_TITLE_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                        <option value="custom">Autre poste...</option>
                      </select>
                      {formData.job_title_option === 'custom' ? (
                        <input
                          type="text"
                          value={formData.job_title_custom}
                          onChange={(event) => setFormData((prev) => ({ ...prev, job_title_custom: event.target.value }))}
                          placeholder="Ex: Réceptionniste, coursier..."
                          required
                        />
                      ) : null}
                    </>
                  )}
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Salaire mensuel (Ar)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.monthly_salary}
                    onChange={(event) => setFormData((prev) => ({ ...prev, monthly_salary: event.target.value }))}
                    placeholder="Ex: 250000"
                  />
                  <div className="form-hint">
                    Vous pouvez le laisser vide maintenant et le compléter plus tard dans la paie.
                  </div>
                </div>

                <div className="form-group">
                  <label>Jour habituel de paiement</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={formData.payment_day}
                    onChange={(event) => setFormData((prev) => ({ ...prev, payment_day: event.target.value }))}
                    placeholder="Ex: 30"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Statut</label>
                  <select
                    value={formData.employment_status}
                    onChange={(event) => setFormData((prev) => ({ ...prev, employment_status: event.target.value }))}
                  >
                    <option value="active">Actif</option>
                    <option value="inactive">Inactif</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Rôle système</label>
                  <select
                    value={formData.role}
                    onChange={(event) => setFormData((prev) => ({ ...prev, role: event.target.value }))}
                    disabled={!isSystemAccess}
                    required={isSystemAccess}
                  >
                    <option value="admin">Admin - Accès complet</option>
                    <option value="server">Serveur - Prise de commandes</option>
                    <option value="kitchen">Cuisine - Gestion commandes</option>
                    <option value="barman">Bar - Préparation boissons</option>
                    <option value="cashier">Caisse - Traitement paiements</option>
                  </select>
                  <div className="form-hint">
                    {isSystemAccess ? 'Choisissez uniquement les profils qui doivent ouvrir une session.' : 'Désactivé pour un employé simple.'}
                  </div>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Email {isSystemAccess ? '' : '(optionnel)'}</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(event) => setFormData((prev) => ({ ...prev, email: event.target.value }))}
                    required={isSystemAccess}
                    placeholder={isSystemAccess ? 'email@restaurant.com' : 'Laisser vide si pas de connexion'}
                  />
                </div>

                <div className="form-group">
                  <label>
                    {editingUser ? 'Nouveau mot de passe' : 'Mot de passe'}
                    {!isSystemAccess ? ' (optionnel)' : ''}
                  </label>
                  <input
                    type="password"
                    value={formData.password}
                    onChange={(event) => setFormData((prev) => ({ ...prev, password: event.target.value }))}
                    required={isSystemAccess && !editingUser}
                    placeholder={editingUser ? 'Renseigner seulement pour modifier' : 'Minimum 6 caractères'}
                  />
                  {editingUser ? (
                    <div className="form-hint">
                      Laissez vide pour conserver le mot de passe actuel.
                    </div>
                  ) : null}
                </div>
              </div>

              {!isSystemAccess ? (
                <div className="message success-message" style={{ marginBottom: '16px' }}>
                  Ce profil sera disponible pour la paie et les avances, mais sans accès aux écrans ni aux comptes internes.
                </div>
              ) : null}

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingUser ? 'Modifier' : 'Créer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default UserManagement;
