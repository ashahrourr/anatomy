// frontend/src/app/page.tsx
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Navbar from "../components/NavBar";
import dynamic from "next/dynamic";

const ModelViewer = dynamic(() => import("../components/ModelViewer"), {
  ssr: false,
});

import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/useAuth";
import Spinner from "../components/Spinner";


type Credits = {
  type: "device" | "user";
  remaining: number;
  limit: number;
  reset_in: number;
  locked?: boolean;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL!;
const MAX_TEXTAREA_HEIGHT = 140; // ~5 lines

export default function Home() {
  const [input, setInput] = useState("");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [credits, setCredits] = useState<Credits | null>(null);
  const [limitError, setLimitError] = useState(false);
  const [loading, setLoading] = useState(false);

  // auth modal
  const [showAuth, setShowAuth] = useState(false);
  const [retryIn, setRetryIn] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  const { user, ready } = useAuth();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [legend, setLegend] = useState<
  { label: string; color: string }[]
>([]);
const [legendOpen, setLegendOpen] = useState(false);
const [noAnswerMessage, setNoAnswerMessage] = useState<string | null>(null);
const [modelReady, setModelReady] = useState(false);
const [creditsBootDone, setCreditsBootDone] = useState(false);
const [showBuyCredits, setShowBuyCredits] = useState(false);
const [showUpgrade, setShowUpgrade] = useState(false);

type AuthReason = "signin" | "limit";

const [authReason, setAuthReason] = useState<AuthReason>("signin");






useEffect(() => {
  const wireframeColors = [
    "#5af6ff",
    "#ff2fb3",
    "#00ff6a",
    "#c300ff",
    "#ff7b00",
  ];

  const handler = (e: any) => {
    const { primary, supporting } = e.detail;

    const items = [
      {
        label: primary.label,
        color: "#ff3b3b", // PRIMARY
      },
      ...(supporting || []).map((s: any, i: number) => ({
        label: s.label,
        color: wireframeColors[i % wireframeColors.length],
      })),
    ];

    setLegend(items);
  };

  window.addEventListener("highlight-structures", handler);
  return () =>
    window.removeEventListener("highlight-structures", handler);
}, []);


  /* ---------------- device id ---------------- */
  useEffect(() => {
let id = localStorage.getItem("device_id");
if (!id) {
  id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

  localStorage.setItem("device_id", id);
}
setDeviceId(id);

  }, []);

  /* ---------------- credits ---------------- */
  const fetchCredits = useCallback(async () => {
    if (!deviceId) return;

    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      // console.time("CREDITS FETCH");
      const res = await fetch(`${API_BASE}/credits`, {
        headers: {
          "x-device-id": deviceId,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      // console.timeEnd("CREDITS FETCH");

      if (!res.ok) throw new Error("credits fetch failed");
      const json = await res.json();
      setCredits(json.credits ?? null);
    } catch {
      setCredits(null);
    }
  }, [deviceId]);

useEffect(() => {
  if (!deviceId || !ready) return;

  // ⛔ wait until auth is fully resolved
  supabase.auth.getSession().then(({ data }) => {
    if (!data.session && user === undefined) return;
    fetchCredits();
  });
}, [deviceId, ready, user?.id]);



  useEffect(() => {
    if (!deviceId) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith("sb-")) fetchCredits();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [deviceId, fetchCredits]);

  /* ---------------- textarea auto-grow ---------------- */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = "auto";
    const nextHeight = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT);
    el.style.height = `${nextHeight}px`;

    if (el.scrollHeight > MAX_TEXTAREA_HEIGHT) {
      el.style.overflowY = "auto";
      el.scrollTop = el.scrollHeight;
    } else {
      el.style.overflowY = "hidden";
    }
  }, [input]);

  useEffect(() => {
  if (retryIn === null) return;

  if (retryIn <= 0) {
    setRetryIn(null);
    setAuthMessage(null);
    return;
  }

  const timer = setTimeout(() => {
    setRetryIn((s) => (s !== null ? s - 1 : null));
  }, 1000);

  return () => clearTimeout(timer);
}, [retryIn]);


  /* ---------------- auth ---------------- */
const sendMagicLink = async () => {
  if (!email || authLoading || retryIn !== null) return;

  setAuthLoading(true);
  setAuthMessage(null);

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: "https://talktoanatomy.com" },
    });

    if (error) {
      // start retry countdown (e.g. 60s)
      const RETRY_SECONDS = 60;
      setAuthMessage(null);
      setRetryIn(RETRY_SECONDS);
      return;
    }

    setAuthMessage("Check your email ✉️");
  } finally {
    setAuthLoading(false);
  }
};

  /* ---------------- send ---------------- */
  const handleSend = async () => {
    const text = input.trim();
    if (!text || !deviceId || loading) return;

    setLoading(true);
    setInput("");
    setLimitError(false);
    setNoAnswerMessage(null);

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.overflowY = "hidden";
    }

    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;

      const res = await fetch(`${API_BASE}/predict-structure`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-id": deviceId,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ pain_text: text }),
      });

