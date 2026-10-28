export type SupabaseEnvironment = {
  url?: string;
  publishableKey?: string;
};

export type SupabaseConfig = {
  url: string;
  publishableKey: string;
};

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Validates public Supabase configuration without reading process.env or making
 * network requests. Missing configuration is supported during RED-001.
 * Error messages deliberately exclude configuration values.
 */
export function getSupabaseConfig(
  environment: SupabaseEnvironment,
): SupabaseConfig | null {
  const url = environment.url?.trim();
  const publishableKey = environment.publishableKey?.trim();

  if (!url && !publishableKey) return null;

  if (!url || !publishableKey) {
    throw new Error(
      "Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY juntas.",
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL precisa ser uma URL válida.");
  }

  const secureProtocol = parsedUrl.protocol === "https:";
  const localHttp =
    parsedUrl.protocol === "http:" && loopbackHosts.has(parsedUrl.hostname);

  if (
    (!secureProtocol && !localHttp) ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.search ||
    parsedUrl.hash ||
    parsedUrl.pathname !== "/"
  ) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL deve usar HTTPS (HTTP apenas em localhost), sem credenciais, caminho, consulta ou fragmento.",
    );
  }

  // This foundation deliberately supports only the current publishable format.
  // Secret keys and legacy JWT keys, including service_role, are never accepted.
  if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(publishableKey)) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY deve ser uma chave publicável sb_publishable_. Chaves secretas e JWT não são aceitas.",
    );
  }

  return { url: parsedUrl.origin, publishableKey };
}

export function requireSupabaseConfig(
  environment: SupabaseEnvironment,
): SupabaseConfig {
  const config = getSupabaseConfig(environment);
  if (!config) {
    throw new Error(
      "Supabase ainda não configurado. Defina as duas variáveis públicas antes de usar a integração.",
    );
  }
  return config;
}
