/**
 * app/api/stripe/verify/route.ts
 *
 * Verifies a Stripe Checkout session completed successfully.
 * The Stripe webhook handles updating Supabase — this route just
 * confirms the session is valid so the frontend can show success.
 *
 * [DB INTEGRATION] Once real Supabase auth is wired up, uncomment
 * the profiles update block at the bottom.
 */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2026-04-22.dahlia",
  });
}

export async function POST(req: NextRequest) {
  try {
    const { sessionId } = await req.json();

    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    // Confirm with Stripe that the session is paid
    const session = await getStripe().checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return NextResponse.json(
        { error: "Payment not completed", status: session.payment_status },
        { status: 400 }
      );
    }

    // Payment confirmed — return success.
    // Supabase profiles.has_paid is updated by the Stripe webhook (checkout.session.completed).
    // [DB INTEGRATION] Once real auth is wired up, also update profiles here as a fallback:
    //
    // const userId = session.metadata?.supabase_user_id;
    // if (userId) {
    //   await getSupabase()
    //     .from("profiles")
    //     .update({ has_paid: true, paid_at: new Date().toISOString(), subscription_id: session.subscription })
    //     .eq("id", userId);
    // }

    return NextResponse.json({
      success: true,
      customerId:     session.customer,
      subscriptionId: session.subscription,
    });

  } catch (e: any) {
    console.error("Verify error:", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
