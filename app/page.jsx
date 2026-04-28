"use client";

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

import { useState, useMemo, useEffect } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS = {
  UPCOMING:  "Upcoming",
  LIVE_NOW:  "Live Now",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const LOOK_AHEAD_DAYS = 4;
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

function effectiveStatus(schedule) {
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
  for (let w = 0; w < WEEKS_OUT; w++) {
    for (const dow of days) {
      const base = new Date(now);
      base.setDate(now.getDate() + (dow - now.getDay() + 7) % 7 + w * 7);
      base.setHours(0, 0, 0, 0);
      const dateStr  = base.toISOString().slice(0, 10);
      const [sh, sm] = schedule.startTime.split(":").map(Number);
      const [eh, em] = schedule.endTime.split(":").map(Number);
      const nowMins  = now.getHours() * 60 + now.getMinutes();
      const isToday  = base.toDateString() === now.toDateString();
      const isLive   = isToday && nowMins >= sh * 60 + sm && nowMins < eh * 60 + em;
      const isPast   = isToday && nowMins >= eh * 60 + em;
      if (isPast && !isLive) continue;
      const daysAway = Math.round((base - now) / 86400000);
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
const inputStyle = { fontSize:"16px", minWidth:0, width:"100%", boxSizing:"border-box" as const };
const labelCls = "text-white/70 text-xs font-semibold block mb-1";
// Fully inline versions used wherever Tailwind is unreliable
const IS = {
  input: {width:"100%",background:"rgba(255,255,255,0.1)",border:"none",borderRadius:"12px",padding:"13px 16px",fontSize:"16px",color:"#fff",outline:"none",boxSizing:"border-box" as const,display:"block"},
  label: {color:"rgba(255,255,255,0.6)",fontSize:"12px",fontWeight:700,display:"block",marginBottom:"6px"},
  card:  {background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"20px",padding:"20px",display:"flex",flexDirection:"column" as const,gap:"14px"},
  btn:   {width:"100%",background:"#fbbf24",color:"#1c1400",fontWeight:900,fontSize:"15px",border:"none",borderRadius:"14px",padding:"14px",cursor:"pointer"},
  btnSm: {background:"rgba(255,255,255,0.1)",color:"#fff",fontWeight:700,fontSize:"12px",border:"none",borderRadius:"10px",padding:"8px 14px",cursor:"pointer"},
};

function Badge({ status }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${statusBadgeClass(status)}`}>
      {status === STATUS.LIVE_NOW && <span style={{width:6,height:6,borderRadius:"50%",background:"#fff",display:"inline-block",animation:"livePulse 1.2s ease-in-out infinite"}}/>}
      {status}
    </span>
  );
}

function Pill({ label, value, accent }) {
  return (
    <div className={`flex flex-col items-center rounded-xl px-3 py-2 ${accent?"bg-amber-400":"bg-white/10"}`}>
      <span className={`text-base font-black leading-none ${accent?"text-gray-900":"text-white"}`}>{value}</span>
      <span className={`text-xs font-medium mt-0.5 ${accent?"text-gray-700":"text-white/60"}`}>{label}</span>
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
        {signup.plannedGiftAmount != null && <p className="text-amber-300 text-xs font-semibold mt-0.5">🎁 Plans to gift ${signup.plannedGiftAmount}</p>}
        {signup.comment && <p className="text-white/50 text-xs mt-0.5 italic">"{signup.comment}"</p>}
      </div>
    </div>
  );
}

// ─── Auth Screen ───────────────────────────────────────────────────────────────

function AuthScreen({ users, onLogin, onRegister }) {
  const [tab,      setTab]      = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");

  function handleLogin() {
    // [DB INTEGRATION] Supabase: auth.signInWithPassword({ email, password })
    const u = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase() && u.password === password);
    if (!u) { setError("Username or password is incorrect."); return; }
    setError(""); onLogin(u);
  }

  function handleRegister() {
    if (!username.trim() || !password.trim()) { setError("Username and password are required."); return; }
    if (users.find(u => u.username.toLowerCase() === username.trim().toLowerCase())) { setError("That username is taken."); return; }
    // [DB INTEGRATION] supabase.auth.signUp({ email, password }) then insert into profiles table
    const newUser = { id:uid(), username:username.trim(), password, communityIds: [] };
    setError(""); onRegister(newUser);
  }

  const submit = tab === "login" ? handleLogin : handleRegister;

  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 20px",background:"linear-gradient(180deg,#0d0f1c,#0a0c18)",width:"100%",boxSizing:"border-box"}}>
      <div style={{width:"100%",maxWidth:"420px"}}>
        <div style={{textAlign:"center",marginBottom:"32px"}}>
          <p style={{fontSize:"48px",marginBottom:"12px"}}>📡</p>
          <h1 style={{color:"#fff",fontWeight:900,fontSize:"24px",margin:0}}>LiveSupport <span style={{color:"#fbbf24"}}>Scheduler</span></h1>
          <p style={{color:"rgba(255,255,255,0.4)",fontSize:"14px",marginTop:"6px"}}>Sign in or create an account</p>
        </div>
        <div style={{display:"flex",background:"rgba(255,255,255,0.1)",borderRadius:"12px",padding:"4px",marginBottom:"20px"}}>
          {[["login","Sign In"],["register","Create Account"]].map(([t,label]) => (
            <button key={t} onClick={() => { setTab(t); setError(""); }}
              style={{flex:1,padding:"10px 0",borderRadius:"9px",fontSize:"14px",fontWeight:700,border:"none",cursor:"pointer",
                background:tab===t?"#fbbf24":"transparent",color:tab===t?"#1c1400":"rgba(255,255,255,0.6)"}}>
              {label}
            </button>
          ))}
        </div>
        <div style={{background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"20px",padding:"24px",display:"flex",flexDirection:"column",gap:"16px"}}>
          {error && <p style={{color:"#f87171",fontSize:"12px",background:"rgba(239,68,68,0.1)",borderRadius:"10px",padding:"8px 12px",margin:0}}>{error}</p>}
          <div>
            <label style={{color:"rgba(255,255,255,0.6)",fontSize:"12px",fontWeight:700,display:"block",marginBottom:"6px"}}>Username</label>
            <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="your_username"
              style={{width:"100%",background:"rgba(255,255,255,0.1)",border:"none",borderRadius:"12px",padding:"14px 16px",fontSize:"16px",color:"#fff",outline:"none",boxSizing:"border-box"}}
              onKeyDown={e=>e.key==="Enter"&&submit()} />
          </div>
          <div>
            <label style={{color:"rgba(255,255,255,0.6)",fontSize:"12px",fontWeight:700,display:"block",marginBottom:"6px"}}>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••"
              style={{width:"100%",background:"rgba(255,255,255,0.1)",border:"none",borderRadius:"12px",padding:"14px 16px",fontSize:"16px",color:"#fff",outline:"none",boxSizing:"border-box"}}
              onKeyDown={e=>e.key==="Enter"&&submit()} />
          </div>
          <button onClick={submit}
            style={{width:"100%",background:"#fbbf24",color:"#1c1400",fontWeight:900,fontSize:"15px",border:"none",borderRadius:"14px",padding:"15px",cursor:"pointer"}}>
            {tab==="login" ? "Sign In 🚀" : "Create Account ✨"}
          </button>
          {tab==="login" && (
            <p style={{color:"rgba(255,255,255,0.2)",fontSize:"11px",textAlign:"center",margin:0}}>
              Demo — DoomLeader/doom123 · StarryNight/pass1 · AshleyLeader/ashley123
            </p>
          )}
        </div>
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

  function handleJoin() {
    const community = communities.find(c => c.inviteCode.toUpperCase() === inviteCode.trim().toUpperCase());
    if (!community) { setError("Invalid invite code. Double-check and try again."); return; }
    onJoinCommunity(community);
  }

  function copyCode() {
    navigator.clipboard.writeText(createdCode).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  // ── Created successfully ──
  if (createdCode) return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-8" style={{background:"linear-gradient(180deg,#0d0f1c,#0a0c18)"}}>
      <div className="w-full text-center" style={{maxWidth:"420px"}}>
        <p className="text-5xl mb-4">🎉</p>
        <h2 className="text-white font-black text-2xl mb-1">Community Created!</h2>
        <p className="text-white/50 text-sm mb-6">Share this invite code with your members so they can join.</p>
        <div className="rounded-2xl p-6 mb-4" style={{background:"linear-gradient(145deg,#1e2340,#16192e)", border:"1px solid rgba(251,191,36,0.3)"}}>
          <p className="text-white/50 text-xs font-semibold uppercase tracking-widest mb-2">Invite Code</p>
          <p className="text-amber-400 font-black text-4xl tracking-widest mb-4">{createdCode}</p>
          <button onClick={copyCode}
            className={`w-full font-bold text-sm rounded-xl py-2.5 transition-colors ${copied ? "bg-emerald-500 text-white" : "bg-white/10 hover:bg-white/20 text-white"}`}>
            {copied ? "✓ Copied!" : "Copy Code"}
          </button>
        </div>
        <p className="text-white/30 text-xs mb-6">You can always find this code in your Admin panel later.</p>
        <button onClick={onSkip} className="w-full bg-amber-400 hover:bg-amber-300 text-gray-900 font-black text-sm rounded-xl py-3 transition-colors">
          Go to Dashboard 🚀
        </button>
      </div>
    </div>
  );

  // ── Join flow ──
  if (step === "join") return (
    <div className="app-shell flex flex-col items-center justify-center px-4 py-8 min-h-screen" style={{background:"linear-gradient(180deg,#0d0f1c,#0a0c18)"}}>
      <div className="w-full" style={{maxWidth:"420px"}}>
        <button onClick={() => { setStep("choice"); setError(""); }} className="text-white/50 hover:text-white text-sm font-semibold mb-6 flex items-center gap-1">← Back</button>
        <h2 className="text-white font-black text-2xl mb-1">Join a Community</h2>
        <p className="text-white/40 text-sm mb-6">Ask your community leader for their invite code.</p>
        <div className="rounded-2xl p-5 space-y-3" style={{background:"linear-gradient(145deg,#1e2340,#16192e)"}}>
          {error && <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className={labelCls}>Invite Code</label>
            <input value={inviteCode} onChange={e=>setInviteCode(e.target.value)} placeholder="e.g. DOOM2024"
              className={inputCls} style={{textTransform:"uppercase"}}
              onKeyDown={e=>e.key==="Enter"&&handleJoin()} />
          </div>
          <button onClick={handleJoin} className="w-full bg-amber-400 hover:bg-amber-300 text-gray-900 font-black text-sm rounded-xl py-3 transition-colors">
            Join Community 🙌
          </button>
        </div>
        <button onClick={onSkip} className="w-full text-white/30 hover:text-white/60 text-xs font-semibold mt-4 transition-colors">
          Skip for now
        </button>
      </div>
    </div>
  );

  // ── Create flow ──
  if (step === "create") return (
    <div className="app-shell flex flex-col items-center justify-center px-4 py-8 min-h-screen" style={{background:"linear-gradient(180deg,#0d0f1c,#0a0c18)"}}>
      <div className="w-full" style={{maxWidth:"420px"}}>
        <button onClick={() => { setStep("choice"); setError(""); }} className="text-white/50 hover:text-white text-sm font-semibold mb-6 flex items-center gap-1">← Back</button>
        <h2 className="text-white font-black text-2xl mb-1">Create a Community</h2>
        <p className="text-white/40 text-sm mb-6">You'll be the leader. An invite code will be generated automatically.</p>
        <div className="rounded-2xl p-5 space-y-3" style={{background:"linear-gradient(145deg,#1e2340,#16192e)"}}>
          {error && <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className={labelCls}>Community Name</label>
            <input value={communityName} onChange={e=>setCommunityName(e.target.value)} placeholder="e.g. DOOMSQUAD"
              className={inputCls} style={{textTransform:"uppercase"}}
              onKeyDown={e=>e.key==="Enter"&&handleCreate()} />
          </div>
          <button onClick={handleCreate} className="w-full bg-amber-400 hover:bg-amber-300 text-gray-900 font-black text-sm rounded-xl py-3 transition-colors">
            Create Community 👑
          </button>
        </div>
        <button onClick={onSkip} className="w-full text-white/30 hover:text-white/60 text-xs font-semibold mt-4 transition-colors">
          Skip for now
        </button>
      </div>
    </div>
  );

  // ── Initial choice ──
  return (
    <div className="app-shell flex flex-col items-center justify-center px-4 py-8 min-h-screen" style={{background:"linear-gradient(180deg,#0d0f1c,#0a0c18)"}}>
      <div className="w-full" style={{maxWidth:"420px"}}>
        <div className="text-center mb-8">
          <p className="text-5xl mb-3">👋</p>
          <h2 className="text-white font-black text-2xl">Welcome, @{newUser.username}!</h2>
          <p className="text-white/40 text-sm mt-2">Communities keep lives organized by group.<br/>What would you like to do?</p>
        </div>
        <div className="space-y-3">
          <button onClick={() => setStep("create")}
            className="w-full rounded-2xl p-4 text-left transition-colors hover:scale-[1.01]"
            style={{background:"linear-gradient(145deg,#1e2340,#16192e)", border:"1px solid rgba(251,191,36,0.2)"}}>
            <div className="flex items-center gap-3">
              <span className="text-3xl">👑</span>
              <div>
                <p className="text-white font-black text-base">Create a Community</p>
                <p className="text-white/50 text-xs mt-0.5">You'll be the leader. Get an invite code to share.</p>
              </div>
            </div>
          </button>
          <button onClick={() => setStep("join")}
            className="w-full rounded-2xl p-4 text-left transition-colors hover:scale-[1.01]"
            style={{background:"linear-gradient(145deg,#1e2340,#16192e)", border:"1px solid rgba(255,255,255,0.07)"}}>
            <div className="flex items-center gap-3">
              <span className="text-3xl">🤝</span>
              <div>
                <p className="text-white font-black text-base">Join a Community</p>
                <p className="text-white/50 text-xs mt-0.5">Enter an invite code from your community leader.</p>
              </div>
            </div>
          </button>
          <button onClick={onSkip} className="w-full text-white/30 hover:text-white/50 text-xs font-semibold py-3 transition-colors">
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

  function handleJoin() {
    const ok = onJoin(code.trim());
    if (!ok) { setErr("Invalid invite code. Check with your leader."); return; }
    closePanel();
  }

  function handleCreate() {
    if (!communityName.trim()) { setErr("Community name is required."); return; }
    onCreate(communityName.trim());
    closePanel();
  }

  // ── Expandable panel ──
  const panelEl = panel && (
    <div className="mt-2 rounded-2xl p-4 space-y-3" style={{background:"linear-gradient(145deg,#1e2340,#16192e)", border:"1px solid rgba(255,255,255,0.08)"}}>
      {panel === "join" && <>
        <p className="text-white font-black text-sm">Join a Community</p>
        <p className="text-white/40 text-xs">Enter the invite code from your community leader.</p>
        {err && <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-1.5">{err}</p>}
        <input value={code} onChange={e=>setCode(e.target.value)} placeholder="e.g. DOOM2024"
          className={inputCls} style={{textTransform:"uppercase"}} onKeyDown={e=>e.key==="Enter"&&handleJoin()} />
        <div className="flex gap-2">
          <button onClick={closePanel} className="flex-1 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-xl py-2.5 transition-colors">Cancel</button>
          <button onClick={handleJoin} className="flex-1 bg-amber-400 hover:bg-amber-300 text-gray-900 text-xs font-bold rounded-xl py-2.5 transition-colors">Join 🤝</button>
        </div>
      </>}
      {panel === "create" && <>
        <p className="text-white font-black text-sm">Create a Community</p>
        <p className="text-white/40 text-xs">You'll be the leader. An invite code is generated automatically.</p>
        {err && <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-1.5">{err}</p>}
        <input value={communityName} onChange={e=>setCommunityName(e.target.value)} placeholder="e.g. DOOMSQUAD"
          className={inputCls} style={{textTransform:"uppercase"}} onKeyDown={e=>e.key==="Enter"&&handleCreate()} />
        <div className="flex gap-2">
          <button onClick={closePanel} className="flex-1 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-xl py-2.5 transition-colors">Cancel</button>
          <button onClick={handleCreate} className="flex-1 bg-amber-400 hover:bg-amber-300 text-gray-900 text-xs font-bold rounded-xl py-2.5 transition-colors">Create 👑</button>
        </div>
      </>}
    </div>
  );

  // ── Empty state ──
  if (myGroups.length === 0) return (
    <div>
      <div className="rounded-2xl p-5 text-center" style={{background:"linear-gradient(145deg,#1e2340,#16192e)"}}>
        <p className="text-3xl mb-2">👥</p>
        <p className="text-white font-black text-base mb-1">No communities yet</p>
        <p className="text-white/40 text-sm mb-4">Join an existing community or create your own.</p>
        <div className="flex gap-2">
          <button onClick={() => setPanel(panel==="join"?null:"join")}
            className={`flex-1 font-bold text-xs rounded-xl py-2.5 transition-colors ${panel==="join"?"bg-amber-400 text-gray-900":"bg-white/10 hover:bg-white/20 text-white"}`}>
            🤝 Join
          </button>
          <button onClick={() => setPanel(panel==="create"?null:"create")}
            className={`flex-1 font-bold text-xs rounded-xl py-2.5 transition-colors ${panel==="create"?"bg-amber-400 text-gray-900":"bg-white/10 hover:bg-white/20 text-white"}`}>
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
      <div className="flex gap-2 overflow-x-auto pb-1" style={{scrollbarWidth:"none"}}>
        {myGroups.map(g => (
          <button key={g.id} onClick={() => { onSwitch(g.id); closePanel(); }}
            className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-black transition-colors ${activeCommunityId===g.id?"bg-amber-400 text-gray-900":"bg-white/10 text-white/70 hover:bg-white/20"}`}>
            👥 {g.name}
          </button>
        ))}
        {/* Join button */}
        <button onClick={() => setPanel(panel==="join"?null:"join")}
          className={`flex-shrink-0 px-3 py-2 rounded-full text-xs font-bold transition-colors ${panel==="join"?"bg-amber-400 text-gray-900":"bg-white/5 text-white/40 hover:bg-white/10"}`}>
          🤝 Join
        </button>
        {/* Create button */}
        <button onClick={() => setPanel(panel==="create"?null:"create")}
          className={`flex-shrink-0 px-3 py-2 rounded-full text-xs font-bold transition-colors ${panel==="create"?"bg-amber-400 text-gray-900":"bg-white/5 text-white/40 hover:bg-white/10"}`}>
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
    <div className="rounded-2xl p-3 flex flex-col gap-2" style={{background:"linear-gradient(145deg,#1e2340,#16192e)"}}>
      <div>
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <Badge status={status} />
          <span className="text-white/50 text-xs">{platformIcon(schedule.platform)}</span>
        </div>
        <p className="text-white font-black text-sm leading-tight">@{schedule.hostUsername}</p>
        <p className="text-amber-400 text-xs font-bold mt-0.5">{dayLabel}</p>
        <p className="text-white/50 text-xs">{formatTime(schedule.startTime)} – {formatTime(schedule.endTime)}</p>
        <p className="text-white/30 text-xs">{schedule.platform}</p>
      </div>
      {schedule.notes && <p className="text-white/45 text-xs bg-white/5 rounded-lg px-2 py-1.5 line-clamp-2">{schedule.notes}</p>}
      <div className="flex gap-1.5">
        <div className="bg-white/10 rounded-lg px-2 py-1 text-center flex-1">
          <p className="text-white font-black text-sm leading-none">{ss.length}</p>
          <p className="text-white/50 text-xs">going</p>
        </div>
        {totalGift > 0 && (
          <div className="bg-amber-400 rounded-lg px-2 py-1 text-center flex-1">
            <p className="text-gray-900 font-black text-sm leading-none">${totalGift}</p>
            <p className="text-gray-700 text-xs">planned 🎁</p>
          </div>
        )}
      </div>
      <div className="flex gap-1.5 mt-auto">
        <button onClick={() => onView(occurrenceId)} className="flex-1 bg-amber-400 hover:bg-amber-300 text-gray-900 font-bold text-xs rounded-xl py-2 transition-colors">
          View & Sign Up
        </button>
        {isOwner && status !== STATUS.LIVE_NOW && status !== STATUS.CANCELLED && daysAway === 0 && (
          <button onClick={() => onGoLive(schedule.id)} className="px-2.5 bg-red-500/80 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-colors">🔴</button>
        )}
      </div>
    </div>
  );
}

