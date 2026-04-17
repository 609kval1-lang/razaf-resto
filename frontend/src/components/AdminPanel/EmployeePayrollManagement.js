import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adminAPI } from '../../services/api';
import useSerializedAsyncCallback from '../../hooks/useSerializedAsyncCallback';
import DataTable from '../common/DataTable';
import { formatPaymentMethodLabel, PAYMENT_METHOD_OPTIONS, normalizePaymentMethod } from '../../utils/paymentMethods';

const ACCOUNT_LABELS = {
  cash: 'Caisse',
  safe: 'Coffre',
  bank: 'Banque',
  mobile_money: 'Mobile Money',
};

const TRANSACTION_TYPE_LABELS = {
  advance: 'Avance sur salaire',
  salary_payment: 'Paiement salaire',
};

const ROLE_JOB_LABELS = {
  admin: 'Administrateur',
  server: 'Serveur',
  kitchen: 'Cuisine',
  barman: 'Bar',
  cashier: 'Caisse',
  employee: 'Employé simple',
};

const defaultSnapshot = {
  employees: [],
  transactions: [],
  config: {
    payment_methods: ['cash', 'mobile_money', 'transfer', 'check'],
    cash_source_accounts: ['cash', 'safe'],
  },
  treasury_balances: {
    cash: 0,
    safe: 0,
    bank: 0,
    mobile_money: 0,
  },
};
const PAYROLL_REFRESH_INTERVAL_MS = 5000;

