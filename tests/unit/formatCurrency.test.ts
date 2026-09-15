import { formatParaBankAmount } from '../../src/utils/formatCurrency';

describe('formatParaBankAmount', () => {
  it('formats positive amounts with two decimals', () => {
    expect(formatParaBankAmount(5)).toBe('$5.00');
  });

  it('formats large amounts without thousands separators', () => {
    expect(formatParaBankAmount(999999)).toBe('$999999.00');
  });

  it('formats zero', () => {
    expect(formatParaBankAmount(0)).toBe('$0.00');
  });

  it('puts the negative sign before the dollar sign', () => {
    expect(formatParaBankAmount(-50)).toBe('-$50.00');
  });

  it('pads a whole-dollar amount to two decimal places', () => {
    expect(formatParaBankAmount(1.5)).toBe('$1.50');
  });
});
