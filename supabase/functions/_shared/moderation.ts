// Automatic pre-moderation. Pure module.
//
//   reject  — strong profanity / slurs (BLOCKLIST)          -> 400 TEXT_REJECTED
//   hidden  — contact data or personal names that should
//             never be shown publicly (order still allowed)  -> moderation = 'hidden'
//   pending — everything else; a human approves before the text can appear
//             publicly (moderation = 'approved').
//
// Lists live in moderation-data.ts.

import type { ModerationStatus } from "./types.ts";
import { BLOCKLIST, COMMON_NAMES, NAME_SUFFIXES, URL_TLDS } from "./moderation-data.ts";

export type ModerationDecision = Extract<ModerationStatus, "pending" | "hidden" | "rejected">;

export interface ModerationResult {
  decision: ModerationDecision;
  /** Short machine reason, stored in orders.moderation_reason for hidden. */
  reason: string | null;
}

export interface ModerationFields {
  text: string;
  wish_text?: string | null;
  recipient_name?: string | null;
}

// ---------------------------------------------------------------------------
// Token folding
// ---------------------------------------------------------------------------

const LATIN_RE = /\p{Script=Latin}/u;
const CYRILLIC_RE = /\p{Script=Cyrillic}/u;
const ARMENIAN_RE = /\p{Script=Armenian}/u;

// Look-alikes, applied before lower-casing so that "B" can become "В".
const LATIN_TO_CYRILLIC: Record<string, string> = {
  A: "А", B: "В", C: "С", E: "Е", H: "Н", K: "К", M: "М", O: "О", P: "Р", T: "Т", X: "Х", Y: "У",
  a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", y: "у", k: "к",
};
const CYRILLIC_TO_LATIN: Record<string, string> = Object.fromEntries(
  Object.entries(LATIN_TO_CYRILLIC).map(([l, c]) => [c, l]),
);

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };

function countMatches(s: string, re: RegExp): number {
  let n = 0;
  for (const ch of s) if (re.test(ch)) n++;
  return n;
}

/** Folds one token for matching. Exported for tests. */
export function foldToken(raw: string): string {
  let t = raw.normalize("NFKC");

  // Leet substitutions only inside tokens that are mostly letters ("f4ck", "$uka").
  if (countMatches(t, /\p{L}/u) >= 2) {
    t = t.replace(/[013457@$]/g, (ch) => LEET[ch] ?? ch);
  }

  // Keep letters only ("f.u.c.k" -> "fuck").
  t = t.replace(/[^\p{L}]/gu, "");

  // Mixed Latin/Cyrillic: map the minority script's look-alikes to the majority.
  const lat = countMatches(t, LATIN_RE);
  const cyr = countMatches(t, CYRILLIC_RE);
  if (lat > 0 && cyr > 0) {
    const map = cyr >= lat ? LATIN_TO_CYRILLIC : CYRILLIC_TO_LATIN;
    t = Array.from(t, (ch) => map[ch] ?? ch).join("");
  }

  return t
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/ё/g, "е")
    .replace(/եւ/g, "եվ")
    .replace(/և/g, "եվ");
}

/** The folded token plus squeezed spellings ("fuuuck" -> "fuck"/"fuuck"). */
function variants(folded: string): string[] {
  const out = new Set<string>([folded]);
  out.add(folded.replace(/(\p{L})\1{2,}/gu, "$1"));
  out.add(folded.replace(/(\p{L})\1{2,}/gu, "$1$1"));
  out.add(folded.replace(/(\p{L})\1+/gu, "$1"));
  out.delete("");
  return [...out];
}

