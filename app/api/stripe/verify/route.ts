/**
 * app/api/stripe/verify/route.ts
 *
 * Called by the payment-success page to confirm a Stripe Checkout session
 * and mark the user as paid in Supabase.
 *
 * This is a safety net — the webhook handles the same thing asynchronously,
 * but this ensures the user gets access immediately after returning from Stripe.
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
  try {
    const { sessionId } = await req.json();

    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    // Retrieve the session from Stripe to confirm it's paid
    const session = await getStripe().checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return NextResponse.json({ error: "Payment not completed" }, { status: 400 });
    }

    const userId = session.metadata?.supabase_user_id;

    if (!userId) {
      return NextResponse.json({ error: "No user ID in session metadata" }, { status: 400 });
    }

    // Mark user as paid in Supabase
    const { error } = await getSupabase()
      .from("profiles")
      .update({
        has_paid:        true,
        paid_at:         new Date().toISOString(),
        subscription_id: session.subscription as string,
      })
      .eq("id", userId);

    if (error) throw error;

    return NextResponse.json({ success: true });

  } catch (e: any) {
    console.error("Verify error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