// ─── Signup Form ───────────────────────────────────────────────────────────────

function SignupForm({ occurrenceId, scheduleId, currentUser, onSubmit }) {
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
    <div className="rounded-2xl bg-emerald-500/20 border border-emerald-500/40 p-6 text-center">
      <p className="text-3xl mb-2">🎉</p>
      <p className="text-emerald-300 font-black text-lg">You're signed up!</p>
      <p className="text-white/50 text-sm mt-1">See you in the live.</p>
    </div>
  );

  return (
    <div style={IS.card}>
      <h3 style={{color:"#fff",fontWeight:900,fontSize:"15px",margin:0}}>Sign Up to Support</h3>
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
    <div className="rounded-2xl p-5 text-center" style={{background:"linear-gradient(145deg,#2a1a1a,#1e1010)",border:"1px solid rgba(239,68,68,0.25)"}}>
      <p className="text-2xl mb-2">⚠️</p>
      <p className="text-white font-black text-base mb-1">Remove your signup?</p>
      <p className="text-white/50 text-sm mb-4">You can always sign up again later.</p>
      <div className="flex gap-2">
        <button onClick={() => setMode("view")} className="flex-1 bg-white/10 hover:bg-white/20 text-white font-bold text-sm rounded-xl py-2.5 transition-colors">Keep It</button>
        <button onClick={() => onRemove(signup.id)} className="flex-1 bg-red-500 hover:bg-red-400 text-white font-bold text-sm rounded-xl py-2.5 transition-colors">Yes, Remove</button>
      </div>
    </div>
  );

  if (mode === "edit") return (
    <div className="rounded-2xl p-4 space-y-3" style={{background:"linear-gradient(145deg,#1e2340,#16192e)",border:"1px solid rgba(251,191,36,0.2)"}}>
      <div className="flex items-center justify-between">
        <h3 className="text-white font-black text-base">Edit Your Signup</h3>
        <button onClick={() => { setGift(signup.plannedGiftAmount!=null?String(signup.plannedGiftAmount):""); setComment(signup.comment||""); setMode("view"); }} className="text-white/40 hover:text-white text-xs font-semibold">Cancel</button>
      </div>
      <p className="text-white/40 text-xs">⚠️ Gift amounts are for planning only — no payment is taken here.</p>
      <div>
        <label className={labelCls}>Planned Gift Amount — <span className="text-amber-400">optional, no charge</span></label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">$</span>
          <input type="number" min="0" value={gift} onChange={e=>setGift(e.target.value)} placeholder="0.00" className={`${inputCls} pl-7`} />
        </div>
        {gift !== "" && <button onClick={() => setGift("")} className="text-white/30 text-xs mt-1 hover:text-white/60">✕ Clear amount</button>}
      </div>
      <div>
        <label className={labelCls}>Hype message (optional)</label>
        <textarea value={comment} onChange={e=>setComment(e.target.value)} rows={2} placeholder="Drop some hype! 🎉" className={`${inputCls} resize-none`} />
      </div>
      <button onClick={handleSave} className="w-full bg-amber-400 hover:bg-amber-300 text-gray-900 font-black text-sm rounded-xl py-3 transition-colors">Save Changes ✓</button>
    </div>
  );

  return (
    <div className="rounded-2xl p-4" style={{background:"linear-gradient(145deg,#1a3328,#122a22)",border:"1px solid rgba(52,211,153,0.2)"}}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-emerald-400 text-lg">✅</span>
            <p className="text-emerald-300 font-black text-sm">You're signed up!</p>
          </div>
          <p className="text-white/60 text-xs">As <span className="text-white font-semibold">{signup.displayName}</span>{signup.supporterUsername && <span className="text-white/40"> {signup.supporterUsername}</span>}</p>
          {signup.plannedGiftAmount != null ? <p className="text-amber-300 text-xs font-semibold mt-0.5">🎁 Planning to gift ${signup.plannedGiftAmount}</p> : <p className="text-white/30 text-xs mt-0.5">No gift amount set</p>}
          {signup.comment && <p className="text-white/40 text-xs italic mt-0.5">"{signup.comment}"</p>}
        </div>
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <button onClick={() => setMode("edit")} className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors">✏️ Edit</button>
          <button onClick={() => setMode("confirm-remove")} className="bg-red-500/20 hover:bg-red-500/40 text-red-400 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors">Remove</button>
        </div>
      </div>
    </div>
  );
}

