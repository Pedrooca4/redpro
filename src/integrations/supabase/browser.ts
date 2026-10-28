"use client";

import "client-only";

import { createBrowserClient } from "@supabase/ssr";

import { requireSupabaseConfig } from "@/config/supabase";

/** Creates the browser client on demand; importing this module makes no request. */
export function createSupabaseBrowserClient() {
  // Explicit property access allows Next.js to inline only these public values.
  const config = requireSupabaseConfig({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

  return createBrowserClient(config.url, config.publishableKey);
}
