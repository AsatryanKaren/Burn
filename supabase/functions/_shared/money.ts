// Money rules. Pure module.
//
// 20% of every paid amount goes to the gift fund, rounded down to whole AMD.
// The database (confirm_payment) computes the same value for gift_ledger;
// this helper is used for display (order-status) and tests.

export const GIFT_SHARE_PERCENT = 20;

export function giftShareAmd(amountAmd: number): number {
  if (!Number.isSafeInteger(amountAmd) || amountAmd < 0) {
    throw new RangeError(`amount must be a non-negative integer AMD, got ${amountAmd}`);
  }
  return Math.floor((amountAmd * GIFT_SHARE_PERCENT) / 100);
}

/**
 * Parses a provider amount ("500", "500.00", 500, 500.0) into whole AMD.
 * Returns null for anything that is not an exact non-negative integer amount.
 */
export function parseWholeAmd(value: unknown): number | null {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string" && /^\s*\d{1,12}(?:\.0{1,4})?\s*$/.test(value)) {
    n = Number(value.trim());
  } else {
    return null;
  }
  if (!Number.isFinite(n) || !Number.isSafeInteger(n) || n < 0) return null;
  return n;
}
