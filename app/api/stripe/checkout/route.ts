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
    const { userId, username } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    if (!process.env.STRIPE_PRICE_ID) {
      return NextResponse.json(
        { error: "STRIPE_PRICE_ID environment variable is not set on the server." },
        { status: 500 }
      );
    }

    const { data: profile } = await getSupabase()
      .from("profiles")
      .select("stripe_customer_id, has_paid")
      .eq("id", userId)
      .single();

    if (profile?.has_paid) {
      return NextResponse.json({ error: "Already subscribed" }, { status: 400 });
    }

    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const customer = await getStripe().customers.create({
        metadata: { supabase_user_id: userId, username },
      });
      customerId = customer.id;
      await getSupabase()
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", userId);
    }

    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      allow_promotion_codes: true, // ← enables coupon code field at checkout
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.NEXT_PUBLIC_APP_URL}/`,
      metadata: { supabase_user_id: userId },
      subscription_data: {
        trial_period_days: 7,
        metadata: { supabase_user_id: userId },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error("Stripe checkout error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
