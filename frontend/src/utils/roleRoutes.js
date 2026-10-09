export const ROLE_HOME_PATHS = {
  admin: '/admin',
  cashier: '/cashier',
};

export const getHomePathForRole = (role) => {
  return ROLE_HOME_PATHS[role] || '/login';
};
