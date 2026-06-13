// Client-safe billing catalogue. This is display + token amounts only — no
// secrets, no Stripe Price IDs (those live server-side in lib/billing.ts). Both
// the /billing page (client) and the server import this, so it must stay free of
// server-only imports.

export type ProductKey =
  | "pack_small"
  | "pack_medium"
  | "pack_large"
  | "subscription";

export interface Product {
  key: ProductKey;
  kind: "pack" | "subscription";
  name: string;
  /** Tokens granted by this purchase (per month for the subscription). */
  tokens: number;
  /** Human price label, e.g. "$5" or "$15/mo". */
  price: string;
  blurb: string;
}

export const PRODUCTS: Product[] = [
  {
    key: "pack_small",
    kind: "pack",
    name: "Starter",
    tokens: 500,
    price: "$5",
    blurb: "A handful of builds to get going.",
  },
  {
    key: "pack_medium",
    kind: "pack",
    name: "Builder",
    tokens: 2000,
    price: "$18",
    blurb: "Best value for regular tinkering.",
  },
  {
    key: "pack_large",
    kind: "pack",
    name: "Pro pack",
    tokens: 6000,
    price: "$50",
    blurb: "A big bundle for heavy use.",
  },
  {
    key: "subscription",
    kind: "subscription",
    name: "Monthly",
    tokens: 2000,
    price: "$15/mo",
    blurb: "2,000 tokens topped up every month.",
  },
];

export function productByKey(key: string): Product | undefined {
  return PRODUCTS.find((p) => p.key === key);
}