// ─── Occurrence Detail ─────────────────────────────────────────────────────────

function OccurrenceDetail({ occurrence, signups, currentUser, onBack, onSignup, onUpdateSignup, onRemoveSignup }) {
  const { schedule, status, dateObj, daysAway, occurrenceId } = occurrence;
  const ss        = signups.filter(sg => sg.occurrenceId === occurrenceId);
  const totalGift = ss.reduce((sum, sg) => sum + (sg.plannedGiftAmount || 0), 0);
  const days      = schedule.daysOfWeek ?? (schedule.dayOfWeek != null ? [schedule.dayOfWeek] : []);
  const dayLabel  = daysAway === 0 ? "Today" : daysAway === 1 ? "Tomorrow" : formatDate(dateObj);
  // [DB INTEGRATION] Replace with server-side query: SELECT * FROM signups WHERE occurrenceId=? AND userId=?
  const mySignup  = ss.find(sg => sg.displayName.toLowerCase()===currentUser.username.toLowerCase() || sg.supporterUsername.replace(/^@/,"").toLowerCase()===currentUser.username.toLowerCase());

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-white/60 hover:text-white text-sm font-semibold">← Back</button>
      <div className="rounded-2xl p-5" style={{background:"linear-gradient(135deg,#e67e22,#c0392b)"}}>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <Badge status={status} />
          <span className="text-white/70 text-xs">{platformIcon(schedule.platform)} {schedule.platform}</span>
        </div>
        <h2 className="text-white font-black text-2xl">@{schedule.hostUsername}</h2>
        <p className="text-white/90 font-bold text-base mt-1">{dayLabel} · {formatDate(dateObj)}</p>
        <p className="text-white/70 text-sm mt-0.5">{formatTime(schedule.startTime)} – {formatTime(schedule.endTime)}</p>
        <p className="text-white/50 text-xs mt-0.5">Repeats every {formatDays(days)}</p>
        {schedule.notes && <div className="mt-3 bg-black/20 rounded-xl px-4 py-3"><p className="text-white/90 text-sm">{schedule.notes}</p></div>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Pill label="Signed Up" value={ss.length} />
        <Pill label="Date" value={dayLabel} />
        <Pill label="🎁 Expected" value={totalGift>0?`$${totalGift}`:"—"} accent={totalGift>0} />
      </div>
      {status !== STATUS.CANCELLED && (
        mySignup
          ? <MySignupPanel signup={mySignup} onUpdate={onUpdateSignup} onRemove={onRemoveSignup} />
          : <SignupForm occurrenceId={occurrenceId} scheduleId={schedule.id} currentUser={currentUser} onSubmit={onSignup} />
      )}
      <div className="rounded-2xl p-4" style={{background:"linear-gradient(145deg,#1e2340,#16192e)"}}>
        <h3 className="text-white font-black text-base mb-3">Who's Coming ({ss.length})</h3>
        {ss.length===0 ? <p className="text-white/40 text-sm text-center py-4">No one yet — be the first! 🌟</p> : ss.map(sg => <SupporterRow key={sg.id} signup={sg} />)}
      </div>
    </div>
  );
}

