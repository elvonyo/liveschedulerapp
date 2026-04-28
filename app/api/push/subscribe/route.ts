/**
 * app/api/push/subscribe/route.ts
 * Saves a user's push subscription to Supabase.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    const { subscription, userId, communityId } = await req.json();

    const { error } = await getSupabase().from("push_subscriptions").upsert({
      user_id:      userId,
      community_id: communityId,
      endpoint:     subscription.endpoint,
      p256dh:       subscription.keys.p256dh,
      auth_key:     subscription.keys.auth,
    }, { onConflict: "user_id,community_id,endpoint" });

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("Push subscribe error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
