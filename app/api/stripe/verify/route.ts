/**
 * app/api/stripe/verify/route.ts
 *
 * Called by /payment-success after Stripe redirects back.
 * 1. Confirms session is paid with Stripe
 * 2. Updates profiles.has_paid = true in Supabase immediately
 *    (webhook does the same thing but may be delayed)
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

    // Confirm with Stripe the session is actually paid
    const session = await getStripe().checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return NextResponse.json(
        { error: "Payment not completed", status: session.payment_status },
        { status: 400 }
      );
    }

    const userId = session.metadata?.supabase_user_id;

    if (!userId) {
      return NextResponse.json({ error: "No user ID in session metadata" }, { status: 400 });
    }

    // Update Supabase immediately — don't wait for webhook
    const { error: updateError } = await getSupabase()
      .from("profiles")
      .update({
        has_paid:        true,
        paid_at:         new Date().toISOString(),
        subscription_id: session.subscription as string,
        stripe_customer_id: session.customer as string,
      })
      .eq("id", userId);

    if (updateError) {
      console.error("Supabase update error:", updateError.message);
      // Don't fail the request — payment went through, webhook will retry
    }

    return NextResponse.json({ success: true, userId });

  } catch (e: any) {
    console.error("Verify error:", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
