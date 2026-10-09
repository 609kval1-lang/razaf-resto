import { isWholeAriary, purchaseTotalAriary, roundAriary } from './ariary';

test('rounds calculated totals to whole Ariary with half values away from zero', () => {
  expect(roundAriary(14.499999999999998)).toBe(15);
  expect(roundAriary(14.49)).toBe(14);
  expect(roundAriary(-14.5)).toBe(-15);
  expect(purchaseTotalAriary(0.145, 100)).toBe(15);
  expect(purchaseTotalAriary(0.003, 500)).toBe(2);
  expect(purchaseTotalAriary(0.001, 5000)).toBe(5);
});

test('accepts integer amounts without silently changing fractional payments', () => {
  expect(isWholeAriary('1251')).toBe(true);
  expect(isWholeAriary('1251.00')).toBe(true);
  expect(isWholeAriary(0)).toBe(true);
  for (const amount of ['', null, undefined, '12,5', '12.5', NaN, Infinity]) {
    expect(isWholeAriary(amount)).toBe(false);
  }
});
