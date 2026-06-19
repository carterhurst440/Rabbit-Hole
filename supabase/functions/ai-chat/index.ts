// RABBIT HOLE — AI assistant + writing-tools backend.
// Calls the Anthropic Messages API server-side so the key never reaches the client.
// Set the secret with:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Tasks (field `task` in the JSON body):
//   chat              { messages, context }            -> { reply }
//   tag_summary       { tagName, chunks }              -> { reply }
//   char_summary      { name, aliases, chunks }        -> { reply }
//   char_arc          { name, aliases, chunks:[{title,body,section}] } -> { arc: [{ stage, summary }] (one beat per section), principles: [{ principle, start, end, changed, refs:[{hop,section,note}] }] }
//   char_relationships { name, aliases, others:[{name,aliases}], chunks:[{title,body,section}] } -> { relationships: [{ character, summary, refs:[{hop,section,note}] }] }
//   loc_summary       { name, aliases, chunks }        -> { reply }
//   detect_characters { chunks, existing }             -> { characters: [{ name, aliases }] }
//   detect_locations  { chunks, existing }             -> { locations: [{ name, aliases }] }
//   detect_events     { hops:[{id,title,section,body}], existing:[{title,when}], characters:[{name,aliases}], locations:[{name,aliases}] } -> { events: [{ title, description, when, hopId, characters:[name], locations:[name] }] }
//   suggest_tags      { chunk, existing }              -> { assign: [string], suggest: [string] }
//   suggest_ideas     { chunks, type, genre }          -> { ideas: [string] }
//   idea_title        { body }                          -> { title: string }
//   generate_body     { title, kind, type, genre, section, chapters, characters, locations, context:[{title,body,section}], contextDocs:[{title,body}] } -> { body: string }
//   NOTE: tag_summary / char_summary / loc_summary / generate_body also accept optional contextDocs:[{title,body}]
//         (author-flagged "USE AS CONTEXT" planning docs) folded into the prompt for continuity.
//   suggest_chunks    { chunks, type, genre, chapters, characters, locations }
//                                                      -> { chunks: [{ title, chapter, description }] }
//   analyze_chunk     { chunk, context, type, genre, characters, locations }
//                                                      -> { strengths: [string], suggestions: [string] }
//   search_hops       { query, hops:[{title,section,body}] }
//                                                      -> { matches: [{ index, score, reason, quote }] }
//   import_outline    { text, instructions, type, genre, sectionsSoFar:[string] }
//                                                      -> { sections: [{ title }], hops: [{ section, title, body }] }
//   journal_advice    { entries:[{title,body,when}], type, genre }
//                                                      -> { items: [{ type:"reflection"|"prompt", title, body }] }
//   practice_coach    { messages, context:{ todayWord?, recentTitles? } } -> { reply }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Three model tiers, chosen per user in Settings and persisted on their profile.
// Each task carries a FLOOR (the cheapest model that still does it justice, used
// in ECONOMY) and an OPTIMAL (the balanced default, used in STANDARD). HIGH
// PERFORMANCE ignores both and runs the strongest model on every task.
const HAIKU = "claude-haiku-4-5";
const SONNET = "claude-sonnet-4-6";
const OPUS = "claude-opus-4-7";
const DEFAULT_MODEL = SONNET;

// floor = ECONOMY model, optimal = STANDARD model. Tasks omitted here default to
// SONNET for both (i.e. economy never weakens them below the balanced model).
const TASK_MODELS: Record<string, { floor: string; optimal: string }> = {
  detect_characters: { floor: HAIKU, optimal: SONNET },
  detect_locations: { floor: HAIKU, optimal: SONNET },
  detect_events: { floor: HAIKU, optimal: SONNET },
  suggest_tags: { floor: HAIKU, optimal: SONNET },
  idea_title: { floor: HAIKU, optimal: SONNET },
  import_outline: { floor: HAIKU, optimal: SONNET },
  journal_advice: { floor: HAIKU, optimal: SONNET },
  practice_coach: { floor: HAIKU, optimal: SONNET },
};

function modelFor(task: string, tier?: string): string {
  if (tier === "high") return OPUS;
  const m = TASK_MODELS[task] || { floor: SONNET, optimal: SONNET };
  return tier === "economy" ? m.floor : m.optimal;
}

type Chunk = { title?: string; body?: string; section?: string };
type Msg = { role: "user" | "assistant"; content: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ error: "ANTHROPIC_API_KEY is not set on the function." }, 500);

    const body = await req.json();
    const task = body.task || "chat";
    // Resolve the model for this task + the user's chosen tier once, and carry it
    // on the request body so every handler's callClaude picks it up.
    body._model = modelFor(task, body.tier);

    if (task === "chat") return await doChat(apiKey, body);
    if (task === "tag_summary") return await doTagSummary(apiKey, body);
    if (task === "char_summary") return await doCharSummary(apiKey, body);
    if (task === "char_arc") return await doCharArc(apiKey, body);
    if (task === "char_relationships") return await doCharRelationships(apiKey, body);
    if (task === "loc_summary") return await doLocSummary(apiKey, body);
    if (task === "detect_characters") return await doDetect(apiKey, body);
    if (task === "detect_locations") return await doDetectLocations(apiKey, body);
    if (task === "detect_events") return await doDetectEvents(apiKey, body);
    if (task === "suggest_tags") return await doSuggestTags(apiKey, body);
    if (task === "suggest_ideas") return await doSuggestIdeas(apiKey, body);
    if (task === "idea_title") return await doIdeaTitle(apiKey, body);
    if (task === "generate_body") return await doGenerateBody(apiKey, body);
    if (task === "suggest_chunks") return await doSuggestChunks(apiKey, body);
    if (task === "analyze_chunk") return await doAnalyzeChunk(apiKey, body);
    if (task === "search_hops") return await doSearchHops(apiKey, body);
    if (task === "import_outline") return await doImportOutline(apiKey, body);
    if (task === "journal_advice") return await doJournalAdvice(apiKey, body);
    if (task === "practice_coach") return await doPracticeCoach(apiKey, body);
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
  const reply = await callClaude(apiKey, { model: (body as any)._model, system: buildSystem(body.context || {}), messages: clean, max_tokens: 1024 });
  return json({ reply });
}

