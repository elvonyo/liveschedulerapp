/**
 * Live Support Scheduler — v2
 *
 * Features:
 * - User accounts (username + password, mock auth — no backend yet)
 * - Weekly recurring schedules (day-of-week + start/end time, not one-off dates)
 * - "Live Now" triggers automatically when current time falls inside a host's window
 * - Manual "Go Live Early" button still available for hosts
 * - Attendance (Yes/Maybe) removed — supporter signup is name + gift + comment only
 * - Admin can download a weekly CSV summary of all hosts + their signups
 *
 * [DB INTEGRATION] tags mark every spot to swap in Supabase / Firebase / Auth calls.
 */

import { useState, useMemo, useEffect } from "react";

// ─── Constants ─────────────────────────────────────────────────────────────────

const STATUS = {
  UPCOMING: "Upcoming",
  LIVE_NOW: "Live Now",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

// ─── Utilities ─────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function formatTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
}

// Returns true if right now falls between startTime and endTime on the given dayOfWeek
function isLiveRightNow(schedule) {
  const now = new Date();
  if (now.getDay() !== schedule.dayOfWeek) return false;
  const [sh, sm] = schedule.startTime.split(":").map(Number);
  const [eh, em] = schedule.endTime.split(":").map(Number);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  return nowMins >= sh * 60 + sm && nowMins < eh * 60 + em;
}

// Derive effective status — manual overrides win, otherwise auto-detect
function effectiveStatus(schedule) {
  if (schedule.manualStatus === STATUS.CANCELLED) return STATUS.CANCELLED;
  if (schedule.manualStatus === STATUS.LIVE_NOW)  return STATUS.LIVE_NOW;
  if (schedule.manualStatus === STATUS.COMPLETED) return STATUS.COMPLETED;
  if (isLiveRightNow(schedule)) return STATUS.LIVE_NOW;
  return STATUS.UPCOMING;
}

function platformIcon(p = "") {
  const pl = p.toLowerCase();
  if (pl.includes("tiktok"))    return "🎵";
  if (pl.includes("kick"))      return "🟩";
  if (pl.includes("youtube"))   return "▶️";
  if (pl.includes("twitch"))    return "💜";
  if (pl.includes("instagram")) return "📸";
  return "📡";
}

function statusBadgeClass(status) {
  switch (status) {
    case STATUS.LIVE_NOW:  return "bg-red-500 text-white";
    case STATUS.UPCOMING:  return "bg-amber-400 text-gray-900";
    case STATUS.COMPLETED: return "bg-emerald-600 text-white";
    case STATUS.CANCELLED: return "bg-gray-500 text-white";
    default:               return "bg-gray-400 text-white";
  }
}

