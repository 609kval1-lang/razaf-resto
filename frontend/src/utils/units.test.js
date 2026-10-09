import { calculatePortionCapacity, convertUnitValue } from './units';

test('exact portion counts do not lose one portion to floating point rounding', () => {
  expect(calculatePortionCapacity(0.29, 0.01)).toBe(29);
  expect(calculatePortionCapacity(0.29, 0.0100001)).toBe(28);
  expect(calculatePortionCapacity(0, 1)).toBe(0);
  expect(calculatePortionCapacity(1, 0)).toBe(0);
});

test('unit conversions preserve mass and volume quantities', () => {
  expect(convertUnitValue(0.001, 'kg', 'g')).toBe(1);
  expect(convertUnitValue(1.5, 'L', 'ml')).toBe(1500);
  expect(convertUnitValue(0.01, 'g', 'kg')).toBeCloseTo(0.00001, 8);
  expect(() => convertUnitValue(1, 'kg', 'ml')).toThrow();
});
