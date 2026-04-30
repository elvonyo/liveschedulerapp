/**
 * app/api/cron/check-lives/route.ts
 *
 * Runs every minute via Vercel Cron.
 * Checks for schedules whose start time just hit (within the last 2 minutes)
 * and sends push notifications to all community subscribers.
 *
 * Vercel Cron config is in vercel.json
 */

import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function initWebPush() {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
}

// Days of week: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
function isLiveNow(schedule: any, now: Date): boolean {
  const days: number[] = (schedule.days_of_week || []).map(Number);
  const currentDay = now.getDay();

  if (!days.includes(currentDay)) return false;

  const [sh, sm] = schedule.start_time.slice(0, 5).split(":").map(Number);
  const [eh, em] = schedule.end_time.slice(0, 5).split(":").map(Number);

  const startMins = sh * 60 + sm;
  const endMins   = eh * 60 + em;
  const nowMins   = now.getHours() * 60 + now.getMinutes();

  // Handle overnight lives (e.g. 11pm–1am)
  const overnight = endMins < startMins;
  if (overnight) {
    return nowMins >= startMins || nowMins < endMins;
  }
  return nowMins >= startMins && nowMins < endMins;
}

function justStarted(schedule: any, now: Date): boolean {
  const days: number[] = (schedule.days_of_week || []).map(Number);
  const currentDay = now.getDay();
  if (!days.includes(currentDay)) return false;

  const [sh, sm] = schedule.start_time.slice(0, 5).split(":").map(Number);
  const startMins = sh * 60 + sm;
  const nowMins   = now.getHours() * 60 + now.getMinutes();

  // Consider "just started" if within 2 minutes of start time
  return nowMins >= startMins && nowMins <= startMins + 2;
}

export async function GET(req: NextRequest) {
  // Verify this is called by Vercel Cron (or internally)
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const supabase = getSupabase();

    // Get all active schedules (not cancelled)
    const { data: schedules, error } = await supabase
      .from("schedules")
      .select("id, user_id, community_id, host_username, platform, days_of_week, start_time, end_time, notes, manual_status")
      .neq("manual_status", "Cancelled");

    if (error) throw error;
    if (!schedules?.length) return NextResponse.json({ checked: 0, notified: 0 });

    // Find schedules that just started (within last 2 minutes)
    const justLive = schedules.filter(s =>
      s.manual_status !== "Cancelled" &&
      justStarted(s, now)
    );

    if (justLive.length === 0) {
      return NextResponse.json({ checked: schedules.length, notified: 0 });
    }

    initWebPush();
    let totalSent = 0;

    for (const schedule of justLive) {
      // Get all push subscriptions for this community
      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth_key, user_id")
        .eq("community_id", schedule.community_id);

      if (!subs?.length) continue;

      // Don't notify the host themselves
      const otherSubs = subs.filter(s => s.user_id !== schedule.user_id);
      if (!otherSubs.length) continue;

      const payload = JSON.stringify({
        title: `@${schedule.host_username} is Live Now! 🔴`,
        body:  schedule.notes
          ? `${schedule.platform} · ${schedule.notes}`
          : `${schedule.platform} · ${schedule.start_time.slice(0,5)} – ${schedule.end_time.slice(0,5)}`,
        url: "/",
      });

      const results = await Promise.allSettled(
        otherSubs.map(sub =>
          webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
            payload
          )
        )
      );

      const sent = results.filter(r => r.status === "fulfilled").length;
      totalSent += sent;

      // Clean up expired subscriptions
      const failed = results
        .map((r, i) => r.status === "rejected" ? otherSubs[i] : null)
        .filter(Boolean);

      for (const sub of failed) {
        if (sub) {
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", sub.endpoint);
        }
      }

      console.log(`[CRON] @${schedule.host_username} live — sent ${sent} notifications`);
    }

    return NextResponse.json({
      checked:  schedules.length,
      live:     justLive.length,
      notified: totalSent,
      time:     now.toISOString(),
    });

  } catch (e: any) {
    console.error("[CRON] Error:", e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
