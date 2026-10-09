import { useEffect } from 'react';

export const notifyCashierChanged = (kind = 'order') => window.dispatchEvent(new CustomEvent('cashier:changed', { detail: { kind } }));

export default function useCashierRefresh(load) {
  useEffect(() => {
    load();
    const refresh = () => {
      if (document.visibilityState !== 'hidden') load({ silent: true });
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('cashier:changed', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('cashier:changed', refresh);
    };
  }, [load]);
}
