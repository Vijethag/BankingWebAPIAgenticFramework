/**
 * Formats a numeric amount the way ParaBank's Transfer Funds confirmation
 * page does: always 2 decimal places, no thousands separators, and for
 * negative values the sign precedes the dollar sign
 * (e.g. -50 -> "-$50.00", not "$-50.00").
 *
 * Verified live against the self-hosted parasoft/parabank instance with
 * amounts 5, 999999, 0, and -50.
 */
export function formatParaBankAmount(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}
