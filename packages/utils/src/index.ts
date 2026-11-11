const SYMBOLS: Record<string, string> = { NGN: '₦' };

/** Formats an API money value exactly. `amountMinor` is an integer string, in kobo for NGN. */
export function formatMoney(amountMinor: string, currency: string): string {
  if (!/^-?\d+$/.test(amountMinor)) throw new Error(`Invalid minor amount: ${amountMinor}`);
  const negative = amountMinor.startsWith('-');
  const digits = (negative ? amountMinor.slice(1) : amountMinor).padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+$)/g, ',');
  const symbol = SYMBOLS[currency] ?? `${currency} `;
  return `${negative ? '-' : ''}${symbol}${whole}.${digits.slice(-2)}`;
}
