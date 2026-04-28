/**
 * app/api/stripe/checkout/route.ts
 *
 * Creates a Stripe Checkout session for the $2.99/month subscription.
 *
 * Setup:
 *   npm install stripe @stripe/stripe-js
 *
 * Required env vars (.env.local):
 *   STRIPE_SECRET_KEY=sk_live_...
 *   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
 *   STRIPE_PRICE_ID=price_...   ← create a recurring $2.99/mo price in Stripe dashboard
 *   NEXT_PUBLIC_APP_URL=https://yourdomain.com
 *
 * In Stripe Dashboard:
 *   1. Products → Create product → "LiveSupport Scheduler Access"
 *   2. Add price → Recurring → $2.99 / month
 *   3. Copy the Price ID (price_xxxx) into STRIPE_PRICE_ID
 */

import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-06-20",
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // use service role for server-side writes
);

export async function POST(req: NextRequest) {
  try {
    const { userId, username } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    // Check if user already has a Stripe customer ID
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id, has_paid")
      .eq("id", userId)
      .single();

    if (profile?.has_paid) {
      return NextResponse.json({ error: "Already subscribed" }, { status: 400 });
    }

    // Create or reuse Stripe customer
    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { supabase_user_id: userId, username },
      });
      customerId = customer.id;

      // Save customer ID to Supabase
      await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", userId);
    }

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID!,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.NEXT_PUBLIC_APP_URL}/`,
      metadata: { supabase_user_id: userId },
      subscription_data: {
        metadata: { supabase_user_id: userId },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error("Stripe checkout error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}