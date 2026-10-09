export const roundAriary = (value) => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  const absolute = Math.abs(amount);
  return Math.sign(amount) * Math.round(absolute + Number.EPSILON * Math.max(1, absolute) * 2);
};

export const isWholeAriary = (value) => value !== '' && value !== null && value !== undefined
  && Number.isSafeInteger(Number(value));

export const purchaseTotalAriary = (quantity, unitPrice) => roundAriary(Number(quantity || 0) * Number(unitPrice || 0));
