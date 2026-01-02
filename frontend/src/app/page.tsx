// frontend/src/app/page.tsx
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Navbar from "../components/NavBar";
import ModelViewer from "../components/ModelViewer";
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

      console.time("CREDITS FETCH");
      const res = await fetch(`${API_BASE}/credits`, {
        headers: {
          "x-device-id": deviceId,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      console.timeEnd("CREDITS FETCH");

      if (!res.ok) throw new Error("credits fetch failed");
      const json = await res.json();
      setCredits(json.credits ?? null);
    } catch {
      setCredits(null);
    }
  }, [deviceId]);

useEffect(() => {
  if (!deviceId || !ready) return;

  let cancelled = false;

  (async () => {
    setCreditsBootDone(false);

    try {
      await fetchCredits();
    } finally {
      if (!cancelled) {
        setCreditsBootDone(true); // ✅ credits finished booting
      }
    }
  })();

  return () => {
    cancelled = true;
  };
}, [deviceId, ready, user?.id, fetchCredits]);


  useEffect(() => {
    if (!deviceId) return;
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key.startsWith("sb-")) fetchCredits();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [deviceId, fetchCredits]);

  useEffect(() => {
    if (!deviceId) return;
    const onFocus = () => fetchCredits();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
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
      options: { emailRedirectTo: window.location.origin },
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
        {!user ? (
          <button
            onClick={() => setShowAuth(true)}
            className="bg-[#181818] border border-[#282825] text-[#afafaf] px-4 py-2 rounded-lg text-sm hover:bg-[#222]"
          >
            Sign in
          </button>
        ) : (
          <button
              onClick={() => {
                setShowAuth(false);   // 👈 close modal
                supabase.auth.signOut();
              }}
            className="bg-[#181818] border border-[#282825] text-red-400 px-4 py-2 rounded-lg text-sm hover:bg-[#222]"
          >
            Sign out
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
  Sign in
</h2>


<input
  value={email}
  onChange={(e) => setEmail(e.target.value)}
  onKeyDown={(e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendMagicLink();
    }
  }}
  placeholder="yourname@example.com"
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
              Credits: {credits.remaining} / {credits.limit} today
            </div>
          )}

          {limitError && (
            <div className="mb-3 text-sm text-center text-[#afafaf]">
              {user
                ? "Daily limit reached. Try again tomorrow."
                : "You’ve used your credit for today. Sign in to unlock the remaining credits."}
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
