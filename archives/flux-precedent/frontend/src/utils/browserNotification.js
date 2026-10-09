export const isBrowserNotificationSupported = () => {
  return typeof window !== 'undefined' && 'Notification' in window;
};

export const getBrowserNotificationPermission = () => {
  if (!isBrowserNotificationSupported()) {
    return 'unsupported';
  }

  return Notification.permission;
};

export const requestBrowserNotificationPermission = async () => {
  if (!isBrowserNotificationSupported()) {
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  try {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  } catch (_error) {
    return false;
  }
};

export const getLocalBrowserNotificationEnabled = (storageKey) => {
  if (!isBrowserNotificationSupported() || typeof window === 'undefined') {
    return false;
  }

  const stored = window.localStorage.getItem(String(storageKey || ''));
  if (stored !== null) {
    return stored === '1' && Notification.permission === 'granted';
  }

  return Notification.permission === 'granted';
};

export const persistLocalBrowserNotificationEnabled = (storageKey, enabled) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(String(storageKey || ''), enabled ? '1' : '0');
};

export const getBrowserNotificationToggleLabel = (enabled) => {
  return `Notif navigateur: ${enabled ? 'ON' : 'OFF'}`;
};

export const showBrowserNotification = async ({ enabled, title, body, tag }) => {
  if (!enabled || !isBrowserNotificationSupported() || Notification.permission !== 'granted') {
    return false;
  }

  try {
    new Notification(title, { body, tag });
    return true;
  } catch (_error) {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration || typeof registration.showNotification !== 'function') {
        return false;
      }

      await registration.showNotification(title, { body, tag });
      return true;
    } catch (_serviceWorkerError) {
      return false;
    }
  }
};
