import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { requireSupabaseConfig } from "@/config/supabase";

/**
 * Use exclusively in Route Handlers or Server Actions where cookies are writable.
 * The explicit option makes that requirement visible at every call site.
 * Server Components need a separate read/refresh flow when auth is implemented;
 * RED-001 does not provide auth routes, session validation, or a refresh proxy.
 * Cookie errors are propagated instead of hiding a lost session refresh.
 */
export async function createSupabaseServerClient(context: {
  cookieAccess: "read-write";
}) {
  if (context.cookieAccess !== "read-write") {
    throw new Error("Este cliente exige um contexto com escrita de cookies.");
  }
  const config = requireSupabaseConfig({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  const cookieStore = await cookies();

  return createServerClient(config.url, config.publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}
