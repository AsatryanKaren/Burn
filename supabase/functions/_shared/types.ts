// Shared domain types. Type-only module (no runtime code).

export type Lang = "hy" | "en" | "ru";

/** Papers burn in the fire. */
export type PaperProductCode = "burn" | "burn_wish" | "gift" | "midnight";

/** Lights on a map plot ("Light up Armenia"). */
export type LightProductCode = "light" | "light_big";

export type ProductCode = PaperProductCode | LightProductCode;

export type LightIcon = "tree" | "home" | "candle" | "star" | "gift" | "pomegranate";

export type LightColor = "amber" | "red" | "green" | "white" | "blue" | "violet";

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
  | { ok: false; code: string; message: string; field?: string };

export interface AmeriaCredentials {
  clientId: string;
  username: string;
  password: string;
  apiBase: string;
}

export interface IdramConfig {
  accountId: string;
  secretKey: string;
  actionUrl: string;
}
