export const PAYMENT_METHOD_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'transfer', label: 'Virement' },
  { value: 'check', label: 'Cheque' },
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'bon', label: 'Bon client' },
];

const LEGACY_ALIASES = {
  card: 'mobile_money',
  voucher: 'bon',
};

export const normalizePaymentMethod = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return LEGACY_ALIASES[raw] || raw;
};

export const formatPaymentMethodLabel = (value) => {
  const normalized = normalizePaymentMethod(value);
  const option = PAYMENT_METHOD_OPTIONS.find((entry) => entry.value === normalized);
  return option?.label || (value || '-');
};