// PRACTICE coach — a creative-writing warm-up partner. Separate from doChat so it
// is never grounded in the user's book; PRACTICE is a no-pressure skills gym.
async function doPracticeCoach(
  apiKey: string,
  body: { messages?: Msg[]; context?: { todayWord?: string; recentTitles?: string[] } },
) {
  const clean = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
    .map((m) => ({ role: m.role, content: String(m.content) }));
  if (!clean.length) return json({ error: "No messages." }, 400);
  const ctx = body.context || {};
  const lines = [
    "You are a warm, energizing creative-writing COACH inside RABBIT HOLE's PRACTICE module.",
    "PRACTICE is a low-pressure gym for freewriting, drills, and skill-building — wholly separate from the writer's real book projects. Nothing here has to be good or go anywhere.",
    "Your job: help the writer warm up, break through blocks, and keep their craft progressing on days they have no narrative idea of their own.",
    "When they ask for a prompt, give ONE specific, concrete exercise they can finish in 15-20 minutes — not a menu, unless they explicitly ask for options. Favor sensory detail, a constraint, a random word, a character voice, a dialogue-only scene, a point-of-view flip, or 'write for 20 minutes about X'.",
    "Keep replies short, vivid, and actionable. Reward effort over polish. Encourage, never lecture. No long preambles.",
  ];
  if (ctx.todayWord) lines.push(`\nToday's random word is "${ctx.todayWord}" — you can build a prompt around it if useful.`);
  if (Array.isArray(ctx.recentTitles) && ctx.recentTitles.length) {
    lines.push(`Recent practice the writer has done: ${ctx.recentTitles.slice(0, 8).join("; ")}.`);
  }
  const reply = await callClaude(apiKey, { model: (body as any)._model, system: lines.join("\n"), messages: clean, max_tokens: 900 });
  return json({ reply });
}

async function doTagSummary(apiKey: string, body: { tagName?: string; chunks?: Chunk[]; contextDocs?: { title?: string; body?: string }[] }) {
  const chunks = body.chunks || [];
  if (!chunks.length) return json({ error: "No tagged chunks to summarize." }, 400);
  const system =
    "You are a literary analyst inside RABBIT HOLE, a book workbench. " +
    "Given a tag and every excerpt the author filed under it, write a concise thematic summary " +
    "(3-5 sentences) that captures what this tag represents in the story — the recurring motif, " +
    "thread, or idea that binds these excerpts. Refer to concrete details. No preamble.";
  const user = `TAG: ${body.tagName || "(untitled)"}\n\nEXCERPTS:\n\n${joinChunks(chunks)}` + contextDocsBlock(body.contextDocs);
  const reply = await callClaude(apiKey, { model: (body as any)._model, system, messages: [{ role: "user", content: user }], max_tokens: 600 });
  return json({ reply });
}

async function doCharSummary(apiKey: string, body: { name?: string; aliases?: string[]; chunks?: Chunk[]; contextDocs?: { title?: string; body?: string }[] }) {
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
    `\n\nEXCERPTS:\n\n${joinChunks(chunks)}` + contextDocsBlock(body.contextDocs);
  const reply = await callClaude(apiKey, { model: (body as any)._model, system, messages: [{ role: "user", content: user }], max_tokens: 700 });
  return json({ reply });
}

async function doCharArc(apiKey: string, body: { name?: string; aliases?: string[]; chunks?: Chunk[] }) {
  const chunks = body.chunks || [];
  if (!chunks.length) return json({ error: "No reference chunks for this character." }, 400);
  const aliases = (body.aliases || []).filter(Boolean);
  // Group every excerpt under its SECTION, preserving the narrative order the
  // client sent. The arc is plotted one beat per section, so the model needs to
  // see the section boundaries explicitly.
  const sectionOrder: string[] = [];
  const bySection = new Map<string, Chunk[]>();
  for (const c of chunks) {
    const sec = (c.section || "Unsectioned").trim() || "Unsectioned";
    if (!bySection.has(sec)) { bySection.set(sec, []); sectionOrder.push(sec); }
    bySection.get(sec)!.push(c);
  }
  const sectionsBlock = sectionOrder
    .map((sec) => {
      const hops = bySection.get(sec)!
        .map((c) => `  • HOP "${c.title || "Untitled"}": ${(c.body || "").replace(/\s+/g, " ").trim()}`)
        .join("\n");
      return `### SECTION: ${sec}\n${hops}`;
    })
    .join("\n\n");
  const system =
    "You are a story-bible analyst inside RABBIT HOLE. A story is divided into SECTIONS; each section " +
    "contains one or more HOPS (excerpts). Given a character and every section/hop that references them " +
    "— in narrative order — produce TWO things.\n\n" +
    "1) ARC: plot the character's arc as EXACTLY ONE beat per SECTION, in the given order. Use the " +
    "section's name as the stage label, verbatim. For each section write a 1-2 sentence summary of the " +
    "character's key beat there — where they are emotionally and how they have changed by that point. " +
    "If there is only one section, return exactly one beat. Never split or merge sections.\n\n" +
    "2) PRINCIPLES: distill this character down to 3-5 CORE PRINCIPLES. Each principle name must be a " +
    "tight 2-5 word epithet that captures a deep value or identity — e.g. 'compassionate creator', " +
    "'cynical skeptic', 'loyal to a fault'. For each principle give: the short name; how it stands at " +
    "the START; how it stands at the END; whether it changed (true if it shifted, deepened, broke, or " +
    "was abandoned; false if it held constant); and a `refs` array of 1-4 supporting references, each " +
    "naming the exact HOP title and its SECTION that informs the principle, plus a brief note (<=12 " +
    "words) on what in that hop supports it. Cite hop titles and section names exactly as given.\n\n" +
    "Track genuine internal growth, not just plot events. Use only what the excerpts support. Respond " +
    "with ONLY a JSON object of the form " +
    `{"arc":[{"stage":"...","summary":"..."}],"principles":[{"principle":"...","start":"...","end":"...","changed":true,"refs":[{"hop":"...","section":"...","note":"..."}]}]}. ` +
    "No markdown, no commentary.";
  const user =
    `CHARACTER: ${body.name || "(unnamed)"}` +
    (aliases.length ? `\nALSO KNOWN AS: ${aliases.join(", ")}` : "") +
    `\n\nSECTIONS (in narrative order):\n\n${sectionsBlock}`;
  const raw = await callClaude(apiKey, { model: (body as any)._model, system, messages: [{ role: "user", content: user }], max_tokens: 2600 });
  const parsed = parseJsonObject(raw);
  const arc = Array.isArray(parsed?.arc)
    ? (parsed.arc as unknown[])
        .filter((s): s is { stage?: unknown; summary?: unknown } => !!s && typeof s === "object")
        .map((s) => ({
          stage: typeof s.stage === "string" ? s.stage.trim() : "",
          summary: typeof s.summary === "string" ? s.summary.trim() : "",
        }))
        .filter((s) => s.stage || s.summary)
        .slice(0, 60)
    : [];
  const principles = Array.isArray(parsed?.principles)
    ? (parsed.principles as unknown[])
        .filter((p): p is { principle?: unknown; start?: unknown; end?: unknown; changed?: unknown; refs?: unknown } => !!p && typeof p === "object")
        .map((p) => ({
          principle: typeof p.principle === "string" ? p.principle.trim() : "",
          start: typeof p.start === "string" ? p.start.trim() : "",
          end: typeof p.end === "string" ? p.end.trim() : "",
          changed: p.changed === true,
          refs: Array.isArray(p.refs)
            ? (p.refs as unknown[])
                .filter((r): r is { hop?: unknown; section?: unknown; note?: unknown } => !!r && typeof r === "object")
                .map((r) => ({
                  hop: typeof r.hop === "string" ? r.hop.trim() : "",
                  section: typeof r.section === "string" ? r.section.trim() : "",
                  note: typeof r.note === "string" ? r.note.trim() : "",
                }))
                .filter((r) => r.hop || r.section || r.note)
                .slice(0, 4)
            : [],
        }))
        .filter((p) => p.principle)
        .slice(0, 5)
    : [];
  return json({ arc, principles });
}