// Split on whitespace and on punctuation that separates words, but NOT on
// . * _ - which people use inside obfuscated words.
const TOKEN_SPLIT_RE = /[\s,;:!?()"'«»„“”‘’\[\]{}<>\/\\|+=~^&]+/u;

function tokens(text: string): string[] {
  return text.split(TOKEN_SPLIT_RE).filter((t) => t.length > 0);
}

// ---------------------------------------------------------------------------
// Blocklist
// ---------------------------------------------------------------------------

interface CompiledList {
  exact: Set<string>;
  prefix: string[];
  contains: string[];
}

const COMPILED_BLOCKLIST: CompiledList = (() => {
  const exact = new Set<string>();
  const prefix: string[] = [];
  const contains: string[] = [];
  for (const list of Object.values(BLOCKLIST)) {
    for (const w of list.exact) exact.add(foldToken(w));
    for (const w of list.prefix) prefix.push(foldToken(w));
    for (const w of list.contains) contains.push(foldToken(w));
  }
  return { exact, prefix: prefix.filter(Boolean), contains: contains.filter(Boolean) };
})();

/** Returns the (folded) blocklist entry found in the text, or null. */
export function findBlockedWord(text: string): string | null {
  const bl = COMPILED_BLOCKLIST;
  for (const tok of tokens(text)) {
    for (const v of variants(foldToken(tok))) {
      if (bl.exact.has(v)) return v;
      for (const p of bl.prefix) if (v.startsWith(p)) return p;
      for (const c of bl.contains) if (v.includes(c)) return c;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Contact data
// ---------------------------------------------------------------------------

export type ContactKind = "email" | "url" | "handle" | "phone";

const EMAIL_IN_TEXT_RE = /[^\s@]+@[^\s@]+\.[^\s@.]{2,}/u;
const URL_PREFIX_RE = /(?:https?:\/\/|www\.|t\.me\/)/iu;
const DOMAIN_RE = new RegExp(
  `(?<![\\p{L}\\p{N}@])[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]*[\\p{L}\\p{N}])?(?:\\.[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]*[\\p{L}\\p{N}])?)*\\.(?:${URL_TLDS.join("|")})(?![\\p{L}\\p{N}])`,
  "iu",
);
const HANDLE_RE = /(?<![\p{L}\p{N}_.])@[\p{L}\p{N}_](?:[\p{L}\p{N}_.]*[\p{L}\p{N}_])?/u;
// Four-digit years 1900–2099 are removed before looking for phone numbers.
const YEAR_RE = /(?<!\d)(?:19|20)\d{2}(?!\d)/g;
const PHONE_RE = /(?<!\d)(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]?\d{2,4}){1,5}(?!\d)/g;
// "10 000 000" is an amount, not a phone (but "093 123 456" is a phone).
const AMOUNT_RE = /^[1-9]\d{0,2}(?:[ ,.]\d{3})+$/;

export function detectContact(text: string): ContactKind | null {
  if (EMAIL_IN_TEXT_RE.test(text)) return "email";
  if (URL_PREFIX_RE.test(text) || DOMAIN_RE.test(text)) return "url";
  if (HANDLE_RE.test(text)) return "handle";

  const withoutYears = text.replace(YEAR_RE, " ");
  for (const m of withoutYears.matchAll(PHONE_RE)) {
    const s = m[0].trim();
    const digits = s.replace(/\D/g, "").length;
    if (digits < 8 || digits > 15) continue;
    if (!s.startsWith("+") && AMOUNT_RE.test(s)) continue;
    return "phone";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Personal names
// ---------------------------------------------------------------------------

type Script = "armn" | "latn" | "cyrl";

function scriptOf(s: string): Script | null {
  if (ARMENIAN_RE.test(s)) return "armn";
  if (CYRILLIC_RE.test(s)) return "cyrl";
  if (LATIN_RE.test(s)) return "latn";
  return null;
}

const NAME_INDEX = (() => {
  const names = new Set<string>();
  const cyrlStems = new Set<string>();
  for (const forms of COMMON_NAMES) {
    for (const form of forms) {
      const f = foldToken(form);
      if (!f) continue;
      names.add(f);
      if (scriptOf(f) === "cyrl" && /[ая]$/.test(f) && f.length >= 4) cyrlStems.add(f.slice(0, -1));
    }
  }
  const suffixes: Record<Script, string[]> = {
    armn: NAME_SUFFIXES.armn.map(foldToken),
    latn: NAME_SUFFIXES.latn.map(foldToken),
    cyrl: NAME_SUFFIXES.cyrl.map(foldToken),
  };
  const stemEndings = NAME_SUFFIXES.cyrlStemReplace.map(foldToken);
  return { names, cyrlStems, suffixes, stemEndings };
})();

function isNameToken(v: string): boolean {
  const idx = NAME_INDEX;
  if (idx.names.has(v)) return true;
  const script = scriptOf(v);
  if (!script) return false;
  for (const suf of idx.suffixes[script]) {
    if (v.length > suf.length + 1 && v.endsWith(suf) && idx.names.has(v.slice(0, -suf.length))) return true;
  }
  if (script === "cyrl") {
    for (const end of idx.stemEndings) {
      if (v.endsWith(end) && idx.cyrlStems.has(v.slice(0, -end.length))) return true;
    }
  }
  return false;
}

/** Returns the folded token that looks like a common Armenian first name, or null. */
export function findName(text: string): string | null {
  for (const tok of tokens(text)) {
    const folded = foldToken(tok);
    if (folded.length < 3) continue;
    for (const v of variants(folded)) {
      if (isNameToken(v)) return v;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export function moderate(fields: ModerationFields): ModerationResult {
  const all = [fields.text, fields.wish_text ?? "", fields.recipient_name ?? ""];
  for (const f of all) {
    if (f && findBlockedWord(f)) return { decision: "rejected", reason: "auto:blocklist" };
  }

  // recipient_name is never shown publicly, so only text and wish matter here.
  for (const f of [fields.text, fields.wish_text ?? ""]) {
    if (!f) continue;
    const contact = detectContact(f);
    if (contact) return { decision: "hidden", reason: `auto:${contact}` };
    if (findName(f)) return { decision: "hidden", reason: "auto:name" };
  }

  return { decision: "pending", reason: null };
}

/**
 * The moderation status stored at creation. With AUTO_APPROVE, texts the
 * automatic checks found nothing in are approved right away.
 */
export function initialModeration(result: ModerationResult, autoApprove: boolean): ModerationStatus {
  if (result.decision === "pending" && autoApprove) return "approved";
  return result.decision;
}
