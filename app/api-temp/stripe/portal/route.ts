/**
 * app/api/stripe/portal/route.ts
 *
 * Creates a Stripe Customer Portal session so users can:
 *   - Cancel their subscription
 *   - Update their payment method
 *   - View invoice history
 *
 * Setup:
 *   1. Go to Stripe Dashboard → Settings → Billing → Customer Portal
 *   2. Click "Activate" and configure what users can do
 *   3. Make sure STRIPE_SECRET_KEY and NEXT_PUBLIC_APP_URL are set in Vercel
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
    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    // Get the user's Stripe customer ID from Supabase
    const { data: profile, error } = await getSupabase()
      .from("profiles")
      .select("stripe_customer_id, has_paid")
      .eq("id", userId)
      .single();

    if (error || !profile?.stripe_customer_id) {
      return NextResponse.json(
        { error: "No billing account found for this user." },
        { status: 404 }
      );
    }

    // Create a Stripe Customer Portal session
    const session = await getStripe().billingPortal.sessions.create({
      customer:   profile.stripe_customer_id,
      return_url: process.env.NEXT_PUBLIC_APP_URL!, // sends them back to your app after
    });

    return NextResponse.json({ url: session.url });

  } catch (e: any) {
    console.error("Portal session error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
