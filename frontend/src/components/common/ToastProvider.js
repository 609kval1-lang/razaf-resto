import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './ToastProvider.css';

const ToastContext = createContext({
  showToast: () => '',
  success: () => '',
  error: () => '',
  info: () => '',
});

const normalizeToastInput = (input) => {
  if (typeof input === 'string') {
    return {
      type: 'info',
      message: input,
      duration: 4200,
    };
  }

  return {
    type: input?.type || 'info',
    message: String(input?.message || ''),
    duration: Number.isFinite(Number(input?.duration)) ? Number(input.duration) : 4200,
  };
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timeoutId) => clearTimeout(timeoutId));
      timers.clear();
    };
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));

    const timeoutId = timersRef.current.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      timersRef.current.delete(id);
    }
  }, []);

  const showToast = useCallback((input) => {
    const normalized = normalizeToastInput(input);
    const message = String(normalized.message || '').trim();
    if (!message) return '';

    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const toast = {
      id,
      type: normalized.type,
      message,
      duration: Math.max(0, normalized.duration),
    };

    setToasts((previous) => [...previous.slice(-4), toast]);

    if (toast.duration > 0) {
      const timeoutId = setTimeout(() => removeToast(id), toast.duration);
      timersRef.current.set(id, timeoutId);
    }

    return id;
  }, [removeToast]);

  const success = useCallback((message, duration) => showToast({ type: 'success', message, duration }), [showToast]);
  const error = useCallback((message, duration) => showToast({ type: 'error', message, duration }), [showToast]);
  const info = useCallback((message, duration) => showToast({ type: 'info', message, duration }), [showToast]);

  const contextValue = useMemo(() => ({
    showToast,
    success,
    error,
    info,
  }), [error, info, showToast, success]);

  const toastNode = toasts.length > 0 ? (
    <div className="app-toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className={`app-toast app-toast-${toast.type || 'info'}`} role="status">
          <div className="app-toast-message">{toast.message}</div>
          <button
            type="button"
            className="app-toast-close"
            onClick={() => removeToast(toast.id)}
            aria-label="Fermer la notification"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {typeof document !== 'undefined' ? createPortal(toastNode, document.body) : null}
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);
