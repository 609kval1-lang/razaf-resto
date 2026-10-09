import { calculateCashTender } from './cashTender';

test('calculates change without changing the amount owed', () => {
  expect(calculateCashTender(2502, '5000')).toEqual({ change: 2498, error: '' });
  expect(calculateCashTender(2502, '2502')).toEqual({ change: 0, error: '' });
  expect(calculateCashTender(2502, '')).toEqual({ change: null, error: '' });
});

test.each(['2501', '-1', '5000.5', 'NaN', '9007199254740992'])('rejects insufficient or invalid tender %s', (received) => {
  expect(calculateCashTender(2502, received).change).toBeNull();
  expect(calculateCashTender(2502, received).error).not.toBe('');
});
