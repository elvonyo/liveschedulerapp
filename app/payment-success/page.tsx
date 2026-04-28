"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

function PaymentSuccessInner() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const sessionId    = searchParams.get("session_id");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errMsg,  setErrMsg]  = useState("");

  useEffect(() => {
    if (!sessionId) {
      setErrMsg("No session ID found in URL.");
      setStatus("error");
      return;
    }

    fetch("/api/stripe/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setStatus("success");
          setTimeout(() => router.push("/"), 3000);
        } else {
          setErrMsg(data.error || "Verification failed.");
          setStatus("error");
        }
      })
      .catch(e => {
        setErrMsg(e.message);
        setStatus("error");
      });
  }, [sessionId]);

  const wrap: React.CSSProperties = {
    minHeight:"100vh", display:"flex", flexDirection:"column",
    alignItems:"center", justifyContent:"center",
    padding:"32px 20px",
    background:"linear-gradient(180deg,#0d0f1c,#0a0c18)",
    fontFamily:"'DM Sans','Segoe UI',sans-serif",
    boxSizing:"border-box",
  };
  const inner: React.CSSProperties = { width:"100%", maxWidth:"420px", textAlign:"center" };

  return (
    <div style={wrap}>
      <div style={inner}>

        {status === "loading" && (
          <>
            <div style={{width:48,height:48,border:"3px solid rgba(251,191,36,0.3)",borderTopColor:"#fbbf24",borderRadius:"50%",animation:"spin 0.8s linear infinite",margin:"0 auto 20px"}} />
            <p style={{color:"#fff",fontWeight:900,fontSize:"20px",margin:"0 0 8px"}}>Confirming your payment…</p>
            <p style={{color:"rgba(255,255,255,0.4)",fontSize:"14px",margin:0}}>Checking with Stripe</p>
          </>
        )}

        {status === "success" && (
          <>
            <p style={{fontSize:"56px",marginBottom:"16px"}}>🎉</p>
            <p style={{color:"#fff",fontWeight:900,fontSize:"24px",margin:"0 0 8px"}}>Payment Successful!</p>
            <p style={{color:"rgba(255,255,255,0.5)",fontSize:"14px",margin:"0 0 24px",lineHeight:1.6}}>
              Welcome to LiveSupport Scheduler.<br/>
              Redirecting you to the app in 3 seconds…
            </p>
            <div style={{background:"linear-gradient(145deg,#1a3328,#122a22)",borderRadius:"16px",padding:"16px",border:"1px solid rgba(52,211,153,0.2)",marginBottom:"20px"}}>
              <p style={{color:"#6ee7b7",fontSize:"13px",margin:0,fontWeight:700}}>✓ Subscription activated</p>
              <p style={{color:"rgba(255,255,255,0.4)",fontSize:"11px",margin:"4px 0 0"}}>
                Sign out and back in if the app still shows the paywall.
              </p>
            </div>
            <button onClick={() => router.push("/")}
              style={{width:"100%",background:"#fbbf24",color:"#1c1400",fontWeight:900,fontSize:"15px",border:"none",borderRadius:"14px",padding:"14px",cursor:"pointer"}}>
              Go to App →
            </button>
          </>
        )}

        {status === "error" && (
          <>
            <p style={{fontSize:"52px",marginBottom:"16px"}}>⚠️</p>
            <p style={{color:"#fff",fontWeight:900,fontSize:"20px",margin:"0 0 8px"}}>Verification failed</p>
            {errMsg && (
              <p style={{color:"rgba(239,68,68,0.8)",fontSize:"12px",background:"rgba(239,68,68,0.1)",borderRadius:"10px",padding:"8px 12px",margin:"0 0 16px"}}>
                {errMsg}
              </p>
            )}
            <p style={{color:"rgba(255,255,255,0.5)",fontSize:"14px",margin:"0 0 24px",lineHeight:1.6}}>
              If your payment went through, please contact{" "}
              <a href="mailto:info@elevateinfluence.us" style={{color:"#fbbf24"}}>
                info@elevateinfluence.us
              </a>{" "}
              and we will get you sorted.
            </p>
            <button onClick={() => router.push("/")}
              style={{width:"100%",background:"#fbbf24",color:"#1c1400",fontWeight:900,fontSize:"15px",border:"none",borderRadius:"14px",padding:"14px",cursor:"pointer"}}>
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
