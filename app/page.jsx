"use client";
import { useState, useMemo, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * Live Support Scheduler — v3
 * Now with multi-community support.
 *
 * Data model additions:
 *   Community: { id, name, inviteCode, leaderId, createdAt }
 *   User.communityIds: string[]  — communities the user belongs to
 *   Schedule.communityId: string — which community this schedule belongs to
 *
 * [DB INTEGRATION] tags mark every spot to swap in Supabase / Firebase / Auth calls.
 */


// ─── Constants ─────────────────────────────────────────────────────────────────

const STATUS = {
  UPCOMING:  "Upcoming",
  LIVE_NOW:  "Live Now",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const LOOK_AHEAD_DAYS = 7;  // ALL filter shows 7 days
const WEEKS_OUT       = 2;

// ─── Utilities ─────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

function formatTime(t) {
  if (!t) return "";
  const [h, m] = t.split(":");
  const hour = parseInt(h);
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
}

function formatDate(d) {
  return d.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" });
}

function formatDays(daysOfWeek) {
  if (!daysOfWeek?.length) return "—";
  return [...daysOfWeek].sort((a,b)=>a-b).map(d => DAYS[d].slice(0,3)).join(", ");
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

function isLiveRightNow(schedule) {
  const now  = new Date();
  const days = schedule.daysOfWeek ?? (schedule.dayOfWeek != null ? [schedule.dayOfWeek] : []);
  if (!days.includes(now.getDay())) return false;
  const [sh, sm] = schedule.startTime.split(":").map(Number);
  const [eh, em] = schedule.endTime.split(":").map(Number);
  const nowMins  = now.getHours() * 60 + now.getMinutes();
  return nowMins >= sh * 60 + sm && nowMins < eh * 60 + em;
}

function effectiveStatus(schedule, occurrenceId = null) {
  if (occurrenceId && schedule.cancelledOccurrenceIds?.includes(occurrenceId)) return STATUS.CANCELLED;
  if (schedule.manualStatus === STATUS.CANCELLED) return STATUS.CANCELLED;
  if (schedule.manualStatus === STATUS.LIVE_NOW)  return STATUS.LIVE_NOW;
  if (schedule.manualStatus === STATUS.COMPLETED) return STATUS.COMPLETED;
  if (isLiveRightNow(schedule)) return STATUS.LIVE_NOW;
  return STATUS.UPCOMING;
}

function expandOccurrences(schedule) {
  const days = schedule.daysOfWeek ?? (schedule.dayOfWeek != null ? [schedule.dayOfWeek] : []);
  const now  = new Date();
  const list = [];
  const [sh, sm] = schedule.startTime.split(":").map(Number);
  const [eh, em] = schedule.endTime.split(":").map(Number);
  const startMins = sh * 60 + sm;
  // Handle overnight lives (e.g. 11pm-1am): end is next day
  const overnight = (eh * 60 + em) < startMins;
  const endMins   = overnight ? (eh * 60 + em) + 1440 : (eh * 60 + em);

  for (let w = 0; w < WEEKS_OUT; w++) {
    for (const dow of days) {
      const base = new Date(now);
      base.setDate(now.getDate() + (dow - now.getDay() + 7) % 7 + w * 7);
      base.setHours(0, 0, 0, 0);
      const dateStr  = base.toISOString().slice(0, 10);
      const nowMins  = now.getHours() * 60 + now.getMinutes();
      const isToday  = base.toDateString() === now.toDateString();

      // For overnight lives, also check if we are currently in the window
      // that started yesterday (previous day's live still going)
      const isLive   = isToday && nowMins >= startMins && nowMins < endMins;

      // isPast: for overnight, not past until endMins (which may exceed 1440 conceptually)
      // Simple check: today and current time is past the end
      const isPast   = isToday && !isLive && nowMins >= (overnight ? endMins - 1440 : endMins) && nowMins >= startMins;

      if (isPast && !isLive) continue;
      // Calculate daysAway by comparing calendar dates, not timestamps
      // This avoids rounding issues caused by time-of-day differences
      const nowMidnight = new Date(now); nowMidnight.setHours(0,0,0,0);
      const daysAway = Math.round((base - nowMidnight) / 86400000);
      if (w === 0 && daysAway > LOOK_AHEAD_DAYS && !isLive) continue;
      let status = STATUS.UPCOMING;
      if (schedule.manualStatus === STATUS.CANCELLED) status = STATUS.CANCELLED;
      else if (schedule.manualStatus === STATUS.COMPLETED && isToday) status = STATUS.COMPLETED;
      else if (isLive || (schedule.manualStatus === STATUS.LIVE_NOW && isToday)) status = STATUS.LIVE_NOW;
      list.push({ occurrenceId:`${schedule.id}__${dateStr}`, scheduleId:schedule.id, schedule, date:dateStr, dateObj:new Date(base), daysAway, status, isLive });
    }
  }
  const seen = new Set();
  return list.filter(o => { if (seen.has(o.occurrenceId)) return false; seen.add(o.occurrenceId); return true; })
             .sort((a,b) => a.dateObj - b.dateObj);
}

function buildCSV(schedules, signups) {
  const rows = [["Host","Platform","Days","Start","End","Status","Supporters","Planned Gifts ($)"]];
  for (const s of schedules) {
    const ss = signups.filter(sg => sg.scheduleId === s.id);
    const tot = ss.reduce((sum, sg) => sum + (sg.plannedGiftAmount || 0), 0);
    rows.push(["@"+s.hostUsername, s.platform, formatDays(s.daysOfWeek ?? [s.dayOfWeek]), formatTime(s.startTime), formatTime(s.endTime), effectiveStatus(s), ss.length, tot.toFixed(2)]);
    if (ss.length) {
      rows.push(["  Supporter","Username","Gift ($)","Comment","","","",""]);
      ss.forEach(sg => rows.push(["  "+sg.displayName, sg.supporterUsername||"", sg.plannedGiftAmount!=null?sg.plannedGiftAmount.toFixed(2):"", sg.comment||"","","","",""]));
    }
  }
  return rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
}

function downloadCSV(content, filename) {
  const blob = new Blob([content], { type:"text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Seed Data ─────────────────────────────────────────────────────────────────
// [DB INTEGRATION] Replace all SEED_* with useEffect + Supabase/Firebase fetches on mount.

const SEED_COMMUNITIES = [
  { id: "c1", name: "DOOMSQUAD",    inviteCode: "DOOM2024",   leaderId: "u0", createdAt: new Date().toISOString() },
  { id: "c2", name: "ASHLEYBESTIE", inviteCode: "ASHLEY2024", leaderId: "u4", createdAt: new Date().toISOString() },
];

// communityIds = list of community IDs the user belongs to
const SEED_USERS = [
  { id: "u0", username: "DoomLeader",   password: "doom123",    communityIds: ["c1"],       hasPaid: true,  paidAt: new Date().toISOString() },
  { id: "u1", username: "StarryNight",  password: "pass1",      communityIds: ["c1"],       hasPaid: true,  paidAt: new Date().toISOString() },
  { id: "u2", username: "CosmicQueen",  password: "pass2",      communityIds: ["c1", "c2"], hasPaid: true,  paidAt: new Date().toISOString() },
  { id: "u3", username: "PixelVibes",   password: "pass3",      communityIds: ["c1"],       hasPaid: false, paidAt: null },
  { id: "u4", username: "AshleyLeader", password: "ashley123",  communityIds: ["c2"],       hasPaid: true,  paidAt: new Date().toISOString() },
  { id: "u5", username: "GlitterGirl",  password: "glitter1",   communityIds: ["c2"],       hasPaid: false, paidAt: null },
];

// schedules now have a communityId
const SEED_SCHEDULES = [
  { id:"sc1", userId:"u1", hostUsername:"StarryNight",  communityId:"c1", platform:"TikTok",   daysOfWeek:[0,3], startTime:"18:00", endTime:"20:00", notes:"Chill hangout 🎶", manualStatus:null, createdAt:new Date().toISOString() },
  { id:"sc2", userId:"u2", hostUsername:"CosmicQueen",  communityId:"c1", platform:"Kick",     daysOfWeek:[5],   startTime:"21:00", endTime:"23:30", notes:"Milestone Fridays 🎁", manualStatus:null, createdAt:new Date().toISOString() },
  { id:"sc3", userId:"u3", hostUsername:"PixelVibes",   communityId:"c1", platform:"YouTube",  daysOfWeek:[2,4], startTime:"19:00", endTime:"21:00", notes:"Pixel art runs 🎮", manualStatus:null, createdAt:new Date().toISOString() },
  { id:"sc4", userId:"u2", hostUsername:"CosmicQueen",  communityId:"c2", platform:"TikTok",   daysOfWeek:[1,4], startTime:"20:00", endTime:"22:00", notes:"Ashley crew lives 💕", manualStatus:null, createdAt:new Date().toISOString() },
  { id:"sc5", userId:"u5", hostUsername:"GlitterGirl",  communityId:"c2", platform:"Instagram",daysOfWeek:[6],   startTime:"17:00", endTime:"19:00", notes:"Weekend glitter stream ✨", manualStatus:null, createdAt:new Date().toISOString() },
];

const SEED_SIGNUPS = [
  { id:"sg1", occurrenceId:"sc1__demo", scheduleId:"sc1", displayName:"MoonlitRose",  supporterUsername:"@moonlit_rose", plannedGiftAmount:25,   comment:"Always here! 🌹", createdAt:new Date().toISOString() },
  { id:"sg2", occurrenceId:"sc1__demo", scheduleId:"sc1", displayName:"TechVibes",    supporterUsername:"",              plannedGiftAmount:null, comment:"",               createdAt:new Date().toISOString() },
  { id:"sg3", occurrenceId:"sc2__demo", scheduleId:"sc2", displayName:"GalaxyGifter", supporterUsername:"@galaxy99",     plannedGiftAmount:50,   comment:"Let's go!! 🚀",  createdAt:new Date().toISOString() },
];

// ─── Shared UI Atoms ───────────────────────────────────────────────────────────

// font-size kept at base (16px equiv) to prevent iOS auto-zoom on focus
const inputCls = "w-full bg-white/10 text-white placeholder-white/30 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-amber-400";
const inputStyle = { fontSize:"16px", minWidth:0, width:"100%", boxSizing:"border-box" };
const labelCls = "text-white/70 text-xs font-semibold block mb-1";
// Fully inline versions used wherever Tailwind is unreliable
const IS = {
  input:    {width:"100%",background:"rgba(255,255,255,0.1)",border:"none",borderRadius:"12px",padding:"13px 16px",fontSize:"16px",color:"#fff",outline:"none",boxSizing:"border-box",display:"block",fontFamily:"inherit"},
  textarea: {width:"100%",background:"rgba(255,255,255,0.1)",border:"none",borderRadius:"12px",padding:"13px 16px",fontSize:"16px",color:"#fff",outline:"none",boxSizing:"border-box",display:"block",fontFamily:"inherit",resize:"none"},
  label:    {color:"rgba(255,255,255,0.6)",fontSize:"12px",fontWeight:700,display:"block",marginBottom:"6px"},
  card:     {background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"20px",padding:"20px",display:"flex",flexDirection:"column",gap:"14px",marginBottom:"12px"},
  cardFlat: {background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"16px",padding:"14px",marginBottom:"10px"},
  btn:      {width:"100%",background:"#fbbf24",color:"#1c1400",fontWeight:900,fontSize:"15px",border:"none",borderRadius:"14px",padding:"14px",cursor:"pointer",fontFamily:"inherit"},
  btnGhost: {background:"rgba(255,255,255,0.1)",color:"#fff",fontWeight:700,fontSize:"12px",border:"none",borderRadius:"10px",padding:"9px 14px",cursor:"pointer",fontFamily:"inherit"},
  btnDanger:{background:"rgba(239,68,68,0.2)",color:"#f87171",fontWeight:700,fontSize:"12px",border:"none",borderRadius:"10px",padding:"9px 14px",cursor:"pointer",fontFamily:"inherit"},
  pill:     {display:"inline-flex",alignItems:"center",gap:"4px",fontSize:"10px",fontWeight:700,padding:"3px 8px",borderRadius:"20px"},
  row:      {display:"flex",alignItems:"flex-start",gap:"10px",paddingTop:"10px",paddingBottom:"10px",borderBottom:"1px solid rgba(255,255,255,0.08)"},
};

function Badge({ status }) {
  const bg = status===STATUS.LIVE_NOW?"#ef4444":status===STATUS.UPCOMING?"#fbbf24":status===STATUS.COMPLETED?"#059669":"#6b7280";
  const fg = status===STATUS.UPCOMING?"#1c1400":"#fff";
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:"4px",fontSize:"10px",fontWeight:700,padding:"3px 8px",borderRadius:"20px",background:bg,color:fg}}>
      {status === STATUS.LIVE_NOW && <span style={{width:5,height:5,borderRadius:"50%",background:"#fff",display:"inline-block",animation:"livePulse 1.2s ease-in-out infinite"}}/>}
      {status}
    </span>
  );
}

function Pill({ label, value, accent }) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",borderRadius:"12px",padding:"8px 10px",background:accent?"#fbbf24":"rgba(255,255,255,0.1)"}}>
      <span style={{fontSize:"15px",fontWeight:900,lineHeight:1,color:accent?"#1c1400":"#fff"}}>{value}</span>
      <span style={{fontSize:"10px",fontWeight:500,marginTop:"3px",color:accent?"rgba(28,20,0,0.65)":"rgba(255,255,255,0.6)"}}>{label}</span>
    </div>
  );
}

function SupporterRow({ signup }) {
  return (
    <div style={{display:"flex",alignItems:"flex-start",gap:"10px",padding:"10px 0",borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
      <div style={{width:"34px",height:"34px",borderRadius:"50%",background:"linear-gradient(135deg,#fbbf24,#f43f5e)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:900,fontSize:"13px",flexShrink:0}}>
        {signup.displayName[0].toUpperCase()}
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
          <span style={{fontWeight:700,color:"#fff",fontSize:"13px"}}>{signup.displayName}</span>
          {signup.supporterUsername && <span style={{color:"rgba(255,255,255,0.4)",fontSize:"11px"}}>{signup.supporterUsername}</span>}
        </div>
        {signup.plannedGiftAmount != null && <p style={{color:"#fcd34d",fontSize:"11px",fontWeight:700,margin:"2px 0 0"}}>🎁 Plans to gift ${signup.plannedGiftAmount}</p>}
        {signup.comment && <p style={{color:"rgba(255,255,255,0.5)",fontSize:"11px",margin:"2px 0 0",fontStyle:"italic"}}>"{signup.comment}"</p>}
      </div>
    </div>
  );
}

// ─── Auth Screen ───────────────────────────────────────────────────────────────

function AuthScreen({ onLogin, onRegister }) {
  const [tab, setTab] = useState("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError("");

    if (!email.trim() || !password.trim()) {
      setError("Email and password are required.");
      return;
    }

    if (tab === "register" && !username.trim()) {
      setError("Username is required.");
      return;
    }

    setLoading(true);

    const result = tab === "login"
      ? await onLogin({ email: email.trim(), password })
      : await onRegister({ email: email.trim(), username: username.trim(), password });

    if (result?.error) setError(result.error);

    setLoading(false);
  }

  const fieldStyle = {
    width: "100%",
    background: "rgba(255,255,255,0.09)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: "14px",
    padding: "14px 15px",
    fontSize: "16px",
    color: "#fff",
    outline: "none",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };

  const labelStyle = {
    color: "rgba(255,255,255,0.62)",
    fontSize: "12px",
    fontWeight: 800,
    display: "block",
    marginBottom: "7px",
    letterSpacing: "0.2px",
  };

  return (
    <div style={{
      minHeight: "100vh",
      width: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "28px 18px",
      boxSizing: "border-box",
      background: "radial-gradient(circle at top left, rgba(251,191,36,0.18), transparent 34%), radial-gradient(circle at bottom right, rgba(59,130,246,0.18), transparent 32%), linear-gradient(180deg,#070914,#101327)",
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{position:"absolute",inset:0,background:"linear-gradient(135deg,rgba(255,255,255,0.04) 0,transparent 38%,rgba(255,255,255,0.03) 100%)",pointerEvents:"none"}} />
      <div style={{position:"absolute",top:"12%",left:"12%",width:"170px",height:"170px",borderRadius:"999px",background:"rgba(251,191,36,0.08)",filter:"blur(35px)",pointerEvents:"none"}} />
      <div style={{position:"absolute",bottom:"12%",right:"10%",width:"220px",height:"220px",borderRadius:"999px",background:"rgba(96,165,250,0.10)",filter:"blur(45px)",pointerEvents:"none"}} />

      <div style={{width:"100%",maxWidth:"430px",position:"relative",zIndex:1}}>
        <div style={{textAlign:"center",marginBottom:"22px"}}>
          <div style={{
            width:"86px",
            height:"86px",
            margin:"0 auto 14px",
            borderRadius:"28px",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
            background:"linear-gradient(145deg,rgba(251,191,36,0.22),rgba(255,255,255,0.07))",
            border:"1px solid rgba(251,191,36,0.28)",
            boxShadow:"0 20px 45px rgba(0,0,0,0.35)",
          }}>
            <span style={{fontSize:"44px",lineHeight:1}}>📡</span>
          </div>

          <h1 style={{color:"#fff",fontWeight:950,fontSize:"30px",lineHeight:1.05,margin:"0 0 8px"}}>
            LiveSupport <span style={{color:"#fbbf24"}}>Scheduler</span>
          </h1>
          <p style={{color:"rgba(255,255,255,0.52)",fontSize:"14px",lineHeight:1.45,margin:"0 auto",maxWidth:"330px"}}>
            Organize live times, supporters, and planned gifts in one clean weekly view.
          </p>
        </div>

        <div style={{
          background:"linear-gradient(145deg,rgba(30,35,64,0.96),rgba(15,18,37,0.96))",
          border:"1px solid rgba(255,255,255,0.09)",
          borderRadius:"28px",
          padding:"18px",
          boxShadow:"0 28px 70px rgba(0,0,0,0.46)",
          backdropFilter:"blur(14px)",
        }}>
          <div style={{display:"flex",background:"rgba(255,255,255,0.08)",borderRadius:"18px",padding:"5px",marginBottom:"18px"}}>
            <button onClick={() => { setTab("login"); setError(""); }}
              style={{flex:1,padding:"12px 0",borderRadius:"14px",fontSize:"14px",fontWeight:900,border:"none",cursor:"pointer",transition:"all .2s ease",background:tab==="login"?"#fbbf24":"transparent",color:tab==="login"?"#1c1400":"rgba(255,255,255,0.62)",fontFamily:"inherit"}}>
              Sign In
            </button>
            <button onClick={() => { setTab("register"); setError(""); }}
              style={{flex:1,padding:"12px 0",borderRadius:"14px",fontSize:"14px",fontWeight:900,border:"none",cursor:"pointer",transition:"all .2s ease",background:tab==="register"?"#fbbf24":"transparent",color:tab==="register"?"#1c1400":"rgba(255,255,255,0.62)",fontFamily:"inherit"}}>
              Create Account
            </button>
          </div>

          {error && (
            <p style={{color:"#fecaca",fontSize:"13px",background:"rgba(239,68,68,0.14)",border:"1px solid rgba(248,113,113,0.24)",borderRadius:"14px",padding:"10px 12px",margin:"0 0 14px"}}>
              {error}
            </p>
          )}

          <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={fieldStyle}
                onKeyDown={e => e.key === "Enter" && submit()}
              />
            </div>

            {tab === "register" && (
              <div>
                <label style={labelStyle}>Username</label>
                <input
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="your_username"
                  style={fieldStyle}
                  onKeyDown={e => e.key === "Enter" && submit()}
                />
              </div>
            )}

            <div>
              <label style={labelStyle}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                style={fieldStyle}
                onKeyDown={e => e.key === "Enter" && submit()}
              />
            </div>

            <button
              onClick={submit}
              disabled={loading}
              style={{
                width:"100%",
                background:"linear-gradient(135deg,#fbbf24,#f59e0b)",
                color:"#1c1400",
                fontWeight:950,
                fontSize:"15px",
                border:"none",
                borderRadius:"16px",
                padding:"15px",
                cursor:"pointer",
                opacity:loading?0.72:1,
                boxShadow:"0 14px 30px rgba(251,191,36,0.22)",
                fontFamily:"inherit",
              }}
            >
              {loading ? "Please wait..." : tab === "login" ? "Sign In" : "Create Account"}
            </button>
          </div>
        </div>

        <p style={{color:"rgba(255,255,255,0.34)",fontSize:"11px",textAlign:"center",margin:"16px 0 0"}}>
          No payments processed inside supporter planning. Gift amounts are for coordination only.
        </p>
      </div>
    </div>
  );
}

// ─── Post-Register Screen ─────────────────────────────────────────────────────
// Shown immediately after account creation so the user can join or create a community.

function PostRegisterScreen({ newUser, communities, onCreateCommunity, onJoinCommunity, onSkip }) {
  const [step,          setStep]          = useState("choice"); // "choice" | "create" | "join"
  const [communityName, setCommunityName] = useState("");
  const [inviteCode,    setInviteCode]    = useState("");
  const [createdCode,   setCreatedCode]   = useState(null);  // shown after creation
  const [error,         setError]         = useState("");
  const [copied,        setCopied]        = useState(false);

  function handleCreate() {
    if (!communityName.trim()) { setError("Community name is required."); return; }
    // Generate a short memorable invite code
    // [DB INTEGRATION] supabase.from('communities').insert({ name, invite_code, leader_id: user.id })
    const code = communityName.trim().toUpperCase().replace(/\s+/g,"").slice(0,6) +
                 Math.random().toString(36).slice(2,5).toUpperCase();
    const community = {
      id:         uid(),
      name:       communityName.trim().toUpperCase(),
      inviteCode: code,
      leaderId:   newUser.id,
      createdAt:  new Date().toISOString(),
    };
    setCreatedCode(code);
    onCreateCommunity(community);
  }

  async function handleJoin() {
    if (!inviteCode.trim()) { setError("Please enter an invite code."); return; }
    setError("");
    const ok = await onJoinCommunity(inviteCode.trim());
    if (!ok) { setError("Invalid invite code. Double-check and try again."); return; }
  }

  function copyCode() {
    navigator.clipboard.writeText(createdCode).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  // ── Created successfully ──
  if (createdCode) return (
    <div style={{minHeight:"100vh",width:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 20px",background:"linear-gradient(180deg,#0d0f1c,#0a0c18)",boxSizing:"border-box"}}>
      <div style={{width:"100%",maxWidth:"420px",boxSizing:"border-box",textAlign:"center"}}>
        <p style={{fontSize:"44px",marginBottom:"12px"}}>🎉</p>
        <h2 style={{color:"#fff",fontWeight:900,fontSize:"22px",margin:"0 0 6px"}}>Community Created!</h2>
        <p style={{color:"rgba(255,255,255,0.5)",fontSize:"14px",margin:"0 0 20px"}}>Share this invite code with your members so they can join.</p>
        <div style={{background:"linear-gradient(145deg,#1e2340,#16192e)",border:"1px solid rgba(251,191,36,0.3)",borderRadius:"20px",padding:"24px",marginBottom:"16px"}}>
          <p style={{color:"rgba(255,255,255,0.5)",fontSize:"11px",fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",margin:"0 0 8px"}}>Invite Code</p>
          <p style={{color:"#fbbf24",fontWeight:900,fontSize:"40px",letterSpacing:"4px",margin:"0 0 16px"}}>{createdCode}</p>
          <button onClick={copyCode}
            style={{width:"100%",fontWeight:700,fontSize:"14px",borderRadius:"12px",padding:"11px",border:"none",cursor:"pointer",
              background:copied?"#10b981":"rgba(255,255,255,0.1)",color:copied?"#fff":"#fff"}}>
            {copied ? "✓ Copied!" : "Copy Code"}
          </button>
        </div>
        <p style={{color:"rgba(255,255,255,0.3)",fontSize:"12px",margin:"0 0 20px"}}>You can always find this code in your Admin panel later.</p>
        <button onClick={onSkip} style={{width:"100%",background:"#fbbf24",color:"#1c1400",fontWeight:900,fontSize:"15px",border:"none",borderRadius:"14px",padding:"14px",cursor:"pointer",boxSizing:"border-box"}}>
          Go to Dashboard 🚀
        </button>
      </div>
    </div>
  );


  // ── Join flow ──
  if (step === "join") return (
    <div style={{minHeight:"100vh",width:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 20px",background:"linear-gradient(180deg,#0d0f1c,#0a0c18)",boxSizing:"border-box"}}>
      <div style={{width:"100%",maxWidth:"420px",boxSizing:"border-box"}}>
        <button onClick={() => { setStep("choice"); setError(""); }} style={{background:"none",border:"none",color:"rgba(255,255,255,0.5)",fontSize:"13px",fontWeight:700,cursor:"pointer",padding:"0 0 20px",display:"flex",alignItems:"center",gap:"4px"}}>← Back</button>
        <h2 style={{color:"#fff",fontWeight:900,fontSize:"22px",margin:"0 0 6px"}}>Join a Community</h2>
        <p style={{color:"rgba(255,255,255,0.4)",fontSize:"14px",margin:"0 0 20px"}}>Ask your community leader for their invite code.</p>
        <div style={{background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"20px",padding:"20px",display:"flex",flexDirection:"column",gap:"14px"}}>
          {error && <p style={{color:"#f87171",fontSize:"12px",background:"rgba(239,68,68,0.1)",borderRadius:"10px",padding:"8px 12px",margin:0}}>{error}</p>}
          <div>
            <label style={{color:"rgba(255,255,255,0.6)",fontSize:"12px",fontWeight:700,display:"block",marginBottom:"6px"}}>Invite Code</label>
            <input value={inviteCode} onChange={e=>setInviteCode(e.target.value)} placeholder="e.g. DOOM2024"
              style={{width:"100%",background:"rgba(255,255,255,0.1)",border:"none",borderRadius:"12px",padding:"14px 16px",fontSize:"16px",color:"#fff",outline:"none",boxSizing:"border-box",textTransform:"uppercase",fontFamily:"inherit"}}
              onKeyDown={e=>e.key==="Enter"&&handleJoin()} />
          </div>
          <button onClick={handleJoin} style={{width:"100%",background:"#fbbf24",color:"#1c1400",fontWeight:900,fontSize:"15px",border:"none",borderRadius:"14px",padding:"14px",cursor:"pointer"}}>
            Join Community 🙌
          </button>
        </div>
        <button onClick={onSkip} style={{width:"100%",background:"none",border:"none",color:"rgba(255,255,255,0.3)",fontSize:"12px",fontWeight:700,padding:"14px",cursor:"pointer",marginTop:"4px"}}>
          Skip for now
        </button>
      </div>
    </div>
  );

  // ── Create flow ──
  if (step === "create") return (
    <div style={{minHeight:"100vh",width:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 20px",background:"linear-gradient(180deg,#0d0f1c,#0a0c18)",boxSizing:"border-box"}}>
      <div style={{width:"100%",maxWidth:"420px",boxSizing:"border-box"}}>
        <button onClick={() => { setStep("choice"); setError(""); }} style={{background:"none",border:"none",color:"rgba(255,255,255,0.5)",fontSize:"13px",fontWeight:700,cursor:"pointer",padding:"0 0 20px",display:"flex",alignItems:"center",gap:"4px"}}>← Back</button>
        <h2 style={{color:"#fff",fontWeight:900,fontSize:"22px",margin:"0 0 6px"}}>Create a Community</h2>
        <p style={{color:"rgba(255,255,255,0.4)",fontSize:"14px",margin:"0 0 20px"}}>You'll be the leader. An invite code is generated automatically.</p>
        <div style={{background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"20px",padding:"20px",display:"flex",flexDirection:"column",gap:"14px"}}>
          {error && <p style={{color:"#f87171",fontSize:"12px",background:"rgba(239,68,68,0.1)",borderRadius:"10px",padding:"8px 12px",margin:0}}>{error}</p>}
          <div>
            <label style={{color:"rgba(255,255,255,0.6)",fontSize:"12px",fontWeight:700,display:"block",marginBottom:"6px"}}>Community Name</label>
            <input value={communityName} onChange={e=>setCommunityName(e.target.value)} placeholder="e.g. DOOMSQUAD"
              style={{width:"100%",background:"rgba(255,255,255,0.1)",border:"none",borderRadius:"12px",padding:"14px 16px",fontSize:"16px",color:"#fff",outline:"none",boxSizing:"border-box",textTransform:"uppercase",fontFamily:"inherit"}}
              onKeyDown={e=>e.key==="Enter"&&handleCreate()} />
          </div>
          <button onClick={handleCreate} style={{width:"100%",background:"#fbbf24",color:"#1c1400",fontWeight:900,fontSize:"15px",border:"none",borderRadius:"14px",padding:"14px",cursor:"pointer"}}>
            Create Community 👑
          </button>
        </div>
        <button onClick={onSkip} style={{width:"100%",background:"none",border:"none",color:"rgba(255,255,255,0.3)",fontSize:"12px",fontWeight:700,padding:"14px",cursor:"pointer",marginTop:"4px"}}>
          Skip for now
        </button>
      </div>
    </div>
  );

  // ── Initial choice ──
  return (
    <div style={{minHeight:"100vh",width:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 20px",background:"linear-gradient(180deg,#0d0f1c,#0a0c18)",boxSizing:"border-box"}}>
      <div style={{width:"100%",maxWidth:"420px",boxSizing:"border-box"}}>
        <div style={{textAlign:"center",marginBottom:"32px"}}>
          <p style={{fontSize:"44px",marginBottom:"12px"}}>👋</p>
          <h2 style={{color:"#fff",fontWeight:900,fontSize:"24px",margin:0}}>Welcome, @{newUser.username}!</h2>
          <p style={{color:"rgba(255,255,255,0.4)",fontSize:"14px",marginTop:"8px"}}>Communities keep lives organized by group.<br/>What would you like to do?</p>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          <button onClick={() => setStep("create")}
            style={{width:"100%",background:"linear-gradient(145deg,#1e2340,#16192e)",border:"1px solid rgba(251,191,36,0.2)",borderRadius:"18px",padding:"18px",textAlign:"left",cursor:"pointer",boxSizing:"border-box"}}>
            <div style={{display:"flex",alignItems:"center",gap:"14px"}}>
              <span style={{fontSize:"28px"}}>👑</span>
              <div>
                <p style={{color:"#fff",fontWeight:900,fontSize:"15px",margin:0}}>Create a Community</p>
                <p style={{color:"rgba(255,255,255,0.5)",fontSize:"12px",margin:"3px 0 0"}}>You'll be the leader. Get an invite code to share.</p>
              </div>
            </div>
          </button>
          <button onClick={() => setStep("join")}
            style={{width:"100%",background:"linear-gradient(145deg,#1e2340,#16192e)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"18px",padding:"18px",textAlign:"left",cursor:"pointer",boxSizing:"border-box"}}>
            <div style={{display:"flex",alignItems:"center",gap:"14px"}}>
              <span style={{fontSize:"28px"}}>🤝</span>
              <div>
                <p style={{color:"#fff",fontWeight:900,fontSize:"15px",margin:0}}>Join a Community</p>
                <p style={{color:"rgba(255,255,255,0.5)",fontSize:"12px",margin:"3px 0 0"}}>Enter an invite code from your community leader.</p>
              </div>
            </div>
          </button>
          <button onClick={onSkip} style={{width:"100%",background:"none",border:"none",color:"rgba(255,255,255,0.3)",fontSize:"13px",fontWeight:700,padding:"12px",cursor:"pointer"}}>
            Skip for now — I'll join later
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Community Switcher ────────────────────────────────────────────────────────

function CommunitySwitcher({ myGroups, activeCommunityId, onSwitch, onJoin, onCreate }) {
  const [panel,         setPanel]         = useState(null); // null | "join" | "create"
  const [code,          setCode]          = useState("");
  const [communityName, setCommunityName] = useState("");
  const [err,           setErr]           = useState("");

  function closePanel() { setPanel(null); setCode(""); setCommunityName(""); setErr(""); }

  async function handleJoin() {
    setErr("");
    const ok = await onJoin(code.trim());
    if (!ok) { setErr("Invalid invite code. Check with your leader."); return; }
    closePanel();
  }

  function handleCreate() {
    if (!communityName.trim()) { setErr("Community name is required."); return; }
    onCreate(communityName.trim());
    closePanel();
  }

  // ── Expandable panel ──
  const S = {
    panelWrap: {marginTop:"8px",background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"16px",padding:"16px",border:"1px solid rgba(255,255,255,0.08)",display:"flex",flexDirection:"column",gap:"12px"},
    title: {color:"#fff",fontWeight:900,fontSize:"14px",margin:0},
    sub:   {color:"rgba(255,255,255,0.4)",fontSize:"12px",margin:0},
    err:   {color:"#f87171",fontSize:"12px",background:"rgba(239,68,68,0.1)",borderRadius:"8px",padding:"6px 10px",margin:0},
    row:   {display:"flex",gap:"8px"},
    btnC:  {flex:1,background:"rgba(255,255,255,0.1)",color:"#fff",fontWeight:700,fontSize:"13px",border:"none",borderRadius:"10px",padding:"10px",cursor:"pointer"},
    btnA:  {flex:1,background:"#fbbf24",color:"#1c1400",fontWeight:700,fontSize:"13px",border:"none",borderRadius:"10px",padding:"10px",cursor:"pointer"},
  };
  const panelEl = panel && (
    <div style={S.panelWrap}>
      {panel === "join" && <>
        <p style={S.title}>Join a Community</p>
        <p style={S.sub}>Enter the invite code from your community leader.</p>
        {err && <p style={S.err}>{err}</p>}
        <input value={code} onChange={e=>setCode(e.target.value)} placeholder="e.g. DOOM2024"
          style={{...IS.input,textTransform:"uppercase"}} onKeyDown={e=>e.key==="Enter"&&handleJoin()} />
        <div style={S.row}>
          <button onClick={closePanel} style={S.btnC}>Cancel</button>
          <button onClick={handleJoin} style={S.btnA}>Join 🤝</button>
        </div>
      </>}
      {panel === "create" && <>
        <p style={S.title}>Create a Community</p>
        <p style={S.sub}>You'll be the leader. An invite code is generated automatically.</p>
        {err && <p style={S.err}>{err}</p>}
        <input value={communityName} onChange={e=>setCommunityName(e.target.value)} placeholder="e.g. DOOMSQUAD"
          style={{...IS.input,textTransform:"uppercase"}} onKeyDown={e=>e.key==="Enter"&&handleCreate()} />
        <div style={S.row}>
          <button onClick={closePanel} style={S.btnC}>Cancel</button>
          <button onClick={handleCreate} style={S.btnA}>Create 👑</button>
        </div>
      </>}
    </div>
  );

  // ── Empty state ──
  if (myGroups.length === 0) return (
    <div>
      <div style={{background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"18px",padding:"20px",textAlign:"center"}}>
        <p style={{fontSize:"28px",marginBottom:"8px"}}>👥</p>
        <p style={{color:"#fff",fontWeight:900,fontSize:"15px",margin:"0 0 4px"}}>No communities yet</p>
        <p style={{color:"rgba(255,255,255,0.4)",fontSize:"13px",margin:"0 0 16px"}}>Join an existing community or create your own.</p>
        <div style={{display:"flex",gap:"8px"}}>
          <button onClick={() => setPanel(panel==="join"?null:"join")}
            style={{flex:1,fontWeight:700,fontSize:"13px",border:"none",borderRadius:"10px",padding:"10px",cursor:"pointer",
              background:panel==="join"?"#fbbf24":"rgba(255,255,255,0.1)",color:panel==="join"?"#1c1400":"#fff"}}>
            🤝 Join
          </button>
          <button onClick={() => setPanel(panel==="create"?null:"create")}
            style={{flex:1,fontWeight:700,fontSize:"13px",border:"none",borderRadius:"10px",padding:"10px",cursor:"pointer",
              background:panel==="create"?"#fbbf24":"rgba(255,255,255,0.1)",color:panel==="create"?"#1c1400":"#fff"}}>
            👑 Create
          </button>
        </div>
      </div>
      {panelEl}
    </div>
  );

  // ── Has communities ──
  return (
    <div>
      <div style={{display:"flex",gap:"8px",overflowX:"auto",paddingBottom:"4px",scrollbarWidth:"none"}}>
        {myGroups.map(g => (
          <button key={g.id} onClick={() => { onSwitch(g.id); closePanel(); }}
            style={{flexShrink:0,display:"flex",alignItems:"center",gap:"6px",padding:"7px 14px",borderRadius:"20px",fontSize:"12px",fontWeight:900,border:"none",cursor:"pointer",
              background:activeCommunityId===g.id?"#fbbf24":"rgba(255,255,255,0.1)",color:activeCommunityId===g.id?"#1c1400":"rgba(255,255,255,0.7)"}}>
            👥 {g.name}
          </button>
        ))}
        <button onClick={() => setPanel(panel==="join"?null:"join")}
          style={{flexShrink:0,padding:"7px 12px",borderRadius:"20px",fontSize:"12px",fontWeight:700,border:"none",cursor:"pointer",
            background:panel==="join"?"#fbbf24":"rgba(255,255,255,0.07)",color:panel==="join"?"#1c1400":"rgba(255,255,255,0.4)"}}>
          🤝 Join
        </button>
        <button onClick={() => setPanel(panel==="create"?null:"create")}
          style={{flexShrink:0,padding:"7px 12px",borderRadius:"20px",fontSize:"12px",fontWeight:700,border:"none",cursor:"pointer",
            background:panel==="create"?"#fbbf24":"rgba(255,255,255,0.07)",color:panel==="create"?"#1c1400":"rgba(255,255,255,0.4)"}}>
          👑 Create
        </button>
      </div>
      {panelEl}
    </div>
  );
}

// ─── Occurrence Card ───────────────────────────────────────────────────────────

function OccurrenceCard({ occurrence, signups, onView, isOwner, onGoLive }) {
  const { schedule, status, dateObj, daysAway, occurrenceId } = occurrence;
  const ss        = signups.filter(sg => sg.occurrenceId === occurrenceId);
  const totalGift = ss.reduce((sum, sg) => sum + (sg.plannedGiftAmount || 0), 0);
  const dayLabel  = daysAway === 0 ? "Today" : daysAway === 1 ? "Tomorrow" : formatDate(dateObj);

  return (
    <div style={{background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"16px",padding:"12px",display:"flex",flexDirection:"column",gap:"8px",boxSizing:"border-box"}}>
      <div>
        <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"4px",flexWrap:"wrap"}}>
          <Badge status={status} />
          <span style={{color:"rgba(255,255,255,0.5)",fontSize:"12px"}}>{platformIcon(schedule.platform)}</span>
        </div>
        <p style={{color:"#fff",fontWeight:900,fontSize:"13px",margin:0}}>@{schedule.hostUsername}</p>
        <p style={{color:"#fbbf24",fontSize:"11px",fontWeight:700,margin:"2px 0 0"}}>{dayLabel}</p>
        <p style={{color:"rgba(255,255,255,0.5)",fontSize:"11px",margin:"1px 0 0"}}>{formatTime(schedule.startTime)} – {formatTime(schedule.endTime)}</p>
        <p style={{color:"rgba(255,255,255,0.3)",fontSize:"11px",margin:"1px 0 0"}}>{schedule.platform}</p>
      </div>
      {schedule.notes && <p style={{color:"rgba(255,255,255,0.45)",fontSize:"11px",background:"rgba(255,255,255,0.05)",borderRadius:"8px",padding:"6px 8px",margin:0}}>{schedule.notes}</p>}
      <div style={{display:"flex",gap:"6px"}}>
        <div style={{background:"rgba(255,255,255,0.1)",borderRadius:"8px",padding:"6px 4px",textAlign:"center",flex:1}}>
          <p style={{color:"#fff",fontWeight:900,fontSize:"13px",margin:0,lineHeight:1}}>{ss.length}</p>
          <p style={{color:"rgba(255,255,255,0.5)",fontSize:"10px",margin:"2px 0 0"}}>going</p>
        </div>
        {totalGift > 0 && (
          <div style={{background:"#fbbf24",borderRadius:"8px",padding:"6px 4px",textAlign:"center",flex:1}}>
            <p style={{color:"#1c1400",fontWeight:900,fontSize:"13px",margin:0,lineHeight:1}}>${totalGift}</p>
            <p style={{color:"rgba(28,20,0,0.6)",fontSize:"10px",margin:"2px 0 0"}}>planned 🎁</p>
          </div>
        )}
      </div>
      <div style={{display:"flex",gap:"6px",marginTop:"auto"}}>
        <button onClick={() => onView(occurrenceId)} style={{flex:1,background:"#fbbf24",color:"#1c1400",fontWeight:700,fontSize:"12px",border:"none",borderRadius:"10px",padding:"8px",cursor:"pointer"}}>
          View & Sign Up
        </button>
        {isOwner && status !== STATUS.LIVE_NOW && status !== STATUS.CANCELLED && daysAway === 0 && (
          <button onClick={() => onGoLive(schedule.id)} style={{background:"rgba(239,68,68,0.8)",color:"#fff",border:"none",borderRadius:"10px",padding:"8px 10px",fontSize:"12px",fontWeight:700,cursor:"pointer"}}>🔴</button>
        )}
      </div>
    </div>
  );
}

// ─── Signup Form ───────────────────────────────────────────────────────────────

function SignupForm({ occurrenceId, scheduleId, currentUser, onSubmit, selectedCount }) {
  const [displayName,       setDisplayName]       = useState(currentUser?.username || "");
  const [supporterUsername, setSupporterUsername] = useState(currentUser ? `@${currentUser.username}` : "");
  const [gift,    setGift]    = useState("");
  const [comment, setComment] = useState("");
  const [done,    setDone]    = useState(false);
  const [error,   setError]   = useState("");

  function submit() {
    if (!displayName.trim()) { setError("Your name is required."); return; }
    setError("");
    // [DB INTEGRATION] POST to signups table — store occurrenceId, scheduleId, and userId
    onSubmit({ id:uid(), occurrenceId, scheduleId, displayName:displayName.trim(), supporterUsername:supporterUsername.trim(), plannedGiftAmount:gift!==""?parseFloat(gift):null, comment:comment.trim(), createdAt:new Date().toISOString() });
    setDone(true);
  }

  if (done) return (
    <div style={{background:"rgba(16,185,129,0.15)",border:"1px solid rgba(52,211,153,0.35)",borderRadius:"16px",padding:"24px",textAlign:"center"}}>
      <p style={{fontSize:"28px",marginBottom:"8px"}}>🎉</p>
      <p style={{color:"#6ee7b7",fontWeight:900,fontSize:"17px",margin:0}}>You're signed up!</p>
      <p style={{color:"rgba(255,255,255,0.5)",fontSize:"13px",margin:"6px 0 0"}}>See you in the live.</p>
    </div>
  );

  return (
    <div style={IS.card}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"6px"}}>
        <h3 style={{color:"#fff",fontWeight:900,fontSize:"15px",margin:0}}>Sign Up to Support</h3>
        {selectedCount > 0 && (
          <span style={{background:"rgba(251,191,36,0.15)",color:"#fbbf24",fontSize:"11px",fontWeight:700,padding:"3px 10px",borderRadius:"20px"}}>
            {selectedCount} day{selectedCount!==1?"s":""} selected
          </span>
        )}
      </div>
      <p style={{color:"rgba(255,255,255,0.4)",fontSize:"12px",margin:0}}>⚠️ Gift amounts are for planning only — no payment is taken here.</p>
      {error && <p style={{color:"#f87171",fontSize:"12px",background:"rgba(239,68,68,0.1)",borderRadius:"10px",padding:"8px 12px",margin:0}}>{error}</p>}
      <div>
        <label style={IS.label}>Your Name *</label>
        <input value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="How you want to appear" style={IS.input} />
      </div>
      <div>
        <label style={IS.label}>Your Username (optional)</label>
        <input value={supporterUsername} onChange={e=>setSupporterUsername(e.target.value)} placeholder="@handle" style={IS.input} />
      </div>
      <div>
        <label style={IS.label}>Planned Gift Amount — <span style={{color:"#fbbf24"}}>optional, no charge</span></label>
        <div style={{position:"relative"}}>
          <span style={{position:"absolute",left:"14px",top:"50%",transform:"translateY(-50%)",color:"rgba(255,255,255,0.4)",fontSize:"15px"}}>$</span>
          <input type="number" min="0" value={gift} onChange={e=>setGift(e.target.value)} placeholder="0.00" style={{...IS.input,paddingLeft:"32px"}} />
        </div>
      </div>
      <div>
        <label style={IS.label}>Hype message (optional)</label>
        <textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="Drop some hype! 🎉" rows={2} style={{...IS.input,resize:"none"}} />
      </div>
      <button onClick={submit} style={IS.btn}>Sign Me Up 🙌</button>
    </div>
  );
}

// ─── My Signup Panel ───────────────────────────────────────────────────────────

function MySignupPanel({ signup, onUpdate, onRemove }) {
  const [mode,    setMode]    = useState("view");
  const [gift,    setGift]    = useState(signup.plannedGiftAmount != null ? String(signup.plannedGiftAmount) : "");
  const [comment, setComment] = useState(signup.comment || "");

  function handleSave() {
    // [DB INTEGRATION] PATCH signups table by signup.id
    onUpdate({ ...signup, plannedGiftAmount: gift!==""?parseFloat(gift):null, comment:comment.trim() });
    setMode("view");
  }

  if (mode === "confirm-remove") return (
    <div style={{background:"linear-gradient(145deg,#2a1a1a,#1e1010)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:"16px",padding:"20px",textAlign:"center"}}>
      <p style={{fontSize:"24px",marginBottom:"8px"}}>⚠️</p>
      <p style={{color:"#fff",fontWeight:900,fontSize:"15px",margin:"0 0 4px"}}>Remove your signup?</p>
      <p style={{color:"rgba(255,255,255,0.5)",fontSize:"13px",margin:"0 0 16px"}}>You can always sign up again later.</p>
      <div style={{display:"flex",gap:"8px"}}>
        <button onClick={() => setMode("view")} style={{flex:1,background:"rgba(255,255,255,0.1)",color:"#fff",fontWeight:700,fontSize:"14px",border:"none",borderRadius:"12px",padding:"11px",cursor:"pointer"}}>Keep It</button>
        <button onClick={() => onRemove(signup.id)} style={{flex:1,background:"#ef4444",color:"#fff",fontWeight:700,fontSize:"14px",border:"none",borderRadius:"12px",padding:"11px",cursor:"pointer"}}>Yes, Remove</button>
      </div>
    </div>
  );

  if (mode === "edit") return (
    <div style={{background:"linear-gradient(145deg,#1e2340,#16192e)",border:"1px solid rgba(251,191,36,0.2)",borderRadius:"16px",padding:"18px",display:"flex",flexDirection:"column",gap:"14px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <h3 style={{color:"#fff",fontWeight:900,fontSize:"15px",margin:0}}>Edit Your Signup</h3>
        <button onClick={() => { setGift(signup.plannedGiftAmount!=null?String(signup.plannedGiftAmount):""); setComment(signup.comment||""); setMode("view"); }} style={{background:"none",border:"none",color:"rgba(255,255,255,0.4)",fontSize:"13px",fontWeight:700,cursor:"pointer"}}>Cancel</button>
      </div>
      <p style={{color:"rgba(255,255,255,0.4)",fontSize:"12px",margin:0}}>⚠️ Gift amounts are for planning only — no payment is taken here.</p>
      <div>
        <label style={{color:"rgba(255,255,255,0.6)",fontSize:"12px",fontWeight:700,display:"block",marginBottom:"6px"}}>Planned Gift Amount — <span style={{color:"#fbbf24"}}>optional, no charge</span></label>
        <div style={{position:"relative"}}>
          <span style={{position:"absolute",left:"14px",top:"50%",transform:"translateY(-50%)",color:"rgba(255,255,255,0.4)",fontSize:"15px"}}>$</span>
          <input type="number" min="0" value={gift} onChange={e=>setGift(e.target.value)} placeholder="0.00" style={{...IS.input,paddingLeft:"32px"}} />
        </div>
        {gift !== "" && <button onClick={() => setGift("")} style={{background:"none",border:"none",color:"rgba(255,255,255,0.3)",fontSize:"12px",marginTop:"4px",cursor:"pointer"}}>✕ Clear amount</button>}
      </div>
      <div>
        <label style={{color:"rgba(255,255,255,0.6)",fontSize:"12px",fontWeight:700,display:"block",marginBottom:"6px"}}>Hype message (optional)</label>
        <textarea value={comment} onChange={e=>setComment(e.target.value)} rows={2} placeholder="Drop some hype! 🎉" style={IS.textarea} />
      </div>
      <button onClick={handleSave} style={IS.btn}>Save Changes ✓</button>
    </div>
  );

  return (
    <div style={{background:"linear-gradient(145deg,#1a3328,#122a22)",borderRadius:"16px",padding:"16px",border:"1px solid rgba(52,211,153,0.2)"}}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"12px"}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"4px"}}>
            <span style={{fontSize:"16px"}}>✅</span>
            <p style={{color:"#6ee7b7",fontWeight:900,fontSize:"13px",margin:0}}>You're signed up!</p>
          </div>
          <p style={{color:"rgba(255,255,255,0.6)",fontSize:"12px",margin:0}}>As <span style={{color:"#fff",fontWeight:700}}>{signup.displayName}</span>{signup.supporterUsername && <span style={{color:"rgba(255,255,255,0.4)"}}> {signup.supporterUsername}</span>}</p>
          {signup.plannedGiftAmount != null ? <p style={{color:"#fcd34d",fontSize:"11px",fontWeight:700,margin:"3px 0 0"}}>🎁 Planning to gift ${signup.plannedGiftAmount}</p> : <p style={{color:"rgba(255,255,255,0.3)",fontSize:"11px",margin:"3px 0 0"}}>No gift amount set</p>}
          {signup.comment && <p style={{color:"rgba(255,255,255,0.4)",fontSize:"11px",fontStyle:"italic",margin:"3px 0 0"}}>"{signup.comment}"</p>}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:"6px",flexShrink:0}}>
          <button onClick={() => setMode("edit")} style={IS.btnGhost}>✏️ Edit</button>
          <button onClick={() => setMode("confirm-remove")} style={IS.btnDanger}>Remove</button>
        </div>
      </div>
    </div>
  );
}

// ─── Occurrence Detail ─────────────────────────────────────────────────────────

function OccurrenceDetail({ occurrence, signups, currentUser, onBack, onSignup, onUpdateSignup, onRemoveSignup }) {
  const { schedule, dateObj, daysAway, occurrenceId } = occurrence;
  const status    = effectiveStatus(schedule, occurrenceId);
  const days      = schedule.daysOfWeek ?? (schedule.dayOfWeek != null ? [schedule.dayOfWeek] : []);
  const dayLabel  = daysAway === 0 ? "Today" : daysAway === 1 ? "Tomorrow" : formatDate(dateObj);
  const isOwn     = schedule.userId === currentUser.id;
  const ss        = signups.filter(sg => sg.occurrenceId === occurrenceId);
  const totalGift = ss.reduce((sum, sg) => sum + (sg.plannedGiftAmount || 0), 0);
  const mySignup  = ss.find(sg =>
    sg.displayName.toLowerCase() === currentUser.username.toLowerCase() ||
    sg.supporterUsername.replace(/^@/,"").toLowerCase() === currentUser.username.toLowerCase()
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
      <button onClick={onBack} style={{display:"flex",alignItems:"center",gap:"4px",background:"none",border:"none",color:"rgba(255,255,255,0.5)",fontSize:"13px",fontWeight:700,cursor:"pointer",padding:0,marginBottom:"2px"}}>← Back</button>

      {/* Hero */}
      <div style={{background:"linear-gradient(135deg,#e67e22,#c0392b)",borderRadius:"18px",padding:"20px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"8px",flexWrap:"wrap"}}>
          <Badge status={status} />
          <span style={{color:"rgba(255,255,255,0.7)",fontSize:"12px"}}>{platformIcon(schedule.platform)} {schedule.platform}</span>
        </div>
        <h2 style={{color:"#fff",fontWeight:900,fontSize:"22px",margin:0}}>@{schedule.hostUsername}</h2>
        <p style={{color:"rgba(255,255,255,0.9)",fontWeight:700,fontSize:"15px",margin:"4px 0 0"}}>{dayLabel} · {formatDate(dateObj)}</p>
        <p style={{color:"rgba(255,255,255,0.7)",fontSize:"13px",margin:"2px 0 0"}}>{formatTime(schedule.startTime)} – {formatTime(schedule.endTime)}</p>
        <p style={{color:"rgba(255,255,255,0.5)",fontSize:"11px",margin:"2px 0 0"}}>Repeats every {formatDays(days)}</p>
        {schedule.notes && <div style={{marginTop:"10px",background:"rgba(0,0,0,0.2)",borderRadius:"10px",padding:"10px 14px"}}><p style={{color:"rgba(255,255,255,0.9)",fontSize:"13px",margin:0}}>{schedule.notes}</p></div>}
      </div>

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px"}}>
        <Pill label="Signed Up" value={ss.length} />
        <Pill label="Date" value={dayLabel} />
        <Pill label="🎁 Expected" value={totalGift>0?`$${totalGift}`:"—"} accent={totalGift>0} />
      </div>

      {/* Signup */}
      {status !== STATUS.CANCELLED && (
        isOwn
          ? (
            <div style={{background:"rgba(251,191,36,0.12)",border:"1px solid rgba(251,191,36,0.25)",borderRadius:"16px",padding:"18px",textAlign:"center"}}>
              <p style={{color:"#fbbf24",fontWeight:900,fontSize:"14px",margin:"0 0 4px"}}>This is your live</p>
              <p style={{color:"rgba(255,255,255,0.45)",fontSize:"12px",margin:0}}>Only other users can sign up to support this live.</p>
            </div>
          )
          : mySignup
            ? <MySignupPanel signup={mySignup} onUpdate={onUpdateSignup} onRemove={onRemoveSignup} />
            : <SignupForm occurrenceId={occurrenceId} scheduleId={schedule.id} currentUser={currentUser} onSubmit={onSignup} />
      )}

      {/* Who's Coming */}
      <div style={IS.card}>
        <h3 style={{color:"#fff",fontWeight:900,fontSize:"15px",margin:0}}>Who's Coming ({ss.length})</h3>
        {ss.length===0
          ? <p style={{color:"rgba(255,255,255,0.4)",fontSize:"13px",textAlign:"center",padding:"12px 0",margin:0}}>No one yet — be the first! 🌟</p>
          : ss.map(sg => <SupporterRow key={sg.id} signup={sg} />)
        }
      </div>
    </div>
  );
}


// ─── Weekly CSV Export Helpers ────────────────────────────────────────────────

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d;
}

function getWeekOptions(count = 9) {
  const currentStart = getWeekStart(new Date());
  return Array.from({ length: count }, (_, i) => {
    const start = new Date(currentStart);
    start.setDate(currentStart.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return {
      value: start.toISOString().slice(0, 10),
      start,
      end,
      label: `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
    };
  });
}

function occurrenceDateFromId(occurrenceId) {
  if (!occurrenceId || !occurrenceId.includes("__")) return null;
  const raw = occurrenceId.split("__")[1];
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isSignupInWeek(signup, weekStartValue) {
  const start = new Date(`${weekStartValue}T00:00:00`);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  const occurrenceDate = occurrenceDateFromId(signup.occurrenceId);
  const createdDate = signup.createdAt ? new Date(signup.createdAt) : null;
  const targetDate = occurrenceDate || createdDate;
  if (!targetDate || Number.isNaN(targetDate.getTime())) return false;
  return targetDate >= start && targetDate < end;
}

function downloadCSVFile(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildWeeklyExportCSV(schedules, signups, options = {}) {
  const { weekStartValue = getWeekStart(new Date()).toISOString().slice(0, 10), hostUserId = "all" } = options;
  const rows = [["Host","Platform","Days","Start","End","Status","Occurrence","Supporter Name","Supporter Username","Planned Gift ($)","Comment","Signed Up At"]];
  const filteredSchedules = schedules.filter(sched => hostUserId === "all" || sched.userId === hostUserId);
  const weekSignups = signups.filter(sg => isSignupInWeek(sg, weekStartValue));

  for (const sched of filteredSchedules) {
    const scheduleSignups = weekSignups.filter(sg => sg.scheduleId === sched.id);

    if (scheduleSignups.length === 0) {
      rows.push([
        "@" + sched.hostUsername,
        sched.platform,
        formatDays(sched.daysOfWeek ?? [sched.dayOfWeek]),
        formatTime(sched.startTime),
        formatTime(sched.endTime),
        effectiveStatus(sched),
        "",
        "No supporters signed up",
        "",
        "",
        "",
        "",
      ]);
      continue;
    }

    for (const sg of scheduleSignups) {
      const occurrenceDate = occurrenceDateFromId(sg.occurrenceId);
      rows.push([
        "@" + sched.hostUsername,
        sched.platform,
        formatDays(sched.daysOfWeek ?? [sched.dayOfWeek]),
        formatTime(sched.startTime),
        formatTime(sched.endTime),
        effectiveStatus(sched),
        occurrenceDate ? occurrenceDate.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }) : "",
        sg.displayName || "",
        sg.supporterUsername || "",
        sg.plannedGiftAmount != null ? Number(sg.plannedGiftAmount).toFixed(2) : "",
        sg.comment || "",
        sg.createdAt ? new Date(sg.createdAt).toLocaleString() : "",
      ]);
    }
  }

  return rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
}

// ─── My Schedule Tab ───────────────────────────────────────────────────────────

function MyScheduleTab({ currentUser, schedules, signups, communities, onSave, onGoLive, onStatusChange }) {
  const [editing, setEditing] = useState(false);
  const [myCsvWeek, setMyCsvWeek] = useState(getWeekStart(new Date()).toISOString().slice(0, 10));
  const myWeekOptions = getWeekOptions(9);
  const mySchedules = schedules.filter(s => s.userId === currentUser.id);
  // For simplicity, host manages the first schedule; multiple schedules per community could be extended
  const mySchedule = mySchedules[0] ?? null;
  const status     = mySchedule ? effectiveStatus(mySchedule) : null;
  const myGroups   = communities.filter(c => currentUser.communityIds?.includes(c.id));

  if (editing || !mySchedule) {
    return (
      <ScheduleForm
        initial={mySchedule}
        userId={currentUser.id}
        username={currentUser.username}
        myGroups={myGroups}
        onSave={s => { onSave(s); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const ss        = signups.filter(sg => sg.scheduleId === mySchedule.id);
  const totalGift = ss.reduce((sum, sg) => sum + (sg.plannedGiftAmount || 0), 0);
  const community = communities.find(c => c.id === mySchedule.communityId);

  function handleMyCSVDownload() {
    if (!mySchedule) return;
    const csv = buildWeeklyExportCSV([mySchedule], signups, {
      weekStartValue: myCsvWeek,
      hostUserId: currentUser.id,
    });
    downloadCSVFile(`my-live-signups-${myCsvWeek}.csv`, csv);
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <h2 style={{color:"#fff",fontWeight:900,fontSize:"20px",margin:0}}>My Schedule</h2>
        <button onClick={() => setEditing(true)} style={{background:"rgba(255,255,255,0.1)",color:"#fff",fontWeight:700,fontSize:"12px",border:"none",borderRadius:"10px",padding:"8px 12px",cursor:"pointer"}}>✏️ Edit</button>
      </div>
      <div className="rounded-2xl p-5" style={{background:"linear-gradient(135deg,#1a1f3c,#0f1225)"}}>
        <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"8px",flexWrap:"wrap"}}>
          <Badge status={status} />
          <span style={{color:"rgba(255,255,255,0.5)",fontSize:"12px"}}>{platformIcon(mySchedule.platform)} {mySchedule.platform}</span>
          {community && <span style={{background:"rgba(255,255,255,0.1)",color:"rgba(255,255,255,0.6)",fontSize:"11px",fontWeight:700,padding:"2px 8px",borderRadius:"20px"}}>👥 {community.name}</span>}
        </div>
        <p style={{color:"#fff",fontWeight:900,fontSize:"20px",margin:0}}>@{currentUser.username}</p>
        <p style={{color:"#fbbf24",fontSize:"13px",fontWeight:700,margin:"4px 0 0"}}>Every {formatDays(mySchedule.daysOfWeek ?? [mySchedule.dayOfWeek])} · {formatTime(mySchedule.startTime)} – {formatTime(mySchedule.endTime)}</p>
        {mySchedule.notes && <p style={{color:"rgba(255,255,255,0.6)",fontSize:"12px",margin:"8px 0 0",background:"rgba(255,255,255,0.05)",borderRadius:"8px",padding:"8px 12px"}}>{mySchedule.notes}</p>}
        <div style={{display:"flex",gap:"8px",marginTop:"14px"}}>
          <Pill label="Supporters" value={ss.length} />
          {totalGift > 0 && <Pill label="Planned 🎁" value={`$${totalGift}`} accent />}
        </div>
      </div>
      <div className="rounded-2xl p-4" style={{background:"linear-gradient(145deg,#1e2340,#16192e)"}}>
        <p style={{color:"#fff",fontWeight:900,fontSize:"15px",margin:"0 0 4px"}}>Download Weekly CSV</p>
        <p style={{color:"rgba(255,255,255,0.4)",fontSize:"12px",margin:"0 0 12px"}}>Export your supporter signups for a selected week.</p>
        <div style={{display:"flex",gap:"8px"}}>
          <select value={myCsvWeek} onChange={e=>setMyCsvWeek(e.target.value)} style={{...IS.input,appearance:"none",flex:1}}>
            {myWeekOptions.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
          <button onClick={handleMyCSVDownload} style={{background:"#fbbf24",color:"#1c1400",fontWeight:900,fontSize:"12px",border:"none",borderRadius:"10px",padding:"0 14px",cursor:"pointer"}}>CSV</button>
        </div>
      </div>

      <div className="rounded-2xl p-4" style={{background:"linear-gradient(145deg,#1e2340,#16192e)"}}>
        <p style={{color:"rgba(255,255,255,0.45)",fontSize:"11px",fontWeight:700,textTransform:"uppercase",letterSpacing:"1px",margin:"0 0 6px"}}>Live Controls</p>
        <p style={{color:"rgba(255,255,255,0.3)",fontSize:"12px",margin:"0 0 12px"}}>"Live Now" starts automatically. Use these if you go early, end early, or need to cancel.</p>
        <div style={{display:"flex",flexWrap:"wrap",gap:"8px"}}>
          {status !== STATUS.LIVE_NOW && status !== STATUS.CANCELLED && <button onClick={() => onGoLive(mySchedule.id)} style={{background:"rgba(239,68,68,0.2)",color:"#f87171",fontSize:"12px",fontWeight:700,border:"none",borderRadius:"10px",padding:"8px 12px",cursor:"pointer"}}>🔴 Go Live Early</button>}
          {status === STATUS.LIVE_NOW && <button onClick={() => onStatusChange(mySchedule.id, STATUS.COMPLETED)} style={{background:"rgba(5,150,105,0.2)",color:"#6ee7b7",fontSize:"12px",fontWeight:700,border:"none",borderRadius:"10px",padding:"8px 12px",cursor:"pointer"}}>✓ End Live</button>}
          {status !== STATUS.CANCELLED && <button onClick={() => onStatusChange(mySchedule.id, STATUS.CANCELLED)} style={{background:"rgba(107,114,128,0.2)",color:"rgba(255,255,255,0.5)",fontSize:"12px",fontWeight:700,border:"none",borderRadius:"10px",padding:"8px 12px",cursor:"pointer"}}>✕ Cancel This Week</button>}
          {mySchedule.manualStatus && <button onClick={() => onStatusChange(mySchedule.id, null)} style={{background:"rgba(255,255,255,0.1)",color:"#fff",fontSize:"12px",fontWeight:700,border:"none",borderRadius:"10px",padding:"8px 12px",cursor:"pointer"}}>↺ Reset to Auto</button>}
        </div>
      </div>
      <div className="rounded-2xl p-4" style={{background:"linear-gradient(145deg,#1e2340,#16192e)"}}>
        <h3 style={{color:"#fff",fontWeight:900,fontSize:"15px",margin:"0 0 12px"}}>My Supporters ({ss.length})</h3>
        {ss.length===0 ? <p style={{color:"rgba(255,255,255,0.4)",fontSize:"13px",textAlign:"center",padding:"12px 0",margin:0}}>No one signed up yet.</p> : ss.map(sg => <SupporterRow key={sg.id} signup={sg} />)}
      </div>
    </div>
  );
}

// ─── TimeInput ────────────────────────────────────────────────────────────────
// Custom time picker using dropdowns — avoids native iOS overflow issues

function TimeInput({ value, onChange, label }) {
  // Parse HH:MM value
  const [h, m] = value ? value.split(":").map(Number) : [12, 0];
  const hour12 = h % 12 || 12;
  const ampm   = h >= 12 ? "PM" : "AM";
  const mins   = m;

  function update(newH12, newAmpm, newMins) {
    let h24 = newH12 % 12;
    if (newAmpm === "PM") h24 += 12;
    const hStr = String(h24).padStart(2, "0");
    const mStr = String(newMins).padStart(2, "0");
    onChange(hStr + ":" + mStr);
  }

  const selectStyle = {
    background:"rgba(255,255,255,0.1)",border:"none",borderRadius:"10px",
    padding:"12px 8px",fontSize:"15px",color:"#fff",outline:"none",
    cursor:"pointer",fontFamily:"inherit",textAlign:"center",
    WebkitAppearance:"none",appearance:"none",flex:1,minWidth:0,
  };

  return (
    <div>
      <label style={IS.label}>{label}</label>
      <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
        <select value={hour12} onChange={e => update(Number(e.target.value), ampm, mins)} style={selectStyle}>
          {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span style={{color:"rgba(255,255,255,0.4)",fontWeight:900,fontSize:"16px",flexShrink:0}}>:</span>
        <select value={mins} onChange={e => update(hour12, ampm, Number(e.target.value))} style={selectStyle}>
          {[0,5,10,15,20,25,30,35,40,45,50,55].map(n => <option key={n} value={n}>{String(n).padStart(2,"0")}</option>)}
        </select>
        <select value={ampm} onChange={e => update(hour12, e.target.value, mins)} style={{...selectStyle,flex:"0 0 64px"}}>
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
    </div>
  );
}

// ─── Schedule Form ─────────────────────────────────────────────────────────────

function ScheduleForm({ initial, userId, username, myGroups, onSave, onCancel }) {
  const [form, setForm] = useState({
    platform:    initial?.platform    ?? "",
    daysOfWeek:  initial?.daysOfWeek  ?? (initial?.dayOfWeek!=null?[initial.dayOfWeek]:[]),
    startTime:   initial?.startTime   ?? "12:00",
    endTime:     initial?.endTime     ?? "13:00",
    notes:       initial?.notes       ?? "",
    communityId: initial?.communityId ?? myGroups[0]?.id ?? "",
  });
  const [error, setError] = useState("");

  function ch(f, v) { setForm(p => ({...p, [f]:v})); }
  function toggleDay(i) { setForm(p => ({...p, daysOfWeek: p.daysOfWeek.includes(i)?p.daysOfWeek.filter(d=>d!==i):[...p.daysOfWeek,i]})); }

  function save() {
    if (!form.platform.trim()||form.daysOfWeek.length===0||!form.startTime||!form.endTime||!form.communityId) {
      setError("Platform, community, at least one day, and times are required."); return;
    }
    setError("");
    // [DB INTEGRATION] POST or PUT to your schedules table
    onSave({ ...(initial||{}), id:initial?.id||uid(), userId, hostUsername:username, platform:form.platform.trim(), communityId:form.communityId, daysOfWeek:[...form.daysOfWeek].sort((a,b)=>a-b), startTime:form.startTime, endTime:form.endTime, notes:form.notes.trim(), manualStatus:initial?.manualStatus??null, createdAt:initial?.createdAt||new Date().toISOString() });
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"14px",paddingBottom:"16px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <h2 style={{color:"#fff",fontWeight:900,fontSize:"20px",margin:0}}>{initial?"Edit My Schedule":"Set My Weekly Schedule"}</h2>
        <button onClick={onCancel} style={{background:"none",border:"none",color:"rgba(255,255,255,0.5)",fontSize:"14px",cursor:"pointer"}}>Cancel</button>
      </div>
      {error && <p style={{color:"#f87171",fontSize:"12px",background:"rgba(239,68,68,0.1)",borderRadius:"10px",padding:"8px 12px",margin:0}}>{error}</p>}
      <div style={{background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"20px",padding:"20px",display:"flex",flexDirection:"column",gap:"14px"}}>
        <p style={{color:"rgba(255,255,255,0.5)",fontSize:"12px",margin:0}}>Your username <span style={{color:"#fbbf24",fontWeight:700}}>@{username}</span> is shown as host automatically.</p>
        {myGroups.length > 0 && (
          <div>
            <label style={IS.label}>Community *</label>
            <select value={form.communityId} onChange={e=>ch("communityId",e.target.value)} style={{...IS.input,appearance:"none"}}>
              <option value="">Select a community…</option>
              {myGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        )}
        {myGroups.length === 0 && <p style={{color:"#f87171",fontSize:"12px",background:"rgba(239,68,68,0.1)",borderRadius:"10px",padding:"8px 12px",margin:0}}>You must join a community before posting a schedule.</p>}
        <div>
          <label style={IS.label}>Platform *</label>
          <input value={form.platform} onChange={e=>ch("platform",e.target.value)} placeholder="TikTok, YouTube, Kick, Twitch…" style={IS.input} />
        </div>
        <div>
          <label style={{...IS.label,marginBottom:"10px"}}>Days of Week * <span style={{color:"rgba(255,255,255,0.3)",fontWeight:400}}>(tap to select)</span></label>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:"4px"}}>
            {DAYS.map((day,i) => (
              <button key={i} type="button" onClick={() => toggleDay(i)}
                style={{padding:"10px 0",borderRadius:"8px",fontSize:"11px",fontWeight:700,border:"none",cursor:"pointer",textAlign:"center",
                  background:form.daysOfWeek.includes(i)?"#fbbf24":"rgba(255,255,255,0.1)",
                  color:form.daysOfWeek.includes(i)?"#1c1400":"rgba(255,255,255,0.6)"}}>
                {day.slice(0,2)}
              </button>
            ))}
          </div>
        </div>
        <TimeInput label="Start Time *" value={form.startTime} onChange={v=>ch("startTime",v)} />
        <TimeInput label="End Time *"   value={form.endTime}   onChange={v=>ch("endTime",v)} />
        <div>
          <label style={IS.label}>Notes / Theme (optional)</label>
          <textarea value={form.notes} onChange={e=>ch("notes",e.target.value)} placeholder="What's the vibe every week?" rows={2} style={{...IS.input,resize:"none"}} />
        </div>
      </div>
      <button onClick={save} style={IS.btn}>
        {initial?"Save Changes":"Save My Schedule 🎬"}
      </button>
    </div>
  );
}

// ─── Group Admin Panel ─────────────────────────────────────────────────────────

function GroupAdminPanel({ community, allUsers, schedules, signups, onStatusChange, onGoLive, onRemoveMember }) {
  const members   = allUsers.filter(u => u.communityIds?.includes(community.id));
  const [csvHostFilter, setCsvHostFilter] = useState("all");
  const [csvWeek, setCsvWeek] = useState(getWeekStart(new Date()).toISOString().slice(0, 10));
  const weekOptions = getWeekOptions(9);
  const commScheds = schedules.filter(s => s.communityId === community.id);
  const hostOptions = commScheds.reduce((acc, sched) => {
    if (!acc.find(h => h.userId === sched.userId)) {
      acc.push({ userId: sched.userId, label: `@${sched.hostUsername}` });
    }
    return acc;
  }, []);
  const today     = new Date();
  const weekLabel = `Week of ${today.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`;

  function downloadSummary() {
    const csv = buildWeeklyExportCSV(commScheds, signups, {
      weekStartValue: csvWeek,
      hostUserId: csvHostFilter,
    });
    const selectedHost = csvHostFilter === "all" ? "all-hosts" : (hostOptions.find(h => h.userId === csvHostFilter)?.label || "host").replace("@", "");
    downloadCSVFile(`${community.name}_${selectedHost}_${csvWeek}.csv`, csv);
  }

  const totalGiftAll = signups.filter(sg => commScheds.some(s => s.id===sg.scheduleId)).reduce((sum,sg)=>sum+(sg.plannedGiftAmount||0),0);
  const liveNowCount = commScheds.filter(s => effectiveStatus(s)===STATUS.LIVE_NOW).length;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <h2 style={{color:"#fff",fontWeight:900,fontSize:"20px",margin:0}}>👥 {community.name}</h2>
          <p style={{color:"rgba(255,255,255,0.4)",fontSize:"12px",margin:"4px 0 0"}}>Invite code: <span style={{color:"#fbbf24",fontWeight:700}}>{community.inviteCode}</span></p>
        </div>
        <button onClick={downloadSummary} style={{display:"flex",alignItems:"center",gap:"6px",background:"#059669",color:"#fff",fontWeight:700,fontSize:"12px",border:"none",borderRadius:"10px",padding:"8px 12px",cursor:"pointer"}}>⬇ CSV</button>
      </div>

      <div style={{background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"16px",padding:"16px",display:"flex",flexDirection:"column",gap:"10px"}}>
        <p style={{color:"#fff",fontWeight:900,fontSize:"14px",margin:0}}>CSV Export Options</p>
        <p style={{color:"rgba(255,255,255,0.45)",fontSize:"12px",lineHeight:1.4,margin:0}}>Choose a week and export all hosts or one specific host. Each row includes the supporters signed up for each live.</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
          <div>
            <label style={IS.label}>Week</label>
            <select value={csvWeek} onChange={e=>setCsvWeek(e.target.value)} style={{...IS.input,appearance:"none"}}>
              {weekOptions.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
            </select>
          </div>
          <div>
            <label style={IS.label}>Host</label>
            <select value={csvHostFilter} onChange={e=>setCsvHostFilter(e.target.value)} style={{...IS.input,appearance:"none"}}>
              <option value="all">All Hosts</option>
              {hostOptions.map(h => <option key={h.userId} value={h.userId}>{h.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="rounded-2xl p-4" style={{background:"linear-gradient(145deg,#1a1f3c,#0f1225)"}}>
        <p style={{color:"rgba(255,255,255,0.4)",fontSize:"11px",fontWeight:700,textTransform:"uppercase",letterSpacing:"1px",margin:"0 0 10px"}}>{weekLabel}</p>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"6px"}}>
          <Pill label="Members"  value={members.length} />
          <Pill label="Hosts"    value={commScheds.length} />
          <Pill label="Live Now" value={liveNowCount} />
          <Pill label="🎁 Total" value={totalGiftAll>0?`$${totalGiftAll}`:"—"} accent={totalGiftAll>0} />
        </div>
      </div>

      {/* Schedules */}
      <div>
        <h3 style={{color:"#fff",fontWeight:900,fontSize:"15px",margin:"0 0 10px"}}>Schedules ({commScheds.length})</h3>
        {commScheds.length===0 && <p style={{color:"rgba(255,255,255,0.4)",fontSize:"13px",textAlign:"center",padding:"12px 0"}}>No schedules yet.</p>}
        {commScheds.map(sched => {
          const ss = signups.filter(sg=>sg.scheduleId===sched.id);
          const totalGift = ss.reduce((sum,sg)=>sum+(sg.plannedGiftAmount||0),0);
          const status = effectiveStatus(sched);
          return (
            <div key={sched.id} style={{background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"16px",padding:"14px",marginBottom:"10px"}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"8px",marginBottom:"8px"}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:"8px",marginBottom:"4px",flexWrap:"wrap"}}><Badge status={status} /><span style={{color:"rgba(255,255,255,0.4)",fontSize:"11px"}}>{platformIcon(sched.platform)} {sched.platform}</span></div>
                  <p className="text-white font-black text-sm">@{sched.hostUsername}</p>
                  <p className="text-white/40 text-xs">{formatDays(sched.daysOfWeek??[sched.dayOfWeek])} · {formatTime(sched.startTime)} – {formatTime(sched.endTime)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-amber-400 font-black text-xl leading-none">{ss.length}</p>
                  <p className="text-white/40 text-xs">supporters</p>
                  {totalGift>0 && <p className="text-emerald-400 text-xs font-semibold">${totalGift} est.</p>}
                </div>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:"6px",marginTop:"8px"}}>
                {status!==STATUS.LIVE_NOW&&status!==STATUS.CANCELLED&&<button onClick={()=>onGoLive(sched.id)} style={{background:"rgba(239,68,68,0.2)",color:"#f87171",fontSize:"11px",fontWeight:700,border:"none",borderRadius:"8px",padding:"6px 10px",cursor:"pointer"}}>🔴 Go Live</button>}
                {status!==STATUS.COMPLETED&&status!==STATUS.CANCELLED&&<button onClick={()=>onStatusChange(sched.id,STATUS.COMPLETED)} style={{background:"rgba(5,150,105,0.2)",color:"#6ee7b7",fontSize:"11px",fontWeight:700,border:"none",borderRadius:"8px",padding:"6px 10px",cursor:"pointer"}}>✓ Complete</button>}
                {status!==STATUS.CANCELLED&&<button onClick={()=>onStatusChange(sched.id,STATUS.CANCELLED)} style={{background:"rgba(107,114,128,0.2)",color:"rgba(255,255,255,0.5)",fontSize:"11px",fontWeight:700,border:"none",borderRadius:"8px",padding:"6px 10px",cursor:"pointer"}}>✕ Cancel</button>}
                {sched.manualStatus&&<button onClick={()=>onStatusChange(sched.id,null)} style={{background:"rgba(255,255,255,0.1)",color:"#fff",fontSize:"11px",fontWeight:700,border:"none",borderRadius:"8px",padding:"6px 10px",cursor:"pointer"}}>↺ Reset</button>}
              </div>
              {ss.length>0 && (
                <div style={{marginTop:"10px",borderTop:"1px solid rgba(255,255,255,0.08)",paddingTop:"10px",display:"flex",flexDirection:"column",gap:"6px"}}>
                  {ss.map(sg => (
                    <div key={sg.id} style={{display:"flex",alignItems:"center",gap:"8px",fontSize:"12px"}}>
                      <span style={{width:22,height:22,borderRadius:"50%",background:"linear-gradient(135deg,#fbbf24,#f43f5e)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:900,fontSize:"10px",flexShrink:0}}>{sg.displayName[0].toUpperCase()}</span>
                      <span className="text-white font-semibold">{sg.displayName}</span>
                      {sg.supporterUsername&&<span className="text-white/40">{sg.supporterUsername}</span>}
                      {sg.plannedGiftAmount!=null&&<span className="text-amber-300 font-semibold ml-auto">${sg.plannedGiftAmount}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Members */}
      <div>
        <h3 style={{color:"#fff",fontWeight:900,fontSize:"15px",margin:"0 0 10px"}}>Members ({members.length})</h3>
        <div className="rounded-2xl overflow-hidden" style={{background:"linear-gradient(145deg,#1e2340,#16192e)"}}>
          {members.map((m, i) => (
            <div key={m.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderBottom:i<members.length-1?"1px solid rgba(255,255,255,0.08)":"none"}}>
              <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                <div style={{width:30,height:30,borderRadius:"50%",background:"linear-gradient(135deg,#fbbf24,#f43f5e)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:900,fontSize:"12px",flexShrink:0}}>{m.username[0].toUpperCase()}</div>
                <div>
                  <p className="text-white font-semibold text-sm">@{m.username}</p>
                  {m.id === community.leaderId && <p className="text-amber-400 text-xs font-bold">👑 Leader</p>}
                </div>
              </div>
              {m.id !== community.leaderId && (
                <button onClick={() => onRemoveMember(community.id, m.id)} className="text-red-400/60 hover:text-red-400 text-xs font-semibold transition-colors">Remove</button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard View ────────────────────────────────────────────────────────────

// ─── Host Card (grouped — one card per host) ──────────────────────────────────
// Shows a host's full weekly schedule with next/live occurrence highlighted.

function HostCard({ schedule, occurrences, signups, onView, isOwner, onGoLive }) {
  const now        = new Date();
  const today      = now.toDateString();
  const tomorrow   = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const tomorrowStr = tomorrow.toDateString();

  // Find the most urgent occurrence (live now first, then soonest upcoming)
  const live    = occurrences.find(o => o.status === STATUS.LIVE_NOW);
  const primary = live || occurrences[0];
  if (!primary) return null;

  const status   = primary.status;
  const daysAway = primary.daysAway;
  const isToday  = primary.dateObj.toDateString() === today;
  const isTomorrow = primary.dateObj.toDateString() === tomorrowStr;

  const dayLabel = status === STATUS.LIVE_NOW ? "🔴 Live Now"
    : isToday    ? "Today"
    : isTomorrow ? "Tomorrow"
    : formatDate(primary.dateObj);

  // All days this host goes live — show as short day pills
  const days = schedule.daysOfWeek ?? [];
  const DAY_SHORT = ["Su","Mo","Tu","We","Th","Fr","Sa"];

  // Total signups across all occurrences for this host
  const totalSignups = signups.filter(sg => sg.scheduleId === schedule.id).length;
  const totalGift    = signups.filter(sg => sg.scheduleId === schedule.id)
                              .reduce((sum, sg) => sum + (sg.plannedGiftAmount || 0), 0);

  return (
    <div style={{background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"16px",padding:"14px",display:"flex",flexDirection:"column",gap:"10px",boxSizing:"border-box"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:"8px"}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"4px",flexWrap:"wrap"}}>
            <Badge status={status} />
            <span style={{color:"rgba(255,255,255,0.5)",fontSize:"11px"}}>{platformIcon(schedule.platform)}</span>
          </div>
          <p style={{color:"#fff",fontWeight:900,fontSize:"14px",margin:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>@{schedule.hostUsername}</p>
          <p style={{color:"#fbbf24",fontSize:"11px",fontWeight:700,margin:"2px 0 0"}}>{dayLabel}</p>
          <p style={{color:"rgba(255,255,255,0.5)",fontSize:"11px",margin:"1px 0 0"}}>{formatTime(schedule.startTime)} – {formatTime(schedule.endTime)}</p>
        </div>
        {/* Day pills */}
        <div style={{display:"flex",gap:"3px",flexWrap:"wrap",justifyContent:"flex-end",maxWidth:"90px"}}>
          {DAY_SHORT.map((d, i) => {
            const isScheduled = days.includes(i);
            const isNext = primary.dateObj.getDay() === i;
            return (
              <span key={i} style={{
                fontSize:"9px", fontWeight:700, padding:"2px 4px", borderRadius:"4px",
                background: isScheduled && isNext ? "#fbbf24"
                          : isScheduled ? "rgba(251,191,36,0.2)"
                          : "rgba(255,255,255,0.06)",
                color: isScheduled && isNext ? "#1c1400"
                     : isScheduled ? "#fbbf24"
                     : "rgba(255,255,255,0.2)",
              }}>{d}</span>
            );
          })}
        </div>
      </div>

      {/* Notes */}
      {schedule.notes && (
        <p style={{color:"rgba(255,255,255,0.45)",fontSize:"11px",background:"rgba(255,255,255,0.05)",borderRadius:"8px",padding:"5px 8px",margin:0}}>{schedule.notes}</p>
      )}

      {/* Stats */}
      <div style={{display:"flex",gap:"6px"}}>
        <div style={{background:"rgba(255,255,255,0.1)",borderRadius:"8px",padding:"5px 4px",textAlign:"center",flex:1}}>
          <p style={{color:"#fff",fontWeight:900,fontSize:"13px",margin:0,lineHeight:1}}>{totalSignups}</p>
          <p style={{color:"rgba(255,255,255,0.5)",fontSize:"10px",margin:"2px 0 0"}}>supporters</p>
        </div>
        {totalGift > 0 && (
          <div style={{background:"#fbbf24",borderRadius:"8px",padding:"5px 4px",textAlign:"center",flex:1}}>
            <p style={{color:"#1c1400",fontWeight:900,fontSize:"13px",margin:0,lineHeight:1}}>${totalGift}</p>
            <p style={{color:"rgba(28,20,0,0.6)",fontSize:"10px",margin:"2px 0 0"}}>planned 🎁</p>
          </div>
        )}
      </div>

      {/* Action */}
      <div style={{display:"flex",gap:"6px",marginTop:"auto"}}>
        <button onClick={() => onView(primary.occurrenceId)}  /* opens detail for this host's next occurrence */
          style={{flex:1,background:"#fbbf24",color:"#1c1400",fontWeight:700,fontSize:"12px",border:"none",borderRadius:"10px",padding:"8px",cursor:"pointer"}}>
          View & Sign Up
        </button>
        {isOwner && status !== STATUS.LIVE_NOW && status !== STATUS.CANCELLED && daysAway === 0 && (
          <button onClick={() => onGoLive(schedule.id)}
            style={{background:"rgba(239,68,68,0.8)",color:"#fff",border:"none",borderRadius:"10px",padding:"8px 10px",fontSize:"12px",fontWeight:700,cursor:"pointer"}}>🔴</button>
        )}
      </div>
    </div>
  );
}

// ─── MemberCount ──────────────────────────────────────────────────────────────
function MemberCount({ communityId }) {
  const [count, setCount] = useState(null);

  useEffect(() => {
    if (!communityId) return;
    supabase
      .from("community_members")
      .select("user_id", { count: "exact", head: true })
      .eq("community_id", communityId)
      .then(({ count: c }) => setCount(c));
  }, [communityId]);

  if (count === null) return null;
  return (
    <span style={{color:"rgba(255,255,255,0.4)",fontSize:"13px",fontWeight:600}}>
      {count} member{count !== 1 ? "s" : ""}
    </span>
  );
}

function DashboardView({ schedules, signups, currentUser, communities, tick, onView, onGoLive, onAddSchedule, onJoinCommunity, onCreateCommunity, activeCommunityId, onSwitchCommunity }) {
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");

  const myGroups = communities.filter(c => currentUser.communityIds?.includes(c.id));
  const activeCommunity = communities.find(c=>c.id===activeCommunityId);

  const communitySchedules = useMemo(() => {
    if (!activeCommunityId) return [];
    return schedules.filter(s => s.communityId === activeCommunityId);
  }, [schedules, activeCommunityId]);

  // All occurrences expanded (7 days out for ALL, 4 for Coming Up)
  const allOccurrences = useMemo(() => {
    const occ = communitySchedules.flatMap(s => expandOccurrences(s));
    const order = { [STATUS.LIVE_NOW]:0, [STATUS.UPCOMING]:1, [STATUS.COMPLETED]:2, [STATUS.CANCELLED]:3 };
    return occ.sort((a,b) => { const oa=order[a.status]??9, ob=order[b.status]??9; return oa!==ob?oa-ob:a.dateObj-b.dateObj; });
  }, [communitySchedules, tick]);

  // Filter occurrences for display — one card per occurrence
  const filteredOcc = useMemo(() => {
    const now = new Date();
    const todayStr     = now.toDateString();
    const tomorrowDate = new Date(now); tomorrowDate.setDate(now.getDate() + 1);
    const tomorrowStr  = tomorrowDate.toDateString();

    let list = allOccurrences;
    if (filter === "Live Now")  list = list.filter(o => o.status === STATUS.LIVE_NOW);
    if (filter === "Today")     list = list.filter(o => o.dateObj.toDateString() === todayStr);
    if (filter === "Tomorrow")  list = list.filter(o => o.dateObj.toDateString() === tomorrowStr);
    if (filter === "Coming Up") list = list.filter(o => o.daysAway >= 0 && o.daysAway <= 4 && o.status !== STATUS.LIVE_NOW);
    if (search.trim()) {
      const q = search.trim().replace(/^@/,"").toLowerCase();
      list = list.filter(o => o.schedule.hostUsername.toLowerCase().includes(q));
    }
    return list;
  }, [allOccurrences, filter, search]);

  const liveNowCount  = communitySchedules.filter(s => effectiveStatus(s) === STATUS.LIVE_NOW).length;
  const todayCount    = allOccurrences.filter(o => o.dateObj.toDateString() === new Date().toDateString()).length;
  const tomorrowDate  = new Date(); tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowCount = allOccurrences.filter(o => o.dateObj.toDateString() === tomorrowDate.toDateString()).length;
  const comingUpCount = allOccurrences.filter(o => o.daysAway >= 0 && o.daysAway <= 4 && o.status !== STATUS.LIVE_NOW).length;

  const filterTabs = [
    { key:"All",       label:"All",        count: 0 },
    { key:"Live Now",  label:"🔴 Live",    count: liveNowCount },
    { key:"Today",     label:"📅 Today",   count: todayCount },
    { key:"Tomorrow",  label:"🌅 Tomorrow",count: tomorrowCount },
    { key:"Coming Up", label:"⏳ Coming",  count: comingUpCount },
  ];

  const emptyMsg = search ? `No lives found for "@${search.replace(/^@/,"")}"` :
    filter==="Live Now" ? "No one is live right now." :
    filter==="Today"    ? "No lives today." :
    filter==="Tomorrow" ? "Nothing scheduled tomorrow." :
    filter==="Coming Up"? "Nothing coming up in the next 4 days." :
    "No schedules in this community yet.";

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
      <CommunitySwitcher myGroups={myGroups} activeCommunityId={activeCommunityId} onSwitch={onSwitchCommunity} onJoin={onJoinCommunity} onCreate={onCreateCommunity} />

      {!activeCommunityId || myGroups.length===0 ? null : (
        <>
          <div style={{display:"flex",alignItems:"baseline",gap:"10px",flexWrap:"wrap"}}>
            <h1 style={{color:"#fff",fontWeight:900,fontSize:"18px",margin:0}}>{activeCommunity?.name} Lives</h1>
            <MemberCount communityId={activeCommunityId} />
          </div>

          {/* Search */}
          <div style={{position:"relative"}}>
            <span style={{position:"absolute",left:"12px",top:"50%",transform:"translateY(-50%)",fontSize:"14px",opacity:0.35}}>🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by @username…"
              style={{...IS.input,paddingLeft:"36px",paddingRight:"36px"}} />
            {search && <button onClick={()=>setSearch("")} style={{position:"absolute",right:"12px",top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"rgba(255,255,255,0.4)",fontSize:"13px",cursor:"pointer"}}>✕</button>}
          </div>

          {/* Filter tabs — scrollable row */}
          <div style={{display:"flex",gap:"6px",overflowX:"auto",paddingBottom:"2px",scrollbarWidth:"none"}}>
            {filterTabs.map(tab => (
              <button key={tab.key} onClick={()=>setFilter(tab.key)}
                style={{flexShrink:0,display:"flex",alignItems:"center",gap:"5px",padding:"6px 12px",borderRadius:"20px",fontSize:"11px",fontWeight:700,border:"none",cursor:"pointer",
                  background:filter===tab.key?"#fbbf24":"rgba(255,255,255,0.1)",color:filter===tab.key?"#1c1400":"rgba(255,255,255,0.6)"}}>
                {tab.label}
                {tab.count>0&&tab.key!=="All"&&<span style={{borderRadius:"20px",padding:"1px 5px",fontSize:"10px",fontWeight:900,lineHeight:1,
                  background:filter===tab.key?"rgba(0,0,0,0.15)":"rgba(255,255,255,0.1)",color:filter===tab.key?"#1c1400":"rgba(255,255,255,0.6)"}}>{tab.count}</span>}
              </button>
            ))}
          </div>

          {filteredOcc.length===0 ? (
            <div style={{textAlign:"center",padding:"48px 0"}}>
              <p style={{fontSize:"36px",marginBottom:"10px"}}>{filter==="Live Now"?"📡":search?"🔎":"📭"}</p>
              <p style={{color:"rgba(255,255,255,0.4)",fontSize:"14px",fontWeight:600}}>{emptyMsg}</p>
              {!search&&filter==="All"&&<button onClick={onAddSchedule} style={{background:"none",border:"none",color:"#fbbf24",fontSize:"13px",textDecoration:"underline",cursor:"pointer",marginTop:"10px",display:"inline-block"}}>Post your schedule</button>}
            </div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(160px, 1fr))",gap:"12px"}}>
              {filteredOcc.map(occ => (
                <OccurrenceCard
                  key={occ.occurrenceId}
                  occurrence={occ}
                  signups={signups}
                  onView={onView}
                  isOwner={occ.schedule.userId === currentUser.id}
                  onGoLive={onGoLive}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Paywall Screen ───────────────────────────────────────────────────────────
/**
 * Shown to any logged-in user who hasn't paid yet.
 * Clicking "Subscribe" calls your backend which creates a Stripe Checkout session.
 *
 * [DB INTEGRATION — STRIPE]
 * 1. npm install @stripe/stripe-js stripe
 * 2. Set env vars: NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, STRIPE_SECRET_KEY, STRIPE_PRICE_ID
 * 3. Create /api/stripe/checkout route (see api/stripe/checkout.ts file)
 * 4. Create /api/stripe/webhook route to listen for checkout.session.completed
 *    and flip profiles.has_paid = true in Supabase
 *
 * Supabase schema:
 *   alter table profiles add column has_paid boolean default false;
 *   alter table profiles add column stripe_customer_id text;
 *   alter table profiles add column subscription_id text;
 *   alter table profiles add column paid_at timestamptz;
 */
function PaywallScreen({ currentUser, onPaymentSuccess, onLogout }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  async function handleSubscribe() {
    if (!currentUser?.id) {
      setError("User account was not found. Please sign out and sign back in.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUser.id, username: currentUser.username }),
      });

      const raw = await res.text();
      let data = {};

      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (parseError) {
        console.error("Stripe checkout JSON parse error:", parseError, raw);
        throw new Error("Stripe checkout returned an invalid response.");
      }

      if (!res.ok) {
        throw new Error(data.error || data.message || "Could not start Stripe checkout.");
      }

      if (!data.url) {
        throw new Error("Stripe checkout did not return a checkout URL.");
      }

      // Replace current history entry so the paywall isn't in the back stack.
      // This prevents the back gesture from returning to the paywall or Stripe page.
      window.location.replace(data.url);
    } catch (e) {
      console.error("Checkout error:", e);
      setError(e.message || "Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div style={{minHeight:"100vh",width:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 20px",background:"linear-gradient(180deg,#0d0f1c,#0a0c18)",boxSizing:"border-box"}}>
      <div style={{width:"100%",maxWidth:"420px",boxSizing:"border-box"}}>
        <div style={{textAlign:"center",marginBottom:"24px"}}>
          <p style={{fontSize:"44px",marginBottom:"10px"}}>📡</p>
          <h1 style={{color:"#fff",fontWeight:900,fontSize:"24px",margin:0}}>LiveSupport <span style={{color:"#fbbf24"}}>Scheduler</span></h1>
        </div>
        <div style={{borderRadius:"20px",overflow:"hidden",marginBottom:"16px",border:"1px solid rgba(251,191,36,0.25)",background:"linear-gradient(145deg,#1e2340,#16192e)"}}>
          <div style={{padding:"20px 24px",textAlign:"center",background:"linear-gradient(135deg,rgba(251,191,36,0.15),rgba(251,191,36,0.05))"}}>
            <p style={{color:"#fbbf24",fontSize:"11px",fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",margin:"0 0 8px"}}>Full Access</p>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"center",gap:"4px"}}>
              <span style={{color:"#fff",fontSize:"22px",fontWeight:900,marginTop:"6px"}}>$</span>
              <span style={{color:"#fff",fontWeight:900,fontSize:"56px",lineHeight:1}}>2.99</span>
              <span style={{color:"rgba(255,255,255,0.5)",fontSize:"14px",alignSelf:"flex-end",marginBottom:"6px"}}>/mo</span>
            </div>
            <p style={{color:"rgba(255,255,255,0.5)",fontSize:"13px",margin:"6px 0 0"}}>Cancel anytime</p>
          </div>
          <div style={{padding:"16px 24px",display:"flex",flexDirection:"column",gap:"12px"}}>
            {["View all community live schedules","Sign up to support your favorite hosts","Get notified when hosts go live","Track planned gift amounts","Join multiple communities","Post your own weekly schedule"].map((f,i) => (
              <div key={i} style={{display:"flex",alignItems:"center",gap:"12px"}}>
                <span style={{color:"#fbbf24",fontSize:"15px",flexShrink:0}}>✓</span>
                <span style={{color:"rgba(255,255,255,0.8)",fontSize:"14px"}}>{f}</span>
              </div>
            ))}
          </div>
          <div style={{padding:"0 24px 24px"}}>
            {error && <p style={{color:"#f87171",fontSize:"12px",background:"rgba(239,68,68,0.1)",borderRadius:"10px",padding:"8px 12px",marginBottom:"12px",textAlign:"center"}}>{error}</p>}
            <button onClick={handleSubscribe} disabled={loading}
              style={{width:"100%",background:"#fbbf24",color:"#1c1400",fontWeight:900,fontSize:"16px",border:"none",borderRadius:"14px",padding:"15px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",opacity:loading?0.7:1,boxSizing:"border-box"}}>
              {loading ? (
                <>
                  <span style={{width:18,height:18,border:"2.5px solid #92400e",borderTopColor:"transparent",borderRadius:"50%",display:"inline-block",animation:"spin 0.7s linear infinite"}} />
                  Processing…
                </>
              ) : <>🔓 Subscribe for $2.99/mo</>}
            </button>
            <p style={{color:"rgba(255,255,255,0.25)",fontSize:"11px",textAlign:"center",margin:"10px 0 0"}}>Secured by Stripe · Cancel anytime in settings</p>
          </div>
        </div>
        <p style={{color:"rgba(255,255,255,0.3)",fontSize:"12px",textAlign:"center"}}>
          Signed in as <span style={{color:"rgba(255,255,255,0.5)",fontWeight:700}}>@{currentUser.username}</span>{" · "}
          <button
            type="button"
            onClick={onLogout}
            style={{background:"none",border:"none",color:"rgba(255,255,255,0.4)",cursor:"pointer",textDecoration:"underline",fontSize:"12px"}}
          >
            Sign out
          </button>
        </p>
      </div>
    </div>
  );
}

// ─── Notification Bell ─────────────────────────────────────────────────────────
/**
 * Allows users to subscribe to web push notifications.
 * When a host goes live, your server sends a push to all subscribed community members.
 *
 * [DB INTEGRATION — WEB PUSH]
 * 1. npm install web-push
 * 2. Generate VAPID keys: npx web-push generate-vapid-keys
 * 3. Set env vars: NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL
 * 4. Create /api/push/subscribe route — saves PushSubscription to Supabase push_subscriptions table
 * 5. Create /api/push/send route — called when host goes live, sends push to community members
 *
 * Supabase schema:
 *   create table push_subscriptions (
 *     id uuid primary key default gen_random_uuid(),
 *     user_id uuid references auth.users(id),
 *     community_id text,
 *     endpoint text not null,
 *     p256dh text not null,
 *     auth text not null,
 *     created_at timestamptz default now()
 *   );
 */
function NotificationBell({ currentUser, activeCommunityId }) {
  const [status,   setStatus]   = useState("idle"); // idle | requesting | granted | denied | unsupported
  const [loading,  setLoading]  = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setStatus("unsupported"); return;
    }
    setStatus(Notification.permission === "granted" ? "granted" :
              Notification.permission === "denied"  ? "denied"  : "idle");
  }, []);

  async function requestPermission() {
    if (!("Notification" in window)) return;
    setLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        // [DB INTEGRATION] Register service worker + get push subscription, then POST to /api/push/subscribe
        // const reg = await navigator.serviceWorker.ready;
        // const sub = await reg.pushManager.subscribe({
        //   userVisibleOnly: true,
        //   applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
        // });
        // await fetch("/api/push/subscribe", {
        //   method: "POST",
        //   headers: { "Content-Type": "application/json" },
        //   body: JSON.stringify({ subscription: sub, userId: currentUser.id, communityId: activeCommunityId }),
        // });
        setStatus("granted");
      } else {
        setStatus("denied");
      }
    } catch (e) {
      console.error("Push subscription error:", e);
    }
    setLoading(false);
  }

  if (status === "unsupported") return null;

  return (
    <div className="relative">
      <button onClick={() => status === "idle" ? requestPermission() : setShowInfo(v=>!v)}
        disabled={loading}
        title={status === "granted" ? "Notifications on" : status === "denied" ? "Notifications blocked" : "Enable notifications"}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
          status === "granted" ? "bg-emerald-500/20 text-emerald-400" :
          status === "denied"  ? "bg-red-500/20 text-red-400" :
          "bg-white/10 hover:bg-white/20 text-white/60"
        }`}>
        {loading ? "…" : status === "granted" ? "🔔 On" : status === "denied" ? "🔕 Off" : "🔔"}
      </button>

      {/* Info popover */}
      {showInfo && (
        <div style={{position:"absolute",right:0,top:"100%",marginTop:"6px",width:"200px",background:"#1e2340",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"16px",overflow:"hidden",zIndex:100,boxShadow:"0 8px 32px rgba(0,0,0,0.4)"}}>
          {status === "granted" && <p className="text-white/70 text-xs">You'll get notified when hosts in your community go live. To turn off, check your browser notification settings.</p>}
          {status === "denied"  && <p className="text-white/70 text-xs">Notifications are blocked. Go to your browser settings → Site Settings → Notifications to allow them for this site.</p>}
        </div>
      )}
    </div>
  );
}

// ─── Help View (FAQ, How To, Contact) ─────────────────────────────────────────

const FAQ_ITEMS = [
  {
    q: "What is a planned gift amount?",
    a: "It's just a planning tool — entering an amount does NOT charge you anything. It helps hosts know roughly how much support to expect so they can plan their live sessions. No payment is ever processed in this app.",
  },
  {
    q: "How do I join a community?",
    a: "Ask your community leader for their invite code. Then tap your avatar → Join a Community and enter the code. You can join multiple communities.",
  },
  {
    q: "How do I get an invite code for my community?",
    a: "If you're the leader, your invite code is shown in the Admin panel under your community name. Share it via text, Discord, or however you communicate with your group.",
  },
  {
    q: "Why am I not seeing any lives on the dashboard?",
    a: "Make sure you've joined a community and have the right community tab selected at the top of the dashboard. Lives only show for communities you belong to.",
  },
  {
    q: "How does Live Now work?",
    a: "When a host's scheduled time window starts, their card automatically flips to Live Now — no one has to do anything. Hosts can also tap Go Live Early if they start before their scheduled time.",
  },
  {
    q: "How do I cancel my subscription?",
    a: "Tap your avatar in the top right → Manage Subscription. This opens Stripe's billing portal where you can cancel, update your payment method, or view invoices. You can cancel anytime.",
  },
  {
    q: "Will I lose access immediately if I cancel?",
    a: "No — you keep access until the end of your current billing period.",
  },
  {
    q: "Can I sign up to support a live without entering a gift amount?",
    a: "Yes, the gift amount is completely optional. You can sign up with just your name and nothing else.",
  },
];

const HOWTO_ITEMS = [
  {
    title: "Set up your weekly schedule",
    steps: [
      "Tap My Schedule in the bottom nav.",
      "Tap Set My Weekly Schedule.",
      "Select your community, platform, days of the week, and start/end times.",
      "Tap Save My Schedule — your live will now appear on the dashboard every week automatically.",
    ],
  },
  {
    title: "Share your invite code with supporters",
    steps: [
      "Tap your avatar → Admin (only visible to community leaders).",
      "Your invite code is shown at the top of the Admin panel.",
      "Share it however you like — text, Discord, TikTok bio, etc.",
      "Supporters enter it when creating their account or via your avatar → Join a Community.",
    ],
  },
  {
    title: "Go live early or end a live",
    steps: [
      "Tap My Schedule in the bottom nav.",
      "Under Live Controls, tap Go Live Early to flip your status to Live Now immediately.",
      "Tap End Live when you're done, or Cancel This Week to hide your live for this week.",
      "Tap Reset to Auto to let the schedule run automatically again.",
    ],
  },
  {
    title: "Sign up to support a host",
    steps: [
      "Find a live on the dashboard and tap View & Sign Up.",
      "Fill in your name and optionally a planned gift amount (this does NOT charge you).",
      "Tap Sign Me Up — you'll appear in the host's supporter list.",
      "You can edit or remove your signup anytime by reopening the same live.",
    ],
  },
];

function HelpView({ onClose }) {
  const [tab,        setTab]        = useState("faq");
  const [openIndex,  setOpenIndex]  = useState(null);

  const tabStyle = (t) => ({
    flex:1, padding:"9px 0", borderRadius:"9px", fontSize:"13px", fontWeight:700,
    border:"none", cursor:"pointer",
    background: tab===t ? "#fbbf24" : "transparent",
    color:       tab===t ? "#1c1400" : "rgba(255,255,255,0.55)",
  });

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <h2 style={{color:"#fff",fontWeight:900,fontSize:"20px",margin:0}}>Help</h2>
        <button onClick={onClose} style={{background:"none",border:"none",color:"rgba(255,255,255,0.5)",fontSize:"14px",cursor:"pointer",fontWeight:700}}>✕ Close</button>
      </div>

      {/* Tab switcher */}
      <div style={{display:"flex",background:"rgba(255,255,255,0.1)",borderRadius:"12px",padding:"4px",gap:"4px"}}>
        <button style={tabStyle("faq")}     onClick={()=>setTab("faq")}>FAQ</button>
        <button style={tabStyle("howto")}   onClick={()=>setTab("howto")}>How To</button>
        <button style={tabStyle("contact")} onClick={()=>setTab("contact")}>Contact</button>
      </div>

      {/* ── FAQ ── */}
      {tab === "faq" && (
        <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
          {FAQ_ITEMS.map((item, i) => (
            <div key={i} style={{background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"14px",overflow:"hidden"}}>
              <button
                onClick={() => setOpenIndex(openIndex===i ? null : i)}
                style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",background:"none",border:"none",cursor:"pointer",textAlign:"left",gap:"10px"}}>
                <p style={{color:"#fff",fontWeight:700,fontSize:"13px",margin:0,flex:1}}>{item.q}</p>
                <span style={{color:"#fbbf24",fontSize:"16px",flexShrink:0,lineHeight:1,transform:openIndex===i?"rotate(180deg)":"none",transition:"transform 0.2s"}}>›</span>
              </button>
              {openIndex === i && (
                <div style={{padding:"0 16px 14px"}}>
                  <p style={{color:"rgba(255,255,255,0.6)",fontSize:"13px",lineHeight:1.6,margin:0}}>{item.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── How To ── */}
      {tab === "howto" && (
        <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
          {HOWTO_ITEMS.map((item, i) => (
            <div key={i} style={{background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"14px",padding:"16px"}}>
              <p style={{color:"#fbbf24",fontWeight:900,fontSize:"13px",margin:"0 0 10px"}}>
                {i+1}. {item.title}
              </p>
              <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                {item.steps.map((step, j) => (
                  <div key={j} style={{display:"flex",alignItems:"flex-start",gap:"10px"}}>
                    <span style={{width:20,height:20,borderRadius:"50%",background:"rgba(251,191,36,0.2)",color:"#fbbf24",fontSize:"11px",fontWeight:900,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:"1px"}}>{j+1}</span>
                    <p style={{color:"rgba(255,255,255,0.7)",fontSize:"13px",lineHeight:1.5,margin:0}}>{step}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Contact ── */}
      {tab === "contact" && (
        <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
          <div style={{background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"16px",padding:"20px",textAlign:"center"}}>
            <p style={{fontSize:"32px",marginBottom:"10px"}}>✉️</p>
            <p style={{color:"#fff",fontWeight:900,fontSize:"16px",margin:"0 0 6px"}}>Get in Touch</p>
            <p style={{color:"rgba(255,255,255,0.5)",fontSize:"13px",margin:"0 0 20px",lineHeight:1.5}}>
              Have a question, bug report, or feedback?<br/>We'd love to hear from you.
            </p>
            <a href="mailto:info@elevateinfluence.us"
              style={{display:"block",background:"#fbbf24",color:"#1c1400",fontWeight:900,fontSize:"14px",borderRadius:"14px",padding:"13px",textDecoration:"none"}}>
              info@elevateinfluence.us
            </a>
          </div>
          <div style={{background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"14px",padding:"16px"}}>
            <p style={{color:"rgba(255,255,255,0.5)",fontSize:"12px",margin:0,lineHeight:1.6,textAlign:"center"}}>
              For billing issues, use <strong style={{color:"#fff"}}>Manage Subscription</strong> in the menu above to access the Stripe billing portal directly.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── User Menu ────────────────────────────────────────────────────────────────

function UserMenu({ currentUser, onLogout, onManage, onHelp }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (!e.target.closest("#user-menu")) setOpen(false);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  const itemStyle = {
    width:"100%", display:"flex", alignItems:"center", gap:"12px",
    padding:"11px 16px", background:"none", border:"none", cursor:"pointer",
    textAlign:"left", borderTop:"1px solid rgba(255,255,255,0.05)",
  };

  return (
    <div id="user-menu" style={{position:"relative"}}>
      <button onClick={() => setOpen(v => !v)}
        style={{width:32,height:32,borderRadius:"50%",background:"linear-gradient(135deg,#fbbf24,#f43f5e)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontWeight:900,fontSize:"13px",border:"none",cursor:"pointer",flexShrink:0}}>
        {currentUser.username[0].toUpperCase()}
      </button>

      {open && (
        <div style={{position:"absolute",right:0,top:"calc(100% + 8px)",width:"220px",background:"#1e2340",border:"1px solid rgba(255,255,255,0.1)",borderRadius:"18px",overflow:"hidden",zIndex:100,boxShadow:"0 8px 40px rgba(0,0,0,0.5)"}}>

          {/* User info */}
          <div style={{padding:"12px 16px",borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
            <p style={{color:"#fff",fontWeight:900,fontSize:"13px",margin:0}}>@{currentUser.username}</p>
            <p style={{fontSize:"11px",fontWeight:700,margin:"3px 0 0",color:currentUser.hasPaid?"#34d399":"#f87171"}}>
              {currentUser.hasPaid ? "✓ Active subscription" : "No active subscription"}
            </p>
          </div>

          {/* Menu items */}
          {currentUser.hasPaid && (
            <button onClick={() => { setOpen(false); onManage(); }} style={itemStyle}>
              <span style={{fontSize:"16px"}}>💳</span>
              <div>
                <p style={{color:"#fff",fontSize:"13px",fontWeight:700,margin:0}}>Manage Subscription</p>
                <p style={{color:"rgba(255,255,255,0.4)",fontSize:"11px",margin:"2px 0 0"}}>Cancel or update billing</p>
              </div>
            </button>
          )}

          <button onClick={() => { setOpen(false); onHelp(); }} style={itemStyle}>
            <span style={{fontSize:"16px"}}>❓</span>
            <div>
              <p style={{color:"#fff",fontSize:"13px",fontWeight:700,margin:0}}>Help</p>
              <p style={{color:"rgba(255,255,255,0.4)",fontSize:"11px",margin:"2px 0 0"}}>FAQ · How To · Contact</p>
            </div>
          </button>

          <button onClick={() => { setOpen(false); onLogout(); }} style={itemStyle}>
            <span style={{fontSize:"16px"}}>🚪</span>
            <p style={{color:"rgba(255,255,255,0.65)",fontSize:"13px",fontWeight:700,margin:0}}>Sign Out</p>
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Share Schedule Modal ─────────────────────────────────────────────────────
// Shown after joining a new community if the user already has a schedule elsewhere

function ShareScheduleModal({ community, existingSchedule, onConfirm, onSkip }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}>
      <div style={{width:"100%",maxWidth:"400px",background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"20px",padding:"24px",border:"1px solid rgba(255,255,255,0.1)"}}>
        <p style={{fontSize:"32px",textAlign:"center",marginBottom:"12px"}}>📅</p>
        <h3 style={{color:"#fff",fontWeight:900,fontSize:"18px",textAlign:"center",margin:"0 0 8px"}}>
          Add your schedule to {community.name}?
        </h3>
        <p style={{color:"rgba(255,255,255,0.5)",fontSize:"13px",textAlign:"center",margin:"0 0 6px",lineHeight:1.5}}>
          You already go live on <strong style={{color:"#fbbf24"}}>{existingSchedule.platform}</strong> — want members of <strong style={{color:"#fbbf24"}}>{community.name}</strong> to see your schedule too?
        </p>
        <p style={{color:"rgba(255,255,255,0.35)",fontSize:"11px",textAlign:"center",margin:"0 0 20px"}}>
          Your same days & times will be shared.
        </p>
        <div style={{display:"flex",gap:"10px"}}>
          <button onClick={onSkip}
            style={{flex:1,background:"rgba(255,255,255,0.1)",color:"#fff",fontWeight:700,fontSize:"14px",border:"none",borderRadius:"12px",padding:"12px",cursor:"pointer"}}>
            Not Now
          </button>
          <button onClick={onConfirm}
            style={{flex:1,background:"#fbbf24",color:"#1c1400",fontWeight:900,fontSize:"14px",border:"none",borderRadius:"12px",padding:"12px",cursor:"pointer"}}>
            Yes, Share It! 🎯
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── App Root ──────────────────────────────────────────────────────────────────

const VIEWS = { DASHBOARD:"dashboard", DETAIL:"detail", MY:"my", ADMIN:"admin", HELP:"help" };

export default function App() {
  // [DB INTEGRATION] Replace all useState with useEffect + API/Supabase fetches on mount.
  const [communities, setCommunities] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [signups, setSignups] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState(SEED_USERS);
  const [pendingUser,  setPendingUser]  = useState(null); // user awaiting post-register flow
  const [view,         setView]         = useState(VIEWS.DASHBOARD);
  const [activeId,    setActiveId]    = useState(null);
  const [activeCommunityId, setActiveCommunityId] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [shareScheduleFor, setShareScheduleFor] = useState(null); // community to share schedule into

  const [tick, setTick] = useState(0);

  // Tick every 30s for Live Now auto-detection
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // Refresh all community data every 5 minutes
  useEffect(() => {
    if (!currentUser) return;
    const interval = setInterval(async () => {
      const ids = currentUser.communityIds || [];
      if (ids.length === 0) return;
      console.log("[REFRESH] Auto-refreshing community data...");
      for (const communityId of ids) {
        // Refresh schedules
        const { data: freshSchedules } = await supabase
          .from("schedules")
          .select("id, user_id, community_id, host_username, platform, days_of_week, start_time, end_time, notes, manual_status, created_at, updated_at")
          .eq("community_id", communityId);

        if (freshSchedules) {
          const mapped = freshSchedules.map(s => ({
            id:           s.id,
            userId:       s.user_id,
            communityId:  s.community_id,
            hostUsername: s.host_username,
            platform:     s.platform,
            daysOfWeek:   (s.days_of_week || []).map(Number),
            startTime:    s.start_time ? String(s.start_time).slice(0, 5) : "12:00",
            endTime:      s.end_time   ? String(s.end_time).slice(0, 5)   : "13:00",
            notes:        s.notes || "",
            manualStatus: s.manual_status,
            createdAt:    s.created_at,
            updatedAt:    s.updated_at,
          }));
          setSchedules(prev => {
            // Merge: update existing, add new ones
            const updated = prev.filter(s => s.communityId !== communityId);
            return [...updated, ...mapped];
          });
        }

        // Refresh signups for this community's schedules
        const scheduleIds = schedules
          .filter(s => s.communityId === communityId)
          .map(s => s.id);

        if (scheduleIds.length > 0) {
          const { data: freshSignups } = await supabase
            .from("signups")
            .select("id, occurrence_id, schedule_id, display_name, supporter_username, planned_gift_amount, comment, created_at")
            .in("schedule_id", scheduleIds);

          if (freshSignups) {
            const mapped = freshSignups.map(sg => ({
              id:                sg.id,
              occurrenceId:      sg.occurrence_id,
              scheduleId:        sg.schedule_id,
              displayName:       sg.display_name,
              supporterUsername: sg.supporter_username || "",
              plannedGiftAmount: sg.planned_gift_amount,
              comment:           sg.comment || "",
              createdAt:         sg.created_at,
            }));
            setSignups(prev => {
              const existingIds = new Set(mapped.map(s => s.id));
              const kept = prev.filter(s => !existingIds.has(s.id));
              return [...kept, ...mapped];
            });
          }
        }
      }
      setTick(n => n + 1); // trigger re-render for Live Now status
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [currentUser, schedules]);

  // Handle browser back gesture (swipe left on iOS Safari)
  useEffect(() => {
    function handlePopState(e) {
      // If we were on the detail view and user swiped back, go to dashboard
      if (view === VIEWS.DETAIL) {
        setView(VIEWS.DASHBOARD);
        setActiveId(null);
      }
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [view]);

  // Set default active community when user logs in
  useEffect(() => {
    if (currentUser && !activeCommunityId) {
      setActiveCommunityId(currentUser.communityIds?.[0] ?? null);
    }
  }, [currentUser]);

  const activeOccurrence = useMemo(() => {
    if (!activeId||!activeId.includes("__")) return null;
    const sched = schedules.find(s=>s.id===activeId.split("__")[0]);
    if (!sched) return null;
    return expandOccurrences(sched).find(o=>o.occurrenceId===activeId)??null;
  }, [activeId, schedules, tick]);

  // Is the current user a leader of the active community?
  const activeCommunity     = communities.find(c=>c.id===activeCommunityId);
  const isGroupLeader       = activeCommunity?.leaderId === currentUser?.id;
  // Is the current user a leader of ANY community?
  const myLeaderCommunities = communities.filter(c=>c.leaderId===currentUser?.id);

useEffect(() => {

  if (currentUser && !activeCommunityId) {

    setActiveCommunityId(currentUser.communityIds?.[0] ?? null);

  }

}, [currentUser]);

async function loadUserFromSupabase(authUser) {

  if (!authUser) { setAuthLoading(false); return null; }

  console.log("[LOAD] Loading profile for user:", authUser.id);

  let { data: profile, error: profileError } = await supabase

    .from("profiles")

    .select("id, username, has_paid, paid_at")

    .eq("id", authUser.id)

    .maybeSingle();

  console.log("[LOAD] Profile result:", JSON.stringify(profile), "error:", profileError?.message ?? "none");

  if (profileError) {

    console.error("Profile load error:", profileError);
    setAuthLoading(false);
    return null;

  }

  if (!profile) {

    const fallbackUsername =

      authUser.user_metadata?.username ||

      authUser.email?.split("@")[0] ||

      "user";

    const { data: createdProfile, error: createProfileError } = await supabase

      .from("profiles")

      .insert({ id: authUser.id, username: fallbackUsername })

      .select("id, username, has_paid, paid_at")

      .single();

    if (createProfileError) {

      console.error("Profile create error:", createProfileError);
      setAuthLoading(false);
      return null;

    }

    profile = createdProfile;

  }

  const { data: memberships, error: membershipError } = await supabase
    .from("community_members")
    .select("community_id")
    .eq("user_id", authUser.id);

  if (membershipError) console.warn("Membership load warning:", membershipError.message || membershipError);

  const communityIds = (memberships || []).map(m => m.community_id);

  if (communityIds.length > 0) {
    const { data: loadedCommunities, error: communitiesError } = await supabase
      .from("communities")
      .select("id, name, invite_code, leader_id, created_at")
      .in("id", communityIds);

    if (communitiesError) {
      console.warn("Communities load warning:", communitiesError.message || communitiesError);
    } else {
      const mappedCommunities = (loadedCommunities || []).map(c => ({
        id: c.id,
        name: c.name,
        inviteCode: c.invite_code,
        leaderId: c.leader_id,
        createdAt: c.created_at,
      }));

      setCommunities(prev => {
        const existingIds = new Set(prev.map(c => c.id));
        const fresh = mappedCommunities.filter(c => !existingIds.has(c.id));
        return [...prev, ...fresh];
      });
    }

    const { data: loadedSchedules, error: schedulesError } = await supabase
      .from("schedules")
      .select("id, user_id, community_id, host_username, platform, days_of_week, start_time, end_time, notes, manual_status, created_at, updated_at")
      .in("community_id", communityIds);

    if (schedulesError) {
      console.warn("Schedules load warning:", schedulesError.message || schedulesError);
    } else {
      const mappedSchedules = (loadedSchedules || []).map(s => ({
        id: s.id,
        userId: s.user_id,
        communityId: s.community_id,
        hostUsername: s.host_username,
        platform: s.platform,
        daysOfWeek: (s.days_of_week || []).map(Number),
        startTime: s.start_time ? String(s.start_time).slice(0, 5) : "12:00",
        endTime: s.end_time ? String(s.end_time).slice(0, 5) : "13:00",
        notes: s.notes || "",
        manualStatus: s.manual_status,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      }));

      setSchedules(mappedSchedules);
    }
  }

  const appUser = {
    id: profile.id,
    username: profile.username,
    communityIds,
    hasPaid: profile.has_paid ?? false,
    paidAt: profile.paid_at ?? null,
  };

  // Set user and clear loading immediately — don't wait for communities/schedules
  setCurrentUser(appUser);
  setAuthLoading(false);

  setUsers(p =>
    p.find(u => u.id === appUser.id)
      ? p.map(u => u.id === appUser.id ? appUser : u)
      : [appUser, ...p]
  );

  return appUser;

}

useEffect(() => {
  let active = true;

  // Safety net — never stay stuck on "Loading account…" more than 8 seconds
  const timeout = setTimeout(() => {
    if (active) setAuthLoading(false);
  }, 8000);

  let isLoadingUser = false;

  const { data: listener } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (!active) return;

    if (event === "SIGNED_OUT") {
      isLoadingUser = false;
      setCurrentUser(null);
      setPendingUser(null);
      setActiveCommunityId(null);
      setView(VIEWS.DASHBOARD);
      setAuthLoading(false);
      return;
    }

    if ((event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") && session?.user) {
      // Prevent double-firing — only one load at a time
      if (isLoadingUser) return;
      isLoadingUser = true;
      try {
        await loadUserFromSupabase(session.user);
      } catch(e) {
        console.error("auth state error:", e);
      } finally {
        isLoadingUser = false;
        if (active) setAuthLoading(false);
      }
      return;
    }

    if (event === "INITIAL_SESSION" && !session) {
      setAuthLoading(false);
    }
  });

  return () => {
    active = false;
    clearTimeout(timeout);
    listener?.subscription?.unsubscribe();
  };
}, []);

  // ── Auth ──
async function handleLogin({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  if (data.user) await loadUserFromSupabase(data.user);
  return { error: null };
}

async function handleLogout() {
  await supabase.auth.signOut();
  setCurrentUser(null);
  setPendingUser(null);
  setView(VIEWS.DASHBOARD);
  setActiveCommunityId(null);
}

  function handleShowHelp() {
    setView(VIEWS.HELP);
  }

  async function handleManageSubscription() {
    // [DB INTEGRATION — STRIPE] Redirects to Stripe Customer Portal for cancellation,
    // payment method updates, and invoice history.
    try {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUser.id }),
      });
      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch (e) {
      console.error("Portal error:", e);
      alert("Could not open billing portal. Please try again.");
    }
  }
  async function handleRegister({ email, username, password }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });

  if (error) return { error: error.message };

  const { error: profileError } = await supabase
    .from("profiles")
    .insert({ id: data.user.id, username });

  if (profileError && !profileError.message?.toLowerCase().includes("duplicate")) {
    return { error: profileError.message };
  }

  const appUser = await loadUserFromSupabase(data.user);
  if (appUser) {
    setPendingUser(appUser);
  }
  setAuthLoading(false);
  return { error: null };
}

  async function handleCreateCommunity(community) {
    const owner = pendingUser || currentUser;
    if (!owner) return;

    const { data: savedCommunity, error: communityError } = await supabase
      .from("communities")
      .insert({
        name: community.name,
        invite_code: community.inviteCode,
        leader_id: owner.id,
      })
      .select("id, name, invite_code, leader_id, created_at")
      .single();

    if (communityError) {
      alert(communityError.message);
      return;
    }

    const { error: memberError } = await supabase
      .from("community_members")
      .insert({
        community_id: savedCommunity.id,
        user_id: owner.id,
        role: "leader",
      });

    if (memberError) {
      alert(memberError.message);
      return;
    }

    const mappedCommunity = {
      id: savedCommunity.id,
      name: savedCommunity.name,
      inviteCode: savedCommunity.invite_code,
      leaderId: savedCommunity.leader_id,
      createdAt: savedCommunity.created_at,
    };

    setCommunities(p=>[...p, mappedCommunity]);
    const updated = { ...owner, communityIds: [...(owner.communityIds||[]), mappedCommunity.id] };
    setUsers(p=>p.map(u=>u.id===owner.id ? updated : u));
    setCurrentUser(updated);
    setPendingUser(null);
    setActiveCommunityId(mappedCommunity.id);

    // If user already has a schedule in another community, offer to share it here
    const hasSchedule = schedules.some(s => s.userId === owner.id);
    if (hasSchedule) setShareScheduleFor(mappedCommunity);
  }

  async function handleJoinAfterRegister(codeOrCommunity) {
    const owner = pendingUser || currentUser;
    if (!owner) { console.error("No owner found"); return false; }

    let community = typeof codeOrCommunity === "string" ? null : codeOrCommunity;

    if (!community) {
      console.log("[JOIN] Looking up invite code:", codeOrCommunity.toUpperCase());
      const { data: found, error: findError } = await supabase
        .from("communities")
        .select("id, name, invite_code, leader_id, created_at")
        .eq("invite_code", codeOrCommunity.toUpperCase())
        .maybeSingle();

      console.log("[JOIN] Community lookup result:", found?.id, "error:", findError?.message);
      if (findError || !found) return false;

      community = {
        id: found.id,
        name: found.name,
        inviteCode: found.invite_code,
        leaderId: found.leader_id,
        createdAt: found.created_at,
      };
      setCommunities(p => p.find(c => c.id === community.id) ? p : [...p, community]);
    }

    // Check if already a member
    if (owner.communityIds?.includes(community.id)) {
      console.log("[JOIN] Already a member");
      setCurrentUser({ ...owner });
      setPendingUser(null);
      setActiveCommunityId(community.id);
      return true;
    }

    console.log("[JOIN] Inserting community_member:", community.id, owner.id);
    const { error } = await supabase
      .from("community_members")
      .insert({ community_id: community.id, user_id: owner.id, role: "member" });

    console.log("[JOIN] Insert result error:", error?.message ?? "none");

    if (error && !error.message?.toLowerCase().includes("duplicate")) {
      console.error("[JOIN] Failed to insert member:", error.message);
      return false;
    }

    const updated = { ...owner, communityIds: [...new Set([...(owner.communityIds||[]), community.id])] };
    setUsers(p => p.map(u => u.id === owner.id ? updated : u));
    setCurrentUser(updated);
    setPendingUser(null);
    setActiveCommunityId(community.id);

    // Fetch schedules — don't await so it doesn't block the UI
    fetchCommunitySchedules(community.id).catch(e => console.warn("[JOIN] Schedule fetch error:", e));

    return true;
  }

  function handleSkipCommunity() {
    setCurrentUser(pendingUser);
    setPendingUser(null);
  }

  // ── Community ──
  // Fetch and merge schedules for a newly joined community
  async function fetchCommunitySchedules(communityId) {
    const { data, error } = await supabase
      .from("schedules")
      .select("id, user_id, community_id, host_username, platform, days_of_week, start_time, end_time, notes, manual_status, created_at, updated_at")
      .eq("community_id", communityId);

    if (error) { console.warn("Schedule fetch error:", error.message); return; }

    const mapped = (data || []).map(s => ({
      id:           s.id,
      userId:       s.user_id,
      communityId:  s.community_id,
      hostUsername: s.host_username,
      platform:     s.platform,
      daysOfWeek:   (s.days_of_week || []).map(Number),
      startTime:    s.start_time ? String(s.start_time).slice(0, 5) : "12:00",
      endTime:      s.end_time   ? String(s.end_time).slice(0, 5)   : "13:00",
      notes:        s.notes || "",
      manualStatus: s.manual_status,
      createdAt:    s.created_at,
      updatedAt:    s.updated_at,
    }));

    // Merge into state — don't duplicate existing ones
    setSchedules(prev => {
      const existingIds = new Set(prev.map(s => s.id));
      const fresh = mapped.filter(s => !existingIds.has(s.id));
      return [...prev, ...fresh];
    });
  }

  async function handleJoinCommunity(code) {
    let community = communities.find(c=>c.inviteCode.toUpperCase()===code.toUpperCase());

    if (!community) {
      const { data: foundCommunity, error: findError } = await supabase
        .from("communities")
        .select("id, name, invite_code, leader_id, created_at")
        .eq("invite_code", code.toUpperCase())
        .maybeSingle();

      if (findError || !foundCommunity) return false;

      community = {
        id: foundCommunity.id,
        name: foundCommunity.name,
        inviteCode: foundCommunity.invite_code,
        leaderId: foundCommunity.leader_id,
        createdAt: foundCommunity.created_at,
      };

      setCommunities(p=>p.find(c=>c.id===community.id) ? p : [...p, community]);
    }

    if (currentUser.communityIds?.includes(community.id)) return true;

    const { error } = await supabase
      .from("community_members")
      .insert({
        community_id: community.id,
        user_id: currentUser.id,
        role: "member",
      });

    if (error && !error.message?.toLowerCase().includes("duplicate")) return false;

    const updated = { ...currentUser, communityIds: [...(currentUser.communityIds||[]), community.id] };
    setUsers(p=>p.map(u=>u.id===currentUser.id?updated:u));
    setCurrentUser(updated);
    setActiveCommunityId(community.id);

    // Fetch schedules for the newly joined community immediately
    await fetchCommunitySchedules(community.id);

    // If user has an existing schedule, ask if they want to add it to this community too
    const hasSchedule = schedules.some(s => s.userId === currentUser.id);
    if (hasSchedule) setShareScheduleFor(community);

    return true;
  }

  async function handleCreateFromDashboard(communityName) {
    const code = communityName.toUpperCase().replace(/\s+/g,"").slice(0,6) +
                 Math.random().toString(36).slice(2,5).toUpperCase();

    const { data: savedCommunity, error: communityError } = await supabase
      .from("communities")
      .insert({
        name: communityName.toUpperCase(),
        invite_code: code,
        leader_id: currentUser.id,
      })
      .select("id, name, invite_code, leader_id, created_at")
      .single();

    if (communityError) {
      alert(communityError.message);
      return;
    }

    const { error: memberError } = await supabase
      .from("community_members")
      .insert({
        community_id: savedCommunity.id,
        user_id: currentUser.id,
        role: "leader",
      });

    if (memberError) {
      alert(memberError.message);
      return;
    }

    const community = {
      id: savedCommunity.id,
      name: savedCommunity.name,
      inviteCode: savedCommunity.invite_code,
      leaderId: savedCommunity.leader_id,
      createdAt: savedCommunity.created_at,
    };

    setCommunities(p=>[...p, community]);
    const updated = { ...currentUser, communityIds: [...(currentUser.communityIds||[]), community.id] };
    setUsers(p=>p.map(u=>u.id===currentUser.id?updated:u));
    setCurrentUser(updated);
    setActiveCommunityId(community.id);

    // If user already has a schedule in another community, offer to share it here too
    const hasSchedule = schedules.some(s => s.userId === currentUser.id);
    if (hasSchedule) setShareScheduleFor(community);
  }

  function handleRemoveMember(communityId, userId) {
    // [DB INTEGRATION] DELETE from community_members table
    setUsers(p=>p.map(u=>u.id===userId?{...u,communityIds:(u.communityIds||[]).filter(id=>id!==communityId)}:u));
  }

  // ── Schedules ──
  async function handleSaveSchedule(s) {
    const payload = {
      user_id: s.userId,
      community_id: s.communityId,
      host_username: s.hostUsername,
      platform: s.platform,
      days_of_week: s.daysOfWeek || [],
      start_time: s.startTime,
      end_time: s.endTime,
      notes: s.notes || "",
      manual_status: s.manualStatus || null,
      updated_at: new Date().toISOString(),
    };

    const { data: existingSchedule } = await supabase
      .from("schedules")
      .select("id")
      .eq("user_id", s.userId)
      .eq("community_id", s.communityId)
      .maybeSingle();

    let savedSchedule;

    if (existingSchedule?.id) {
      const { data, error } = await supabase
        .from("schedules")
        .update(payload)
        .eq("id", existingSchedule.id)
        .select("id, user_id, community_id, host_username, platform, days_of_week, start_time, end_time, notes, manual_status, created_at, updated_at")
        .single();

      if (error) {
        alert(error.message);
        return;
      }

      savedSchedule = data;
    } else {
      const { data, error } = await supabase
        .from("schedules")
        .insert(payload)
        .select("id, user_id, community_id, host_username, platform, days_of_week, start_time, end_time, notes, manual_status, created_at, updated_at")
        .single();

      if (error) {
        alert(error.message);
        return;
      }

      savedSchedule = data;
    }

    const mappedSchedule = {
      id: savedSchedule.id,
      userId: savedSchedule.user_id,
      communityId: savedSchedule.community_id,
      hostUsername: savedSchedule.host_username,
      platform: savedSchedule.platform,
      daysOfWeek: (savedSchedule.days_of_week || []).map(Number),
      startTime: savedSchedule.start_time ? String(savedSchedule.start_time).slice(0, 5) : "12:00",
      endTime: savedSchedule.end_time ? String(savedSchedule.end_time).slice(0, 5) : "13:00",
      notes: savedSchedule.notes || "",
      manualStatus: savedSchedule.manual_status,
      createdAt: savedSchedule.created_at,
      updatedAt: savedSchedule.updated_at,
    };

    setSchedules(p=>p.find(x=>x.id===mappedSchedule.id)?p.map(x=>x.id===mappedSchedule.id?mappedSchedule:x):[mappedSchedule,...p]);
  }

  async function handleGoLive(id) {
    await handleStatusChange(id, STATUS.LIVE_NOW);
    // [DB INTEGRATION — PUSH] Trigger push notification to community members
    // const sched = schedules.find(s => s.id === id);
    // await fetch("/api/push/send", {
    //   method: "POST",
    //   headers: { "Content-Type": "application/json" },
    //   body: JSON.stringify({
    //     communityId: sched.communityId,
    //     title: `@${sched.hostUsername} is LIVE now! 🔴`,
    //     body: `on ${sched.platform} — go show your support!`,
    //     url: `/live/${id}`,
    //   }),
    // });
  }

  async function handleStatusChange(id, st) {
    const { error } = await supabase
      .from("schedules")
      .update({ manual_status: st, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      alert(error.message);
      return;
    }

    setSchedules(p=>p.map(s=>s.id===id?{...s,manualStatus:st}:s));
  }

  // ── Signups ──
  function handleSignup(data)         { setSignups(p=>[data,...p]); }
  function handleUpdateSignup(updated){ setSignups(p=>p.map(sg=>sg.id===updated.id?updated:sg)); }
  function handleRemoveSignup(id)     { setSignups(p=>p.filter(sg=>sg.id!==id)); }

  if (authLoading) return (
  <>
    <GlobalStyles />
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#0a0c18",color:"white"}}>
      Loading account…
    </div>
  </>
);

if (!currentUser && !pendingUser) return (
  <>
    <GlobalStyles />
    <AuthScreen onLogin={handleLogin} onRegister={handleRegister} />
  </>
);

  // Paywall gate — show immediately after registration OR login if not paid
  // [DB INTEGRATION] currentUser.hasPaid comes from profiles.has_paid in Supabase
  const userToCheck = currentUser || pendingUser;
  if (userToCheck && !userToCheck.hasPaid) return (
    <>
      <GlobalStyles />
      <PaywallScreen
        currentUser={userToCheck}
        onLogout={handleLogout}
        onPaymentSuccess={() => {
          // Mark as paid then continue to community selection (for new users) or dashboard (for returning)
          // [DB INTEGRATION] Stripe webhook flips has_paid in DB — here we update local state
          const updated = { ...userToCheck, hasPaid: true, paidAt: new Date().toISOString() };
          setUsers(p => p.map(u => u.id === userToCheck.id ? updated : u));
          if (pendingUser) {
            setPendingUser(updated); // still needs community selection
          } else {
            setCurrentUser(updated);
          }
        }}
      />
    </>
  );

  // Community selection — shown after payment for new registrations
  if (pendingUser) return (
    <>
      <GlobalStyles />
      <PostRegisterScreen
        newUser={pendingUser}
        communities={communities}
        onCreateCommunity={handleCreateCommunity}
        onJoinCommunity={handleJoinAfterRegister}
        onSkip={handleSkipCommunity}
      />
    </>
  );

  const myGroups    = communities.filter(c=>currentUser.communityIds?.includes(c.id));
  const liveNow     = schedules.filter(s=>currentUser.communityIds?.includes(s.communityId)&&effectiveStatus(s)===STATUS.LIVE_NOW).length;

  const navItems = [
    { key:VIEWS.DASHBOARD, icon:"🏠", label:"Lives" },
    { key:VIEWS.MY,        icon:"📅", label:"My Schedule" },
    ...(myLeaderCommunities.length>0 ? [{ key:VIEWS.ADMIN, icon:"👑", label:"Admin" }] : []),
  ];

  return (
    <>
      <GlobalStyles />
      {shareScheduleFor && (
        (() => {
          const existingSchedule = schedules.find(s => s.userId === currentUser.id);
          return existingSchedule ? (
            <ShareScheduleModal
              community={shareScheduleFor}
              existingSchedule={existingSchedule}
              onSkip={() => setShareScheduleFor(null)}
              onConfirm={async () => {
                // Copy the schedule to the new community
                const newSched = {
                  ...existingSchedule,
                  id: uid(),
                  communityId: shareScheduleFor.id,
                  createdAt: new Date().toISOString(),
                };
                await handleSaveSchedule(newSched);
                setShareScheduleFor(null);
              }}
            />
          ) : null;
        })()
      )}
      <div className="app-shell text-white" style={{fontFamily:"'DM Sans','Segoe UI',sans-serif",overflowX:"hidden"}}>
        <header style={{position:"sticky",top:0,zIndex:40,background:"rgba(10,12,24,0.95)",borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
          <div style={{padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
              <span style={{fontSize:"18px"}}>📡</span>
              <span style={{fontWeight:900,color:"#fff",fontSize:"14px",letterSpacing:"-0.3px"}}>LiveSupport <span style={{color:"#fbbf24"}}>Scheduler</span></span>
              {liveNow>0&&<span style={{background:"#ef4444",color:"#fff",fontSize:"10px",fontWeight:900,padding:"2px 7px",borderRadius:"20px",animation:"livePulse 1.2s ease-in-out infinite"}}>{liveNow} LIVE</span>}
            </div>
            <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
              <NotificationBell currentUser={currentUser} activeCommunityId={activeCommunityId} />
              <UserMenu currentUser={currentUser} onLogout={handleLogout} onManage={handleManageSubscription} onHelp={handleShowHelp} />
            </div>
          </div>
        </header>

        <main style={{width:"100%",padding:"16px 16px 112px",overflowX:"hidden",boxSizing:"border-box"}}>
          {view===VIEWS.DASHBOARD && (
            <DashboardView
              schedules={schedules}
              signups={signups}
              currentUser={currentUser}
              communities={communities}
              tick={tick}
              activeCommunityId={activeCommunityId}
              onSwitchCommunity={id=>{ setActiveCommunityId(id); setView(VIEWS.DASHBOARD); }}
              onJoinCommunity={handleJoinCommunity}
              onCreateCommunity={handleCreateFromDashboard}
              onView={id=>{ setActiveId(id); setView(VIEWS.DETAIL); window.history.pushState({ view: VIEWS.DETAIL, id }, "", `#live-${id}`); }}
              onGoLive={handleGoLive}
              onAddSchedule={()=>setView(VIEWS.MY)}
            />
          )}

          {view===VIEWS.DETAIL&&activeOccurrence&&(
            <OccurrenceDetail
              occurrence={activeOccurrence}
              signups={signups}
              currentUser={currentUser}
              onBack={()=>{ if (window.history.state?.view === VIEWS.DETAIL) { window.history.back(); } else { setView(VIEWS.DASHBOARD); setActiveId(null); } }}
              onSignup={handleSignup}
              onUpdateSignup={handleUpdateSignup}
              onRemoveSignup={handleRemoveSignup}
            />
          )}

          {view===VIEWS.MY&&(
            <MyScheduleTab
              currentUser={currentUser}
              schedules={schedules}
              signups={signups}
              communities={communities}
              onSave={handleSaveSchedule}
              onGoLive={handleGoLive}
              onStatusChange={handleStatusChange}
            />
          )}

          {view===VIEWS.HELP&&(
            <HelpView onClose={() => setView(VIEWS.DASHBOARD)} />
          )}

          {view===VIEWS.ADMIN&&myLeaderCommunities.length>0&&(
            <div style={{display:"flex",flexDirection:"column",gap:"24px"}}>
              {myLeaderCommunities.map(community => (
                <GroupAdminPanel
                  key={community.id}
                  community={community}
                  allUsers={users}
                  schedules={schedules}
                  signups={signups}
                  onStatusChange={handleStatusChange}
                  onGoLive={handleGoLive}
                  onRemoveMember={handleRemoveMember}
                />
              ))}
            </div>
          )}
        </main>

        <nav style={{position:"fixed",bottom:0,left:0,right:0,zIndex:40,background:"rgba(10,12,24,0.97)",borderTop:"1px solid rgba(255,255,255,0.07)"}}>
          <div style={{display:"flex"}}>
            {navItems.map(item => (
              <button key={item.key} onClick={()=>setView(item.key)}
                style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"2px",padding:"10px 0 6px",fontSize:"10px",fontWeight:700,border:"none",background:"none",cursor:"pointer",
                  color:view===item.key?"#fbbf24":"rgba(255,255,255,0.35)"}}>
                <span style={{fontSize:"18px",lineHeight:1}}>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <p style={{textAlign:"center",color:"rgba(255,255,255,0.15)",fontSize:"10px",padding:"2px 16px 8px",margin:0}}>⚠️ No payments processed — gift amounts are for planning only</p>
        </nav>
      </div>
    </>
  );
}

// ─── Global Styles ─────────────────────────────────────────────────────────────

function GlobalStyles() {
  // Inject viewport meta if not already present (handles cases where layout.tsx doesn't set it)
  useEffect(() => {
    if (!document.querySelector('meta[name="viewport"]')) {
      const meta = document.createElement("meta");
      meta.name = "viewport";
      meta.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
      document.head.appendChild(meta);
    } else {
      // Ensure existing viewport tag has correct content
      const existing = document.querySelector('meta[name="viewport"]');
      existing.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
    }
  }, []);

  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,600;9..40,700;9..40,900&display=swap"
      />
      <style>{[
        "*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }",
        "html { font-size: 16px; }",
        "body { width: 100%; overflow-x: hidden; -webkit-text-size-adjust: 100%; background: #0a0c18; }",
        "input, textarea, select, button { font-family: inherit; font-size: 16px; max-width: 100%; }",
        "input[type=time], input[type=date] { min-width: 0; width: 100%; font-size: 16px; }",
        "input[type=date]::-webkit-calendar-picker-indicator, input[type=time]::-webkit-calendar-picker-indicator { filter: invert(0.5); }",
        "select option { background: #16192e; color: white; } select { color-scheme: dark; }",
        ".app-shell { width: 100%; max-width: 500px; margin: 0 auto; min-height: 100vh; background: linear-gradient(180deg,#0d0f1c,#0a0c18); position: relative; }",
        "@media (min-width: 520px) { body { background: #060810; } .app-shell { box-shadow: 0 0 80px rgba(0,0,0,0.7); } }",
        ".line-clamp-2 { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }",
        "@keyframes livePulse { 0%,100%{ opacity:1; transform:scale(1); } 50%{ opacity:.45; transform:scale(1.35); } }",
        "@keyframes spin { to { transform: rotate(360deg); } }",
        "::-webkit-scrollbar { width:4px; height:4px; }",
        "::-webkit-scrollbar-thumb { background:rgba(255,255,255,.12); border-radius:4px; }",
      ].join(" ")}</style>
    </>
  );
}
