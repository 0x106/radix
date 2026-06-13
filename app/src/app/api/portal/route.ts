// Opens the Stripe Billing Portal so subscribers can manage or cancel their plan
// and view invoices.

import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { verifyUser } from "@/lib/auth";
import { ensureAccount } from "@/lib/billing";

export async function POST(req: NextRequest) {
  try {
    const user = await verifyUser(req);
    if (!user)
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const account = await ensureAccount(user.id);
    if (!account.stripeCustomerId) {
      return NextResponse.json(
        { error: "No billing account yet — make a purchase first." },
        { status: 400 }
      );
    }

    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
    const session = await getStripe().billingPortal.sessions.create({
      customer: account.stripeCustomerId,
      return_url: `${origin}/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[portal]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