async function doLocSummary(apiKey: string, body: { name?: string; aliases?: string[]; chunks?: Chunk[]; contextDocs?: { title?: string; body?: string }[] }) {
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
    `\n\nEXCERPTS:\n\n${joinChunks(chunks)}` + contextDocsBlock(body.contextDocs);
  const reply = await callClaude(apiKey, { model: (body as any)._model, system, messages: [{ role: "user", content: user }], max_tokens: 700 });
  return json({ reply });
}

async function doDetect(apiKey: string, body: { chunks?: Chunk[]; existing?: string[] }) {
  const chunks = body.chunks || [];
  if (!chunks.length) return json({ error: "No chunk text to scan." }, 400);
  const existing = (body.existing || []).filter(Boolean);
  const system =
    "You are a character extractor inside RABBIT HOLE, a book workbench. Read the manuscript " +
    "excerpts and identify the distinct named characters (people) that ACTUALLY APPEAR in the " +
    "excerpt text below. For each, give the canonical name and any aliases/nicknames/titles used " +
    "for the same person. Ignore place names, objects, and generic references. " +
    "CRITICAL: Only return characters who are genuinely mentioned in the excerpt text. Do NOT " +
    "include a name merely because it appears in the already-tracked list — that list is provided " +
    "ONLY so you can reuse the same canonical spelling for anyone who does appear. If an excerpt " +
    "mentions no characters, return an empty array. Respond with ONLY a JSON object of the form " +
    `{"characters":[{"name":"Jane Doe","aliases":["Jane","Doc"]}]}. No markdown, no commentary.`;
  const user =
    (existing.length ? `Canonical names already tracked (use these spellings for any that appear in the excerpts; do NOT list ones that are absent): ${existing.join(", ")}\n\n` : "") +
    `EXCERPTS:\n\n${joinChunks(chunks)}`;
  const raw = await callClaude(apiKey, { model: (body as any)._model, system, messages: [{ role: "user", content: user }], max_tokens: 1500 });
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
    "excerpts and identify the distinct named places and settings that ACTUALLY APPEAR in the " +
    "excerpt text below — cities, towns, regions, buildings, rooms, landmarks, planets, realms, " +
    "named natural features. For each, give the canonical name and any aliases/alternate " +
    "names/nicknames used for the same place. Ignore people, objects, organizations, and generic " +
    "references (e.g. 'the house' with no name). " +
    "CRITICAL: Only return places that are genuinely mentioned in the excerpt text. Do NOT include " +
    "a place merely because it appears in the already-tracked list — that list is provided ONLY so " +
    "you can reuse the same canonical spelling for any place that does appear. If an excerpt " +
    "mentions no places, return an empty array. Respond with ONLY a JSON object of the form " +
    `{"locations":[{"name":"Rivermouth","aliases":["the Mouth"]}]}. No markdown, no commentary.`;
  const user =
    (existing.length ? `Canonical names already tracked (use these spellings for any that appear in the excerpts; do NOT list ones that are absent): ${existing.join(", ")}\n\n` : "") +
    `EXCERPTS:\n\n${joinChunks(chunks)}`;
  const raw = await callClaude(apiKey, { model: (body as any)._model, system, messages: [{ role: "user", content: user }], max_tokens: 1500 });
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

async function doDetectEvents(
  apiKey: string,
  body: {
    hops?: { id?: string; title?: string; section?: string; body?: string }[];
    existing?: { title?: string; when?: string }[];
    characters?: { name?: string; aliases?: string[] }[];
    locations?: { name?: string; aliases?: string[] }[];
  },
) {
  const hops = (Array.isArray(body.hops) ? body.hops : []).filter((h) => h && (h.body || "").trim());
  if (!hops.length) return json({ error: "No hop text to scan." }, 400);
  const manuscript = hops
    .map((h, i) => `--- HOP ${i + 1} | id=${h.id || ""} | section=${h.section || ""} | title=${h.title || ""} ---\n${h.body || ""}`)
    .join("\n\n");
  // Events already on the author's timeline — the model should NOT re-report these.
  const existing = (Array.isArray(body.existing) ? body.existing : [])
    .map((e) => (typeof e?.title === "string" ? e.title.trim() : ""))
    .filter(Boolean);
  const existingBlock = existing.length
    ? `\n\nThese events are ALREADY on the author's timeline. Do NOT report them again, and do not report trivial rephrasings of them:\n${existing.map((t) => `- ${t}`).join("\n")}`
    : "";
  // Rosters of known characters / locations so the model can affiliate each event
  // using the author's exact entity names (with aliases for matching).
  const rosterLine = (e: { name?: string; aliases?: string[] }) => {
    const name = (e?.name || "").trim();
    if (!name) return "";
    const al = (Array.isArray(e?.aliases) ? e.aliases : []).map((a) => (a || "").trim()).filter(Boolean);
    return `- ${name}${al.length ? ` (aka ${al.join(", ")})` : ""}`;
  };
  const charRoster = (Array.isArray(body.characters) ? body.characters : []).map(rosterLine).filter(Boolean);
  const locRoster = (Array.isArray(body.locations) ? body.locations : []).map(rosterLine).filter(Boolean);
  const rosterBlock =
    (charRoster.length
      ? `\n\nKNOWN CHARACTERS — when an event involves one of these people, list them by their EXACT name (the part before any "aka"):\n${charRoster.join("\n")}`
      : "") +
    (locRoster.length
      ? `\n\nKNOWN LOCATIONS — when an event happens at one of these places, list it by its EXACT name:\n${locRoster.join("\n")}`
      : "");
  const system =
    "You are an EVENT extractor inside RABBIT HOLE, a book workbench. " +
    "An EVENT is a LARGE-SCALE, CONSEQUENTIAL plot event — a turning point that moves the whole story, shifts the " +
    "world, or changes the stakes for many characters. Think headline-worthy beats: 'Explosion on the Moon', 'Rap " +
    "Concert', 'Union Swarm', a war breaking out, a coup, a death that reshapes the plot, a major discovery, a " +
    "city falling, a public reveal. Each event should be something a reader would name as a key moment in the book.\n\n" +
    "CRITICAL — STAY HIGH-LEVEL. Do NOT log small character beats, routine actions, private moments, mood, or " +
    "incremental scene business. Examples of what to EXCLUDE: 'Ava works on music in her room', 'Tom makes coffee', " +
    "'they have a conversation', 'character feels sad', 'someone walks to the store'. These are not events — they are " +
    "scene texture. Only surface the consequential, plot-moving occurrences. When in doubt, LEAVE IT OUT. It is far " +
    "better to return a handful of genuinely major events than a long list of minor ones. Aim for the events a back-" +
    "cover blurb or chapter summary would mention.\n\n" +
    "STABILITY — this extraction must be repeatable. Run after run on the same manuscript should yield the same major " +
    "events. Already-tracked events are listed below; never re-report them or trivial rephrasings, and if every major " +
    "event in the text is already tracked, return an empty array. " +
    "Events are anchored in time, distinct from themes, settings, or general description. " +
    "CRUCIAL: when a character RECALLS or MENTIONS a past (or future) occurrence — a memory, a flashback to a war, a " +
    "prophecy of a death — log the EVENT ITSELF (e.g. 'The war begins'), NOT the act of remembering. That event is " +
    "anchored to its own point in the chronology even though it surfaces inside the hop where it is recalled. " +
    "For each event provide: title (short, concrete, headline-style, e.g. 'Explosion on the Moon'); description (1-2 sentences of what " +
    "happens); when (any explicit or implied time marker — a date, age, season, or relative phrase like 'thirty " +
    "years before the war'; empty string if the text gives none); hopId (the id= value of the hop where this " +
    "event appears or is recalled — use exactly one of the provided id values, or an empty string if it does not " +
    "clearly belong to a single hop); characters (an array of the names of any KNOWN CHARACTERS who take part in " +
    "this event — use the EXACT names from the KNOWN CHARACTERS list, an empty array if none apply or no list is " +
    "given); and locations (an array of the names of any KNOWN LOCATIONS where this event takes place — use the " +
    "EXACT names from the KNOWN LOCATIONS list, an empty array if none apply or no list is given). Only use names " +
    "that appear in the provided lists; never invent character or location names. " +
    "Do not invent events unsupported by the text. Merge obvious duplicates. If nothing qualifies, return an empty " +
    `array. Respond with ONLY a JSON object of the form {"events":[{"title":"","description":"","when":"","hopId":"","characters":[],"locations":[]}]}. ` +
    "No markdown, no commentary.";
  const raw = await callClaude(apiKey, { model: (body as any)._model, system, messages: [{ role: "user", content: `HOPS:\n\n${manuscript}${existingBlock}${rosterBlock}` }], max_tokens: 4000 });
  const validIds = new Set(hops.map((h) => h.id).filter(Boolean) as string[]);
  // Salvage events tolerantly: the model may wrap them in {"events":[...]}, emit a
  // bare [...] array, fence them in markdown, or get truncated by the token cap.
  // Event objects are flat (no nested braces), so scanning for individual {...}
  // blocks and parsing each one independently recovers every complete object and
  // simply drops a trailing truncated one.
  const rawEvents = extractFlatObjects(raw);
  const strList = (v: unknown) =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x) => (x as string).trim()).filter(Boolean) : [];
  const events = (rawEvents as { title?: unknown; description?: unknown; when?: unknown; hopId?: unknown; characters?: unknown; locations?: unknown }[])
        .filter((e) => e && (typeof e.title === "string" || typeof e.description === "string"))
        .map((e) => ({
          title: typeof e.title === "string" ? e.title.trim() : "",
          description: typeof e.description === "string" ? e.description.trim() : "",
          when: typeof e.when === "string" ? e.when.trim() : "",
          hopId: typeof e.hopId === "string" && validIds.has(e.hopId) ? e.hopId : "",
          characters: strList(e.characters),
          locations: strList(e.locations),
        }))
        .filter((e) => e.title || e.description);
  return json({ events });
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
  const raw = await callClaude(apiKey, { model: (body as any)._model, system, messages: [{ role: "user", content: user }], max_tokens: 400 });
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
  const raw = await callClaude(apiKey, { model: (body as any)._model, system, messages: [{ role: "user", content: user }], max_tokens: 1200 });
  const parsed = parseJsonObject(raw);
  const ideas = Array.isArray(parsed?.ideas)
    ? (parsed.ideas as unknown[]).filter((s) => typeof s === "string" && s.trim()).map((s) => (s as string).trim())
    : [];
  return json({ ideas });
}