const formatCurrency = (value) => {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} Ar`;
};

const formatDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('fr-FR');
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

const getTodayDateInputValue = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatOutstandingAdvanceDateHint = (employee) => {
  const outstandingAmount = Number(employee?.outstanding_advance_amount || 0);
  const outstandingCount = Number(employee?.outstanding_advance_count || 0);
  const oldestDate = employee?.outstanding_advance_oldest_date || '';
  const latestDate = employee?.outstanding_advance_latest_date || '';

  if (outstandingAmount <= 0 || outstandingCount <= 0) {
    return 'Aucune avance ouverte.';
  }

  if (oldestDate && latestDate && oldestDate !== latestDate) {
    return `Dates prises en compte: du ${formatDate(oldestDate)} au ${formatDate(latestDate)} (${outstandingCount} avances).`;
  }

  const singleDate = oldestDate || latestDate || '';
  if (singleDate) {
    return `Date prise en compte: ${formatDate(singleDate)} (${outstandingCount} avance${outstandingCount > 1 ? 's' : ''}).`;
  }

  return `Avances ouvertes en attente de déduction (${outstandingCount}).`;
};

const extractErrorMessage = (error, fallbackMessage) => {
  const errors = error?.response?.data?.errors;
  if (errors && typeof errors === 'object') {
    const first = Object.values(errors).flat().find((item) => typeof item === 'string');
    if (first) return first;
  }
  return error?.response?.data?.message || fallbackMessage;
};

const resolveDisplayedJobTitle = (person) => {
  const explicitJobTitle = String(person?.job_title || '').trim();
  if (explicitJobTitle) return explicitJobTitle;
  if (person?.has_system_access) return ROLE_JOB_LABELS[person?.role] || 'Utilisateur système';
  return 'Poste non renseigné';
};

const getAutoSourceAccount = (paymentMethod, cashSourceAccount) => {
  const normalizedMethod = normalizePaymentMethod(paymentMethod);
  if (normalizedMethod === 'cash') return cashSourceAccount || 'cash';
  if (normalizedMethod === 'mobile_money') return 'mobile_money';
  if (normalizedMethod === 'transfer' || normalizedMethod === 'check') return 'bank';
  return '';
};

const getPaymentSelectionValue = (paymentMethod, cashSourceAccount) => {
  const normalizedMethod = normalizePaymentMethod(paymentMethod);
  if (normalizedMethod === 'cash') {
    return `cash:${cashSourceAccount || 'cash'}`;
  }

  return normalizedMethod || 'cash:cash';
};

const resolvePaymentSelection = (selection) => {
  const normalizedSelection = String(selection || '').trim().toLowerCase();

  if (normalizedSelection.startsWith('cash:')) {
    const selectedAccount = normalizedSelection.slice(5) === 'safe' ? 'safe' : 'cash';

    return {
      payment_method: 'cash',
      cash_source_account: selectedAccount,
    };
  }

  const normalizedMethod = normalizePaymentMethod(normalizedSelection);

  return {
    payment_method: normalizedMethod || 'cash',
    cash_source_account: normalizedMethod === 'cash' ? 'cash' : null,
  };
};

const buildSalaryForm = (employee) => ({
  monthly_salary: employee?.salary_profile?.monthly_salary ?? employee?.monthly_salary ?? '',
  payment_day: employee?.salary_profile?.payment_day ?? '',
  is_active: employee?.salary_profile?.is_active ?? employee?.employment_status !== 'inactive',
  notes: employee?.salary_profile?.notes || '',
});

const buildAdvanceForm = () => ({
  amount: '',
  payment_method: 'cash',
  cash_source_account: 'cash',
  paid_at: getTodayDateInputValue(),
  reference: '',
  note: '',
});

const buildSalaryPaymentForm = (employee) => ({
  gross_amount: employee?.monthly_salary
    ? String(Math.max(0, Number(employee.monthly_salary || 0) - Number(employee.salary_covered_this_month || 0)))
    : '',
  advance_deduction_amount: employee?.outstanding_advance_amount ? String(employee.outstanding_advance_amount) : '',
  payment_method: 'cash',
  cash_source_account: 'cash',
  payroll_month: new Date().toISOString().slice(0, 7),
  paid_at: getTodayDateInputValue(),
  reference: '',
  note: '',
});

const EmployeePayrollManagement = () => {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [snapshot, setSnapshot] = useState(defaultSnapshot);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(null);
  const [salaryForm, setSalaryForm] = useState(buildSalaryForm(null));
  const [advanceForm, setAdvanceForm] = useState(buildAdvanceForm());
  const [salaryPaymentForm, setSalaryPaymentForm] = useState(buildSalaryPaymentForm(null));
  const [savingSalaryProfile, setSavingSalaryProfile] = useState(false);
  const [savingAdvance, setSavingAdvance] = useState(false);
  const [savingSalaryPayment, setSavingSalaryPayment] = useState(false);
  const [activePayrollAction, setActivePayrollAction] = useState('advance');
  const [transactionHistoryFilter, setTransactionHistoryFilter] = useState('all');
  const previousSelectedEmployeeIdRef = useRef(null);

  const loadSnapshotInternal = useCallback(async (options = {}) => {
    const { silent = false } = options || {};

    if (silent && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return null;
    }

    if (!silent) {
      setLoading(true);
      setMessage('');
    }

    try {
      const response = await adminAPI.getEmployeePayrollSnapshot();
      const data = response?.data || defaultSnapshot;
      const employees = Array.isArray(data.employees) ? data.employees : [];
      const normalizedSnapshot = {
        employees,
        transactions: Array.isArray(data.transactions) ? data.transactions : [],
        config: data.config || defaultSnapshot.config,
        treasury_balances: data.treasury_balances && typeof data.treasury_balances === 'object'
          ? data.treasury_balances
          : defaultSnapshot.treasury_balances,
      };
      setSnapshot(normalizedSnapshot);
      setSelectedEmployeeId((currentSelectedId) => (
        employees.some((employee) => employee.id === currentSelectedId)
          ? currentSelectedId
          : (employees[0]?.id || null)
      ));
      return normalizedSnapshot;
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Impossible de charger la paie des employés.')}`);
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);
  const loadSnapshot = useSerializedAsyncCallback(loadSnapshotInternal);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      loadSnapshot({ silent: true });
    }, PAYROLL_REFRESH_INTERVAL_MS);

    const handleWindowFocus = () => {
      loadSnapshot({ silent: true });
    };

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        loadSnapshot({ silent: true });
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
  }, [loadSnapshot]);

  const employees = useMemo(() => snapshot.employees || [], [snapshot.employees]);
  const transactions = useMemo(() => snapshot.transactions || [], [snapshot.transactions]);
  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === selectedEmployeeId) || null,
    [employees, selectedEmployeeId]
  );

  useEffect(() => {
    if (previousSelectedEmployeeIdRef.current === selectedEmployeeId) {
      return;
    }

    setSalaryForm(buildSalaryForm(selectedEmployee));
    setAdvanceForm(buildAdvanceForm());
    setSalaryPaymentForm(buildSalaryPaymentForm(selectedEmployee));
    setActivePayrollAction('advance');
    setTransactionHistoryFilter('all');
    previousSelectedEmployeeIdRef.current = selectedEmployeeId;
  }, [selectedEmployeeId, selectedEmployee]);

  const paymentMethodOptions = useMemo(() => {
    const backendMethods = Array.isArray(snapshot?.config?.payment_methods)
      ? snapshot.config.payment_methods
      : defaultSnapshot.config.payment_methods;
    return PAYMENT_METHOD_OPTIONS.filter((option) => backendMethods.includes(option.value) && option.value !== 'bon');
  }, [snapshot]);

  const cashSourceOptions = useMemo(() => {
    const backendSources = Array.isArray(snapshot?.config?.cash_source_accounts)
      ? snapshot.config.cash_source_accounts
      : defaultSnapshot.config.cash_source_accounts;
    return backendSources.map((value) => ({ value, label: ACCOUNT_LABELS[value] || value }));
  }, [snapshot]);

  const payrollPaymentOptions = useMemo(() => {
    return paymentMethodOptions.flatMap((option) => {
      if (option.value !== 'cash') {
        return [option];
      }

      return cashSourceOptions.map((source) => ({
        value: `cash:${source.value}`,
        label: `${option.label} - ${source.label}`,
      }));
    });
  }, [cashSourceOptions, paymentMethodOptions]);

  const selectedEmployeeTransactions = useMemo(() => {
    if (!selectedEmployeeId) return transactions;
    return transactions.filter((transaction) => transaction.user_id === selectedEmployeeId);
  }, [selectedEmployeeId, transactions]);

  const filteredTransactionHistory = useMemo(() => {
    if (transactionHistoryFilter === 'advance') {
      return selectedEmployeeTransactions.filter((transaction) => transaction.transaction_type === 'advance');
    }

    if (transactionHistoryFilter === 'salary_payment') {
      return selectedEmployeeTransactions.filter((transaction) => transaction.transaction_type === 'salary_payment');
    }

    return selectedEmployeeTransactions;
  }, [selectedEmployeeTransactions, transactionHistoryFilter]);

  const transactionHistoryCounts = useMemo(() => ({
    all: selectedEmployeeTransactions.length,
    advance: selectedEmployeeTransactions.filter((transaction) => transaction.transaction_type === 'advance').length,
    salary_payment: selectedEmployeeTransactions.filter((transaction) => transaction.transaction_type === 'salary_payment').length,
  }), [selectedEmployeeTransactions]);

  const monthlySalaryAmount = Number(selectedEmployee?.monthly_salary || 0);
  const salaryCoveredThisMonth = Number(selectedEmployee?.salary_covered_this_month || 0);
  const salaryGrossAmount = Math.max(0, monthlySalaryAmount - salaryCoveredThisMonth);
  const availableAdvance = Number(selectedEmployee?.outstanding_advance_amount || 0);
  const effectiveAdvanceDeduction = Math.min(Math.max(availableAdvance, 0), Math.max(salaryGrossAmount, 0));
  const salaryNetPreview = Math.max(0, salaryGrossAmount - effectiveAdvanceDeduction);
  const advanceSourceAccount = getAutoSourceAccount(advanceForm.payment_method, advanceForm.cash_source_account);
  const salarySourceAccount = getAutoSourceAccount(salaryPaymentForm.payment_method, salaryPaymentForm.cash_source_account);
  const advanceSourceAvailableBalance = Number((snapshot?.treasury_balances || {})[advanceSourceAccount] || 0);
  const salarySourceAvailableBalance = Number((snapshot?.treasury_balances || {})[salarySourceAccount] || 0);

  const employeeColumns = [
    {
      key: 'name',
      header: 'Employé',
      sortAccessor: (employee) => employee.name || '',
      searchAccessor: (employee) => `${employee.name || ''} ${resolveDisplayedJobTitle(employee)}`,
      render: (employee) => (
        <div className="cash-movement-detail">
          <strong>{employee.name}</strong>
          <span>{resolveDisplayedJobTitle(employee)}</span>
        </div>
      ),
    },
    {
      key: 'access',
      header: 'Accès',
      sortAccessor: (employee) => (employee.has_system_access ? '1' : '0'),
      searchAccessor: (employee) => (employee.has_system_access ? 'Accès écran' : 'Sans accès'),
      render: (employee) => (
        <span className={`role-badge ${employee.has_system_access ? 'role-admin' : 'role-employee'}`}>
          {employee.has_system_access ? 'Accès écran' : 'Sans accès'}
        </span>
      ),
    },
    {
      key: 'monthly_salary',
      header: 'Salaire mensuel',
      sortType: 'number',
      sortAccessor: (employee) => Number(employee.monthly_salary || 0),
      searchAccessor: (employee) => String(employee.monthly_salary || ''),
      render: (employee) => formatCurrency(employee.monthly_salary),
    },
    {
      key: 'outstanding_advance_amount',
      header: 'Avances en cours',
      sortType: 'number',
      sortAccessor: (employee) => Number(employee.outstanding_advance_amount || 0),
      searchAccessor: (employee) => String(employee.outstanding_advance_amount || ''),
      render: (employee) => (
        <div className="cash-movement-detail">
          <strong>{formatCurrency(employee.outstanding_advance_amount)}</strong>
          <span>{formatOutstandingAdvanceDateHint(employee)}</span>
        </div>
      ),
    },
    {
      key: 'salary_remaining_this_month',
      header: 'Reste ce mois',
      sortType: 'number',
      sortAccessor: (employee) => Number(employee.salary_remaining_this_month || 0),
      searchAccessor: (employee) => String(employee.salary_remaining_this_month || ''),
      render: (employee) => formatCurrency(employee.salary_remaining_this_month),
    },
    {
      key: 'actions',
      header: 'Action',
      sortable: false,
      searchable: false,
      render: (employee) => (
        <button
          type="button"
          className={`btn btn-sm ${employee.id === selectedEmployeeId ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setSelectedEmployeeId(employee.id)}
        >
          {employee.id === selectedEmployeeId ? 'Sélectionné' : 'Gérer'}
        </button>
      ),
    },
  ];

  const transactionColumns = [
    {
      key: 'paid_at',
      header: 'Date',
      sortType: 'date',
      sortAccessor: (transaction) => transaction.paid_at || transaction.created_at,
      searchAccessor: (transaction) => `${formatDateTime(transaction.paid_at)} ${formatDateTime(transaction.created_at)}`,
      render: (transaction) => formatDateTime(transaction.paid_at || transaction.created_at),
    },
    {
      key: 'employee_name',
      header: 'Employé',
      sortAccessor: (transaction) => transaction.employee_name || '',
      searchAccessor: (transaction) => `${transaction.employee_name || ''} ${resolveDisplayedJobTitle(transaction)}`,
      render: (transaction) => (
        <div className="cash-movement-detail">
          <strong>{transaction.employee_name}</strong>
          <span>{resolveDisplayedJobTitle(transaction)}</span>
        </div>
      ),
    },
    {
      key: 'transaction_type',
      header: 'Type',
      sortAccessor: (transaction) => TRANSACTION_TYPE_LABELS[transaction.transaction_type] || transaction.transaction_type,
      searchAccessor: (transaction) => TRANSACTION_TYPE_LABELS[transaction.transaction_type] || transaction.transaction_type,
      render: (transaction) => TRANSACTION_TYPE_LABELS[transaction.transaction_type] || transaction.transaction_type,
    },
    {
      key: 'amounts',
      header: 'Montants',
      sortType: 'number',
      sortAccessor: (transaction) => Number(transaction.net_amount || 0),
      searchAccessor: (transaction) => `${transaction.gross_amount || ''} ${transaction.advance_deduction_amount || ''} ${transaction.net_amount || ''}`,
      render: (transaction) => (
        <div className="cash-movement-detail">
          <strong>Net: {formatCurrency(transaction.net_amount)}</strong>
          <span>Brut: {formatCurrency(transaction.gross_amount)}</span>
          {Number(transaction.advance_deduction_amount || 0) > 0 ? (
            <span>Avance déduite: {formatCurrency(transaction.advance_deduction_amount)}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'payment',
      header: 'Paiement',
      sortAccessor: (transaction) => `${transaction.payment_method || ''} ${transaction.source_account || ''}`,
      searchAccessor: (transaction) => `${transaction.payment_method || ''} ${transaction.source_account || ''} ${transaction.reference || ''}`,
      render: (transaction) => (
        <div className="cash-movement-detail">
          <strong>{transaction.payment_method ? formatPaymentMethodLabel(transaction.payment_method) : 'Aucun décaissement'}</strong>
          <span>Compte: {transaction.source_account ? (ACCOUNT_LABELS[transaction.source_account] || transaction.source_account) : 'Aucun'}</span>
          <span>
            Mouvement trésorerie: {transaction.cash_movement_id ? `#${transaction.cash_movement_id}` : 'Aucun (net à 0)'}
          </span>
          <span>Référence: {transaction.reference || '-'}</span>
        </div>
      ),
    },
    {
      key: 'payroll_month',
      header: 'Mois paie',
      sortAccessor: (transaction) => transaction.payroll_month || '',
      searchAccessor: (transaction) => transaction.payroll_month || '',
      render: (transaction) => transaction.payroll_month ? formatDate(transaction.payroll_month) : '-',
    },
  ];

  const submitSalaryProfile = async (event) => {
    event.preventDefault();
    if (!selectedEmployee) return;

    setSavingSalaryProfile(true);
    setMessage('');

    try {
      await adminAPI.upsertEmployeeSalaryProfile(selectedEmployee.id, {
        monthly_salary: Number(salaryForm.monthly_salary || 0),
        payment_day: salaryForm.payment_day ? Number(salaryForm.payment_day) : null,
        is_active: Boolean(salaryForm.is_active),
        notes: String(salaryForm.notes || '').trim() || null,
      });

      setMessage(`Profil salarial mis à jour pour ${selectedEmployee.name}.`);
      await loadSnapshot({ silent: true });
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Impossible d’enregistrer le profil salarial.')}`);
    } finally {
      setSavingSalaryProfile(false);
    }
  };

  const submitAdvance = async (event) => {
    event.preventDefault();
    if (!selectedEmployee) return;

    setSavingAdvance(true);
    setMessage('');

    try {
      await adminAPI.createEmployeeAdvance(selectedEmployee.id, {
        amount: Number(advanceForm.amount || 0),
        payment_method: advanceForm.payment_method,
        cash_source_account: normalizePaymentMethod(advanceForm.payment_method) === 'cash' ? advanceForm.cash_source_account : null,
        paid_at: advanceForm.paid_at || null,
        reference: String(advanceForm.reference || '').trim() || null,
        note: String(advanceForm.note || '').trim() || null,
      });

      setMessage(`Avance enregistrée pour ${selectedEmployee.name}.`);
      const refreshedSnapshot = await loadSnapshot({ silent: true });
      const refreshedEmployee = refreshedSnapshot?.employees?.find((employee) => employee.id === selectedEmployee.id) || null;
      setAdvanceForm(buildAdvanceForm());
      if (refreshedEmployee) {
        setSalaryForm(buildSalaryForm(refreshedEmployee));
        setSalaryPaymentForm(buildSalaryPaymentForm(refreshedEmployee));
      }
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Impossible d’enregistrer cette avance.')}`);
    } finally {
      setSavingAdvance(false);
    }
  };

  const submitSalaryPayment = async (event) => {
    event.preventDefault();
    if (!selectedEmployee) return;
    if (salaryGrossAmount <= 0) {
      setMessage(`Erreur: le salaire du mois est déjà entièrement couvert pour ${selectedEmployee.name}.`);
      return;
    }

    setSavingSalaryPayment(true);
    setMessage('');

    try {
      await adminAPI.createEmployeeSalaryPayment(selectedEmployee.id, {
        gross_amount: salaryGrossAmount,
        advance_deduction_amount: effectiveAdvanceDeduction,
        payroll_month: salaryPaymentForm.payroll_month ? `${salaryPaymentForm.payroll_month}-01` : null,
        payment_method: salaryPaymentForm.payment_method,
        cash_source_account: normalizePaymentMethod(salaryPaymentForm.payment_method) === 'cash' ? salaryPaymentForm.cash_source_account : null,
        paid_at: salaryPaymentForm.paid_at || null,
        reference: String(salaryPaymentForm.reference || '').trim() || null,
        note: String(salaryPaymentForm.note || '').trim() || null,
      });

      setMessage(`Paiement salaire enregistré pour ${selectedEmployee.name}.`);
      const refreshedSnapshot = await loadSnapshot({ silent: true });
      const refreshedEmployee = refreshedSnapshot?.employees?.find((employee) => employee.id === selectedEmployee.id) || null;
      if (refreshedEmployee) {
        setSalaryForm(buildSalaryForm(refreshedEmployee));
        setSalaryPaymentForm(buildSalaryPaymentForm(refreshedEmployee));
      }
    } catch (error) {
      setMessage(`Erreur: ${extractErrorMessage(error, 'Impossible d’enregistrer ce paiement salaire.')}`);
    } finally {
      setSavingSalaryPayment(false);
    }
  };

  if (loading) {
    return <div className="loading">Chargement des employés et de la paie...</div>;
  }

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <div>
            <h2>💼 Employés & paie</h2>
            <p className="form-hint" style={{ marginTop: '6px' }}>
              Les avances et salaires passent ici, avec un impact automatique sur la caisse, le coffre, la banque ou le mobile money selon le mode choisi.
            </p>
          </div>
          <button className="btn btn-secondary" type="button" onClick={() => loadSnapshot()}>
            Actualiser
          </button>
        </div>

        {message ? (
          <div className={`message ${message.includes('Erreur') ? 'error-message' : 'success-message'}`}>
            {message}
          </div>
        ) : null}

        <div className="stats-grid">
          <div className="stat-card">
            <h3>Employés suivis</h3>
            <div className="stat-number">{employees.length}</div>
            <p>Tous les profils hors admin</p>
          </div>
          <div className="stat-card">
            <h3>Sans accès écran</h3>
            <div className="stat-number">{employees.filter((employee) => !employee.has_system_access).length}</div>
            <p>Personnel simple géré sans connexion</p>
          </div>
          <div className="stat-card">
            <h3>Avances en cours</h3>
            <div className="stat-number">
              {formatCurrency(
                employees.reduce((total, employee) => total + Number(employee.outstanding_advance_amount || 0), 0)
              )}
            </div>
            <p>Somme restant à déduire des prochains salaires</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: '10px' }}>Liste du personnel</h3>
        <DataTable
          columns={employeeColumns}
          data={employees}
          rowKey="id"
          searchPlaceholder="Rechercher un employé (nom, poste, accès)..."
          initialSort={{ key: 'name', direction: 'asc' }}
          emptyMessage="Aucun employé disponible."
        />
      </div>

      {selectedEmployee ? (
        <>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
              <div>
                <h3>{selectedEmployee.name}</h3>
                <p className="form-hint" style={{ marginTop: '6px' }}>
                  {resolveDisplayedJobTitle(selectedEmployee)} · {selectedEmployee.has_system_access ? 'Avec accès écran' : 'Employé simple'} · Statut {selectedEmployee.employment_status === 'inactive' ? 'inactif' : 'actif'}
                </p>
              </div>
              <div className="actions">
                <span className={`role-badge ${selectedEmployee.has_system_access ? 'role-admin' : 'role-employee'}`}>
                  {selectedEmployee.has_system_access ? 'Accès écran' : 'Sans accès'}
                </span>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-card">
                <h3>Salaire mensuel</h3>
                <div className="stat-number">{formatCurrency(selectedEmployee.monthly_salary)}</div>
                <p>Base actuelle du profil salarial</p>
              </div>
              <div className="stat-card">
                <h3>Avances ouvertes</h3>
                <div className="stat-number">{formatCurrency(selectedEmployee.outstanding_advance_amount)}</div>
                <p>{formatOutstandingAdvanceDateHint(selectedEmployee)}</p>
              </div>
              <div className="stat-card">
                <h3>Reste à payer ce mois</h3>
                <div className="stat-number">{formatCurrency(selectedEmployee.salary_remaining_this_month)}</div>
                <p>Avances ouvertes et salaire déjà couvert déduits automatiquement</p>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: '10px' }}>Profil salarial</h3>
            <form onSubmit={submitSalaryProfile}>
              <div className="form-row">
                <div className="form-group">
                  <label>Salaire mensuel (Ar)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={salaryForm.monthly_salary}
                    onChange={(event) => setSalaryForm((prev) => ({ ...prev, monthly_salary: event.target.value }))}
                    required
                  />
                </div>

                <div className="form-group">
                  <label>Jour de paiement</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={salaryForm.payment_day}
                    onChange={(event) => setSalaryForm((prev) => ({ ...prev, payment_day: event.target.value }))}
                    placeholder="Ex: 30"
                  />
                </div>

                <div className="form-group">
                  <label>Profil actif</label>
                  <select
                    value={salaryForm.is_active ? '1' : '0'}
                    onChange={(event) => setSalaryForm((prev) => ({ ...prev, is_active: event.target.value === '1' }))}
                  >
                    <option value="1">Oui</option>
                    <option value="0">Non</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Notes paie</label>
                <textarea
                  rows="2"
                  value={salaryForm.notes}
                  onChange={(event) => setSalaryForm((prev) => ({ ...prev, notes: event.target.value }))}
                  placeholder="Ex: Paiement le dernier jour du mois"
                />
              </div>

              <div className="form-actions">
                <button className="btn btn-primary" type="submit" disabled={savingSalaryProfile}>
                  {savingSalaryProfile ? 'Enregistrement...' : 'Enregistrer le profil salarial'}
                </button>
              </div>
            </form>
          </div>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
              <div>
                <h3 style={{ marginBottom: '6px' }}>Action paie</h3>
                <p className="form-hint">
                  Choisis d&apos;abord si tu veux enregistrer une avance ou payer le salaire. Une seule interface d&apos;action s&apos;affiche à la fois.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`btn btn-sm ${activePayrollAction === 'advance' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setActivePayrollAction('advance')}
                >
                  Faire une avance
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${activePayrollAction === 'salary_payment' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setActivePayrollAction('salary_payment')}
                >
                  Payer le salaire
                </button>
              </div>
            </div>
            <div className="form-hint">
              {activePayrollAction === 'advance'
                ? 'Mode avance: on ajoute une nouvelle avance qui s’additionne aux précédentes.'
                : 'Mode salaire: le brut restant du mois et la déduction des avances ouvertes sont calculés automatiquement et non modifiables.'}
            </div>
          </div>

          {activePayrollAction === 'advance' ? (
            <div className="card">
              <h3 style={{ marginBottom: '10px' }}>Avance sur salaire</h3>
              <p className="form-hint" style={{ marginBottom: '12px' }}>
                Chaque nouvelle avance s&apos;ajoute aux précédentes, crée immédiatement un mouvement de trésorerie et sera déduite automatiquement des prochains paiements salaire.
              </p>
              <form onSubmit={submitAdvance}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Montant (Ar)</label>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={advanceForm.amount}
                      onChange={(event) => setAdvanceForm((prev) => ({ ...prev, amount: event.target.value }))}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>Mode de paiement</label>
                    <select
                      value={getPaymentSelectionValue(advanceForm.payment_method, advanceForm.cash_source_account)}
                      onChange={(event) => setAdvanceForm((prev) => ({
                        ...prev,
                        ...resolvePaymentSelection(event.target.value),
                      }))}
                      required
                    >
                      {payrollPaymentOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <div className="form-hint">
                      Solde disponible: {formatCurrency(advanceSourceAvailableBalance)}
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Compte débité</label>
                    <input type="text" value={ACCOUNT_LABELS[advanceSourceAccount] || '-'} readOnly />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Date de paiement</label>
                    <input
                      type="date"
                      value={advanceForm.paid_at}
                      onChange={(event) => setAdvanceForm((prev) => ({ ...prev, paid_at: event.target.value }))}
                    />
                  </div>

                  <div className="form-group">
                    <label>Référence</label>
                    <input
                      type="text"
                      value={advanceForm.reference}
                      onChange={(event) => setAdvanceForm((prev) => ({ ...prev, reference: event.target.value }))}
                      placeholder="Ex: CHQ-002 ou REF-MM"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Note</label>
                  <textarea
                    rows="2"
                    value={advanceForm.note}
                    onChange={(event) => setAdvanceForm((prev) => ({ ...prev, note: event.target.value }))}
                    placeholder="Ex: Avance exceptionnelle semaine 2"
                  />
                </div>

                <div className="form-actions">
                  <button className="btn btn-primary" type="submit" disabled={savingAdvance}>
                    {savingAdvance ? 'Enregistrement...' : 'Enregistrer l’avance'}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="card">
              <h3 style={{ marginBottom: '10px' }}>Paiement salaire</h3>
              <p className="form-hint" style={{ marginBottom: '12px' }}>
                Le brut restant du mois est affiché automatiquement. Les avances ouvertes sont déduites automatiquement pour obtenir le reste net à payer.
              </p>
              <form onSubmit={submitSalaryPayment}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Salaire brut restant du mois (Ar)</label>
                    <input
                      type="text"
                      value={formatCurrency(salaryGrossAmount)}
                      readOnly
                    />
                    <div className="form-hint">
                      Salaire mensuel: {formatCurrency(monthlySalaryAmount)} · Déjà couvert ce mois: {formatCurrency(salaryCoveredThisMonth)}.
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Avance déduite automatiquement (Ar)</label>
                    <input
                      type="text"
                      value={formatCurrency(effectiveAdvanceDeduction)}
                      readOnly
                    />
                    <div className="form-hint">
                      Avances ouvertes: {formatCurrency(availableAdvance)}.
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Mois concerné</label>
                    <input
                      type="month"
                      value={salaryPaymentForm.payroll_month}
                      onChange={(event) => setSalaryPaymentForm((prev) => ({ ...prev, payroll_month: event.target.value }))}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Mode de paiement</label>
                    <select
                      value={getPaymentSelectionValue(salaryPaymentForm.payment_method, salaryPaymentForm.cash_source_account)}
                      onChange={(event) => setSalaryPaymentForm((prev) => ({
                        ...prev,
                        ...resolvePaymentSelection(event.target.value),
                      }))}
                      required
                    >
                      {payrollPaymentOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <div className="form-hint">
                      Solde disponible: {formatCurrency(salarySourceAvailableBalance)}
                    </div>
                  </div>

                  <div className="form-group">
                    <label>Compte débité</label>
                    <input type="text" value={ACCOUNT_LABELS[salarySourceAccount] || '-'} readOnly />
                  </div>

                  <div className="form-group">
                    <label>Date de paiement</label>
                    <input
                      type="date"
                      value={salaryPaymentForm.paid_at}
                      onChange={(event) => setSalaryPaymentForm((prev) => ({ ...prev, paid_at: event.target.value }))}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Référence</label>
                    <input
                      type="text"
                      value={salaryPaymentForm.reference}
                      onChange={(event) => setSalaryPaymentForm((prev) => ({ ...prev, reference: event.target.value }))}
                      placeholder="Ex: VIRT-SAL-AVRIL"
                    />
                  </div>

                  <div className="form-group">
                    <label>Reste à payer (net)</label>
                    <input type="text" value={formatCurrency(salaryNetPreview)} readOnly />
                    <div className="form-hint">
                      {salaryNetPreview > 0
                        ? `Le compte ${ACCOUNT_LABELS[salarySourceAccount] || '-'} sera débité de ${formatCurrency(salaryNetPreview)}.`
                        : 'Aucun décaissement si le net est à 0, seules les avances sont soldées.'}
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label>Note</label>
                  <textarea
                    rows="2"
                    value={salaryPaymentForm.note}
                    onChange={(event) => setSalaryPaymentForm((prev) => ({ ...prev, note: event.target.value }))}
                    placeholder="Ex: Salaire avril 2026"
                  />
                </div>

                <div className="form-actions">
                  <button className="btn btn-primary" type="submit" disabled={savingSalaryPayment || salaryGrossAmount <= 0}>
                    {savingSalaryPayment ? 'Enregistrement...' : 'Enregistrer le paiement salaire'}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
              <div>
                <h3 style={{ marginBottom: '6px' }}>Historique</h3>
                <p className="form-hint">
                  Un seul historique regroupe maintenant les avances et les paiements salaire, classés par date.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`btn btn-sm ${transactionHistoryFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setTransactionHistoryFilter('all')}
                >
                  Tout ({transactionHistoryCounts.all})
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${transactionHistoryFilter === 'advance' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setTransactionHistoryFilter('advance')}
                >
                  Avances ({transactionHistoryCounts.advance})
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${transactionHistoryFilter === 'salary_payment' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setTransactionHistoryFilter('salary_payment')}
                >
                  Salaires ({transactionHistoryCounts.salary_payment})
                </button>
              </div>
            </div>
            <p className="form-hint" style={{ marginBottom: '10px' }}>
              Historique des avances et paiements pour {selectedEmployee.name}. Chaque ligne correspond à une transaction liée à la trésorerie.
            </p>
            <DataTable
              columns={transactionColumns}
              data={filteredTransactionHistory}
              rowKey="id"
              searchPlaceholder="Rechercher une avance ou un paiement salaire..."
              initialSort={{ key: 'paid_at', direction: 'desc' }}
              emptyMessage={
                transactionHistoryFilter === 'advance'
                  ? 'Aucune avance enregistrée pour cet employé.'
                  : transactionHistoryFilter === 'salary_payment'
                    ? 'Aucun paiement salaire enregistré pour cet employé.'
                    : 'Aucune transaction de paie pour cet employé.'
              }
            />
          </div>
        </>
      ) : (
        <div className="card">
          <div className="alert-empty">Aucun employé à gérer pour la paie.</div>
        </div>
      )}
    </div>
  );
};

export default EmployeePayrollManagement;
