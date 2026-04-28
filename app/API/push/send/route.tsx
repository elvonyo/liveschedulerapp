import webpush from "web-push";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

webpush.setVapidDetails(
  process.env.VAPID_EMAIL!,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { communityId, title, body, url } = await req.json();

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth_key")
      .eq("community_id", communityId);

    if (!subs?.length) return NextResponse.json({ sent: 0 });

    const payload = JSON.stringify({ title, body, url });

    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          payload
        )
      )
    );

    const sent   = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected").length;

    return NextResponse.json({ sent, failed });
  } catch (e: any) {
    console.error("Push send error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}