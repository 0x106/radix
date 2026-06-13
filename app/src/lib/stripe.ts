// Server-only Stripe client. The secret key must never reach the browser, so
// this module is imported by route handlers only.
//
// Initialised lazily: importing this module is harmless when Stripe isn't
// configured (the app still builds and runs), and we only throw when a billing
// endpoint actually tries to use it.

import Stripe from "stripe";

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY in environment");
  }
  client = new Stripe(secretKey);
  return client;
}