async function doIdeaTitle(apiKey: string, body: { body?: string }) {
  const text = (body.body || "").trim();
  if (!text) return json({ error: "No idea text to title." }, 400);
  const system =
    "You are a naming assistant inside RABBIT HOLE, a book workbench. The author will give you the " +
    "body of a single backlog idea. Distill it into ONE short, evocative title of 3 to 10 words that " +
    "captures the heart of the idea. Title case-ish, no surrounding quotes, no trailing punctuation, " +
    "no preamble. Respond with ONLY a JSON object of the form " +
    `{"title":"..."}. No markdown, no commentary.`;
  const raw = await callClaude(apiKey, { model: (body as any)._model, system, messages: [{ role: "user", content: `IDEA:\n${text}` }], max_tokens: 80 });
  const parsed = parseJsonObject(raw);
  let title = typeof parsed?.title === "string" ? parsed.title.trim() : "";
  title = title.replace(/^["'\u201c\u2018]+|["'\u201d\u2019.]+$/g, "").trim();
  if (!title) return json({ error: "Could not generate a title." }, 502);
  return json({ title });
}

async function doGenerateBody(
  apiKey: string,
  body: {
    title?: string; kind?: string; type?: string; genre?: string; section?: string;
    chapters?: string[]; characters?: string[]; locations?: string[]; context?: Chunk[];
    contextDocs?: { title?: string; body?: string }[];
  },
) {
  const title = (body.title || "").trim();
  if (!title) return json({ error: "Add a title first — the body is generated from it." }, 400);
  const kind = body.kind === "hop" ? "hop" : "idea";
  const flavor = [body.type, body.genre].filter(Boolean).join(" / ");
  const chapters = (body.chapters || []).filter(Boolean);
  const characters = (body.characters || []).filter(Boolean);
  const locations = (body.locations || []).filter(Boolean);
  const context = (body.context || []).filter((c) => c && (c.body || c.title));
  const grounding =
    "Ground the writing in the story so far: stay consistent with the established characters, places, " +
    "events, tone, and narrative voice, and keep continuity with what is already written. Reference the " +
    "story's actual characters and places where natural. Do not contradict or restate the existing text — " +
    "write the new material the title calls for as it would fit into this manuscript. ";
  const system = kind === "hop"
    ? "You are a drafting partner inside RABBIT HOLE, a book workbench. The author gives you the TITLE of a single hop (a scene or beat) plus the surrounding manuscript for context. Draft a short passage of prose for that hop — 2 to 4 paragraphs that bring the moment to life and give the author something to react to and revise. Write in immersive prose, not an outline or bullet points. No preamble, no title line, no commentary. " +
      (flavor ? `The book is ${flavor}. ` : "") +
      grounding +
      `Respond with ONLY a JSON object of the form {"body":"..."}. Use \\n for line breaks. No markdown, no commentary.`
    : "You are a brainstorming partner inside RABBIT HOLE, a book workbench. The author gives you the TITLE of a single backlog idea plus the work so far for context. Flesh it out into a vivid 2 to 4 sentence description that expands on what the idea is, why it matters, and where it could go in THIS story. Concrete and evocative, not generic. No preamble, no title line, no commentary. " +
      (flavor ? `The book is ${flavor}. ` : "") +
      grounding +
      `Respond with ONLY a JSON object of the form {"body":"..."}. Use \\n for line breaks. No markdown, no commentary.`;
  const user =
    (chapters.length ? `SECTIONS: ${chapters.join(", ")}\n` : "") +
    (characters.length ? `CHARACTERS: ${characters.join(", ")}\n` : "") +
    (locations.length ? `LOCATIONS: ${locations.join(", ")}\n` : "") +
    (body.section ? `THIS HOP BELONGS TO SECTION: ${body.section}\n` : "") +
    (context.length ? `\n${kind === "hop" ? "SURROUNDING MANUSCRIPT" : "WORK SO FAR"} (for context only):\n\n${joinChunks(context)}\n` : "") +
    contextDocsBlock(body.contextDocs) +
    `\nTITLE:\n${title}`;
  const raw = await callClaude(apiKey, { model: (body as any)._model, system, messages: [{ role: "user", content: user }], max_tokens: kind === "hop" ? 900 : 320 });
  const parsed = parseJsonObject(raw);
  let text = typeof parsed?.body === "string" ? parsed.body.trim() : "";
  if (!text) return json({ error: "Could not generate body text." }, 502);
  return json({ body: text });
}

async function doCharRelationships(
  apiKey: string,
  body: { name?: string; aliases?: string[]; others?: { name?: string; aliases?: string[] }[]; chunks?: Chunk[] },
) {
  const chunks = body.chunks || [];
  if (!chunks.length) return json({ error: "No reference hops for this character." }, 400);
  const aliases = (body.aliases || []).filter(Boolean);
  const others = (body.others || [])
    .filter((o) => o && typeof o.name === "string" && o.name.trim())
    .map((o) => ({
      name: (o.name as string).trim(),
      aliases: Array.isArray(o.aliases) ? o.aliases.filter((a) => typeof a === "string" && a.trim()).map((a) => (a as string).trim()) : [],
    }));
  const sectionOrder: string[] = [];
  const bySection = new Map<string, Chunk[]>();
  for (const c of chunks) {
    const sec = (c.section || "Unsectioned").trim() || "Unsectioned";
    if (!bySection.has(sec)) { bySection.set(sec, []); sectionOrder.push(sec); }
    bySection.get(sec)!.push(c);
  }
  const sectionsBlock = sectionOrder
    .map((sec) => {
      const hops = bySection.get(sec)!
        .map((c) => `  • HOP "${c.title || "Untitled"}": ${(c.body || "").replace(/\s+/g, " ").trim()}`)
        .join("\n");
      return `### SECTION: ${sec}\n${hops}`;
    })
    .join("\n\n");
  const othersBlock = others.length
    ? others.map((o) => `- ${o.name}${o.aliases.length ? ` (aka ${o.aliases.join(", ")})` : ""}`).join("\n")
    : "(no other characters are tracked yet)";
  const system =
    "You are a story-bible analyst inside RABBIT HOLE. You are given a FOCUS character, a roster of " +
    "OTHER tracked characters, and every hop (excerpt) that references the focus character, grouped by " +
    "section. Identify which of the OTHER tracked characters the focus character has a relationship with " +
    "— meaning they interact, share a scene, are emotionally connected, or are otherwise tied together " +
    "in the excerpts. Only include characters from the OTHER roster; match aliases to the canonical " +
    "roster name and always report the canonical name. For each related character give: their canonical " +
    "name; a 1-2 sentence summary of the relationship and how it stands; and a `refs` array of 1-5 " +
    "supporting references, each naming the exact HOP title and its SECTION where the two are tied " +
    "together, plus a brief note (<=14 words) on what happens between them there. Cite hop titles and " +
    "section names exactly as given. Skip characters with no real connection in the excerpts. Order by " +
    "strength of relationship, strongest first. Use only what the excerpts support. Respond with ONLY a " +
    "JSON object of the form " +
    `{"relationships":[{"character":"...","summary":"...","refs":[{"hop":"...","section":"...","note":"..."}]}]}. ` +
    "No markdown, no commentary.";
  const user =
    `FOCUS CHARACTER: ${body.name || "(unnamed)"}` +
    (aliases.length ? `\nALSO KNOWN AS: ${aliases.join(", ")}` : "") +
    `\n\nOTHER TRACKED CHARACTERS:\n${othersBlock}` +
    `\n\nHOPS REFERENCING THE FOCUS CHARACTER (in narrative order):\n\n${sectionsBlock}`;
  const raw = await callClaude(apiKey, { model: (body as any)._model, system, messages: [{ role: "user", content: user }], max_tokens: 2600 });
  const parsed = parseJsonObject(raw);
  const relationships = Array.isArray(parsed?.relationships)
    ? (parsed.relationships as unknown[])
        .filter((r): r is { character?: unknown; summary?: unknown; refs?: unknown } => !!r && typeof r === "object")
        .map((r) => ({
          character: typeof r.character === "string" ? r.character.trim() : "",
          summary: typeof r.summary === "string" ? r.summary.trim() : "",
          refs: Array.isArray(r.refs)
            ? (r.refs as unknown[])
                .filter((x): x is { hop?: unknown; section?: unknown; note?: unknown } => !!x && typeof x === "object")
                .map((x) => ({
                  hop: typeof x.hop === "string" ? x.hop.trim() : "",
                  section: typeof x.section === "string" ? x.section.trim() : "",
                  note: typeof x.note === "string" ? x.note.trim() : "",
                }))
                .filter((x) => x.hop || x.section || x.note)
                .slice(0, 5)
            : [],
        }))
        .filter((r) => r.character)
        .slice(0, 30)
    : [];
  return json({ relationships });
}

async function doSuggestChunks(
  apiKey: string,
  body: { chunks?: Chunk[]; type?: string; genre?: string; chapters?: string[]; characters?: string[]; locations?: string[] },
) {
  const chunks = body.chunks || [];
  const kind = [body.type, body.genre].filter(Boolean).join(" / ");
  const chapters = (body.chapters || []).filter(Boolean);
  const characters = (body.characters || []).filter(Boolean);
  const locations = (body.locations || []).filter(Boolean);
  const system =
    "You are a story-structure partner inside RABBIT HOLE, a book workbench. Read the work so far " +
    "and propose the next scenes the author should write — concrete, specific beats that follow " +
    "naturally from where the manuscript currently stands. " +
    (kind ? `This is a ${kind}; keep suggestions appropriate to that format and genre. ` : "") +
    "For each suggested scene give: a short evocative title; the chapter it most likely belongs to " +
    "(reuse one of the author's existing chapter names when it fits, otherwise propose a concise new " +
    "chapter name); and a 1-2 sentence description of what happens, referencing this story's actual " +
    "characters and places. Offer exactly 5 suggestions, ordered by what should come next. Respond " +
    "with ONLY a JSON object of the form " +
    `{"chunks":[{"title":"...","chapter":"...","description":"..."}]}. No markdown, no commentary.`;
  const user =
    (chapters.length ? `EXISTING CHAPTERS: ${chapters.join(", ")}\n` : "") +
    (characters.length ? `CHARACTERS: ${characters.join(", ")}\n` : "") +
    (locations.length ? `LOCATIONS: ${locations.join(", ")}\n` : "") +
    `\nWORK SO FAR:\n\n${chunks.length ? joinChunks(chunks) : "(nothing written yet — suggest strong opening scenes)"}`;
  const raw = await callClaude(apiKey, { model: (body as any)._model, system, messages: [{ role: "user", content: user }], max_tokens: 1200 });
  const parsed = parseJsonObject(raw);
  const out = Array.isArray(parsed?.chunks)
    ? (parsed.chunks as unknown[])
        .filter((c): c is { title?: unknown; chapter?: unknown; description?: unknown } => !!c && typeof c === "object")
        .map((c) => ({
          title: typeof c.title === "string" ? c.title.trim() : "",
          chapter: typeof c.chapter === "string" ? c.chapter.trim() : "",
          description: typeof c.description === "string" ? c.description.trim() : "",
        }))
        .filter((c) => c.title || c.description)
        .slice(0, 5)
    : [];
  return json({ chunks: out });
}

async function doAnalyzeChunk(
  apiKey: string,
  body: { chunk?: Chunk; context?: Chunk[]; type?: string; genre?: string; characters?: string[]; locations?: string[] },
) {
  const chunk = body.chunk || ({} as Chunk);
  const context = (body.context || []).filter((c) => c && (c.body || c.title));
  const kind = [body.type, body.genre].filter(Boolean).join(" / ");
  const characters = (body.characters || []).filter(Boolean);
  const locations = (body.locations || []).filter(Boolean);
  const isJournal = (body.type || "").toLowerCase() === "journal";
  const system = isJournal
    ? "You are a warm, perceptive reader inside RABBIT HOLE, reflecting on a personal journal entry. " +
      "The author will give you ONE entry plus their surrounding entries for context. This is private " +
      "journaling, NOT fiction — do not treat it as a manuscript or give writing-craft critique. " +
      "Return two things. First, 2-3 powerful parts of this entry — the moments of genuine insight, " +
      "emotional honesty, courage, or meaningful reflection. Quote or name the specific moment; never " +
      "generic praise. Second, a few (2-4) observations or pieces of caring advice — what the entry " +
      "reveals about how the author is doing, patterns worth noticing, and gentle, supportive " +
      "encouragement. Be kind and human, never clinical or preachy. Respond with ONLY a JSON object " +
      `of the form {"strengths":["..."],"suggestions":["..."]}. No markdown, no commentary.`
    : "You are a perceptive, generous developmental editor inside RABBIT HOLE, a book workbench. " +
      "The author will give you ONE hop (a scene/excerpt) plus the surrounding manuscript for context. " +
      "Read the focus hop closely against that context. " +
      (kind ? `This is a ${kind}; judge it on the terms of that format and genre. ` : "") +
      "Return two things. First, the 2-3 things that genuinely work in this hop — what is compelling, " +
      "specific, and alive. Name concrete moments, lines, or choices; never generic praise. " +
      "Second, a few (2-4) suggestions, delivered very delicately — framed as gentle invitations or " +
      "questions, never commands or harsh criticism. Ground everything in this story's actual " +
      "characters and places. Respond with ONLY a JSON object of the form " +
      `{"strengths":["..."],"suggestions":["..."]}. No markdown, no commentary.`;
  const user = isJournal
    ? `JOURNAL ENTRY${chunk.title ? ` — ${chunk.title}` : ""}:\n${chunk.body || "(empty)"}\n\n` +
      (context.length ? `EARLIER ENTRIES (for context only):\n\n${joinChunks(context)}` : "(no other entries yet)")
    : (characters.length ? `CHARACTERS: ${characters.join(", ")}\n` : "") +
      (locations.length ? `LOCATIONS: ${locations.join(", ")}\n` : "") +
      `\nFOCUS HOP${chunk.title ? ` — ${chunk.title}` : ""}:\n${chunk.body || "(empty)"}\n\n` +
      (context.length ? `SURROUNDING MANUSCRIPT (for context only):\n\n${joinChunks(context)}` : "(no other hops written yet)");
  const raw = await callClaude(apiKey, { model: (body as any)._model, system, messages: [{ role: "user", content: user }], max_tokens: 1100 });
  const parsed = parseJsonObject(raw);
  const clean = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? arr.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)
      : [];
  return json({ strengths: clean(parsed?.strengths).slice(0, 3), suggestions: clean(parsed?.suggestions).slice(0, 4) });
}

async function doSearchHops(
  apiKey: string,
  body: { query?: string; hops?: { title?: string; section?: string; body?: string }[] },
) {
  const query = (body.query || "").trim();
  if (!query) return json({ error: "No search query." }, 400);
  const hops = (body.hops || []).filter((h) => h && (h.body || h.title));
  if (!hops.length) return json({ matches: [] });
  const hopsBlock = hops
    .map((h, i) =>
      `### HOP ${i + 1}${h.section ? ` — SECTION: ${h.section}` : ""}\n` +
      `TITLE: ${h.title || "Untitled"}\n` +
      `${(h.body || "").replace(/\s+/g, " ").trim() || "(empty)"}`)
    .join("\n\n");
  const system =
    "You are a precise search engine inside RABBIT HOLE, a book workbench. The author gives you a " +
    "QUERY (a question or a description of what they are trying to find) and a numbered batch of HOPS " +
    "(manuscript excerpts). Read each hop in full and decide whether it is genuinely relevant to the " +
    "query — it answers the question, contains the thing described, or is clearly about it. Judge on " +
    "meaning and story content, not mere keyword overlap. Return ONLY the hops that are actually " +
    "relevant. For each relevant hop give: `index` (its number from the list), `score` (0-100 " +
    "relevance, higher = stronger match), `reason` (one sentence, <=20 words, on why it matches), and " +
    "`quote` (the single most relevant phrase copied verbatim from that hop, <=25 words). Omit hops " +
    "that are not relevant; if none match, return an empty list. Respond with ONLY a JSON object of the " +
    `form {"matches":[{"index":1,"score":87,"reason":"...","quote":"..."}]}. No markdown, no commentary.`;
  const user = `QUERY: ${query}\n\nHOPS:\n\n${hopsBlock}`;
  const raw = await callClaude(apiKey, { model: (body as any)._model, system, messages: [{ role: "user", content: user }], max_tokens: 1200 });
  const parsed = parseJsonObject(raw);
  const matches = Array.isArray(parsed?.matches)
    ? (parsed.matches as unknown[])
        .filter((m): m is { index?: unknown; score?: unknown; reason?: unknown; quote?: unknown } => !!m && typeof m === "object")
        .map((m) => ({
          index: typeof m.index === "number" ? m.index : parseInt(String(m.index), 10) || 0,
          score: typeof m.score === "number" ? Math.max(0, Math.min(100, Math.round(m.score))) : 0,
          reason: typeof m.reason === "string" ? m.reason.trim() : "",
          quote: typeof m.quote === "string" ? m.quote.trim() : "",
        }))
        .filter((m) => m.index >= 1 && m.index <= hops.length)
        .slice(0, hops.length)
    : [];
  return json({ matches });
}

async function doImportOutline(
  apiKey: string,
  body: { text?: string; instructions?: string; type?: string; genre?: string; sectionsSoFar?: string[] },
) {
  const text = (body.text || "").trim();
  if (!text) return json({ sections: [], hops: [] });
  const instructions = (body.instructions || "").trim();
  const flavor = [body.type, body.genre].filter(Boolean).join(" / ");
  const sectionsSoFar = (body.sectionsSoFar || [])
    .filter((s) => typeof s === "string" && s.trim())
    .map((s) => s.trim())
    .slice(0, 200);
  const system =
    "You are an import engine inside RABBIT HOLE, a book workbench. You convert a raw document into a " +
    "structured outline of SECTIONS and HOPS. A HOP is a single self-contained unit of content (a scene, " +
    "a beat, a chapter, a journal entry); a SECTION is a named group of hops. You are given ONE SLICE of " +
    "a longer document (slices arrive in order), the list of SECTIONS already created from earlier slices, " +
    "and optional grouping recommendations from the author. Split THIS slice into hops in the order they " +
    "appear, and assign each hop to a section.\n\n" +
    "Rules:\n" +
    "- Preserve the author's actual words. A hop's `body` is the real text of that unit, copied verbatim " +
    "from the slice, only fixing obvious line-break/whitespace artifacts from extraction. Do NOT summarize, " +
    "rewrite, or invent content.\n" +
    "- Give each hop a short, specific `title` drawn from its content.\n" +
    "- Reuse an existing section title from ALREADY-CREATED SECTIONS verbatim when this content continues " +
    "that group; only create a NEW section when the content clearly starts a new group.\n" +
    "- If the slice appears to begin mid-unit (continuing a hop split across the slice boundary), still " +
    "emit it as a hop with the text you have.\n" +
    (instructions
      ? `- FOLLOW THE AUTHOR'S GROUPING RECOMMENDATIONS EXACTLY: ${instructions}\n`
      : "- Use natural structure (existing chapter/entry/scene breaks, headings, or clear topic shifts) to decide hop and section boundaries.\n") +
    (flavor ? `- The document is a ${flavor}.\n` : "") +
    "\nRespond with ONLY a JSON object of the form " +
    `{"sections":[{"title":"..."}],"hops":[{"section":"...","title":"...","body":"..."}]}. No markdown, no commentary.`;
  const user =
    (sectionsSoFar.length
      ? `ALREADY-CREATED SECTIONS (reuse these titles when the content continues them):\n${sectionsSoFar.map((s) => `- ${s}`).join("\n")}\n\n`
      : "ALREADY-CREATED SECTIONS: (none yet — this is the first slice)\n\n") +
    `DOCUMENT SLICE:\n\n${text}`;
  const raw = await callClaude(apiKey, { model: (body as any)._model, system, messages: [{ role: "user", content: user }], max_tokens: 8000 });
  const parsed = parseJsonObject(raw);
  const sections = Array.isArray(parsed?.sections)
    ? (parsed.sections as unknown[])
        .map((s) => (s && typeof s === "object" ? (s as { title?: unknown }).title : s))
        .map((t) => (typeof t === "string" ? t.trim() : ""))
        .filter(Boolean)
        .map((title) => ({ title }))
    : [];
  const hops = Array.isArray(parsed?.hops)
    ? (parsed.hops as unknown[])
        .filter((h): h is { section?: unknown; title?: unknown; body?: unknown } => !!h && typeof h === "object")
        .map((h) => ({
          section: typeof h.section === "string" ? h.section.trim() : "",
          title: typeof h.title === "string" ? h.title.trim() : "",
          body: typeof h.body === "string" ? h.body.trim() : "",
        }))
        .filter((h) => h.body || h.title)
        .slice(0, 200)
    : [];
  return json({ sections, hops });
}

async function doJournalAdvice(
  apiKey: string,
  body: { entries?: { title?: string; body?: string; when?: string }[]; type?: string; genre?: string },
) {
  const entries = (body.entries || []).filter((e) => e && (e.body || e.title));
  if (!entries.length) return json({ items: [] });
  const block = entries
    .map((e, i) =>
      `--- entry ${i + 1}${e.when ? ` (${e.when})` : ""}${e.title ? `: ${e.title}` : ""} ---\n${(e.body || "").trim()}`)
    .join("\n\n");
  const system =
    "You are a warm, perceptive companion inside RABBIT HOLE, reflecting on someone's personal journal. " +
    "You are given their most recent entries, oldest first. This is private journaling, NOT fiction \u2014 never " +
    "treat it as a manuscript or give writing-craft critique. Respond with caring, grounded support based ONLY " +
    "on what the entries actually say. Return 4-6 items of two kinds:\n" +
    "- 'reflection': a gentle observation, encouragement, or piece of caring advice about how the writer seems " +
    "to be doing, a pattern worth noticing, or something they might be proud of. Specific to their entries, never generic.\n" +
    "- 'prompt': an inviting question or theme they could write about next, drawn from what is on their mind lately.\n" +
    "Give a mix of both, leaning slightly toward reflections. Each item has a short `title` (a few words) and a " +
    "`body` (1-2 sentences). Be human and kind, never clinical, preachy, or alarmist. Respond with ONLY a JSON " +
    `object of the form {"items":[{"type":"reflection","title":"...","body":"..."}]}. No markdown, no commentary.`;
  const user = `RECENT ENTRIES (oldest first):\n\n${block}`;
  const raw = await callClaude(apiKey, { model: (body as any)._model, system, messages: [{ role: "user", content: user }], max_tokens: 1200 });
  const parsed = parseJsonObject(raw);
  const items = Array.isArray(parsed?.items)
    ? (parsed.items as unknown[])
        .filter((it): it is { type?: unknown; title?: unknown; body?: unknown } => !!it && typeof it === "object")
        .map((it) => ({
          type: it.type === "prompt" ? "prompt" : "reflection",
          title: typeof it.title === "string" ? it.title.trim() : "",
          body: typeof it.body === "string" ? it.body.trim() : "",
        }))
        .filter((it) => it.title || it.body)
        .slice(0, 8)
    : [];
  return json({ items });
}

/* ---------------- helpers ---------------- */
type Ctx = { project?: string | null; type?: string; genre?: string; chapters?: string[]; characters?: { name: string; summary?: string }[] };

async function callClaude(
  apiKey: string,
  opts: { system: string; messages: Msg[]; max_tokens: number; model?: string },
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: opts.model || DEFAULT_MODEL, max_tokens: opts.max_tokens, system: opts.system, messages: opts.messages }),
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

