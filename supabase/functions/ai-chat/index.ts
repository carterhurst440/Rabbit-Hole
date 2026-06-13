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
//   suggest_tags      { chunk, existing }              -> { assign: [string], suggest: [string] }
//   suggest_ideas     { chunks, type, genre }          -> { ideas: [string] }
//   idea_title        { body }                          -> { title: string }
//   generate_body     { title, kind, type, genre, section, chapters, characters, locations, context:[{title,body,section}] } -> { body: string }
//   suggest_chunks    { chunks, type, genre, chapters, characters, locations }
//                                                      -> { chunks: [{ title, chapter, description }] }
//   analyze_chunk     { chunk, context, type, genre, characters, locations }
//                                                      -> { strengths: [string], suggestions: [string] }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-sonnet-4-6";

type Chunk = { title?: string; body?: string; section?: string };
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
    if (task === "char_arc") return await doCharArc(apiKey, body);
    if (task === "char_relationships") return await doCharRelationships(apiKey, body);
    if (task === "loc_summary") return await doLocSummary(apiKey, body);
    if (task === "detect_characters") return await doDetect(apiKey, body);
    if (task === "detect_locations") return await doDetectLocations(apiKey, body);
    if (task === "suggest_tags") return await doSuggestTags(apiKey, body);
    if (task === "suggest_ideas") return await doSuggestIdeas(apiKey, body);
    if (task === "idea_title") return await doIdeaTitle(apiKey, body);
    if (task === "generate_body") return await doGenerateBody(apiKey, body);
    if (task === "suggest_chunks") return await doSuggestChunks(apiKey, body);
    if (task === "analyze_chunk") return await doAnalyzeChunk(apiKey, body);
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
  const raw = await callClaude(apiKey, { system, messages: [{ role: "user", content: user }], max_tokens: 2600 });
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

async function doIdeaTitle(apiKey: string, body: { body?: string }) {
  const text = (body.body || "").trim();
  if (!text) return json({ error: "No idea text to title." }, 400);
  const system =
    "You are a naming assistant inside RABBIT HOLE, a book workbench. The author will give you the " +
    "body of a single backlog idea. Distill it into ONE short, evocative title of 3 to 10 words that " +
    "captures the heart of the idea. Title case-ish, no surrounding quotes, no trailing punctuation, " +
    "no preamble. Respond with ONLY a JSON object of the form " +
    `{"title":"..."}. No markdown, no commentary.`;
  const raw = await callClaude(apiKey, { system, messages: [{ role: "user", content: `IDEA:\n${text}` }], max_tokens: 80 });
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
    `\nTITLE:\n${title}`;
  const raw = await callClaude(apiKey, { system, messages: [{ role: "user", content: user }], max_tokens: kind === "hop" ? 900 : 320 });
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
  const raw = await callClaude(apiKey, { system, messages: [{ role: "user", content: user }], max_tokens: 2600 });
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
  const raw = await callClaude(apiKey, { system, messages: [{ role: "user", content: user }], max_tokens: 1200 });
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
  const raw = await callClaude(apiKey, { system, messages: [{ role: "user", content: user }], max_tokens: 1100 });
  const parsed = parseJsonObject(raw);
  const clean = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? arr.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)
      : [];
  return json({ strengths: clean(parsed?.strengths).slice(0, 3), suggestions: clean(parsed?.suggestions).slice(0, 4) });
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

function parseJsonObject(s: string): { characters?: unknown[]; locations?: unknown[]; ideas?: unknown[]; assign?: unknown[]; suggest?: unknown[]; chunks?: unknown[]; strengths?: unknown[]; suggestions?: unknown[]; arc?: unknown[]; principles?: unknown[]; relationships?: unknown[]; title?: unknown; body?: unknown } | null {
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
