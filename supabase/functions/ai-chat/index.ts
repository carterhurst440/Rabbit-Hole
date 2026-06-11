// RABBIT HOLE — AI assistant.
// Calls the Anthropic Messages API server-side so the key never reaches the client.
// Set the secret with:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-sonnet-4-6";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set on the function." }, 500);

    const { messages = [], context = {} } = await req.json();
    const clean = (Array.isArray(messages) ? messages : [])
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
      .map((m) => ({ role: m.role, content: String(m.content) }));
    if (!clean.length) return json({ error: "No messages." }, 400);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: buildSystem(context),
        messages: clean,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return json({ error: `Anthropic ${res.status}: ${detail}` }, 502);
    }

    const data = await res.json();
    const reply = (data.content || [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("\n")
      .trim();
    return json({ reply: reply || "No response." });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

function buildSystem(ctx: {
  project?: string | null;
  chapters?: string[];
  characters?: { name: string; summary?: string }[];
}): string {
  const lines = [
    "You are the writing assistant inside RABBIT HOLE, a book-writing workbench.",
    "Help the author develop their story: plot, character arcs, pacing, continuity, and prose.",
    "Be concise and concrete. Ask a clarifying question only when truly necessary.",
  ];
  if (ctx.project) lines.push(`\nCurrent project: ${ctx.project}`);
  if (ctx.chapters?.length) lines.push(`Chapters: ${ctx.chapters.join(", ")}`);
  if (ctx.characters?.length) {
    lines.push("Characters:");
    for (const c of ctx.characters) {
      lines.push(`- ${c.name}${c.summary ? `: ${c.summary}` : ""}`);
    }
  }
  return lines.join("\n");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}
