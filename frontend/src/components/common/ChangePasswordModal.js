import React, { useEffect, useState } from 'react';
import { authAPI } from '../../services/api';
import './ChangePasswordModal.css';

const INITIAL_FORM = {
  current_password: '',
  new_password: '',
  new_password_confirmation: '',
};

const ChangePasswordModal = ({ isOpen, onClose }) => {
  const [form, setForm] = useState(INITIAL_FORM);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setForm(INITIAL_FORM);
    setLoading(false);
    setMessage('');
    setMessageType('');
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleClose = () => {
    if (loading) {
      return;
    }

    onClose();
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    setMessageType('');

    try {
      await authAPI.changePassword(form);
      setMessage('Mot de passe modifié avec succès.');
      setMessageType('success');
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (error) {
      const data = error.response?.data || {};
      const validationErrors = data.errors || {};
      const firstValidationMessage = Object.values(validationErrors)?.[0]?.[0];

      setMessage(data.message || firstValidationMessage || 'Erreur lors du changement du mot de passe.');
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cp-modal-overlay" onClick={handleClose}>
      <div className="cp-modal" onClick={(event) => event.stopPropagation()}>
        <div className="cp-modal-header">
          <h3>Changer mon mot de passe</h3>
          <button type="button" className="cp-close-btn" onClick={handleClose} aria-label="Fermer">
            ×
          </button>
        </div>

        {message && (
          <div className={`cp-message ${messageType === 'success' ? 'cp-message-success' : 'cp-message-error'}`}>
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="cp-form">
          <label className="cp-field">
            <span>Mot de passe actuel</span>
            <input
              type="password"
              value={form.current_password}
              onChange={(event) => setForm((prev) => ({ ...prev, current_password: event.target.value }))}
              required
            />
          </label>

          <label className="cp-field">
            <span>Nouveau mot de passe</span>
            <input
              type="password"
              value={form.new_password}
              onChange={(event) => setForm((prev) => ({ ...prev, new_password: event.target.value }))}
              required
            />
          </label>

          <label className="cp-field">
            <span>Confirmer le nouveau mot de passe</span>
            <input
              type="password"
              value={form.new_password_confirmation}
              onChange={(event) => setForm((prev) => ({ ...prev, new_password_confirmation: event.target.value }))}
              required
            />
          </label>

          <p className="cp-hint">Minimum 6 caractères avec au moins une majuscule, une minuscule et un chiffre.</p>

          <div className="cp-actions">
            <button type="button" className="cp-btn cp-btn-secondary" onClick={handleClose} disabled={loading}>
              Annuler
            </button>
            <button type="submit" className="cp-btn cp-btn-primary" disabled={loading}>
              {loading ? 'Mise à jour...' : 'Modifier'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ChangePasswordModal;