// ─── My Schedule Tab ───────────────────────────────────────────────────────────

function MyScheduleTab({ currentUser, schedules, signups, communities, onSave, onGoLive, onStatusChange }) {
  const [editing, setEditing] = useState(false);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-black text-xl">My Schedule</h2>
        <button onClick={() => setEditing(true)} className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-2 rounded-xl font-semibold transition-colors">✏️ Edit</button>
      </div>
      <div className="rounded-2xl p-5" style={{background:"linear-gradient(135deg,#1a1f3c,#0f1225)"}}>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <Badge status={status} />
          <span className="text-white/50 text-xs">{platformIcon(mySchedule.platform)} {mySchedule.platform}</span>
          {community && <span className="bg-white/10 text-white/60 text-xs font-bold px-2 py-0.5 rounded-full">👥 {community.name}</span>}
        </div>
        <p className="text-white font-black text-xl">@{currentUser.username}</p>
        <p className="text-amber-400 text-sm mt-0.5">Every {formatDays(mySchedule.daysOfWeek ?? [mySchedule.dayOfWeek])} · {formatTime(mySchedule.startTime)} – {formatTime(mySchedule.endTime)}</p>
        {mySchedule.notes && <p className="text-white/60 text-xs mt-2 bg-white/5 rounded-lg px-3 py-2">{mySchedule.notes}</p>}
        <div className="flex gap-2 mt-4">
          <Pill label="Supporters" value={ss.length} />
          {totalGift > 0 && <Pill label="Planned 🎁" value={`$${totalGift}`} accent />}
        </div>
      </div>
      <div className="rounded-2xl p-4" style={{background:"linear-gradient(145deg,#1e2340,#16192e)"}}>
        <p className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-2">Live Controls</p>
        <p className="text-white/35 text-xs mb-3">"Live Now" starts automatically during your window. Use these if you go early, end early, or need to cancel.</p>
        <div className="flex flex-wrap gap-2">
          {status !== STATUS.LIVE_NOW && status !== STATUS.CANCELLED && <button onClick={() => onGoLive(mySchedule.id)} className="text-xs bg-red-500/80 hover:bg-red-500 text-white px-4 py-2 rounded-xl font-bold transition-colors">🔴 Go Live Early</button>}
          {status === STATUS.LIVE_NOW && <button onClick={() => onStatusChange(mySchedule.id, STATUS.COMPLETED)} className="text-xs bg-emerald-600/80 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl font-bold transition-colors">✓ End Live</button>}
          {status !== STATUS.CANCELLED && <button onClick={() => onStatusChange(mySchedule.id, STATUS.CANCELLED)} className="text-xs bg-gray-600/80 hover:bg-gray-600 text-white px-4 py-2 rounded-xl font-bold transition-colors">✕ Cancel This Week</button>}
          {mySchedule.manualStatus && <button onClick={() => onStatusChange(mySchedule.id, null)} className="text-xs bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-xl font-bold transition-colors">↺ Reset to Auto</button>}
        </div>
      </div>
      <div className="rounded-2xl p-4" style={{background:"linear-gradient(145deg,#1e2340,#16192e)"}}>
        <h3 className="text-white font-black text-base mb-3">My Supporters ({ss.length})</h3>
        {ss.length===0 ? <p className="text-white/40 text-sm text-center py-4">No one signed up yet.</p> : ss.map(sg => <SupporterRow key={sg.id} signup={sg} />)}
      </div>
    </div>
  );
}

