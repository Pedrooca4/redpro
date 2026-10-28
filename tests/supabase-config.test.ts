import assert from "node:assert/strict";
import test from "node:test";

import {
  getSupabaseConfig,
  requireSupabaseConfig,
} from "../src/config/supabase.ts";

// Synthetic values, never credentials for a real Supabase project.
const publishableKey = "sb_publishable_test-only-not-a-real-key-00000000";
const remoteUrl = "https://redpro-example.supabase.co";

test("missing configuration allows the foundation to run", () => {
  assert.equal(getSupabaseConfig({}), null);
  assert.equal(getSupabaseConfig({ url: " ", publishableKey: " " }), null);
  assert.throws(() => requireSupabaseConfig({}), /ainda não configurado/);
});

test("partial configuration fails with a safe actionable message", () => {
  assert.throws(() => getSupabaseConfig({ url: remoteUrl }), /juntas/);
  assert.throws(() => getSupabaseConfig({ publishableKey }), /juntas/);
});

test("accepts HTTPS and normalizes surrounding whitespace and trailing slash", () => {
  assert.deepEqual(
    getSupabaseConfig({ url: ` ${remoteUrl}/ `, publishableKey: ` ${publishableKey} ` }),
    { url: remoteUrl, publishableKey },
  );
});

test("permits HTTP only for exact loopback hosts", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const url = `http://${host}:54321`;
    assert.equal(requireSupabaseConfig({ url, publishableKey }).url, url);
  }

  for (const url of [
    "http://redpro-example.supabase.co",
    "http://localhost.example.com:54321",
    "ftp://localhost:54321",
  ]) {
    assert.throws(() => getSupabaseConfig({ url, publishableKey }), /HTTPS/);
  }
});

test("rejects malformed URLs and embedded credentials or extra URL components", () => {
  for (const url of [
    "not-a-url",
    "https://user:private-value@redpro-example.supabase.co",
    `${remoteUrl}/rest/v1`,
    `${remoteUrl}?token=private-value`,
    `${remoteUrl}#private-value`,
  ]) {
    assert.throws(() => getSupabaseConfig({ url, publishableKey }));
  }
});

test("rejects secret, service_role and malformed keys without disclosing values", () => {
  const serviceRoleJwt = [
    Buffer.from('{"alg":"HS256"}').toString("base64url"),
    Buffer.from('{"role":"service_role"}').toString("base64url"),
    "test-only-signature",
  ].join(".");

  for (const key of [
    "sb_secret_test-only-not-a-real-key-00000000",
    serviceRoleJwt,
    "service_role",
    "sb_publishable_short",
    "invalid-key-private-value",
  ]) {
    assert.throws(
      () => getSupabaseConfig({ url: remoteUrl, publishableKey: key }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes(key));
        assert.ok(!error.message.includes(remoteUrl));
        return true;
      },
    );
  }
});

test("URL validation errors never disclose the supplied URL or key", () => {
  const url = "https://private-name:private-password@redpro-example.supabase.co";
  assert.throws(
    () => getSupabaseConfig({ url, publishableKey }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      for (const secret of [url, publishableKey, "private-name", "private-password"]) {
        assert.ok(!error.message.includes(secret));
      }
      return true;
    },
  );
});
