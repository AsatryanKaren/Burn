// Shared domain types. Type-only module (no runtime code).

export type Lang = "hy" | "en" | "ru";

export type ProductCode = "burn" | "burn_wish" | "gift" | "midnight";

export type ProviderName = "disabled" | "mock" | "ameria" | "idram";

/** Providers that can actually take money (stored in orders.provider). */
export type PaymentProvider = Exclude<ProviderName, "disabled">;

export type OrderStatus =
  | "awaiting_launch"
  | "pending"
  | "paid"
  | "failed"
  | "cancelled"
  | "refunded";

export type ModerationStatus = "pending" | "approved" | "hidden" | "rejected";

/** `payment` object returned by create-order. */
export type PaymentInstruction =
  | { mode: "disabled" }
  | { mode: "mock"; url: string }
  | { mode: "redirect"; url: string }
  | { mode: "form"; action: string; method: "POST"; fields: Record<string, string> };

/** Result type used by pure validators. */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };
