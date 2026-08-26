/**
 * Money arithmetic for order totals.
 *
 * Prices are decimal strings ("3.00") because that is what AFS expects on the
 * wire and what the catalogue stores. Arithmetic happens in integer minor units
 * (fils, cents) and never in floating point: `0.1 + 0.2` is 0.30000000000000004,
 * and an order total that is one ten-thousandth off is a payment AFS rejects for
 * an amount mismatch.
 *
 * Two decimal places is assumed, which holds for AED and for every currency
 * this POC can be configured with today. A currency with a different exponent
 * (JPY, KWD) would need the exponent threaded through here.
 */

const DECIMALS = 2;
const SCALE = 10 ** DECIMALS;

/** Matches a plain decimal amount with at most two decimal places. */
const AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** "3.05" -> 305. Throws rather than guessing at anything malformed. */
export function toMinorUnits(amount: string): number {
  const trimmed = amount.trim();
  if (!AMOUNT_PATTERN.test(trimmed)) {
    throw new MoneyError(`Amount is not a plain decimal with at most ${DECIMALS} places`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const padded = fraction.padEnd(DECIMALS, "0");
  return Number.parseInt(whole, 10) * SCALE + Number.parseInt(padded, 10);
}

/** 305 -> "3.05". Always emits both decimal places, as AFS expects. */
export function fromMinorUnits(minor: number): string {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new MoneyError("Minor units must be a non-negative integer");
  }
  const whole = Math.trunc(minor / SCALE);
  const fraction = minor % SCALE;
  return `${whole}.${String(fraction).padStart(DECIMALS, "0")}`;
}

/** Line total for `quantity` units at `unitPrice`. */
export function multiplyPrice(unitPrice: string, quantity: number): string {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new MoneyError("Quantity must be a positive integer");
  }
  return fromMinorUnits(toMinorUnits(unitPrice) * quantity);
}

/** Order total from its line totals. An empty list is not a zero-price order. */
export function sumPrices(prices: string[]): string {
  if (prices.length === 0) {
    throw new MoneyError("Cannot total an order with no lines");
  }
  return fromMinorUnits(prices.reduce((sum, price) => sum + toMinorUnits(price), 0));
}