// Next calendar label for a given day-of-week
function nextOccurrence(dayOfWeek) {
  const now = new Date();
  const diff = (dayOfWeek - now.getDay() + 7) % 7;
  const d = new Date(now);
  d.setDate(now.getDate() + diff);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// Build CSV for weekly summary download
function buildWeeklyCSV(schedules, signups, users) {
  const rows = [["Host","Platform","Day","Start","End","Status","# Supporters","Total Planned Gifts ($)"]];
  for (const sched of schedules) {
    const ss = signups.filter(sg => sg.scheduleId === sched.id);
    const totalGift = ss.reduce((sum, sg) => sum + (sg.plannedGiftAmount || 0), 0);
    rows.push([
      "@" + sched.hostUsername,
      sched.platform,
      DAYS[sched.dayOfWeek],
      formatTime(sched.startTime),
      formatTime(sched.endTime),
      effectiveStatus(sched),
      ss.length,
      totalGift.toFixed(2),
    ]);
    if (ss.length > 0) {
      rows.push(["  Supporter", "Username", "Planned Gift ($)", "Comment", "", "", "", ""]);
      for (const sg of ss) {
        rows.push([
          "  " + sg.displayName,
          sg.supporterUsername || "",
          sg.plannedGiftAmount != null ? sg.plannedGiftAmount.toFixed(2) : "",
          sg.comment || "",
          "", "", "", "",
        ]);
      }
    }
  }
  return rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
}

function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Seed Data ─────────────────────────────────────────────────────────────────
// [DB INTEGRATION] Replace with useEffect fetch / Supabase .select() on mount.

const SEED_USERS = [
  { id: "u1", username: "StarryNight",  password: "pass1",    isAdmin: false },
  { id: "u2", username: "CosmicQueen", password: "pass2",    isAdmin: false },
  { id: "u3", username: "PixelVibes",  password: "pass3",    isAdmin: false },
  { id: "u0", username: "admin",       password: "admin123", isAdmin: true  },
];

const SEED_SCHEDULES = [
  {
    id: "sc1", userId: "u1", hostUsername: "StarryNight",
    platform: "TikTok", dayOfWeek: 0,
    startTime: "18:00", endTime: "20:00",
    notes: "Chill hangout, song requests & gifting games 🎶",
    manualStatus: null, createdAt: new Date().toISOString(),
  },
  {
    id: "sc2", userId: "u2", hostUsername: "CosmicQueen",
    platform: "Kick", dayOfWeek: 5,
    startTime: "21:00", endTime: "23:30",
    notes: "Milestone celebration every Friday 🎁",
    manualStatus: null, createdAt: new Date().toISOString(),
  },
  {
    id: "sc3", userId: "u3", hostUsername: "PixelVibes",
    platform: "YouTube", dayOfWeek: 2,
    startTime: "19:00", endTime: "21:00",
    notes: "Pixel art speedruns & community challenges 🎮",
    manualStatus: null, createdAt: new Date().toISOString(),
  },
];

const SEED_SIGNUPS = [
  { id: "sg1", scheduleId: "sc1", displayName: "MoonlitRose",  supporterUsername: "@moonlit_rose", plannedGiftAmount: 25,   comment: "Always here for you! 🌹", createdAt: new Date().toISOString() },
  { id: "sg2", scheduleId: "sc1", displayName: "TechVibes",    supporterUsername: "",              plannedGiftAmount: null, comment: "",                        createdAt: new Date().toISOString() },
  { id: "sg3", scheduleId: "sc2", displayName: "GalaxyGifter", supporterUsername: "@galaxy99",     plannedGiftAmount: 50,   comment: "Let's gooo!! 🚀",          createdAt: new Date().toISOString() },
];

// ─── Shared Atoms ──────────────────────────────────────────────────────────────

const inputCls = "w-full bg-white/10 text-white placeholder-white/30 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-400";
const labelCls = "text-white/70 text-xs font-semibold block mb-1";

function Badge({ status }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${statusBadgeClass(status)}`}>
      {status === STATUS.LIVE_NOW && (
        <span style={{ width:6, height:6, borderRadius:"50%", background:"#fff", display:"inline-block", animation:"livePulse 1.2s ease-in-out infinite" }} />
      )}
      {status}
    </span>
  );
}

function Pill({ label, value, accent }) {
  return (
    <div className={`flex flex-col items-center rounded-xl px-3 py-2 ${accent ? "bg-amber-400" : "bg-white/10"}`}>
      <span className={`text-base font-black leading-none ${accent ? "text-gray-900" : "text-white"}`}>{value}</span>
      <span className={`text-xs font-medium mt-0.5 ${accent ? "text-gray-700" : "text-white/60"}`}>{label}</span>
    </div>
  );
}

function SupporterRow({ signup }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-white/10 last:border-0">
      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-amber-400 to-rose-500 flex items-center justify-center text-white font-black text-sm flex-shrink-0">
        {signup.displayName[0].toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-white text-sm">{signup.displayName}</span>
          {signup.supporterUsername && <span className="text-white/40 text-xs">{signup.supporterUsername}</span>}
        </div>
        {signup.plannedGiftAmount != null && (
          <p className="text-amber-300 text-xs font-semibold mt-0.5">🎁 Plans to gift ${signup.plannedGiftAmount}</p>
        )}
        {signup.comment && <p className="text-white/50 text-xs mt-0.5 italic">"{signup.comment}"</p>}
      </div>
    </div>
  );
}

// ─── Auth Screen ───────────────────────────────────────────────────────────────

function AuthScreen({ users, onLogin, onRegister }) {
  const [tab, setTab]         = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]     = useState("");

  function handleLogin() {
    // [DB INTEGRATION] Replace with Supabase auth.signInWithPassword() or Firebase signInWithEmailAndPassword()
    const u = users.find(u =>
      u.username.toLowerCase() === username.trim().toLowerCase() && u.password === password
    );
    if (!u) { setError("Username or password is incorrect."); return; }
    setError(""); onLogin(u);
  }

  function handleRegister() {
    if (!username.trim() || !password.trim()) { setError("Both fields are required."); return; }
    if (users.find(u => u.username.toLowerCase() === username.trim().toLowerCase())) {
      setError("That username is already taken."); return;
    }
    // [DB INTEGRATION] POST new user to your users table, then call onLogin with returned user
    const newUser = { id: uid(), username: username.trim(), password, isAdmin: false };
    setError(""); onRegister(newUser);
  }

  const submit = tab === "login" ? handleLogin : handleRegister;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ background: "linear-gradient(180deg,#0d0f1c,#0a0c18)" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="text-5xl mb-3">📡</p>
          <h1 className="text-white font-black text-2xl tracking-tight">
            LiveSupport <span className="text-amber-400">Scheduler</span>
          </h1>
          <p className="text-white/40 text-sm mt-1">Sign in or create an account to get started</p>
        </div>

        <div className="flex bg-white/10 rounded-xl p-1 mb-5">
          {[["login","Sign In"],["register","Create Account"]].map(([t, label]) => (
            <button key={t} onClick={() => { setTab(t); setError(""); }}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${tab === t ? "bg-amber-400 text-gray-900" : "text-white/60"}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="rounded-2xl p-5 space-y-3" style={{ background: "linear-gradient(145deg,#1e2340,#16192e)" }}>
          {error && <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className={labelCls}>Username</label>
            <input value={username} onChange={e => setUsername(e.target.value)}
              placeholder="your_username" className={inputCls}
              onKeyDown={e => e.key === "Enter" && submit()} />
          </div>
          <div>
            <label className={labelCls}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••" className={inputCls}
              onKeyDown={e => e.key === "Enter" && submit()} />
          </div>
          <button onClick={submit}
            className="w-full bg-amber-400 hover:bg-amber-300 text-gray-900 font-black text-sm rounded-xl py-3 transition-colors">
            {tab === "login" ? "Sign In 🚀" : "Create Account ✨"}
          </button>
          {tab === "login" && (
            <p className="text-white/25 text-xs text-center pt-1">
              Demo hosts: StarryNight / pass1 · CosmicQueen / pass2<br/>Admin: admin / admin123
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Schedule Card (Dashboard) ─────────────────────────────────────────────────

function ScheduleCard({ schedule, signups, onView, isOwner, onGoLive }) {
  const status    = effectiveStatus(schedule);
  const ss        = signups.filter(sg => sg.scheduleId === schedule.id);
  const totalGift = ss.reduce((sum, sg) => sum + (sg.plannedGiftAmount || 0), 0);

  return (
    <div className="rounded-2xl p-4" style={{ background: "linear-gradient(145deg,#1e2340,#16192e)" }}>
      <div className="flex items-start gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge status={status} />
            <span className="text-white/50 text-xs">{platformIcon(schedule.platform)} {schedule.platform}</span>
          </div>
          <p className="text-white font-black text-lg leading-tight">@{schedule.hostUsername}</p>
          <p className="text-amber-400/90 text-xs font-semibold mt-0.5">
            Every {DAYS[schedule.dayOfWeek]} · {formatTime(schedule.startTime)} – {formatTime(schedule.endTime)}
          </p>
          <p className="text-white/35 text-xs mt-0.5">Next: {nextOccurrence(schedule.dayOfWeek)}</p>
        </div>
      </div>

      {schedule.notes && (
        <p className="text-white/50 text-xs bg-white/5 rounded-lg px-3 py-2 mb-3 line-clamp-2">{schedule.notes}</p>
      )}

      <div className="flex gap-2 mb-3">
        <Pill label="Supporters" value={ss.length} />
        {totalGift > 0 && <Pill label="Planned 🎁" value={`$${totalGift}`} accent />}
      </div>

      <div className="flex gap-2">
        <button onClick={() => onView(schedule.id)}
          className="flex-1 bg-amber-400 hover:bg-amber-300 text-gray-900 font-bold text-sm rounded-xl py-2.5 transition-colors">
          View & Sign Up
        </button>
        {isOwner && status !== STATUS.LIVE_NOW && status !== STATUS.CANCELLED && (
          <button onClick={() => onGoLive(schedule.id)}
            className="px-4 bg-red-500/80 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-colors">
            🔴 Early
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Signup Form ───────────────────────────────────────────────────────────────

function SignupForm({ scheduleId, currentUser, onSubmit }) {
  const [displayName,       setDisplayName]       = useState(currentUser?.username || "");
  const [supporterUsername, setSupporterUsername] = useState(currentUser ? `@${currentUser.username}` : "");
  const [gift,  setGift]    = useState("");
  const [comment, setComment] = useState("");
  const [done,  setDone]    = useState(false);
  const [error, setError]   = useState("");

  function submit() {
    if (!displayName.trim()) { setError("Your name is required."); return; }
    setError("");
    // [DB INTEGRATION] POST to your signups table here
    onSubmit({
      id: uid(), scheduleId,
      displayName: displayName.trim(),
      supporterUsername: supporterUsername.trim(),
      plannedGiftAmount: gift !== "" ? parseFloat(gift) : null,
      comment: comment.trim(),
      createdAt: new Date().toISOString(),
    });
    setDone(true);
  }

  if (done) return (
    <div className="rounded-2xl bg-emerald-500/20 border border-emerald-500/40 p-6 text-center">
      <p className="text-3xl mb-2">🎉</p>
      <p className="text-emerald-300 font-black text-lg">You're signed up!</p>
      <p className="text-white/50 text-sm mt-1">See you in the live.</p>
      <button onClick={() => setDone(false)} className="mt-3 text-white/40 text-xs underline">Sign up again</button>
    </div>
  );

  return (
    <div className="rounded-2xl p-4 space-y-3" style={{ background: "linear-gradient(145deg,#1e2340,#16192e)" }}>
      <h3 className="text-white font-black text-base">Sign Up to Support</h3>
      <p className="text-white/40 text-xs">⚠️ Gift amounts are for planning only — no payment is taken here.</p>

      {error && <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2">{error}</p>}

      <div>
        <label className={labelCls}>Your Name *</label>
        <input value={displayName} onChange={e => setDisplayName(e.target.value)}
          placeholder="How you want to appear" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Your Username (optional)</label>
        <input value={supporterUsername} onChange={e => setSupporterUsername(e.target.value)}
          placeholder="@handle" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>
          Planned Gift Amount — <span className="text-amber-400">optional, no charge</span>
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">$</span>
          <input type="number" min="0" value={gift} onChange={e => setGift(e.target.value)}
            placeholder="0.00" className={`${inputCls} pl-7`} />
        </div>
      </div>
      <div>
        <label className={labelCls}>Hype message (optional)</label>
        <textarea value={comment} onChange={e => setComment(e.target.value)}
          placeholder="Drop some hype! 🎉" rows={2} className={`${inputCls} resize-none`} />
      </div>
      <button onClick={submit}
        className="w-full bg-amber-400 hover:bg-amber-300 text-gray-900 font-black text-sm rounded-xl py-3 transition-colors">
        Sign Me Up 🙌
      </button>
    </div>
  );
}

// ─── Schedule Detail ───────────────────────────────────────────────────────────

function ScheduleDetail({ schedule, signups, currentUser, onBack, onSignup }) {
  const status    = effectiveStatus(schedule);
  const ss        = signups.filter(sg => sg.scheduleId === schedule.id);
  const totalGift = ss.reduce((sum, sg) => sum + (sg.plannedGiftAmount || 0), 0);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-white/60 hover:text-white text-sm font-semibold">
        ← Back
      </button>

      <div className="rounded-2xl p-5" style={{ background: "linear-gradient(135deg,#e67e22,#c0392b)" }}>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <Badge status={status} />
          <span className="text-white/70 text-xs">{platformIcon(schedule.platform)} {schedule.platform}</span>
        </div>
        <h2 className="text-white font-black text-2xl">@{schedule.hostUsername}</h2>
        <p className="text-white/80 text-sm mt-1">
          Every {DAYS[schedule.dayOfWeek]} · {formatTime(schedule.startTime)} – {formatTime(schedule.endTime)}
        </p>
        <p className="text-white/50 text-xs mt-0.5">Next: {nextOccurrence(schedule.dayOfWeek)}</p>
        {schedule.notes && (
          <div className="mt-3 bg-black/20 rounded-xl px-4 py-3">
            <p className="text-white/90 text-sm">{schedule.notes}</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Pill label="Supporters" value={ss.length} />
        <Pill label="Next Live" value={nextOccurrence(schedule.dayOfWeek).split(",")[0]} />
        <Pill label="🎁 Expected" value={totalGift > 0 ? `$${totalGift}` : "—"} accent={totalGift > 0} />
      </div>

      {status !== STATUS.CANCELLED && (
        <SignupForm scheduleId={schedule.id} currentUser={currentUser} onSubmit={onSignup} />
      )}

      <div className="rounded-2xl p-4" style={{ background: "linear-gradient(145deg,#1e2340,#16192e)" }}>
        <h3 className="text-white font-black text-base mb-3">Supporters ({ss.length})</h3>
        {ss.length === 0
          ? <p className="text-white/40 text-sm text-center py-4">No supporters yet — be the first! 🌟</p>
          : ss.map(sg => <SupporterRow key={sg.id} signup={sg} />)
        }
      </div>
    </div>
  );
}

// ─── My Schedule Tab ───────────────────────────────────────────────────────────

function MyScheduleTab({ currentUser, schedules, signups, onSave, onGoLive, onStatusChange }) {
  const [editing, setEditing] = useState(false);
  const mySchedule = schedules.find(s => s.userId === currentUser.id);
  const status     = mySchedule ? effectiveStatus(mySchedule) : null;

  // ── Schedule form ──
  if (editing || !mySchedule) {
    const blank = { platform:"", dayOfWeek:0, startTime:"", endTime:"", notes:"" };
    return (
      <ScheduleForm
        initial={mySchedule || null}
        defaults={blank}
        userId={currentUser.id}
        username={currentUser.username}
        onSave={s => { onSave(s); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  // ── Existing schedule view ──
  const ss        = signups.filter(sg => sg.scheduleId === mySchedule.id);
  const totalGift = ss.reduce((sum, sg) => sum + (sg.plannedGiftAmount || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-black text-xl">My Schedule</h2>
        <button onClick={() => setEditing(true)}
          className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-2 rounded-xl font-semibold transition-colors">
          ✏️ Edit
        </button>
      </div>

      <div className="rounded-2xl p-5" style={{ background: "linear-gradient(135deg,#1a1f3c,#0f1225)" }}>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <Badge status={status} />
          <span className="text-white/50 text-xs">{platformIcon(mySchedule.platform)} {mySchedule.platform}</span>
        </div>
        <p className="text-white font-black text-xl">@{currentUser.username}</p>
        <p className="text-amber-400 text-sm mt-0.5">
          Every {DAYS[mySchedule.dayOfWeek]} · {formatTime(mySchedule.startTime)} – {formatTime(mySchedule.endTime)}
        </p>
        <p className="text-white/35 text-xs mt-0.5">Next: {nextOccurrence(mySchedule.dayOfWeek)}</p>
        {mySchedule.notes && (
          <p className="text-white/60 text-xs mt-2 bg-white/5 rounded-lg px-3 py-2">{mySchedule.notes}</p>
        )}
        <div className="flex gap-2 mt-4">
          <Pill label="Supporters" value={ss.length} />
          {totalGift > 0 && <Pill label="Planned 🎁" value={`$${totalGift}`} accent />}
        </div>
      </div>

      {/* Manual live controls */}
      <div className="rounded-2xl p-4" style={{ background: "linear-gradient(145deg,#1e2340,#16192e)" }}>
        <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-2">Live Controls</p>
        <p className="text-white/35 text-xs mb-3">
          "Live Now" starts automatically during your scheduled window. Use these buttons if you go early, end early, or need to cancel this week.
        </p>
        <div className="flex flex-wrap gap-2">
          {status !== STATUS.LIVE_NOW && status !== STATUS.CANCELLED && (
            <button onClick={() => onGoLive(mySchedule.id)}
              className="text-xs bg-red-500/80 hover:bg-red-500 text-white px-4 py-2 rounded-xl font-bold transition-colors">
              🔴 Go Live Early
            </button>
          )}
          {status === STATUS.LIVE_NOW && (
            <button onClick={() => onStatusChange(mySchedule.id, STATUS.COMPLETED)}
              className="text-xs bg-emerald-600/80 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl font-bold transition-colors">
              ✓ End Live
            </button>
          )}
          {status !== STATUS.CANCELLED && (
            <button onClick={() => onStatusChange(mySchedule.id, STATUS.CANCELLED)}
              className="text-xs bg-gray-600/80 hover:bg-gray-600 text-white px-4 py-2 rounded-xl font-bold transition-colors">
              ✕ Cancel This Week
            </button>
          )}
          {mySchedule.manualStatus && (
            <button onClick={() => onStatusChange(mySchedule.id, null)}
              className="text-xs bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl font-bold transition-colors">
              ↺ Reset to Auto
            </button>
          )}
        </div>
      </div>

      {/* My supporters */}
      <div className="rounded-2xl p-4" style={{ background: "linear-gradient(145deg,#1e2340,#16192e)" }}>
        <h3 className="text-white font-black text-base mb-3">My Supporters ({ss.length})</h3>
        {ss.length === 0
          ? <p className="text-white/40 text-sm text-center py-4">No one signed up yet.</p>
          : ss.map(sg => <SupporterRow key={sg.id} signup={sg} />)
        }
      </div>
    </div>
  );
}

// ─── Schedule Form (reusable add/edit) ────────────────────────────────────────

function ScheduleForm({ initial, userId, username, onSave, onCancel }) {
  const [form, setForm] = useState({
    platform:   initial?.platform   ?? "",
    dayOfWeek:  initial?.dayOfWeek  ?? 0,
    startTime:  initial?.startTime  ?? "",
    endTime:    initial?.endTime    ?? "",
    notes:      initial?.notes      ?? "",
  });
  const [error, setError] = useState("");

  function ch(f, v) { setForm(p => ({ ...p, [f]: v })); }

  function save() {
    if (!form.platform.trim() || !form.startTime || !form.endTime) {
      setError("Platform, start time, and end time are required."); return;
    }
    setError("");
    // [DB INTEGRATION] POST (create) or PUT (update) to your schedules table
    onSave({
      ...(initial || {}),
      id:           initial?.id          || uid(),
      userId,
      hostUsername: username,
      platform:     form.platform.trim(),
      dayOfWeek:    Number(form.dayOfWeek),
      startTime:    form.startTime,
      endTime:      form.endTime,
      notes:        form.notes.trim(),
      manualStatus: initial?.manualStatus ?? null,
      createdAt:    initial?.createdAt    || new Date().toISOString(),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-black text-xl">{initial ? "Edit My Schedule" : "Set My Weekly Schedule"}</h2>
        <button onClick={onCancel} className="text-white/50 hover:text-white text-sm">Cancel</button>
      </div>

      {error && <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2">{error}</p>}

      <div className="rounded-2xl p-4 space-y-3" style={{ background: "linear-gradient(145deg,#1e2340,#16192e)" }}>
        <p className="text-white/50 text-xs">
          Your username <span className="text-amber-400 font-semibold">@{username}</span> will be shown as the host automatically. Your schedule repeats every week on the day you choose.
        </p>
        <div>
          <label className={labelCls}>Platform *</label>
          <input value={form.platform} onChange={e => ch("platform", e.target.value)}
            placeholder="TikTok, YouTube, Kick, Twitch…" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Day of Week *</label>
          <select value={form.dayOfWeek} onChange={e => ch("dayOfWeek", e.target.value)}
            className={`${inputCls} appearance-none`}>
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelCls}>Start Time *</label>
            <input type="time" value={form.startTime} onChange={e => ch("startTime", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>End Time *</label>
            <input type="time" value={form.endTime} onChange={e => ch("endTime", e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Notes / Theme (optional)</label>
          <textarea value={form.notes} onChange={e => ch("notes", e.target.value)}
            placeholder="What's the vibe every week?" rows={2} className={`${inputCls} resize-none`} />
        </div>
      </div>

      <button onClick={save}
        className="w-full bg-amber-400 hover:bg-amber-300 text-gray-900 font-black text-sm rounded-xl py-3 transition-colors">
        {initial ? "Save Changes" : "Save My Schedule 🎬"}
      </button>
    </div>
  );
}

// ─── Admin Panel ───────────────────────────────────────────────────────────────

function AdminPanel({ schedules, signups, users, onStatusChange, onGoLive }) {
  const today     = new Date();
  const weekLabel = `Week of ${today.toLocaleDateString("en-US", { month:"short", day:"numeric", year:"numeric" })}`;

  function downloadSummary() {
    const csv = buildWeeklyCSV(schedules, signups, users);
    downloadCSV(csv, `LiveSupport_${weekLabel.replace(/[\s,]/g,"_")}.csv`);
  }

  const totalHosts    = schedules.length;
  const totalSupport  = signups.length;
  const totalGiftAll  = signups.reduce((sum, sg) => sum + (sg.plannedGiftAmount || 0), 0);
  const liveNowCount  = schedules.filter(s => effectiveStatus(s) === STATUS.LIVE_NOW).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-black text-xl">Admin Panel</h2>
        <button onClick={downloadSummary}
          className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-4 py-2 rounded-xl transition-colors">
          ⬇ Weekly CSV
        </button>
      </div>

      {/* Week summary bar */}
      <div className="rounded-2xl p-4" style={{ background: "linear-gradient(145deg,#1a1f3c,#0f1225)" }}>
        <p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-3">{weekLabel}</p>
        <div className="grid grid-cols-4 gap-2">
          <Pill label="Hosts"      value={totalHosts} />
          <Pill label="Live Now"   value={liveNowCount} />
          <Pill label="Supporters" value={totalSupport} />
          <Pill label="🎁 Total"   value={totalGiftAll > 0 ? `$${totalGiftAll}` : "—"} accent={totalGiftAll > 0} />
        </div>
      </div>

      {schedules.length === 0 && (
        <p className="text-white/40 text-sm text-center py-8">No schedules registered yet.</p>
      )}

      {schedules.map(sched => {
        const ss        = signups.filter(sg => sg.scheduleId === sched.id);
        const totalGift = ss.reduce((sum, sg) => sum + (sg.plannedGiftAmount || 0), 0);
        const status    = effectiveStatus(sched);

        return (
          <div key={sched.id} className="rounded-2xl p-4" style={{ background: "linear-gradient(145deg,#1e2340,#16192e)" }}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <Badge status={status} />
                  <span className="text-white/40 text-xs">{platformIcon(sched.platform)} {sched.platform}</span>
                </div>
                <p className="text-white font-black text-sm">@{sched.hostUsername}</p>
                <p className="text-white/40 text-xs">
                  {DAYS[sched.dayOfWeek]} · {formatTime(sched.startTime)} – {formatTime(sched.endTime)}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-amber-400 font-black text-xl leading-none">{ss.length}</p>
                <p className="text-white/40 text-xs">supporters</p>
                {totalGift > 0 && <p className="text-emerald-400 text-xs font-semibold">${totalGift} est.</p>}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              {status !== STATUS.LIVE_NOW && status !== STATUS.CANCELLED && (
                <button onClick={() => onGoLive(sched.id)}
                  className="text-xs bg-red-500/80 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors">
                  🔴 Go Live
                </button>
              )}
              {status !== STATUS.COMPLETED && status !== STATUS.CANCELLED && (
                <button onClick={() => onStatusChange(sched.id, STATUS.COMPLETED)}
                  className="text-xs bg-emerald-600/80 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors">
                  ✓ Complete
                </button>
              )}
              {status !== STATUS.CANCELLED && (
                <button onClick={() => onStatusChange(sched.id, STATUS.CANCELLED)}
                  className="text-xs bg-gray-600/80 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors">
                  ✕ Cancel
                </button>
              )}
              {sched.manualStatus && (
                <button onClick={() => onStatusChange(sched.id, null)}
                  className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors">
                  ↺ Reset
                </button>
              )}
            </div>

            {/* Inline supporter list */}
            {ss.length > 0 && (
              <div className="mt-3 border-t border-white/10 pt-3 space-y-1.5">
                {ss.map(sg => (
                  <div key={sg.id} className="flex items-center gap-2 text-xs">
                    <span className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-400 to-rose-500 flex items-center justify-center text-white font-black flex-shrink-0">
                      {sg.displayName[0].toUpperCase()}
                    </span>
                    <span className="text-white font-semibold">{sg.displayName}</span>
                    {sg.supporterUsername && <span className="text-white/40">{sg.supporterUsername}</span>}
                    {sg.plannedGiftAmount != null && (
                      <span className="text-amber-300 font-semibold ml-auto">${sg.plannedGiftAmount}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── App Root ──────────────────────────────────────────────────────────────────

const VIEWS = { DASHBOARD:"dashboard", DETAIL:"detail", MY:"my", ADMIN:"admin" };

export default function App() {
  // [DB INTEGRATION] Replace useState with useEffect + API/Supabase fetches on mount.
  const [users,     setUsers]     = useState(SEED_USERS);
  const [schedules, setSchedules] = useState(SEED_SCHEDULES);
  const [signups,   setSignups]   = useState(SEED_SIGNUPS);
  const [currentUser, setCurrentUser] = useState(null);
  const [view,      setView]      = useState(VIEWS.DASHBOARD);
  const [activeId,  setActiveId]  = useState(null);

  // Re-render every 30s so auto-live status stays fresh
  // [DB INTEGRATION] With Supabase Realtime you can replace this with a subscription
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const activeSchedule = schedules.find(s => s.id === activeId);

  // Sort: Live Now first, then by proximity of day-of-week
  const sortedSchedules = useMemo(() => {
    const today = new Date().getDay();
    const order = { [STATUS.LIVE_NOW]:0, [STATUS.UPCOMING]:1, [STATUS.COMPLETED]:2, [STATUS.CANCELLED]:3 };
    return [...schedules].sort((a, b) => {
      const oa = order[effectiveStatus(a)], ob = order[effectiveStatus(b)];
      if (oa !== ob) return oa - ob;
      return ((a.dayOfWeek - today + 7) % 7) - ((b.dayOfWeek - today + 7) % 7);
    });
  }, [schedules, tick]);

  // ── Auth handlers ──
  function handleLogin(user)   { setCurrentUser(user); }
  function handleLogout()      { setCurrentUser(null); setView(VIEWS.DASHBOARD); }
  function handleRegister(u)   {
    // [DB INTEGRATION] After inserting user in DB, call setCurrentUser with returned user object
    setUsers(p => [...p, u]);
    setCurrentUser(u);
  }

  // ── Data handlers ──
  function handleSaveSchedule(s) {
    setSchedules(prev => prev.find(x => x.id === s.id) ? prev.map(x => x.id === s.id ? s : x) : [s, ...prev]);
  }
  function handleGoLive(id) {
    // [DB INTEGRATION] PATCH manualStatus = 'Live Now' in your DB
    setSchedules(prev => prev.map(s => s.id === id ? { ...s, manualStatus: STATUS.LIVE_NOW } : s));
  }
  function handleStatusChange(id, newStatus) {
    // [DB INTEGRATION] PATCH manualStatus in your DB (null = back to auto)
    setSchedules(prev => prev.map(s => s.id === id ? { ...s, manualStatus: newStatus } : s));
  }
  function handleSignup(data) {
    // [DB INTEGRATION] POST to signups table
    setSignups(prev => [data, ...prev]);
  }

  if (!currentUser) return (
    <>
      <GlobalStyles />
      <AuthScreen users={users} onLogin={handleLogin} onRegister={handleRegister} />
    </>
  );

  const navItems = [
    { key: VIEWS.DASHBOARD, icon: "🏠", label: "Lives" },
    { key: VIEWS.MY,        icon: "📅", label: "My Schedule" },
    ...(currentUser.isAdmin ? [{ key: VIEWS.ADMIN, icon: "⚙️", label: "Admin" }] : []),
  ];

  const liveNow = sortedSchedules.filter(s => effectiveStatus(s) === STATUS.LIVE_NOW).length;

  return (
    <>
      <GlobalStyles />
      <div className="min-h-screen text-white" style={{ background:"linear-gradient(180deg,#0d0f1c,#0a0c18)", fontFamily:"'DM Sans','Segoe UI',sans-serif" }}>

        {/* Header */}
        <header className="sticky top-0 z-40 backdrop-blur-lg" style={{ background:"rgba(10,12,24,0.93)", borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
          <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">📡</span>
              <span className="font-black text-white text-sm tracking-tight">
                LiveSupport <span className="text-amber-400">Scheduler</span>
              </span>
              {liveNow > 0 && (
                <span className="bg-red-500 text-white text-xs font-black px-2 py-0.5 rounded-full" style={{ animation:"livePulse 1.2s ease-in-out infinite" }}>
                  {liveNow} LIVE
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-white/40 text-xs hidden sm:block">@{currentUser.username}</span>
              <button onClick={handleLogout} className="text-white/40 hover:text-white/80 text-xs font-semibold transition-colors">Sign out</button>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="max-w-lg mx-auto px-4 py-5 pb-28">

          {view === VIEWS.DASHBOARD && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h1 className="text-white font-black text-2xl">This Week's Lives</h1>
              </div>
              {sortedSchedules.length === 0
                ? (
                  <div className="text-center py-16">
                    <p className="text-4xl mb-3">📭</p>
                    <p className="text-white/40 font-semibold">No schedules yet.</p>
                    <button onClick={() => setView(VIEWS.MY)} className="mt-3 text-amber-400 text-sm underline">
                      Add yours
                    </button>
                  </div>
                )
                : sortedSchedules.map(s => (
                    <ScheduleCard key={s.id + tick} schedule={s} signups={signups}
                      onView={id => { setActiveId(id); setView(VIEWS.DETAIL); }}
                      isOwner={s.userId === currentUser.id}
                      onGoLive={handleGoLive}
                    />
                  ))
              }
            </div>
          )}

          {view === VIEWS.DETAIL && activeSchedule && (
            <ScheduleDetail
              schedule={activeSchedule}
              signups={signups}
              currentUser={currentUser}
              onBack={() => { setView(VIEWS.DASHBOARD); setActiveId(null); }}
              onSignup={handleSignup}
            />
          )}

          {view === VIEWS.MY && (
            <MyScheduleTab
              currentUser={currentUser}
              schedules={schedules}
              signups={signups}
              onSave={handleSaveSchedule}
              onGoLive={handleGoLive}
              onStatusChange={handleStatusChange}
            />
          )}

          {view === VIEWS.ADMIN && currentUser.isAdmin && (
            <AdminPanel
              schedules={sortedSchedules}
              signups={signups}
              users={users}
              onStatusChange={handleStatusChange}
              onGoLive={handleGoLive}
            />
          )}

        </main>

        {/* Bottom nav */}
        <nav className="fixed bottom-0 left-0 right-0 z-40" style={{ background:"rgba(10,12,24,0.97)", borderTop:"1px solid rgba(255,255,255,0.07)" }}>
          <div className="max-w-lg mx-auto flex">
            {navItems.map(item => (
              <button key={item.key} onClick={() => setView(item.key)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-3 text-xs font-bold transition-colors ${view === item.key ? "text-amber-400" : "text-white/35 hover:text-white/60"}`}>
                <span className="text-base leading-none">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <p className="text-center text-white/15 text-xs pb-2 px-4">
            ⚠️ No payments processed — gift amounts are for planning only
          </p>
        </nav>

      </div>
    </>
  );
}

// ─── Global Styles ─────────────────────────────────────────────────────────────

function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700;9..40,900&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin: 0; }
      input[type="date"]::-webkit-calendar-picker-indicator,
      input[type="time"]::-webkit-calendar-picker-indicator { filter: invert(0.5); }
      select option { background: #16192e; color: white; }
      .line-clamp-2 { display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden; }
      @keyframes livePulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.45;transform:scale(1.35)} }
      ::-webkit-scrollbar { width:4px; height:4px; }
      ::-webkit-scrollbar-thumb { background:rgba(255,255,255,.12); border-radius:4px; }
    `}</style>
  );
}