// Author-flagged planning/lore docs (the "USE AS CONTEXT" toggle on the PLANNING
// page). Appended to GENERATE-style prompts so the model honors the author's
// canon for continuity. Returns "" when nothing is flagged.
function contextDocsBlock(docs?: { title?: string; body?: string }[]): string {
  const valid = (docs || []).filter((d) => d && (d.body || "").trim());
  if (!valid.length) return "";
  const block = valid
    .map((d, i) => `--- reference doc ${i + 1}${d.title ? `: ${d.title}` : ""} ---\n${(d.body || "").trim()}`)
    .join("\n\n");
  return `\n\nAUTHOR REFERENCE DOCS (planning, outline, and lore the author flagged as context — treat as canon and honor for continuity; do not quote verbatim or summarize these docs themselves):\n\n${block}`;
}

function parseJsonObject(s: string): { characters?: unknown[]; locations?: unknown[]; events?: unknown[]; ideas?: unknown[]; assign?: unknown[]; suggest?: unknown[]; chunks?: unknown[]; strengths?: unknown[]; suggestions?: unknown[]; arc?: unknown[]; principles?: unknown[]; relationships?: unknown[]; matches?: unknown[]; sections?: unknown[]; hops?: unknown[]; items?: unknown[]; title?: unknown; body?: unknown } | null {
  try {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Pull every flat (non-nested) JSON object out of a raw model reply, parsing each
// independently. Tolerant of {"events":[...]} wrappers, bare [...] arrays, markdown
// fences, stray prose, and truncated output (a trailing incomplete object is simply
// skipped because it never closes its brace). Only valid for objects whose values
// contain no nested braces — true for our flat event shape.
function extractFlatObjects(raw: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /\{[^{}]*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    try {
      const o = JSON.parse(m[0]);
      if (o && typeof o === "object" && !Array.isArray(o)) out.push(o as Record<string, unknown>);
    } catch {
      // ignore non-JSON braces
    }
  }
  return out;
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