// ─── Schedule Form ─────────────────────────────────────────────────────────────

function ScheduleForm({ initial, userId, username, myGroups, onSave, onCancel }) {
  const [form, setForm] = useState({
    platform:    initial?.platform    ?? "",
    daysOfWeek:  initial?.daysOfWeek  ?? (initial?.dayOfWeek!=null?[initial.dayOfWeek]:[]),
    startTime:   initial?.startTime   ?? "",
    endTime:     initial?.endTime     ?? "",
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
    <div className="space-y-4 pb-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-black text-xl">{initial?"Edit My Schedule":"Set My Weekly Schedule"}</h2>
        <button onClick={onCancel} className="text-white/50 hover:text-white text-sm">Cancel</button>
      </div>
      {error && <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2">{error}</p>}
      <div style={{background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"20px",padding:"20px",display:"flex",flexDirection:"column",gap:"14px"}}>
        <p style={{color:"rgba(255,255,255,0.5)",fontSize:"12px",margin:0}}>Your username <span style={{color:"#fbbf24",fontWeight:700}}>@{username}</span> is shown as host automatically.</p>
        {myGroups.length > 0 && (
          <div>
            <label style={IS.label}>Community *</label>
            <select value={form.communityId} onChange={e=>ch("communityId",e.target.value)} style={{...IS.input,appearance:"none" as any}}>
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
        <div>
          <label style={IS.label}>Start Time *</label>
          <input type="time" value={form.startTime} onChange={e=>ch("startTime",e.target.value)} style={IS.input} />
        </div>
        <div>
          <label style={IS.label}>End Time *</label>
          <input type="time" value={form.endTime} onChange={e=>ch("endTime",e.target.value)} style={IS.input} />
        </div>
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
  const commScheds = schedules.filter(s => s.communityId === community.id);
  const today     = new Date();
  const weekLabel = `Week of ${today.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`;

  function downloadSummary() {
    const csv = buildCSV(commScheds, signups);
    downloadCSV(csv, `${community.name}_${weekLabel.replace(/[\s,]/g,"_")}.csv`);
  }

  const totalGiftAll = signups.filter(sg => commScheds.some(s => s.id===sg.scheduleId)).reduce((sum,sg)=>sum+(sg.plannedGiftAmount||0),0);
  const liveNowCount = commScheds.filter(s => effectiveStatus(s)===STATUS.LIVE_NOW).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-white font-black text-xl">👥 {community.name}</h2>
          <p className="text-white/40 text-xs mt-0.5">Invite code: <span className="text-amber-400 font-bold">{community.inviteCode}</span></p>
        </div>
        <button onClick={downloadSummary} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-4 py-2 rounded-xl transition-colors">⬇ CSV</button>
      </div>

      {/* Summary */}
      <div className="rounded-2xl p-4" style={{background:"linear-gradient(145deg,#1a1f3c,#0f1225)"}}>
        <p className="text-white/40 text-xs font-semibold uppercase tracking-wide mb-3">{weekLabel}</p>
        <div className="grid grid-cols-4 gap-2">
          <Pill label="Members"  value={members.length} />
          <Pill label="Hosts"    value={commScheds.length} />
          <Pill label="Live Now" value={liveNowCount} />
          <Pill label="🎁 Total" value={totalGiftAll>0?`$${totalGiftAll}`:"—"} accent={totalGiftAll>0} />
        </div>
      </div>

      {/* Schedules */}
      <div>
        <h3 className="text-white font-black text-base mb-3">Schedules ({commScheds.length})</h3>
        {commScheds.length===0 && <p className="text-white/40 text-sm text-center py-4">No schedules yet.</p>}
        {commScheds.map(sched => {
          const ss = signups.filter(sg=>sg.scheduleId===sched.id);
          const totalGift = ss.reduce((sum,sg)=>sum+(sg.plannedGiftAmount||0),0);
          const status = effectiveStatus(sched);
          return (
            <div key={sched.id} className="rounded-2xl p-4 mb-3" style={{background:"linear-gradient(145deg,#1e2340,#16192e)"}}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap"><Badge status={status} /><span className="text-white/40 text-xs">{platformIcon(sched.platform)} {sched.platform}</span></div>
                  <p className="text-white font-black text-sm">@{sched.hostUsername}</p>
                  <p className="text-white/40 text-xs">{formatDays(sched.daysOfWeek??[sched.dayOfWeek])} · {formatTime(sched.startTime)} – {formatTime(sched.endTime)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-amber-400 font-black text-xl leading-none">{ss.length}</p>
                  <p className="text-white/40 text-xs">supporters</p>
                  {totalGift>0 && <p className="text-emerald-400 text-xs font-semibold">${totalGift} est.</p>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {status!==STATUS.LIVE_NOW&&status!==STATUS.CANCELLED&&<button onClick={()=>onGoLive(sched.id)} className="text-xs bg-red-500/80 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors">🔴 Go Live</button>}
                {status!==STATUS.COMPLETED&&status!==STATUS.CANCELLED&&<button onClick={()=>onStatusChange(sched.id,STATUS.COMPLETED)} className="text-xs bg-emerald-600/80 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors">✓ Complete</button>}
                {status!==STATUS.CANCELLED&&<button onClick={()=>onStatusChange(sched.id,STATUS.CANCELLED)} className="text-xs bg-gray-600/80 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors">✕ Cancel</button>}
                {sched.manualStatus&&<button onClick={()=>onStatusChange(sched.id,null)} className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg font-semibold transition-colors">↺ Reset</button>}
              </div>
              {ss.length>0 && (
                <div className="mt-3 border-t border-white/10 pt-3 space-y-1.5">
                  {ss.map(sg => (
                    <div key={sg.id} className="flex items-center gap-2 text-xs">
                      <span className="w-6 h-6 rounded-full bg-gradient-to-br from-amber-400 to-rose-500 flex items-center justify-center text-white font-black flex-shrink-0">{sg.displayName[0].toUpperCase()}</span>
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
        <h3 className="text-white font-black text-base mb-3">Members ({members.length})</h3>
        <div className="rounded-2xl overflow-hidden" style={{background:"linear-gradient(145deg,#1e2340,#16192e)"}}>
          {members.map((m, i) => (
            <div key={m.id} className={`flex items-center justify-between px-4 py-3 ${i<members.length-1?"border-b border-white/10":""}`}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-rose-500 flex items-center justify-center text-white font-black text-xs flex-shrink-0">{m.username[0].toUpperCase()}</div>
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

function DashboardView({ schedules, signups, currentUser, communities, tick, onView, onGoLive, onAddSchedule, onJoinCommunity, onCreateCommunity, activeCommunityId, onSwitchCommunity }) {
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");

  const myGroups = communities.filter(c => currentUser.communityIds?.includes(c.id));

  // Filter schedules to the active community
  const communitySchedules = useMemo(() => {
    if (!activeCommunityId) return [];
    return schedules.filter(s => s.communityId === activeCommunityId);
  }, [schedules, activeCommunityId]);

  const allOccurrences = useMemo(() => {
    const occ = communitySchedules.flatMap(s => expandOccurrences(s));
    const order = { [STATUS.LIVE_NOW]:0, [STATUS.UPCOMING]:1, [STATUS.COMPLETED]:2, [STATUS.CANCELLED]:3 };
    return occ.sort((a,b) => { const oa=order[a.status]??9, ob=order[b.status]??9; return oa!==ob?oa-ob:a.dateObj-b.dateObj; });
  }, [communitySchedules, tick]);

  const liveNowCount  = allOccurrences.filter(o=>o.status===STATUS.LIVE_NOW).length;
  const upcomingCount = allOccurrences.filter(o=>o.status===STATUS.UPCOMING).length;

  const filtered = useMemo(() => {
    let list = allOccurrences;
    if (filter==="Live Now")  list = list.filter(o=>o.status===STATUS.LIVE_NOW);
    if (filter==="Coming Up") list = list.filter(o=>o.status===STATUS.UPCOMING);
    if (search.trim()) { const q=search.trim().replace(/^@/,"").toLowerCase(); list=list.filter(o=>o.schedule.hostUsername.toLowerCase().includes(q)); }
    return list;
  }, [allOccurrences, filter, search]);

  const activeCommunity = communities.find(c=>c.id===activeCommunityId);

  return (
    <div className="space-y-4">
      {/* Community switcher */}
      <CommunitySwitcher myGroups={myGroups} activeCommunityId={activeCommunityId} onSwitch={onSwitchCommunity} onJoin={onJoinCommunity} onCreate={onCreateCommunity} />

      {!activeCommunityId || myGroups.length===0 ? null : (
        <>
          <div className="flex items-center justify-between">
            <h1 className="text-white font-black text-lg">{activeCommunity?.name} Lives</h1>
          </div>

          {/* Search */}
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-sm">🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by @username…"
              className="w-full bg-white/10 text-white placeholder-white/30 rounded-xl pl-9 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-amber-400" />
            {search && <button onClick={()=>setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white text-xs">✕</button>}
          </div>

          {/* Filter tabs */}
          <div className="flex justify-center gap-2 flex-wrap">
            {[{key:"All",label:"All",count:allOccurrences.length},{key:"Live Now",label:"🔴 Live Now",count:liveNowCount},{key:"Coming Up",label:"📅 Coming Up",count:upcomingCount}].map(tab => (
              <button key={tab.key} onClick={()=>setFilter(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${filter===tab.key?"bg-amber-400 text-gray-900":"bg-white/10 text-white/60 hover:bg-white/20"}`}>
                {tab.label}
                {tab.count>0&&<span className={`rounded-full px-1.5 py-0.5 text-xs font-black leading-none ${filter===tab.key?"bg-gray-900/20 text-gray-900":"bg-white/10 text-white/60"}`}>{tab.count}</span>}
              </button>
            ))}
          </div>

          {filtered.length===0 ? (
            <div className="text-center py-16">
              <p className="text-4xl mb-3">{filter==="Live Now"?"📡":search?"🔎":"📭"}</p>
              <p className="text-white/40 font-semibold">
                {search?`No lives found for "@${search.replace(/^@/,"")}"`:filter==="Live Now"?"No one is live right now.":filter==="Coming Up"?"No upcoming lives.":"No schedules in this community yet."}
              </p>
              {!search&&filter==="All"&&<button onClick={onAddSchedule} className="mt-3 text-amber-400 text-sm underline">Post your schedule</button>}
            </div>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(160px, 1fr))",gap:"12px"}}>
              {filtered.map(occ => (
                <OccurrenceCard key={occ.occurrenceId} occurrence={occ} signups={signups}
                  onView={onView} isOwner={occ.schedule.userId===currentUser.id} onGoLive={onGoLive} />
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
function PaywallScreen({ currentUser, onPaymentSuccess }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  async function handleSubscribe() {
    setLoading(true);
    setError("");
    try {
      // [DB INTEGRATION] Call your API route to create a Stripe Checkout session
      // const res = await fetch("/api/stripe/checkout", {
      //   method: "POST",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify({ userId: currentUser.id, username: currentUser.username }),
      // });
      // const { url } = await res.json();
      // window.location.href = url; // redirect to Stripe Checkout

      // ── MOCK for demo — simulates successful payment ──
      await new Promise(r => setTimeout(r, 1500));
      onPaymentSuccess();
    } catch (e) {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="app-shell flex flex-col items-center justify-center px-4 py-8 min-h-screen" style={{background:"linear-gradient(180deg,#0d0f1c,#0a0c18)"}}>
      <div className="w-full" style={{maxWidth:"420px"}}>
        {/* Logo */}
        <div className="text-center mb-8">
          <p className="text-5xl mb-3">📡</p>
          <h1 className="text-white font-black text-2xl tracking-tight">LiveSupport <span className="text-amber-400">Scheduler</span></h1>
        </div>

        {/* Pricing card */}
        <div className="rounded-2xl overflow-hidden mb-4" style={{background:"linear-gradient(145deg,#1e2340,#16192e)", border:"1px solid rgba(251,191,36,0.25)"}}>
          {/* Header */}
          <div className="px-6 py-5 text-center" style={{background:"linear-gradient(135deg,rgba(251,191,36,0.15),rgba(251,191,36,0.05))"}}>
            <p className="text-amber-400 text-xs font-bold uppercase tracking-widest mb-1">Full Access</p>
            <div className="flex items-start justify-center gap-1">
              <span className="text-white text-2xl font-black mt-1">$</span>
              <span className="text-white font-black" style={{fontSize:"4rem",lineHeight:1}}>2.99</span>
              <span className="text-white/50 text-sm mt-auto mb-2">/mo</span>
            </div>
            <p className="text-white/50 text-sm mt-1">Cancel anytime</p>
          </div>

          {/* Features */}
          <div className="px-6 py-5 space-y-3">
            {[
              "View all community live schedules",
              "Sign up to support your favorite hosts",
              "Get notified when hosts go live",
              "Track planned gift amounts",
              "Join multiple communities",
              "Post your own weekly schedule",
            ].map((f, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-amber-400 text-base flex-shrink-0">✓</span>
                <span className="text-white/80 text-sm">{f}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="px-6 pb-6">
            {error && <p className="text-red-400 text-xs bg-red-400/10 rounded-lg px-3 py-2 mb-3 text-center">{error}</p>}
            <button onClick={handleSubscribe} disabled={loading}
              className="w-full bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-gray-900 font-black text-base rounded-2xl py-4 transition-colors flex items-center justify-center gap-2">
              {loading ? (
                <>
                  <span style={{width:18,height:18,border:"2.5px solid #92400e",borderTopColor:"transparent",borderRadius:"50%",display:"inline-block",animation:"spin 0.7s linear infinite"}} />
                  Processing…
                </>
              ) : (
                <>🔓 Subscribe for $2.99/mo</>
              )}
            </button>
            <p className="text-white/25 text-xs text-center mt-3">
              Secured by Stripe · Cancel anytime in settings
            </p>
          </div>
        </div>

        {/* Signed in as */}
        <p className="text-white/30 text-xs text-center">
          Signed in as <span className="text-white/50 font-semibold">@{currentUser.username}</span> ·{" "}
          <button onClick={() => window.location.reload()} className="underline hover:text-white/50 transition-colors">Sign out</button>
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
        <div className="absolute right-0 top-full mt-2 w-56 rounded-xl p-3 z-50 shadow-xl" style={{background:"#1e2340", border:"1px solid rgba(255,255,255,0.1)"}}>
          {status === "granted" && <p className="text-white/70 text-xs">You'll get notified when hosts in your community go live. To turn off, check your browser notification settings.</p>}
          {status === "denied"  && <p className="text-white/70 text-xs">Notifications are blocked. Go to your browser settings → Site Settings → Notifications to allow them for this site.</p>}
        </div>
      )}
    </div>
  );
}

// ─── User Menu ────────────────────────────────────────────────────────────────

function UserMenu({ currentUser, onLogout, onManage }) {
  const [open, setOpen] = useState(false);

  // Close menu when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (!e.target.closest("#user-menu")) setOpen(false);
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [open]);

  return (
    <div id="user-menu" className="relative">
      {/* Avatar button */}
      <button onClick={() => setOpen(v => !v)}
        className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-rose-500 flex items-center justify-center text-white font-black text-sm flex-shrink-0 hover:opacity-90 transition-opacity">
        {currentUser.username[0].toUpperCase()}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 rounded-2xl overflow-hidden z-50 shadow-2xl"
          style={{background:"#1e2340", border:"1px solid rgba(255,255,255,0.1)"}}>

          {/* User info */}
          <div className="px-4 py-3 border-b border-white/10">
            <p className="text-white font-black text-sm">@{currentUser.username}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {currentUser.hasPaid
                ? <span className="text-emerald-400 text-xs font-semibold">✓ Active subscription</span>
                : <span className="text-red-400 text-xs font-semibold">No active subscription</span>
              }
            </div>
          </div>

          {/* Menu items */}
          <div className="py-1">
            {currentUser.hasPaid && (
              <button onClick={() => { setOpen(false); onManage(); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors">
                <span className="text-base">💳</span>
                <div>
                  <p className="text-white text-sm font-semibold">Manage Subscription</p>
                  <p className="text-white/40 text-xs">Cancel or update billing</p>
                </div>
              </button>
            )}

            <button onClick={() => { setOpen(false); onLogout(); }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors border-t border-white/5">
              <span className="text-base">🚪</span>
              <p className="text-white/70 text-sm font-semibold">Sign Out</p>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── App Root ──────────────────────────────────────────────────────────────────

const VIEWS = { DASHBOARD:"dashboard", DETAIL:"detail", MY:"my", ADMIN:"admin" };

export default function App() {
  // [DB INTEGRATION] Replace all useState with useEffect + API/Supabase fetches on mount.
  const [communities, setCommunities] = useState(SEED_COMMUNITIES);
  const [users,       setUsers]       = useState(SEED_USERS);
  const [schedules,   setSchedules]   = useState(SEED_SCHEDULES);
  const [signups,     setSignups]     = useState(SEED_SIGNUPS);
  const [currentUser,  setCurrentUser]  = useState(null);
  const [pendingUser,  setPendingUser]  = useState(null); // user awaiting post-register flow
  const [view,         setView]         = useState(VIEWS.DASHBOARD);
  const [activeId,    setActiveId]    = useState(null);
  const [activeCommunityId, setActiveCommunityId] = useState(null);

  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setInterval(()=>setTick(n=>n+1), 30000); return ()=>clearInterval(t); }, []);

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

  // ── Auth ──
  function handleLogin(user)          { setCurrentUser(user); }
  function handleLogout()             { setCurrentUser(null); setView(VIEWS.DASHBOARD); setActiveCommunityId(null); }

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
  function handleRegister(u) {
    // [DB INTEGRATION] Insert user row in DB, then show post-register flow
    setUsers(p=>[...p,u]);
    setPendingUser(u); // triggers PostRegisterScreen
  }

  function handleCreateCommunity(community) {
    // [DB INTEGRATION] INSERT into communities + community_members tables
    setCommunities(p=>[...p, community]);
    // Merge with any existing communityIds so multiple communities are supported
    const updated = { ...pendingUser, communityIds: [...(pendingUser.communityIds||[]), community.id] };
    setUsers(p=>p.map(u=>u.id===pendingUser.id ? updated : u));
    setCurrentUser(updated);
    setPendingUser(null);
    setActiveCommunityId(community.id);
  }

  function handleJoinAfterRegister(community) {
    // [DB INTEGRATION] INSERT into community_members table
    const updated = { ...pendingUser, communityIds: [community.id] };
    setUsers(p=>p.map(u=>u.id===pendingUser.id ? updated : u));
    setCurrentUser(updated);
    setPendingUser(null);
    setActiveCommunityId(community.id);
  }

  function handleSkipCommunity() {
    setCurrentUser(pendingUser);
    setPendingUser(null);
  }

  // ── Community ──
  function handleJoinCommunity(code) {
    const community = communities.find(c=>c.inviteCode.toUpperCase()===code.toUpperCase());
    if (!community) return false;
    if (currentUser.communityIds?.includes(community.id)) return true; // already in
    // [DB INTEGRATION] INSERT into community_members table
    const updated = { ...currentUser, communityIds: [...(currentUser.communityIds||[]), community.id] };
    setUsers(p=>p.map(u=>u.id===currentUser.id?updated:u));
    setCurrentUser(updated);
    setActiveCommunityId(community.id);
    return true;
  }

  function handleCreateFromDashboard(communityName) {
    // Called when user creates a community from the switcher (not post-register)
    // [DB INTEGRATION] INSERT into communities + community_members tables
    const code = communityName.toUpperCase().replace(/\s+/g,"").slice(0,6) +
                 Math.random().toString(36).slice(2,5).toUpperCase();
    const community = { id:uid(), name:communityName.toUpperCase(), inviteCode:code, leaderId:currentUser.id, createdAt:new Date().toISOString() };
    setCommunities(p=>[...p, community]);
    const updated = { ...currentUser, communityIds: [...(currentUser.communityIds||[]), community.id] };
    setUsers(p=>p.map(u=>u.id===currentUser.id?updated:u));
    setCurrentUser(updated);
    setActiveCommunityId(community.id);
  }

  function handleRemoveMember(communityId, userId) {
    // [DB INTEGRATION] DELETE from community_members table
    setUsers(p=>p.map(u=>u.id===userId?{...u,communityIds:(u.communityIds||[]).filter(id=>id!==communityId)}:u));
  }

  // ── Schedules ──
  function handleSaveSchedule(s)      { setSchedules(p=>p.find(x=>x.id===s.id)?p.map(x=>x.id===s.id?s:x):[s,...p]); }
  function handleGoLive(id) {
    setSchedules(p=>p.map(s=>s.id===id?{...s,manualStatus:STATUS.LIVE_NOW}:s));
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
  function handleStatusChange(id, st) { setSchedules(p=>p.map(s=>s.id===id?{...s,manualStatus:st}:s)); }

  // ── Signups ──
  function handleSignup(data)         { setSignups(p=>[data,...p]); }
  function handleUpdateSignup(updated){ setSignups(p=>p.map(sg=>sg.id===updated.id?updated:sg)); }
  function handleRemoveSignup(id)     { setSignups(p=>p.filter(sg=>sg.id!==id)); }

  if (!currentUser && !pendingUser) return (
    <>
      <GlobalStyles />
      <AuthScreen users={users} onLogin={handleLogin} onRegister={handleRegister} />
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
      <div className="app-shell text-white" style={{fontFamily:"'DM Sans','Segoe UI',sans-serif",overflowX:"hidden"}}>
        <header className="sticky top-0 z-40 backdrop-blur-lg" style={{background:"rgba(10,12,24,0.93)",borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
          <div className="w-full px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">📡</span>
              <span className="font-black text-white text-sm tracking-tight">LiveSupport <span className="text-amber-400">Scheduler</span></span>
              {liveNow>0&&<span className="bg-red-500 text-white text-xs font-black px-2 py-0.5 rounded-full" style={{animation:"livePulse 1.2s ease-in-out infinite"}}>{liveNow} LIVE</span>}
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell currentUser={currentUser} activeCommunityId={activeCommunityId} />
              <UserMenu currentUser={currentUser} onLogout={handleLogout} onManage={handleManageSubscription} />
            </div>
          </div>
        </header>

        <main className="w-full px-4 py-5 pb-28" style={{overflowX:"hidden"}}>
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
              onView={id=>{ setActiveId(id); setView(VIEWS.DETAIL); }}
              onGoLive={handleGoLive}
              onAddSchedule={()=>setView(VIEWS.MY)}
            />
          )}

          {view===VIEWS.DETAIL&&activeOccurrence&&(
            <OccurrenceDetail
              occurrence={activeOccurrence}
              signups={signups}
              currentUser={currentUser}
              onBack={()=>{ setView(VIEWS.DASHBOARD); setActiveId(null); }}
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

          {view===VIEWS.ADMIN&&myLeaderCommunities.length>0&&(
            <div className="space-y-6">
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

        <nav className="fixed bottom-0 left-0 right-0 z-40" style={{background:"rgba(10,12,24,0.97)",borderTop:"1px solid rgba(255,255,255,0.07)"}}>
          <div className="w-full flex">
            {navItems.map(item => (
              <button key={item.key} onClick={()=>setView(item.key)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-3 text-xs font-bold transition-colors ${view===item.key?"text-amber-400":"text-white/35 hover:text-white/60"}`}>
                <span className="text-base leading-none">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <p className="text-center text-white/15 text-xs pb-2 px-4">⚠️ No payments processed — gift amounts are for planning only</p>
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
        "select option { background: #16192e; color: white; }",
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
