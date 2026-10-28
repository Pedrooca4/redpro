// Compile-only checks, included by tsconfig.json. Never run as runtime tests.
import type { SupabaseConfig } from "@/config/supabase";

export const aliasContract: SupabaseConfig = {
  url: "https://example.supabase.co",
  publishableKey: "synthetic-typecheck-only",
};

// @ts-expect-error strictNullChecks must reject null for a required string.
export const strictNullContract: string = null;

// @ts-expect-error noImplicitAny must reject an untyped parameter.
export function implicitParameterContract(value) {
  return value;
}

// @ts-expect-error The alias must resolve the real type with required fields.
export const missingFieldContract: SupabaseConfig = { url: "https://example.supabase.co" };
