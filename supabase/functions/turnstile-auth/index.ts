import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ALLOWED_ORIGINS = new Set([
  "https://bentoxr.github.io",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
]);

function corsHeaders(origin: string | null) {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://bentoxr.github.io";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

function jsonResponse(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
    },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ message: "Method not allowed." }, 405, origin);
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse({ message: "Origin not allowed." }, 403, origin);
  }

  const secret = (Deno.env.get("TURNSTILE_SECRET") || "").trim();
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
  const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();

  if (!secret || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ message: "Verificação temporariamente indisponível." }, 503, origin);
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ message: "Requisição inválida." }, 400, origin);
  }

  const rpc = payload.rpc === "criar_conta" || payload.rpc === "criar_conta_convidado"
    ? payload.rpc
    : null;
  const token = typeof payload.turnstile_token === "string" ? payload.turnstile_token.trim() : "";

  if (!rpc) {
    return jsonResponse({ message: "Operação inválida." }, 400, origin);
  }
  if (token.length === 0 || token.length > 2048) {
    return jsonResponse({ message: "Confirme a verificação de segurança." }, 403, origin);
  }

  const expectedAction = rpc === "criar_conta" ? "signup" : "guest";
  const clientIp = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();

  const form = new URLSearchParams({
    secret,
    response: token,
  });
  if (clientIp) form.set("remoteip", clientIp);

  let verifyRes: Record<string, unknown>;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: form,
    });
    if (!r.ok) throw new Error(`siteverify ${r.status}`);
    verifyRes = await r.json();
  } catch {
    return jsonResponse({ message: "Falha ao validar verificação de segurança." }, 403, origin);
  }

  if (
    verifyRes.success !== true ||
    verifyRes.action !== expectedAction ||
    verifyRes.hostname !== "bentoxr.github.io"
  ) {
    return jsonResponse({ message: "Verificação de segurança recusada. Tente novamente." }, 403, origin);
  }

  const rpcBody = rpc === "criar_conta"
    ? { p_nome: payload.p_nome ?? "", p_senha: payload.p_senha ?? "" }
    : { p_nome: payload.p_nome ?? null };

  try {
    const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpc}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify(rpcBody),
    });
    const text = await rpcRes.text();
    return new Response(text, {
      status: rpcRes.status,
      headers: {
        ...corsHeaders(origin),
        "Content-Type": "application/json",
      },
    });
  } catch {
    return jsonResponse({ message: "Não consegui falar com o servidor. Confira a internet." }, 502, origin);
  }
});
