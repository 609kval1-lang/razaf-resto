import { isWholeAriary } from './ariary';

export const calculateCashTender = (due, received) => {
  if (received === '' || received == null) return { change: null, error: '' };
  if (!isWholeAriary(received) || Number(received) < 0) {
    return { change: null, error: 'Saisissez un montant remis entier en Ariary.' };
  }
  if (!Number.isSafeInteger(Number(due)) || Number(due) < 0) {
    return { change: null, error: 'Le montant a payer doit etre actualise.' };
  }
  if (Number(received) < Number(due)) {
    return { change: null, error: 'Le montant remis est inferieur au montant a payer.' };
  }
  return { change: Number(received) - Number(due), error: '' };
};
