/**
 * app/api/stripe/webhook/route.ts
 *
 * Listens for Stripe events and updates Supabase when payment succeeds or fails.
 *
 * Setup:
 *   1. In Stripe Dashboard → Developers → Webhooks → Add endpoint
 *   2. URL: https://yourdomain.com/api/stripe/webhook
 *   3. Events to listen for:
 *      - checkout.session.completed
 *      - customer.subscription.deleted  (cancellation)
 *      - customer.subscription.updated  (renewal / failed payment)
 *   4. Copy Webhook Signing Secret into env:
 *      STRIPE_WEBHOOK_SECRET=whsec_...
 *
 * For local testing:
 *   stripe listen --forward-to localhost:3000/api/stripe/webhook
 */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2026-04-22.dahlia",
  });
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const body      = await req.text();
  const signature = req.headers.get("stripe-signature")!;

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {

    // ── Payment succeeded → grant access ──
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId  = session.metadata?.supabase_user_id;
      if (!userId) break;

      await getSupabase().from("profiles").update({
        has_paid:        true,
        paid_at:         new Date().toISOString(),
        subscription_id: session.subscription as string,
      }).eq("id", userId);

      console.log(`✅ User ${userId} subscribed`);
      break;
    }

    // ── Subscription cancelled → revoke access ──
    case "customer.subscription.deleted": {
      const sub    = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.supabase_user_id;
      if (!userId) break;

      await getSupabase().from("profiles").update({
        has_paid:        false,
        subscription_id: null,
      }).eq("id", userId);

      console.log(`❌ User ${userId} subscription cancelled`);
      break;
    }

    // ── Renewal or payment failure ──
    case "customer.subscription.updated": {
      const sub    = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.supabase_user_id;
      if (!userId) break;

      const active = sub.status === "active" || sub.status === "trialing";
      await getSupabase().from("profiles").update({ has_paid: active }).eq("id", userId);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
