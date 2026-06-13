// Creates a Stripe Checkout Session for a token pack or the monthly subscription.
// The client sends a product *key* (never a price or amount); the server resolves
// it to a trusted Price ID + token count via lib/billing.

import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { verifyUser } from "@/lib/auth";
import { ensureAccount, serverProduct, updateAccountStripe } from "@/lib/billing";

export async function POST(req: NextRequest) {
  try {
    const user = await verifyUser(req);
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { productKey } = (await req.json()) as { productKey?: string };
    const product = productKey ? serverProduct(productKey) : null;
    if (!product) {
      return NextResponse.json(
        { error: "Unknown or unconfigured product" },
        { status: 400 }
      );
    }

    const stripe = getStripe();

    // Reuse the account's Stripe customer, creating one on first purchase so all
    // of a user's payments and subscriptions live under a single customer.
    const account = await ensureAccount(user.id);
    let customerId = account.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await updateAccountStripe(user.id, { stripeCustomerId: customerId });
    }

    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;

    const session = await stripe.checkout.sessions.create({
      mode: product.mode,
      customer: customerId,
      line_items: [{ price: product.priceId, quantity: 1 }],
      client_reference_id: user.id,
      metadata: {
        userId: user.id,
        productKey: product.key,
        tokens: String(product.tokens),
      },
      // Stamp the same metadata on the subscription so renewal invoices can be
      // attributed back to the user.
      ...(product.mode === "subscription"
        ? {
            subscription_data: {
              metadata: { userId: user.id, tokens: String(product.tokens) },
            },
          }
        : {}),
      success_url: `${origin}/billing?status=success`,
      cancel_url: `${origin}/billing?status=cancel`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[checkout]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
