import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import './DialogProvider.css';

const DialogContext = createContext({
  confirm: async () => false,
  alert: async () => undefined,
});

const DEFAULT_CONFIRM = {
  type: 'confirm',
  title: 'Confirmation',
  message: '',
  confirmText: 'Confirmer',
  cancelText: 'Annuler',
  tone: 'primary',
};

const DEFAULT_ALERT = {
  type: 'alert',
  title: 'Information',
  message: '',
  confirmText: 'OK',
  tone: 'primary',
};

const normalizeDialogConfig = (config, defaults) => {
  if (typeof config === 'string') {
    return {
      ...defaults,
      message: config,
    };
  }

  return {
    ...defaults,
    ...(config || {}),
  };
};

export const DialogProvider = ({ children }) => {
  const [dialog, setDialog] = useState(null);

  const closeDialog = useCallback((result) => {
    setDialog((previous) => {
      if (!previous) {
        return previous;
      }

      if (typeof previous.resolve === 'function') {
        previous.resolve(result);
      }

      return null;
    });
  }, []);

  const openDialog = useCallback((config) => {
    return new Promise((resolve) => {
      setDialog((previous) => {
        if (previous && typeof previous.resolve === 'function') {
          previous.resolve(false);
        }

        return {
          ...config,
          resolve,
        };
      });
    });
  }, []);

  const confirm = useCallback((config) => {
    return openDialog(normalizeDialogConfig(config, DEFAULT_CONFIRM));
  }, [openDialog]);

  const alert = useCallback(async (config) => {
    await openDialog(normalizeDialogConfig(config, DEFAULT_ALERT));
  }, [openDialog]);

  useEffect(() => {
    if (!dialog) {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog(dialog.type === 'confirm' ? false : true);
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        closeDialog(true);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeDialog, dialog]);

  const contextValue = useMemo(() => ({
    confirm,
    alert,
  }), [alert, confirm]);

  const handleBackdropClick = () => {
    closeDialog(dialog?.type === 'confirm' ? false : true);
  };

  const dialogNode = dialog ? (
    <div className="app-dialog-overlay" onClick={handleBackdropClick}>
      <div
        className={`app-dialog app-dialog-${dialog.tone || 'primary'}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={dialog.title || 'Dialogue'}
      >
        <div className="app-dialog-header">
          <h3>{dialog.title}</h3>
          <button
            type="button"
            className="app-dialog-close"
            onClick={() => closeDialog(dialog.type === 'confirm' ? false : true)}
            aria-label="Fermer"
          >
            ×
          </button>
        </div>

        <div className="app-dialog-body">
          <p>{dialog.message}</p>
        </div>

        <div className="app-dialog-actions">
          {dialog.type === 'confirm' ? (
            <button
              type="button"
              className="app-dialog-btn secondary"
              onClick={() => closeDialog(false)}
            >
              {dialog.cancelText || 'Annuler'}
            </button>
          ) : null}

          <button
            type="button"
            className={`app-dialog-btn ${dialog.tone === 'danger' ? 'danger' : 'primary'}`}
            onClick={() => closeDialog(true)}
            autoFocus
          >
            {dialog.confirmText || 'OK'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <DialogContext.Provider value={contextValue}>
      {children}
      {typeof document !== 'undefined' ? createPortal(dialogNode, document.body) : null}
    </DialogContext.Provider>
  );
};

export const useDialog = () => useContext(DialogContext);
