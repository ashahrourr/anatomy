// Demo mode.
//
// NEXT_PUBLIC_DEMO=1 runs the app with no backend, no database and no model
// calls: Supabase auth is stubbed out and every request to the API is answered
// from fixtures. The 3D models still load from the CDN, so the viewer and the
// highlighting are the real thing — only the prediction is canned.
//
// Turned off, this file does nothing.

import { supabase } from "../lib/supabase";
import { DEMO_CASES, DEMO_CREDITS, matchDemoCase } from "./demoData";

export const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function route(url: string, init?: RequestInit): Promise<Response | null> {
  const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];

  if (path === "/credits") {
    return json({ credits: DEMO_CREDITS });
  }

  if (path === "/predict-structure") {
    let painText = "";
    try {
      painText = JSON.parse((init?.body as string) || "{}").pain_text ?? "";
    } catch {
      /* ignore */
    }

    // a beat of latency, so the spinner behaves like it does against the API
    await new Promise((r) => setTimeout(r, 450));

    const hit = matchDemoCase(painText);
    if (!hit) {
      return json({
        primary: null,
        supporting: [],
        error:
          "This is a demo with a fixed set of examples. Try one of the suggestions below.",
        credits: DEMO_CREDITS,
      });
    }

    return json({
      primary: hit.primary,
      supporting: hit.supporting,
      credits: DEMO_CREDITS,
    });
  }

  if (path === "/create-checkout-session") {
    return json({ error: "Checkout is disabled in the demo." }, 400);
  }

  return json({ ok: true, demo: true });
}

export function installDemoMode() {
  if (!DEMO || typeof window === "undefined") return;

  // 1. no Supabase project to reach — return a signed-out session rather than
  //    letting the client hang on DNS that no longer resolves
  const noSession = { data: { session: null }, error: null } as any;
  supabase.auth.getSession = async () => noSession;
  supabase.auth.getUser = async () => ({ data: { user: null }, error: null } as any);
  supabase.auth.onAuthStateChange = ((cb: any) => {
    setTimeout(() => cb("SIGNED_OUT", null), 0);
    return { data: { subscription: { unsubscribe() {} } } } as any;
  }) as any;
  supabase.auth.signOut = async () => ({ error: null } as any);

  // 2. answer the API from fixtures
  const base = process.env.NEXT_PUBLIC_API_BASE_URL || "";
  const realFetch = window.fetch.bind(window);
  window.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url ?? "";
    if (base && url.startsWith(base)) {
      const res = await route(url, init);
      if (res) return res;
    }
    return realFetch(input, init);
  }) as typeof window.fetch;

  // eslint-disable-next-line no-console
  console.info(
    `[talktoanatomy] demo mode — ${DEMO_CASES.length} canned cases, no backend, no model calls`
  );
}
