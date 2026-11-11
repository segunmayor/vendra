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

/** Converts a naira amount typed by a person, such as "15,000.50", into exact kobo. Returns null if it is not a valid amount. */
export function nairaToKobo(input: string): string | null {
  const cleaned = input.trim().replace(/^₦/, '').replace(/,(?=\d{3}(?:\D|$))/g, '');
  const match = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  return `${match[1]}${(match[2] ?? '').padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
}
