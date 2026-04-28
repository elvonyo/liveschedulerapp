"use client";

import { Suspense } from "react";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function PaymentSuccessInner() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const sessionId    = searchParams.get("session_id");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");

  useEffect(() => {
    if (!sessionId) { setStatus("error"); return; }
    fetch("/api/stripe/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) { setStatus("success"); setTimeout(() => router.push("/"), 2000); }
        else setStatus("error");
      })
      .catch(() => setStatus("error"));
  }, [sessionId]);

  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px 20px",background:"linear-gradient(180deg,#0d0f1c,#0a0c18)",fontFamily:"'DM Sans','Segoe UI',sans-serif",boxSizing:"border-box"}}>
      <div style={{width:"100%",maxWidth:"420px",textAlign:"center"}}>
        {status === "loading" && (
          <>
            <div style={{width:48,height:48,border:"3px solid rgba(251,191,36,0.3)",borderTopColor:"#fbbf24",borderRadius:"50%",animation:"spin 0.8s linear infinite",margin:"0 auto 20px"}} />
            <p style={{color:"#fff",fontWeight:900,fontSize:"20px",margin:"0 0 8px"}}>Confirming your payment…</p>
            <p style={{color:"rgba(255,255,255,0.4)",fontSize:"14px",margin:0}}>Just a moment</p>
          </>
        )}
        {status === "success" && (
          <>
            <p style={{fontSize:"52px",marginBottom:"16px"}}>🎉</p>
            <p style={{color:"#fff",fontWeight:900,fontSize:"22px",margin:"0 0 8px"}}>You're in!</p>
            <p style={{color:"rgba(255,255,255,0.5)",fontSize:"14px",margin:"0 0 24px"}}>Your subscription is active. Taking you to the app…</p>
            <div style={{background:"linear-gradient(145deg,#1e2340,#16192e)",borderRadius:"16px",padding:"16px",border:"1px solid rgba(52,211,153,0.2)"}}>
              <p style={{color:"#6ee7b7",fontSize:"13px",margin:0}}>✓ Welcome to LiveSupport Scheduler</p>
            </div>
          </>
        )}
        {status === "error" && (
          <>
            <p style={{fontSize:"52px",marginBottom:"16px"}}>⚠️</p>
            <p style={{color:"#fff",fontWeight:900,fontSize:"20px",margin:"0 0 8px"}}>Something went wrong</p>
            <p style={{color:"rgba(255,255,255,0.5)",fontSize:"14px",margin:"0 0 24px",lineHeight:1.6}}>
              Your payment may have gone through but we could not confirm it automatically. Please contact us at{" "}
              <a href="mailto:info@elevateinfluence.us" style={{color:"#fbbf24"}}>info@elevateinfluence.us</a>{" "}
              and we will sort it out right away.
            </p>
            <button onClick={() => router.push("/")} style={{width:"100%",background:"#fbbf24",color:"#1c1400",fontWeight:900,fontSize:"15px",border:"none",borderRadius:"14px",padding:"14px",cursor:"pointer"}}>
              Go to App
            </button>
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(180deg,#0d0f1c,#0a0c18)"}}>
      <div style={{width:48,height:48,border:"3px solid rgba(251,191,36,0.3)",borderTopColor:"#fbbf24",borderRadius:"50%",animation:"spin 0.8s linear infinite"}} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function PaymentSuccess() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <PaymentSuccessInner />
    </Suspense>
  );
}
