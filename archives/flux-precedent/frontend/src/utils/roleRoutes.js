export const ROLE_HOME_PATHS = {
  admin: '/admin',
  server: '/server',
  kitchen: '/kitchen',
  barman: '/bar',
  cashier: '/cashier',
};

export const getHomePathForRole = (role) => {
  return ROLE_HOME_PATHS[role] || '/login';
};
