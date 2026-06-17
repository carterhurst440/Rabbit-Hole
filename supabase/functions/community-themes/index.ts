// RABBIT HOLE — community theme tagging.
// Two modes:
//   default       { title, text, type, genre } -> { themes: string[] }   (post-time, user JWT)
//   backfill      { mode: 'backfill' }          -> { updated, results }   (service-role mass fill)
// Names 2-3 broad, reusable themes per shared hop so the feed can show theme
// chips and aggregate a themes cloud. Anthropic key stays server-side.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const HAIKU = "claude-haiku-4-5";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });
}

async function callClaude(apiKey: string, system: string, user: string, max_tokens = 120): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: HAIKU, max_tokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
}

function parseThemes(s: string): string[] {
  try {
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a === -1 || b === -1) return [];
    const obj = JSON.parse(s.slice(a, b + 1));
    return Array.isArray(obj.themes)
      ? obj.themes.filter((x: any) => typeof x === "string" && x.trim()).map((x: string) => x.trim().toUpperCase()).slice(0, 3)
      : [];
  } catch {
    return [];
  }
}

function systemPrompt(kind: string): string {
  return (
    "You are a thematic-tagging assistant inside RABBIT HOLE, a writing community. Read one shared " +
    "excerpt of creative writing and name 2-3 THEME tags it explores. These tags are shared across the " +
    "whole community, so they MUST be universal and reusable — the kind of label that hundreds of " +
    "different stories would land on, never a one-off. " +
    "RULES:\n" +
    "1. Prefer ONE single canonical word: CORRUPTION, GRIEF, REVENGE, BETRAYAL, SURVIVAL, IDENTITY, " +
    "POWER, ISOLATION, REDEMPTION, FAITH, GREED, FAMILY, SACRIFICE, LOVE, FEAR, JUSTICE, AMBITION, LOSS. " +
    "2. Only use a 2-3 word phrase when it is itself a well-known reusable trope: COMING OF AGE, " +
    "MAN VS NATURE, FORBIDDEN LOVE, BOARD MEETING, COLD OPEN. " +
    "3. NEVER chain ideas with 'and' (no 'Power and Corruption' — pick CORRUPTION). " +
    "4. NEVER use proper nouns, character names, places, or plot-specific labels. " +
    "5. Pick the most common, generic word a reader would search by, not the most precise one. " +
    "Output every tag in UPPERCASE. Return 2 or 3, most central first. " +
    (kind ? `This is a ${kind}. ` : "") +
    `Respond with ONLY a JSON object of the form {"themes":["...","..."]}. No markdown, no commentary.`
  );
}

async function themesFor(apiKey: string, title: string, text: string, type: string, genre: string): Promise<string[]> {
  const t = (text || "").trim();
  if (!t) return [];
  const kind = [type, genre].filter(Boolean).join(" / ");
  const raw = await callClaude(apiKey, systemPrompt(kind), `EXCERPT${title ? `: ${title}` : ""}\n${t}`);
  return parseThemes(raw);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set." }, 500);
    const body = await req.json().catch(() => ({}));

    if (body.mode === "backfill") {
      const url = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const admin = createClient(url, serviceKey);
      const { data: posts, error } = await admin
        .from("community_posts")
        .select("id, hop_title, hop_body, project_type, project_genre, themes");
      if (error) return json({ error: error.message }, 500);
      const force = body.force === true;
      let updated = 0;
      const results: any[] = [];
      for (const p of posts || []) {
        if (!force && Array.isArray(p.themes) && p.themes.length) { results.push({ id: p.id, skipped: true }); continue; }
        const themes = await themesFor(apiKey, p.hop_title || "", p.hop_body || "", p.project_type || "", p.project_genre || "");
        if (themes.length) {
          await admin.from("community_posts").update({ themes }).eq("id", p.id);
          updated++;
        }
        results.push({ id: p.id, themes });
      }
      return json({ updated, count: (posts || []).length, results });
    }

    const themes = await themesFor(apiKey, body.title || "", body.text || "", body.type || "", body.genre || "");
    return json({ themes });
  } catch (e) {
    return json({ error: String((e as any)?.message || e) }, 500);
  }
});
