// RABBIT HOLE — AI assistant + writing-tools backend.
// Calls the Anthropic Messages API server-side so the key never reaches the client.
// Set the secret with:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Tasks (field `task` in the JSON body):
//   chat              { messages, context }            -> { reply }
//   tag_summary       { tagName, chunks }              -> { reply }
//   char_summary      { name, aliases, chunks }        -> { reply }
//   loc_summary       { name, aliases, chunks }        -> { reply }
//   detect_characters { chunks, existing }             -> { characters: [{ name, aliases }] }
//   detect_locations  { chunks, existing }             -> { locations: [{ name, aliases }] }
//   suggest_tags      { chunk, existing }              -> { assign: [string], suggest: [string] }
//   suggest_ideas     { chunks, type, genre }          -> { ideas: [string] }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-sonnet-4-6";

type Chunk = { title?: string; body?: string };
type Msg = { role: "user" | "assistant"; content: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set on the function." }, 500);

    const body = await req.json();
    const task = body.task || "chat";

    if (task === "chat") return await doChat(apiKey, body);
    if (task === "tag_summary") return await doTagSummary(apiKey, body);
    if (task === "char_summary") return await doCharSummary(apiKey, body);
    if (task === "loc_summary") return await doLocSummary(apiKey, body);
    if (task === "detect_characters") return await doDetect(apiKey, body);
    if (task === "detect_locations") return await doDetectLocations(apiKey, body);
    if (task === "suggest_tags") return await doSuggestTags(apiKey, body);
    if (task === "suggest_ideas") return await doSuggestIdeas(apiKey, body);
    return json({ error: `Unknown task: ${task}` }, 400);
  } catch (e) {
    console.error("ai-chat error:", (e as Error)?.message || e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

async function doChat(apiKey: string, body: { messages?: Msg[]; context?: Ctx }) {
  const clean = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .map((m) => ({ role: m.role, content: String(m.content) }));
  if (!clean.length) return json({ error: "No messages." }, 400);
  const reply = await callClaude(apiKey, { system: buildSystem(body.context || {}), messages: clean, max_tokens: 1024 });
  return json({ reply });
}

async function doTagSummary(apiKey: string, body: { tagName?: string; chunks?: Chunk[] }) {
  const chunks = body.chunks || [];
  if (!chunks.length) return json({ error: "No tagged chunks to summarize." }, 400);
  const system =
    "You are a literary analyst inside RABBIT HOLE, a book workbench. " +
    "Given a tag and every excerpt the author filed under it, write a concise thematic summary " +
    "(3-5 sentences) that captures what this tag represents in the story — the recurring motif, " +
    "thread, or idea that binds these excerpts. Refer to concrete details. No preamble.";
  const user = `TAG: ${body.tagName || "(untitled)"}\n\nEXCERPTS:\n\n${joinChunks(chunks)}`;
  const reply = await callClaude(apiKey, { system, messages: [{ role: "user", content: user }], max_tokens: 600 });
  return json({ reply });
}

async function doCharSummary(apiKey: string, body: { name?: string; aliases?: string[]; chunks?: Chunk[] }) {
  const chunks = body.chunks || [];
  if (!chunks.length) return json({ error: "No reference chunks for this character." }, 400);
  const aliases = (body.aliases || []).filter(Boolean);
  const system =
    "You are a story-bible assistant inside RABBIT HOLE. Given a character and every excerpt that " +
    "references them, write a concise character summary (3-6 sentences): who they are, their role, " +
    "key relationships, and arc so far. Use only what the excerpts support. No preamble.";
  const user =
    `CHARACTER: ${body.name || "(unnamed)"}` +
    (aliases.length ? `\nALSO KNOWN AS: ${aliases.join(", ")}` : "") +
    `\n\nEXCERPTS:\n\n${joinChunks(chunks)}`;
  const reply = await callClaude(apiKey, { system, messages: [{ role: "user", content: user }], max_tokens: 700 });
  return json({ reply });
}

async function doLocSummary(apiKey: string, body: { name?: string; aliases?: string[]; chunks?: Chunk[] }) {
  const chunks = body.chunks || [];
  if (!chunks.length) return json({ error: "No reference chunks for this location." }, 400);
  const aliases = (body.aliases || []).filter(Boolean);
  const system =
    "You are a story-bible assistant inside RABBIT HOLE. Given a location/setting and every excerpt " +
    "that references it, write a concise place summary (3-6 sentences): what the place is, its " +
    "atmosphere and significance, what happens there, and how it figures in the story so far. " +
    "Use only what the excerpts support. No preamble.";
  const user =
    `LOCATION: ${body.name || "(unnamed)"}` +
    (aliases.length ? `\nALSO KNOWN AS: ${aliases.join(", ")}` : "") +
    `\n\nEXCERPTS:\n\n${joinChunks(chunks)}`;
  const reply = await callClaude(apiKey, { system, messages: [{ role: "user", content: user }], max_tokens: 700 });
  return json({ reply });
}

async function doDetect(apiKey: string, body: { chunks?: Chunk[]; existing?: string[] }) {
  const chunks = body.chunks || [];
  if (!chunks.length) return json({ error: "No chunk text to scan." }, 400);
  const existing = (body.existing || []).filter(Boolean);
  const system =
    "You are a character extractor inside RABBIT HOLE, a book workbench. Read the manuscript " +
    "excerpts and identify the distinct named characters (people). For each, give the canonical " +
    "name and any aliases/nicknames/titles used for the same person. Ignore place names, objects, " +
    "and generic references. Respond with ONLY a JSON object of the form " +
    `{"characters":[{"name":"Jane Doe","aliases":["Jane","Doc"]}]}. No markdown, no commentary.`;
  const user =
    (existing.length ? `Characters already tracked (still list them if present, but focus on new ones): ${existing.join(", ")}\n\n` : "") +
    `EXCERPTS:\n\n${joinChunks(chunks)}`;
  const raw = await callClaude(apiKey, { system, messages: [{ role: "user", content: user }], max_tokens: 1500 });
  const parsed = parseJsonObject(raw);
  const characters = Array.isArray(parsed?.characters)
    ? parsed.characters
        .filter((c: { name?: string }) => c && typeof c.name === "string" && c.name.trim())
        .map((c: { name: string; aliases?: string[] }) => ({
          name: c.name.trim(),
          aliases: Array.isArray(c.aliases) ? c.aliases.filter((a) => typeof a === "string" && a.trim()).map((a) => a.trim()) : [],
        }))
    : [];
  return json({ characters });
}

async function doDetectLocations(apiKey: string, body: { chunks?: Chunk[]; existing?: string[] }) {
  const chunks = body.chunks || [];
  if (!chunks.length) return json({ error: "No chunk text to scan." }, 400);
  const existing = (body.existing || []).filter(Boolean);
  const system =
    "You are a setting/location extractor inside RABBIT HOLE, a book workbench. Read the manuscript " +
    "excerpts and identify the distinct named places and settings — cities, towns, regions, " +
    "buildings, rooms, landmarks, planets, realms, named natural features. For each, give the " +
    "canonical name and any aliases/alternate names/nicknames used for the same place. Ignore " +
    "people, objects, organizations, and generic references (e.g. 'the house' with no name). " +
    "Respond with ONLY a JSON object of the form " +
    `{"locations":[{"name":"Rivermouth","aliases":["the Mouth"]}]}. No markdown, no commentary.`;
  const user =
    (existing.length ? `Locations already tracked (still list them if present, but focus on new ones): ${existing.join(", ")}\n\n` : "") +
    `EXCERPTS:\n\n${joinChunks(chunks)}`;
  const raw = await callClaude(apiKey, { system, messages: [{ role: "user", content: user }], max_tokens: 1500 });
  const parsed = parseJsonObject(raw);
  const locations = Array.isArray(parsed?.locations)
    ? parsed.locations
        .filter((c: { name?: string }) => c && typeof c.name === "string" && c.name.trim())
        .map((c: { name: string; aliases?: string[] }) => ({
          name: c.name.trim(),
          aliases: Array.isArray(c.aliases) ? c.aliases.filter((a) => typeof a === "string" && a.trim()).map((a) => a.trim()) : [],
        }))
    : [];
  return json({ locations });
}

async function doSuggestTags(apiKey: string, body: { chunk?: Chunk; existing?: string[] }) {
  const text = (body.chunk?.body || "").trim();
  if (!text) return json({ error: "No chunk text to read." }, 400);
  const existing = (body.existing || []).filter(Boolean);
  const system =
    "You are a tagging assistant inside RABBIT HOLE, a book workbench. Tags are short labels (themes, " +
    "motifs, tones, plot functions, recurring elements) an author uses to file scenes. Given one scene " +
    "and the author's existing tag vocabulary, decide which EXISTING tags genuinely apply, and propose " +
    "a few NEW tags worth adding. Strongly prefer reusing existing tags; only suggest new ones when " +
    "nothing fits well. Tags are 1-3 words. Be selective — quality over quantity. Respond with ONLY a " +
    `JSON object of the form {"assign":["EXISTING TAG"],"suggest":["NEW TAG"]}. No markdown, no commentary.`;
  const user =
    `EXISTING TAGS: ${existing.length ? existing.join(", ") : "(none yet)"}\n\n` +
    `SCENE${body.chunk?.title ? `: ${body.chunk.title}` : ""}\n${body.chunk?.body || ""}`;
  const raw = await callClaude(apiKey, { system, messages: [{ role: "user", content: user }], max_tokens: 400 });
  const parsed = parseJsonObject(raw);
  const norm = (arr: unknown) =>
    Array.isArray(arr)
      ? (arr as unknown[]).filter((s) => typeof s === "string" && (s as string).trim()).map((s) => (s as string).trim())
      : [];
  const existingLower = new Set(existing.map((s) => s.toLowerCase()));
  const rawAssign = norm(parsed?.assign);
  const rawSuggest = norm(parsed?.suggest);
  // Keep `assign` strictly to existing tags; anything novel the model put there
  // spills into `suggest` so it goes through the "create new" path.
  const assign = rawAssign.filter((t) => existingLower.has(t.toLowerCase()));
  const spill = rawAssign.filter((t) => !existingLower.has(t.toLowerCase()));
  const seen = new Set<string>();
  const suggest = [...rawSuggest, ...spill].filter((t) => {
    const k = t.toLowerCase();
    if (existingLower.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return json({ assign, suggest });
}

async function doSuggestIdeas(apiKey: string, body: { chunks?: Chunk[]; type?: string; genre?: string }) {
  const chunks = body.chunks || [];
  if (!chunks.length) return json({ error: "No chunk text to read." }, 400);
  const kind = [body.type, body.genre].filter(Boolean).join(" / ");
  const system =
    "You are a brainstorming partner inside RABBIT HOLE, a book workbench. Read the work " +
    "so far and propose fresh, concrete ideas for what could happen next — scenes, beats, " +
    "complications, reveals, or whole new sections the author could write. Each idea is one or two " +
    "sentences, specific to THIS story (reference its characters and situations), and distinct from " +
    "the others. " +
    (kind ? `This is a ${kind}; keep ideas appropriate to that format and genre. ` : "") +
    "Offer 6-10 ideas. Respond with ONLY a JSON object of the form " +
    `{"ideas":["...","..."]}. No markdown, no commentary.`;
  const user = `WORK SO FAR:\n\n${joinChunks(chunks)}`;
  const raw = await callClaude(apiKey, { system, messages: [{ role: "user", content: user }], max_tokens: 1200 });
  const parsed = parseJsonObject(raw);
  const ideas = Array.isArray(parsed?.ideas)
    ? (parsed.ideas as unknown[]).filter((s) => typeof s === "string" && s.trim()).map((s) => (s as string).trim())
    : [];
  return json({ ideas });
}

/* ---------------- helpers ---------------- */
type Ctx = { project?: string | null; type?: string; genre?: string; chapters?: string[]; characters?: { name: string; summary?: string }[] };

async function callClaude(
  apiKey: string,
  opts: { system: string; messages: Msg[]; max_tokens: number },
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: opts.max_tokens, system: opts.system, messages: opts.messages }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content || [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n")
    .trim();
}

function joinChunks(chunks: Chunk[]): string {
  return chunks
    .map((c, i) => `--- excerpt ${i + 1}${c.title ? `: ${c.title}` : ""} ---\n${c.body || ""}`)
    .join("\n\n");
}

function parseJsonObject(s: string): { characters?: unknown[]; locations?: unknown[]; ideas?: unknown[]; assign?: unknown[]; suggest?: unknown[] } | null {
  try {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

function buildSystem(ctx: Ctx): string {
  const lines = [
    "You are the writing assistant inside RABBIT HOLE, a book-writing workbench.",
    "Help the author develop their story: plot, character arcs, pacing, continuity, and prose.",
    "Be concise and concrete. Ask a clarifying question only when truly necessary.",
  ];
  if (ctx.project) lines.push(`\nCurrent project: ${ctx.project}`);
  if (ctx.type) lines.push(`Format: ${ctx.type}`);
  if (ctx.genre) lines.push(`Genre: ${ctx.genre}`);
  if (ctx.chapters?.length) lines.push(`Chapters: ${ctx.chapters.join(", ")}`);
  if (ctx.characters?.length) {
    lines.push("Characters:");
    for (const c of ctx.characters) lines.push(`- ${c.name}${c.summary ? `: ${c.summary}` : ""}`);
  }
  return lines.join("\n");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}
