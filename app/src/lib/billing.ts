// Server-only token wallet logic. Owns the InstantDB `accounts` / `ledgerEntries`
// entities through the admin client, converts OpenAI usage into Radix tokens, and
// maps product keys to Stripe Price IDs. Never import this into client code.

import { adminDb, id } from "@/lib/db-admin";
import { MODEL } from "@/lib/openai";
import { PRODUCTS, productByKey, type ProductKey } from "@/lib/products";

// --- Pricing configuration (all knobs in one place) -------------------------

/** What one Radix token is worth in USD of credit. */
export const TOKEN_VALUE_USD = 0.01;
/** Multiplier over raw OpenAI cost (covers margin + Stripe fees). */
export const MARKUP = 2;
/** One-time tokens granted to a brand-new account. */
export const FREE_GRANT_TOKENS = 300;

/**
 * Per-model OpenAI pricing in USD per 1M tokens. These are PLACEHOLDER values —
 * confirm them against current OpenAI pricing before going live.
 */
const MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  "gpt-5.5": { inputPerM: 1.25, outputPerM: 10 },
  default: { inputPerM: 1.25, outputPerM: 10 },
};

/** Maps a product key to the env var holding its Stripe Price ID. */
const PRICE_ENV: Record<ProductKey, string> = {
  pack_small: "STRIPE_PRICE_PACK_SMALL",
  pack_medium: "STRIPE_PRICE_PACK_MEDIUM",
  pack_large: "STRIPE_PRICE_PACK_LARGE",
  subscription: "STRIPE_PRICE_SUBSCRIPTION",
};

export interface ServerProduct {
  key: ProductKey;
  priceId: string;
  tokens: number;
  mode: "payment" | "subscription";
}

/** Resolve a product key to its Stripe Price ID + token amount, or null. */
export function serverProduct(key: string): ServerProduct | null {
  const product = productByKey(key);
  if (!product) return null;
  const priceId = process.env[PRICE_ENV[product.key]];
  if (!priceId) return null;
  return {
    key: product.key,
    priceId,
    tokens: product.tokens,
    mode: product.kind === "subscription" ? "subscription" : "payment",
  };
}

/** Reverse lookup: how many tokens a given Stripe Price ID is worth. */
export function tokensForPriceId(priceId: string): number | null {
  for (const product of PRODUCTS) {
    if (process.env[PRICE_ENV[product.key]] === priceId) return product.tokens;
  }
  return null;
}

// --- Usage metering ---------------------------------------------------------

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
}

/** Convert an OpenAI Responses usage object into whole Radix tokens (min 1). */
export function usageToTokens(usage: Usage | null | undefined): number {
  const input = usage?.input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  const pricing = MODEL_PRICING[MODEL] ?? MODEL_PRICING.default;
  const usd =
    (input / 1_000_000) * pricing.inputPerM +
    (output / 1_000_000) * pricing.outputPerM;
  const tokens = Math.ceil((usd * MARKUP) / TOKEN_VALUE_USD);
  return Math.max(1, tokens);
}

// --- Account & ledger -------------------------------------------------------

export interface Account {
  id: string;
  tokenBalance: number;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  subscriptionStatus?: string;
  freeGrantApplied: boolean;
  createdAt: number;
}

async function findAccount(userId: string): Promise<Account | null> {
  const res = await adminDb.query({
    accounts: { $: { where: { "owner.id": userId } } },
  });
  return (res.accounts?.[0] as Account | undefined) ?? null;
}

/**
 * Find the user's wallet, creating it (with the one-time free grant) on first
 * use. Idempotent in the common case; a rare concurrent double-create is
 * tolerated for simplicity.
 */
export async function ensureAccount(userId: string): Promise<Account> {
  const existing = await findAccount(userId);
  if (existing) return existing;

  const now = Date.now();
  const accountId = id();
  await adminDb.transact([
    adminDb.tx.accounts[accountId]
      .update({
        tokenBalance: FREE_GRANT_TOKENS,
        freeGrantApplied: true,
        createdAt: now,
      })
      .link({ owner: userId }),
    adminDb.tx.ledgerEntries[id()]
      .update({ delta: FREE_GRANT_TOKENS, reason: "grant", createdAt: now })
      .link({ account: accountId }),
  ]);

  return {
    id: accountId,
    tokenBalance: FREE_GRANT_TOKENS,
    freeGrantApplied: true,
    createdAt: now,
  };
}

/**
 * Apply a balance change and append a ledger row in one transaction. Balance is
 * floored at 0. Returns the new balance.
 */
async function adjustBalance(
  account: Account,
  delta: number,
  reason: string,
  meta?: unknown,
  stripeEventId?: string
): Promise<number> {
  const newBalance = Math.max(0, account.tokenBalance + delta);
  const entry = adminDb.tx.ledgerEntries[id()]
    .update({
      delta,
      reason,
      createdAt: Date.now(),
      ...(stripeEventId ? { stripeEventId } : {}),
      ...(meta !== undefined ? { meta } : {}),
    })
    .link({ account: account.id });

  await adminDb.transact([
    adminDb.tx.accounts[account.id].update({ tokenBalance: newBalance }),
    entry,
  ]);
  return newBalance;
}

/** Debit tokens for a model call. Returns the new balance. */
export async function debitTokens(
  userId: string,
  amount: number,
  meta?: unknown
): Promise<number> {
  const account = await ensureAccount(userId);
  return adjustBalance(account, -Math.abs(amount), "build", meta);
}

/**
 * Credit tokens from a Stripe event. Idempotent: we skip if a ledger entry with
 * this event id already exists, so retried webhook deliveries never double-credit.
 */
export async function creditTokens(opts: {
  userId: string;
  amount: number;
  reason: "purchase" | "subscription";
  eventId: string;
  meta?: unknown;
}): Promise<void> {
  const { userId, amount, reason, eventId, meta } = opts;
  const dup = await adminDb.query({
    ledgerEntries: { $: { where: { stripeEventId: eventId } } },
  });
  if ((dup.ledgerEntries?.length ?? 0) > 0) return; // already processed

  const account = await ensureAccount(userId);
  await adjustBalance(account, Math.abs(amount), reason, meta, eventId);
}

/** Persist Stripe customer/subscription details on the user's account. */
export async function updateAccountStripe(
  userId: string,
  fields: {
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    subscriptionStatus?: string;
  }
): Promise<void> {
  const account = await ensureAccount(userId);
  await adminDb.transact([
    adminDb.tx.accounts[account.id].update(fields),
  ]);
}
