// Stripe webhook: the only place token balances are credited from payments.
// Verifies the signature against the raw body, then applies the event. All
// credits are idempotent (keyed on the Stripe event id), so retries are safe.

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { creditTokens, tokensForPriceId, updateAccountStripe } from "@/lib/billing";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

export async function POST(req: NextRequest) {
  if (!webhookSecret) {
    console.error("[webhook] Missing STRIPE_WEBHOOK_SECRET");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // Signature verification needs the exact raw bytes, not parsed JSON.
  const body = await req.text();

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[webhook] Signature verification failed:", message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        const tokens = Number(session.metadata?.tokens ?? 0);
        if (!userId || !tokens) break;

        // Credits the pack, or the FIRST month of a subscription. Renewals come
        // through invoice.paid below.
        await creditTokens({
          userId,
          amount: tokens,
          reason: session.mode === "subscription" ? "subscription" : "purchase",
          eventId: event.id,
          meta: { sessionId: session.id, productKey: session.metadata?.productKey },
        });

        if (session.mode === "subscription") {
          await updateAccountStripe(userId, {
            stripeCustomerId:
              typeof session.customer === "string"
                ? session.customer
                : undefined,
            stripeSubscriptionId:
              typeof session.subscription === "string"
                ? session.subscription
                : undefined,
            subscriptionStatus: "active",
          });
        }
        break;
      }

      // Recurring renewals. The first invoice (billing_reason
      // "subscription_create") is already covered by checkout.session.completed,
      // so only act on later cycles.
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.billing_reason !== "subscription_cycle") break;

        const subId = subscriptionIdOf(invoice);
        if (!subId) break;
        const sub = await stripe.subscriptions.retrieve(subId);
        const userId = sub.metadata?.userId;
        const priceId = sub.items.data[0]?.price?.id;
        const tokens =
          (priceId ? tokensForPriceId(priceId) : null) ??
          Number(sub.metadata?.tokens ?? 0);
        if (!userId || !tokens) break;

        await creditTokens({
          userId,
          amount: tokens,
          reason: "subscription",
          eventId: event.id,
          meta: { invoiceId: invoice.id, subscriptionId: subId },
        });
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        if (!userId) break;
        await updateAccountStripe(userId, {
          stripeSubscriptionId: sub.id,
          subscriptionStatus: sub.status,
        });
        break;
      }

      default:
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[webhook] Handling ${event.type} failed:`, message);
    // 500 tells Stripe to retry; idempotency makes that safe.
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/** Pull the subscription id off an invoice across Stripe API shape changes. */
function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  const inv = invoice as unknown as {
    subscription?: string | { id: string };
    parent?: { subscription_details?: { subscription?: string } };
  };
  if (typeof inv.subscription === "string") return inv.subscription;
  if (inv.subscription && typeof inv.subscription === "object")
    return inv.subscription.id;
  const nested = inv.parent?.subscription_details?.subscription;
  return typeof nested === "string" ? nested : null;
}