if (!res.ok) {
  if (res.status === 429) {
    setLimitError(true);
    setNoAnswerMessage(null);

    // 🔥 OPEN THE RIGHT POPUP
if (!user) {
  setAuthReason("limit");
  setShowAuth(true);
} else {
  setShowBuyCredits(true);
}

    return;
  }
  throw new Error("API error");
}


const data = await res.json();
setCredits(data.credits);

// 🚨 EXPLICIT ERROR FROM BACKEND
if (data.error) {
  setNoAnswerMessage(data.error);
  setLegend([]);
  setLegendOpen(false);
  return;
}

// 🚫 NO-ANSWER (MODEL COULDN’T IDENTIFY)
if (!data.primary) {
  setNoAnswerMessage(
    "I need a bit more detail. Try describing where it hurts, which side, and what movement causes pain."
  );
  setLegend([]);
  setLegendOpen(false);
  return;
}


// ✅ NORMAL CASE
setNoAnswerMessage(null);
window.dispatchEvent(
  new CustomEvent("highlight-structures", { detail: data })
);

    } finally {
      setLoading(false);
    }
  };

    /* ---------------- buy credits ---------------- */
const handleBuyCredits = async () => {
  try {
    const { data } = await supabase.auth.getSession();
    console.log("session:", data.session);
console.log("token exists?", !!data.session?.access_token);

    const token = data.session?.access_token;

    const res = await fetch(`${API_BASE}/create-checkout-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-device-id": deviceId ?? "",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    // ✅ ADD THIS BLOCK HERE
    if (!res.ok) {
      const text = await res.text();
      console.error("Checkout error:", res.status, text);
      alert("Checkout failed. Check console/network logs.");
      return;
    }

    const out = await res.json();
    if (out.url) window.location.href = out.url;
    else console.error("No checkout url:", out);
  } catch (e) {
    console.error("Stripe checkout failed", e);
  }
};

const isPro =
  !!credits && "unlimited" in credits && (credits as any).unlimited === true;

const appBootReady =
  ready &&
  !!deviceId &&
  modelReady;
  /* ---------------- UI ---------------- */
  return (
<div className="relative min-h-[100svh] bg-[#1c1c1c]">
<div className="sticky top-0 z-50">
  <Navbar />
</div>
      {!appBootReady && (
  <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#1c1c1c]">
    <Spinner size={34} />
  </div>
)}


      <div className="fixed top-2 right-4 z-50">
{user ? (
  <div className="flex gap-2">
    {!isPro ? (
      <button
        onClick={() => setShowUpgrade(true)}
        className="bg-[#181818] border border-[#282825] text-[#e5e5e5] px-4 py-2 rounded-lg text-sm hover:bg-[#222]"
      >
        Upgrade
      </button>
    ) : (
      <button
        onClick={async () => {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;

          const res = await fetch(`${API_BASE}/create-billing-portal`, {
            method: "POST",
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          });

          const out = await res.json();
          if (out.url) window.location.href = out.url;
        }}
        className="bg-[#181818] border border-[#282825] text-[#afafaf] px-4 py-2 rounded-lg text-sm hover:bg-[#222]"
      >
        Manage billing
      </button>
    )}

    <button
      onClick={() => {
        setShowAuth(false);
        supabase.auth.signOut();
      }}
      className="bg-[#181818] border border-[#282825] text-red-400 px-4 py-2 rounded-lg text-sm hover:bg-[#222]"
    >
      Sign out
    </button>
  </div>
) : (

  <button
    onClick={() => {
      setAuthReason("signin");
      setShowAuth(true);
    }}
    className="bg-[#181818] border border-[#282825] text-[#afafaf] px-4 py-2 rounded-lg text-sm hover:bg-[#222]"
  >
    Sign in
  </button>
)}

      </div>

{legend.length > 0 && (
  <>
    {/* 🔘 Toggle pill (mobile + desktop) */}
    <button
      onClick={() => setLegendOpen((v) => !v)}
      className="
        fixed top-20 right-4 z-40
        bg-[#181818]/95 border border-[#282825]
        rounded-full px-3 py-1.5
        text-xs text-[#e5e5e5]
        flex items-center gap-2
        hover:bg-[#202020]
      "
    >
      <span>Highlighted ({legend.length})</span>
      <span className="text-lg leading-none">
        {legendOpen ? "–" : "+"}
      </span>
    </button>

    {/* 📋 Expanded legend (shown when open) */}
    {legendOpen && (
      <div
        className="
          fixed top-30 right-4 z-40
          bg-[#181818]/95 border border-[#282825]
          rounded-xl px-4 py-3 space-y-2
          max-w-[240px]
        "
      >
        {legend.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-sm text-[#e5e5e5] leading-tight">
              {item.label}
            </span>
          </div>
        ))}
      </div>
    )}
  </>
)}




{showAuth && !user && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    onClick={() => setShowAuth(false)}   // 👈 click outside closes
  >
    <div
      className="relative bg-[#181818] border border-[#282825] rounded-2xl p-6 w-[360px]"
      onClick={(e) => e.stopPropagation()} // 👈 prevent close when clicking inside
    >
      {/* ❌ CLOSE BUTTON */}
      <button
        onClick={() => setShowAuth(false)}
        className="absolute top-3 right-3 text-[#afafaf] hover:text-white text-lg"
        aria-label="Close"
      >
        ×
      </button>

<h2 className="text-white text-lg mb-2 text-center">
  {authReason === "limit" ? "Out of credits" : "Sign in"}
</h2>
{authReason === "limit" && (
  <p className="text-sm text-[#afafaf] text-center mb-4">
    You’ve hit your daily limit. Sign in to get more credits.
  </p>
)}



<input
  value={email}
  onChange={(e) => setEmail(e.target.value)}
  onKeyDown={(e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendMagicLink();
    }
  }}
  placeholder="email@example.com"
  className="w-full bg-[#1c1c1c] border border-[#282825] px-3 py-2 rounded-lg text-white mb-3"
/>


<button
  onClick={sendMagicLink}
  disabled={authLoading || !email || retryIn !== null}
  className="w-full bg-[#960019] py-2 rounded-lg text-white disabled:opacity-50 flex items-center justify-center"
>
  {authLoading ? <Spinner /> : "Send Link"}
</button>


{retryIn !== null ? (
  <div className="text-sm text-[#afafaf] mt-3 text-center">
    You can request another email in {retryIn}s
  </div>
) : authMessage ? (
  <div className="text-sm text-[#afafaf] mt-3 text-center">
    {authMessage}
  </div>
) : null}

          </div>
        </div>
      )}
    {showBuyCredits && user && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    onClick={() => setShowBuyCredits(false)}   // click outside closes
  >
    <div
      className="relative bg-[#181818] border border-[#282825] rounded-2xl p-6 w-[360px]"
      onClick={(e) => e.stopPropagation()}
    >
      {/* ❌ CLOSE */}
      <button
        onClick={() => setShowBuyCredits(false)}
        className="absolute top-3 right-3 text-[#afafaf] hover:text-white text-lg"
        aria-label="Close"
      >
        ×
      </button>

      <h2 className="text-white text-lg mb-2 text-center">
        Out of credits
      </h2>

      <p className="text-sm text-[#afafaf] text-center mb-4">
        You’ve used all your credits for today.
      </p>

      <button
        onClick={handleBuyCredits}
        className="w-full bg-[#960019] py-2 rounded-lg text-white hover:opacity-90"
      >
        Upgrade to Pro
      </button>
      <p className="mt-3 text-xs text-[#afafaf] text-center">
  $4.99 · Unlimited daily credits
</p>

    </div>
  </div>
)}
{showUpgrade && user && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    onClick={() => setShowUpgrade(false)}
  >
    <div
      className="relative bg-[#181818] border border-[#282825] rounded-2xl p-6 w-[360px]"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => setShowUpgrade(false)}
        className="absolute top-3 right-3 text-[#afafaf] hover:text-white text-lg"
        aria-label="Close"
      >
        ×
      </button>

      <h2 className="text-white text-lg mb-2 text-center">Upgrade to Pro</h2>
      <p className="text-sm text-[#afafaf] text-center mb-4">
        Unlock unlimited daily credits.
      </p>

      <button
        onClick={handleBuyCredits}
        className="w-full bg-[#960019] py-2 rounded-lg text-white hover:opacity-90"
      >
        Upgrade to Pro
      </button>

      <p className="mt-3 text-xs text-[#afafaf] text-center">
        $4.99 · Unlimited daily credits
      </p>
    </div>
  </div>
)}


<div
  className="absolute left-0 right-0"
  style={{
    top: "calc(3.5rem + env(safe-area-inset-top))",
    bottom: "calc(env(safe-area-inset-bottom))",
  }}
>
  <ModelViewer onReady={() => setModelReady(true)} />



<div
  className="fixed left-1/2 -translate-x-1/2 w-[820px] max-w-[90vw]"
  style={{ bottom: "calc(env(safe-area-inset-bottom) + 1.5rem)" }}
>

{credits && (
  <div className="mb-2 text-xs text-center text-[#afafaf]">
    {"unlimited" in credits && credits.unlimited ? (
      <>Credits: ∞</>
    ) : (
      <>Credits: {credits.remaining} / {credits.limit} today</>
    )}
  </div>
)}



{noAnswerMessage && !limitError && (
  <div className="mb-3 text-sm text-center text-[#afafaf]">
    {noAnswerMessage}
  </div>
)}



          <div className="bg-[#181818] border border-[#282825] rounded-4xl px-4 py-3 flex gap-2 items-center">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              rows={1}
              placeholder="Describe what hurts"
              className="
                flex-1
                bg-transparent
                text-white
                outline-none
                resize-none
                leading-[22px]
                py-[7px]
                min-h-[36px]
                max-h-[140px]
              "
            />

            <button
              onClick={handleSend}
              disabled={limitError || loading}
              className="h-9 w-9 bg-[#960019] rounded-full flex items-center justify-center disabled:opacity-50"
            >
              {loading ? <Spinner /> : "↑"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}