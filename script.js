/* ===================================================================
   RABBIT HOLE — book workbench
   Vanilla SPA. Data layer is isolated so it can move to Supabase later.
   =================================================================== */

/* ---------------- DATA LAYER (localStorage) ---------------- */
const STORE_KEY = 'exile_db_v1';

const uid = () => crypto.randomUUID();

const CHAPTER_PALETTE = ['#e0a96d', '#6da9e0', '#9ad06b', '#d06b9a', '#c9a227', '#6bd0c0', '#b58be0', '#e07a5f'];

const PROJECT_TYPES = ['Book', 'Movie', 'Play', 'Show', 'Short Story', 'Journal', 'Other'];

// Per-project theme colors. The first is the app default (tan). All are light
// enough that the dark text used on accent-filled buttons stays readable.
const DEFAULT_ACCENT = '#e0a96d';
const PROJECT_ACCENTS = [
  { name: 'Tan', value: '#e0a96d' },
  { name: 'Gold', value: '#e0c46d' },
  { name: 'Coral', value: '#e0896d' },
  { name: 'Rose', value: '#e088a4' },
  { name: 'Violet', value: '#b794e0' },
  { name: 'Sky', value: '#7cc1de' },
  { name: 'Sage', value: '#86c9a0' },
  { name: 'Slate', value: '#9aa6c0' },
];

// Paint the whole app in a project's theme color by swapping --accent; the
// derived dim/mid vars follow via color-mix in the stylesheet.
function applyProjectAccent(color) {
  document.documentElement.style.setProperty('--accent', color || DEFAULT_ACCENT);
}

// The AI marker. A plain dingbat (not the ✨ emoji) so it inherits the
// project accent via CSS instead of rendering as a fixed-color emoji.
const AI_STAR = '<span class="ai-star">✦</span>';

// Inline icons for the three primary AI functions. The shared `aifn-ic` class
// lets the working-state CSS animate whichever icon a button carries.
const _aifn = inner => '<svg class="aifn-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
const IC_DETECT = _aifn('<path d="M4 8V5.5a1.5 1.5 0 0 1 1.5-1.5H8"/><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8"/><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16"/><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><circle cx="12" cy="12" r="2.6"/>');
const IC_ANALYZE = _aifn('<path d="M4 5v14h16"/><path d="M7.5 14.5l3-3.5 3 2.5 4-5.5"/>');
const IC_GENERATE = _aifn('<path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="M18.5 15l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6Z"/>');
const IC_PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

// Drive an AI button's working state: swap in its function icon + verb and add
// the animated `ai-working` class. Returns the prior HTML so callers can restore
// it (omit the html arg to aiBtnDone when the surrounding pane re-renders).
function aiBtnStart(btn, icon, verb) {
  if (!btn) return '';
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('ai-working');
  btn.innerHTML = (icon || AI_STAR) + ' ' + verb;
  return original;
}
function aiBtnDone(btn, html) {
  if (!btn) return;
  btn.disabled = false;
  btn.classList.remove('ai-working');
  if (html != null) btn.innerHTML = html;
}

const GENRES = [
  'Literary Fiction', 'Fantasy', 'Science Fiction', 'Mystery', 'Thriller',
  'Horror', 'Romance', 'Historical Fiction', 'Adventure', 'Young Adult',
  'Crime', 'Drama', 'Comedy', 'Action', 'Dystopian', 'Memoir',
  'Biography', 'Nonfiction', 'Poetry', 'Other',
];

function seed() {
  const chId = uid();
  return {
    chapters: [{ id: chId, title: 'Chapter 1', order: 0, color: CHAPTER_PALETTE[0] }],
    chunks: [],
    characters: [],
    locations: [],
    ideas: [],
    events: [],
    timelines: [],
    docs: [],
    tags: [],
    ui: { activeChapter: chId, activeChar: null, activeLoc: null, activeTag: null, activeTimeline: '' }
  };
}

// Bring older saved data up to the current shape. Idempotent + defensive.
function migrate(d) {
  d.tags = d.tags || [];
  d.locations = d.locations || [];
  d.events = d.events || [];
  d.timelines = d.timelines || [];
  d.docs = d.docs || [];
  d.ui = d.ui || {};
  if (typeof d.ui.activeTimeline !== 'string') d.ui.activeTimeline = '';
  (d.events || []).forEach(e => { if (!Array.isArray(e.timelineIds)) e.timelineIds = []; });
  (d.chunks || []).forEach(c => { if (!Array.isArray(c.tagIds)) c.tagIds = []; });
  (d.chunks || []).forEach(c => { if (!Array.isArray(c.locationIds)) c.locationIds = []; });
  (d.ideas || []).forEach(i => {
    if (!Array.isArray(i.tagIds)) {
      i.tagIds = [];
      if (Array.isArray(i.labels)) {
        i.labels.forEach(name => {
          const lab = ensureTagIn(d, name);
          if (lab && !i.tagIds.includes(lab.id)) i.tagIds.push(lab.id);
        });
      }
    }
    delete i.labels; // replaced by tagIds
  });
  return d;
}

// `db` holds the ACTIVE project in memory, in the same shape the whole UI
// expects. It's populated by loadProject() after auth; persistence is the
// Supabase data layer near boot (save → schedulePersist → persistProject).
let db = seed();
let activeProjectId = null;
let projectsCache = [];
let writingDaysCache = new Map();
let dayStatsCache = new Map();   // day key -> { hops, words }, for heatmap tooltips
let wordsChartCache = new Map(); // day key -> Map(sourceKey -> words); sourceKey = project_id | 'practice'
const PRACTICE_BAR_COLOR = DEFAULT_ACCENT;  // practice stacks in the app default accent

// Pull any legacy localStorage data so it can become the user's first project.
function importableLocalData() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) { console.warn('local import read failed', e); }
  return null;
}

let _dataVersion = 0;
function save() {
  _dataVersion++;
  renderHeaderMeta();
  schedulePersist();
}

function chapterColor(chId) {
  const ch = db.chapters.find(c => c.id === chId);
  if (ch && ch.color) return ch.color;
  const idx = db.chapters.findIndex(c => c.id === chId);
  return CHAPTER_PALETTE[(idx < 0 ? 0 : idx) % CHAPTER_PALETTE.length];
}

/* ---------------- TAGS ---------------- */
function ensureTagIn(d, rawName) {
  // Labels are canonically uppercase so the same word never splits by case.
  const name = String(rawName || '').trim().toUpperCase();
  if (!name) return null;
  let lab = d.tags.find(l => l.name.toUpperCase() === name);
  if (!lab) {
    lab = { id: uid(), name, color: CHAPTER_PALETTE[d.tags.length % CHAPTER_PALETTE.length] };
    d.tags.push(lab);
  }
  return lab;
}
const ensureTag = (name) => ensureTagIn(db, name);
const getTag = (id) => db.tags.find(l => l.id === id);
const tagName = (id) => getTag(id)?.name || '';
const tagColor = (id) => getTag(id)?.color || 'var(--muted)';

// Tag categories ("THEMES", "LORE", "TONE", …) are just an uppercase name stored
// on each tag (the `category` column on the tags table). The set of categories is
// derived from whatever names the tags actually use, so a category with no tags
// simply ceases to exist — there is no separate list or table to maintain. Here a
// category's id IS its name, which keeps the render code (c.id / c.name) unchanged.
function tagCats() {
  const seen = new Map();
  for (const l of db.tags) {
    const nm = (l.category || '').trim();
    if (nm && !seen.has(nm)) seen.set(nm, { id: nm, name: nm });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
const tagCatOf = (labelId) => (getTag(labelId)?.category || '');
const tagCatName = (catId) => (catId || '');
function setTagCat(labelId, catName) {
  const l = getTag(labelId);
  if (!l) return;
  l.category = String(catName || '').trim().toUpperCase();
  save();
}
function addTagCat(name) {
  const nm = String(name || '').trim().toUpperCase();
  return nm ? { id: nm, name: nm } : null;
}
function renameTagCat(oldName, newName) {
  const a = String(oldName || '').trim().toUpperCase();
  const b = String(newName || '').trim().toUpperCase();
  if (!a || !b || a === b) return;
  db.tags.forEach(l => { if ((l.category || '').toUpperCase() === a) l.category = b; });
  save();
}
function deleteTagCat(catName) {
  const a = String(catName || '').trim().toUpperCase();
  db.tags.forEach(l => { if ((l.category || '').toUpperCase() === a) l.category = ''; });
  save();
}

// Characters and locations get the same name-on-the-row category model as tags:
// a `category` column holding an uppercase name, with the category list derived
// from whatever names the rows actually use. These helpers take a collection key
// ('characters' | 'locations') so one set covers both entity kinds.
function collCats(coll) {
  const seen = new Map();
  for (const e of (db[coll] || [])) {
    const nm = (e.category || '').trim();
    if (nm && !seen.has(nm)) seen.set(nm, { id: nm, name: nm });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
const collCatOf = (coll, id) => ((db[coll] || []).find(e => e.id === id)?.category || '');
function setCollCat(coll, id, catName) {
  const e = (db[coll] || []).find(x => x.id === id);
  if (!e) return;
  e.category = String(catName || '').trim().toUpperCase();
  save();
}
function renameCollCat(coll, oldName, newName) {
  const a = String(oldName || '').trim().toUpperCase();
  const b = String(newName || '').trim().toUpperCase();
  if (!a || !b || a === b) return;
  (db[coll] || []).forEach(e => { if ((e.category || '').toUpperCase() === a) e.category = b; });
  save();
}
function deleteCollCat(coll, catName) {
  const a = String(catName || '').trim().toUpperCase();
  (db[coll] || []).forEach(e => { if ((e.category || '').toUpperCase() === a) e.category = ''; });
  save();
}

// Reusable chip editor for any entity holding a `tagIds` array.
function tagEditorHTML(selectedIds) {
  const chips = db.tags.map(l =>
    `<span class="lbl-chip ${selectedIds.includes(l.id) ? 'on' : ''}" data-lbl="${l.id}" style="--lc:${l.color}">${esc(l.name)}</span>`
  ).join('') || `<span class="ci-count">no tags yet</span>`;
  return `
    <div class="label-editor">
      <div class="label-chips">${chips}</div>
      <input class="new-label-input" placeholder="+ new tag, Enter to add" />
    </div>`;
}

function wireTagEditor(container, target) {
  container.querySelectorAll('.lbl-chip[data-lbl]').forEach(chip => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.lbl;
      const i = target.tagIds.indexOf(id);
      if (i >= 0) target.tagIds.splice(i, 1); else target.tagIds.push(id);
      chip.classList.toggle('on');
      save();
    });
  });
  const input = container.querySelector('.new-label-input');
  if (input) input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!input.value.trim()) return;
    const lab = ensureTag(input.value);
    if (lab && !target.tagIds.includes(lab.id)) target.tagIds.push(lab.id);
    save();
    // rebuild this editor in place (new chip appears, focus retained)
    const wrap = document.createElement('div');
    wrap.innerHTML = tagEditorHTML(target.tagIds);
    const fresh = wrap.firstElementChild;
    container.replaceWith(fresh);
    wireTagEditor(fresh, target);
    fresh.querySelector('.new-label-input').focus();
  });
}

/* ---------------- ROUTING ---------------- */
const ROUTES = ['home', 'search', 'sections', 'timelines', 'characters', 'locations', 'tags', 'ideas', 'planning', 'community', 'practice'];

function currentRoute() {
  const h = location.hash.replace('#', '');
  return ROUTES.includes(h) ? h : 'home';
}

function route() {
  const r = currentRoute();
  ROUTES.forEach(name => {
    document.getElementById('view-' + name).hidden = name !== r;
  });
  document.querySelectorAll('.nav-icon[data-route]').forEach(a => {
    a.classList.toggle('active', a.dataset.route === r);
  });
  closeDrawer();
  updateArchiveToggles();
  // The + HOP button adds to the open project; on PRACTICE it becomes + PRACTICE HOP.
  const onPractice = r === 'practice';
  const addHop = document.getElementById('addHopBtn');
  const addPr = document.getElementById('addPracticeHopBtn');
  if (addHop) addHop.hidden = onPractice;
  if (addPr) addPr.hidden = !onPractice;
  // The project switcher is meaningless inside the global PRACTICE module.
  const projSwitch = document.querySelector('.header-project');
  if (projSwitch) projSwitch.hidden = onPractice;
  if (r === 'home') { renderHome(); playHomeReveal(); fetchWordsChart().then(renderWordsChart); }
  if (r === 'search') renderSearch();
  if (r === 'sections') { sectionsMode = 'board'; renderSections(); }
  if (r === 'timelines') renderTimelines();
  if (r === 'characters') renderCharacters();
  if (r === 'locations') renderLocations();
  if (r === 'tags') renderTags();
  if (r === 'ideas') renderIdeas();
  if (r === 'planning') renderPlanning();
  if (r === 'community') renderCommunity();
  if (r === 'practice') renderPractice();
}

// Populate the account menu (profile card) from the signed-in user.
function renderSettings() {
  if (!currentUser) return;
  const meta = currentUser.user_metadata || {};
  const who = [meta.first_name, meta.last_name].filter(Boolean).join(' ') || currentUser.email;
  const initials = ([meta.first_name, meta.last_name].filter(Boolean).map(s => s[0]).join('')
    || currentUser.email[0]).toUpperCase();
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('settingsAvatar', initials);
  set('settingsName', who);
  set('settingsEmail', currentUser.email);
  const handle = displayUsername();
  const cur = document.getElementById('usernameCurrent');
  if (cur) {
    cur.textContent = handle ? '@' + handle : 'not set';
    cur.classList.toggle('unset', !handle);
  }
  const adminSection = document.getElementById('adminSection');
  if (adminSection) adminSection.hidden = !isAdmin();
  paintAiTier();
}

const AI_TIER_HINTS = {
  economy: 'Leanest models per task. Stretches tokens the furthest.',
  standard: 'Balanced models tuned for each task. Recommended.',
  high: 'Best model on every task. Uses the most tokens.'
};

function currentAiTier() {
  return (currentProfile && currentProfile.ai_tier) || 'standard';
}

function paintAiTier() {
  const tier = currentAiTier();
  document.querySelectorAll('#aiTier .ai-tier-opt').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.tier === tier);
  });
  const hint = document.getElementById('aiTierHint');
  if (hint) hint.textContent = AI_TIER_HINTS[tier] || '';
}

async function setAiTier(tier) {
  if (!currentUser || !['economy', 'standard', 'high'].includes(tier)) return;
  if (currentAiTier() === tier) return;
  const prev = currentProfile ? currentProfile.ai_tier : undefined;
  if (currentProfile) currentProfile.ai_tier = tier;
  paintAiTier();
  const { error } = await sb.from('profiles').update({ ai_tier: tier }).eq('id', currentUser.id);
  if (error) {
    if (currentProfile) currentProfile.ai_tier = prev;
    paintAiTier();
  }
}

// Reveal the username editor (called only after the user confirms the warning).
function openUsernameEditor() {
  const view = document.getElementById('usernameView');
  const edit = document.getElementById('usernameEdit');
  const input = document.getElementById('usernameInput');
  const msg = document.getElementById('usernameMsg');
  if (!view || !edit || !input) return;
  view.hidden = true; edit.hidden = false;
  if (msg) { msg.textContent = ''; msg.classList.remove('ok'); }
  input.value = displayUsername();
  input.focus(); input.select();
}

// Collapse the editor back to the read-only view.
function closeUsernameEditor() {
  const view = document.getElementById('usernameView');
  const edit = document.getElementById('usernameEdit');
  const msg = document.getElementById('usernameMsg');
  if (!view || !edit) return;
  edit.hidden = true; view.hidden = false;
  if (msg) { msg.textContent = ''; msg.classList.remove('ok'); }
}

// Save / change the community handle. Enforces a simple format and surfaces the
// unique-constraint error if the handle is already taken.
async function saveUsername() {
  const input = document.getElementById('usernameInput');
  const msg = document.getElementById('usernameMsg');
  if (!input || !currentUser) return;
  const setMsg = (t, ok) => { if (msg) { msg.textContent = t || ''; msg.classList.toggle('ok', !!ok); } };
  const name = input.value.trim();
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(name)) {
    setMsg('3-24 chars: letters, numbers, underscore.'); return;
  }
  setMsg('Saving...');
  const { error } = await sb.from('profiles').update({ username: name }).eq('id', currentUser.id);
  if (error) {
    setMsg(error.code === '23505' ? 'That username is taken.' : 'Could not save.');
    return;
  }
  if (currentProfile) currentProfile.username = name; else currentProfile = { username: name };
  renderSettings();
  closeUsernameEditor();
}

/* =====================================================================
   COMMUNITY — social feed of shared hops
   ===================================================================== */
let feedCache = [];
let hopPostCounts = {};      // chunk_id -> { active, total }
let myFluffle = new Set();    // user_ids the current user has favorited
let fluffleNames = new Map(); // user_id -> username for Fluffle members
let feedScope = 'all';        // 'all' | 'fluffle' | 'mine'
let feedGenre = '';           // '' = all genres, else a project_genre
let feedType = '';            // '' = all types, else a project_type
let feedSort = 'recent';      // 'recent' | 'popular' (FIND WRITERS)
let feedSearch = '';          // free-text search across the feed
let followerCount = 0;        // people who added the current user to their Fluffle
let pendingFeedFocus = null;  // post id to scroll to after the feed draws

// How many community posts the current user has per hop, so each hop can show a
// live count badge on its VIEW POSTS control. Cached; refreshed after mutations.
async function loadHopPostCounts() {
  hopPostCounts = {};
  if (!currentUser) { refreshHopPostBadges(); return; }
  const { data } = await sb.from('community_posts')
    .select('chunk_id, status').eq('user_id', currentUser.id);
  (data || []).forEach(r => {
    if (!r.chunk_id) return;
    const e = hopPostCounts[r.chunk_id] || (hopPostCounts[r.chunk_id] = { active: 0, total: 0 });
    e.total++; if (r.status !== 'closed') e.active++;
  });
  refreshHopPostBadges();
}

// Stamp the cached active-post count onto each hop card's VIEW POSTS buttons.
function refreshHopPostBadges() {
  document.querySelectorAll('.chunk-card').forEach(card => {
    const n = (hopPostCounts[card.dataset.id] || {}).active || 0;
    card.querySelectorAll('[data-f="viewposts"] .pc-badge').forEach(b => {
      b.textContent = n;
      b.classList.toggle('has', n > 0);
    });
  });
}

// The set of community members the current user has added to their Fluffle,
// plus a username map. Other users' profiles aren't readable under RLS, so the
// handle is snapshotted onto community_follows when they're added; the
// usernames_for_ids RPC (security definer) backfills any rows missing it.
async function loadFluffle() {
  myFluffle = new Set();
  fluffleNames = new Map();
  if (!currentUser) { updateFluffleCount(); return; }
  const { data } = await sb.from('community_follows')
    .select('friend_id, friend_username').eq('user_id', currentUser.id);
  (data || []).forEach(r => { myFluffle.add(r.friend_id); fluffleNames.set(r.friend_id, r.friend_username || ''); });
  updateFluffleCount();
  await resolveFluffleNames();
}

// Look up real usernames for Fluffle members whose handle wasn't snapshotted,
// then backfill the snapshot so future loads don't need the RPC.
async function resolveFluffleNames() {
  const missing = [...myFluffle].filter(id => !(fluffleNames.get(id) || '').trim());
  if (!missing.length) return;
  const { data, error } = await sb.rpc('usernames_for_ids', { ids: missing });
  if (error || !data) return;
  for (const row of data) {
    const name = row.username || '';
    if (!name) continue;
    fluffleNames.set(row.id, name);
    sb.from('community_follows')
      .update({ friend_username: name })
      .eq('user_id', currentUser.id).eq('friend_id', row.id);
  }
}

// Reflect the Fluffle size in the account-menu badge.
function updateFluffleCount() {
  const el = document.getElementById('fluffleCount');
  if (el) { el.textContent = myFluffle.size; el.classList.toggle('has', myFluffle.size > 0); }
}

// Manage everyone in the Fluffle: open a member's profile or remove them.
function manageFluffleModal() {
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  overlay.innerHTML = `
    <div class="ui-modal">
      <div class="ui-modal-title">MY FLUFFLE</div>
      <div class="ui-modal-scroll" id="flScroll"></div>
      <div class="ui-modal-actions">
        <button class="ui-modal-btn" data-act="close">Done</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="close"]').addEventListener('click', close);
  const scroll = overlay.querySelector('#flScroll');

  function render() {
    const members = [...myFluffle];
    if (!members.length) {
      scroll.innerHTML = '<div class="feed-empty">No one in your Fluffle yet. Tap a username in the community to add them.</div>';
      return;
    }
    scroll.innerHTML = members.map(idv => {
      const name = fluffleNames.get(idv) || 'member';
      return `<div class="fl-row" data-id="${idv}">
        <button class="fl-name" data-f="open">@${esc(name)}</button>
        <button class="add-btn danger" data-f="remove">REMOVE</button>
      </div>`;
    }).join('');
    members.forEach(idv => {
      const row = scroll.querySelector(`.fl-row[data-id="${idv}"]`);
      if (!row) return;
      row.querySelector('[data-f="open"]').addEventListener('click', () =>
        userProfileModal(idv, fluffleNames.get(idv) || ''));
      row.querySelector('[data-f="remove"]').addEventListener('click', async () => {
        myFluffle.delete(idv); fluffleNames.delete(idv);
        await sb.from('community_follows').delete().eq('user_id', currentUser.id).eq('friend_id', idv);
        updateFluffleCount(); render();
        if (currentRoute() === 'community') { renderCommunityTabs(); drawFeed(); renderCommunityRail(); }
      });
    });
  }
  render();
  resolveFluffleNames().then(render);
}

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60; if (m < 60) return Math.floor(m) + 'm';
  const h = m / 60; if (h < 24) return Math.floor(h) + 'h';
  const d = h / 24; if (d < 7) return Math.floor(d) + 'd';
  return new Date(iso).toLocaleDateString();
}

// Share a hop to the community feed: snapshots the hop + project so the post
// stands alone even if the source hop later changes.
// Snapshot of every character/location present in a hop, with their overview
// (summary) and highlights (notes), frozen into a post so the community sees
// the same reference detail the author had at post time.
function chunkEntitySnapshot(chunk) {
  const build = (K, kind) => (db[K.coll] || [])
    .filter(e => chunkEntityPresence(K, chunk, e).on)
    .map(e => ({
      kind, name: e.name, color: e.color || '',
      summary: e.summary || '',
      notes: (e.notes || []).map(n => (n.text || '').trim()).filter(Boolean)
    }));
  return [
    ...build(ENTITY_KINDS.character, 'character'),
    ...build(ENTITY_KINDS.location, 'location')
  ];
}

function postToCommunityModal(chunk) {
  const username = displayUsername();
  if (!username) {
    alertModal('Pick a username first — open your profile (top-right) and set a handle.', { title: 'POST TO COMMUNITY' });
    return;
  }
  if (!(chunk.body || '').trim()) {
    alertModal('This hop has no content to share yet.', { title: 'POST TO COMMUNITY' });
    return;
  }
  const proj = projectsCache.find(p => p.id === activeProjectId) || {};
  const projLine = [proj.name, proj.type, proj.genre].filter(Boolean).join(' · ');
  const entities = chunkEntitySnapshot(chunk);
  const entPreview = entitySnapshotHtml(entities);
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  overlay.innerHTML = `
    <div class="ui-modal">
      <div class="ui-modal-title">POST TO COMMUNITY</div>
      <div class="ui-modal-scroll">
        <label class="post-field">
          <span class="post-field-head">CONTEXT / ASK <span class="post-count" id="postCount">0/100</span></span>
          <textarea id="postContext" maxlength="100" rows="3" placeholder="What feedback are you after? (optional)"></textarea>
        </label>
        <div class="post-field">
          <span class="post-field-head">WHO CAN SEE THIS</span>
          <div class="vis-opts" id="postVis">
            <button type="button" class="vis-btn active" data-vis="public">FOR EVERYONE</button>
            <button type="button" class="vis-btn" data-vis="fluffle">MY FLUFFLE ONLY</button>
          </div>
        </div>
        <div class="post-preview">
          <div class="post-preview-proj">${esc(projLine) || 'Untitled project'}</div>
          ${chunk.title ? `<div class="post-preview-title">${esc(chunk.title)}</div>` : ''}
          <div class="post-preview-body">${esc(chunk.body)}</div>
          ${entPreview}
        </div>
      </div>
      <div class="ui-modal-actions">
        <button class="ui-modal-btn" data-act="cancel">Cancel</button>
        <button class="ui-modal-btn solid" data-act="post">POST</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const ta = overlay.querySelector('#postContext');
  const cnt = overlay.querySelector('#postCount');
  ta.addEventListener('input', () => { cnt.textContent = ta.value.length + '/100'; });
  let visibility = 'public';
  overlay.querySelectorAll('#postVis .vis-btn').forEach(b => b.addEventListener('click', () => {
    visibility = b.dataset.vis;
    overlay.querySelectorAll('#postVis .vis-btn').forEach(x => x.classList.toggle('active', x === b));
  }));
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
  overlay.querySelector('[data-act="post"]').addEventListener('click', async () => {
    const btn = overlay.querySelector('[data-act="post"]');
    btn.disabled = true; btn.textContent = 'POSTING…';
    let themes = [];
    try {
      const { data: td } = await sb.functions.invoke('community-themes', {
        body: { title: chunk.title || '', text: chunk.body || '', type: proj.type || '', genre: proj.genre || '' }
      });
      if (td && Array.isArray(td.themes)) themes = td.themes;
    } catch (_) {}
    const { error } = await sb.from('community_posts').insert({
      user_id: currentUser.id,
      username,
      chunk_id: chunk.id,
      hop_title: chunk.title || null,
      hop_body: chunk.body || '',
      context: ta.value.trim() || null,
      project_name: proj.name || null,
      project_type: proj.type || null,
      project_genre: proj.genre || null,
      accent: proj.accent || DEFAULT_ACCENT,
      entities,
      themes,
      visibility
    });
    if (error) {
      btn.disabled = false; btn.textContent = 'POST';
      alertModal('Could not post.\n\n' + (error.message || ''), { title: 'POST' });
      return;
    }
    close();
    alertModal('Shared to the community.', { title: 'POSTED' });
    loadHopPostCounts();
    if (currentRoute() === 'community') renderCommunity();
  });
}

// Map each post's chunk_id -> its project's CURRENT accent so accent changes
// show in the feed, not the value frozen at post time. RLS limits the chunk and
// project reads to the viewer's own rows, so only the viewer's own posts pick up
// a live accent; everyone else's fall back to the frozen snapshot.
async function resolveLivePostAccents(posts) {
  const chunkIds = [...new Set((posts || []).map(p => p.chunk_id).filter(Boolean))];
  if (!chunkIds.length) return {};
  const { data: crows } = await sb.from('chunks').select('id, project_id').in('id', chunkIds);
  const projIds = [...new Set((crows || []).map(r => r.project_id).filter(Boolean))];
  const projAccent = {};
  if (projIds.length) {
    const { data: prows } = await sb.from('projects').select('id, accent').in('id', projIds);
    (prows || []).forEach(r => { if (r.accent) projAccent[r.id] = r.accent; });
  }
  const out = {};
  (crows || []).forEach(r => { const a = projAccent[r.project_id]; if (a) out[r.id] = a; });
  return out;
}

async function renderCommunity() {
  const el = document.getElementById('communityFeed');
  if (!el) return;
  el.innerHTML = '<div class="feed-empty">Loading…</div>';
  await loadFluffle();
  await loadFollowerCount();
  renderCommunityTabs();
  renderCommunityTools();
  const { data: posts, error } = await sb.from('community_posts')
    .select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(100);
  if (error) { el.innerHTML = '<div class="feed-empty">Could not load the feed.</div>'; return; }
  const ids = posts.map(p => p.id);
  let likes = [], comments = [];
  if (ids.length) {
    const [lr, cr] = await Promise.all([
      sb.from('community_likes').select('post_id, user_id').in('post_id', ids),
      sb.from('community_comments').select('*').in('post_id', ids).order('created_at', { ascending: true })
    ]);
    likes = lr.data || []; comments = cr.data || [];
  }
  const me = currentUser && currentUser.id;
  const liveAccent = await resolveLivePostAccents(posts);
  feedCache = posts.map(p => ({
    ...p,
    accent: liveAccent[p.chunk_id] || p.accent || DEFAULT_ACCENT,
    likeCount: likes.filter(l => l.post_id === p.id).length,
    likedByMe: likes.some(l => l.post_id === p.id && l.user_id === me),
    comments: comments.filter(c => c.post_id === p.id),
    commentsOpen: false
  }));
  drawFeed();
  renderCommunityRail();
}

// People who have added the current user to their Fluffle (reverse follow).
async function loadFollowerCount() {
  followerCount = 0;
  if (!currentUser) return;
  const { count } = await sb.from('community_follows')
    .select('user_id', { count: 'exact', head: true }).eq('friend_id', currentUser.id);
  followerCount = count || 0;
}

// Up-to-two-letter avatar label from a handle (drops a leading @).
function initialsOf(name) {
  const s = (name || '').replace(/^@/, '').trim();
  if (!s) return '?';
  const parts = s.split(/[\s_.-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : s.slice(0, 2);
  return letters.toUpperCase();
}

// Tab row: ALL / MY FLUFFLE / MY POSTS scope toggle.
function renderCommunityTabs() {
  const bar = document.getElementById('communityTabs');
  if (!bar) return;
  bar.innerHTML = `
    <button class="community-tab ${feedScope === 'all' ? 'active' : ''}" data-scope="all">ALL</button>
    <button class="community-tab ${feedScope === 'fluffle' ? 'active' : ''}" data-scope="fluffle">MY FLUFFLE <span class="badge">${myFluffle.size}</span></button>
    <button class="community-tab ${feedScope === 'mine' ? 'active' : ''}" data-scope="mine">MY POSTS</button>`;
  bar.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
    feedScope = b.dataset.scope;
    feedSort = 'recent';
    renderCommunityTabs(); drawFeed();
  }));
}

// Sticky toolbar: free-text search + GENRE / TYPE dropdown filters.
function renderCommunityTools() {
  const bar = document.getElementById('communityTools');
  if (!bar) return;
  const genreOpts = ['<option value="">ALL GENRES</option>']
    .concat(GENRES.map(g => `<option value="${esc(g)}" ${feedGenre === g ? 'selected' : ''}>${esc(g)}</option>`)).join('');
  const typeOpts = ['<option value="">ALL TYPES</option>']
    .concat(PROJECT_TYPES.map(t => `<option value="${esc(t)}" ${feedType === t ? 'selected' : ''}>${esc(t)}</option>`)).join('');
  bar.innerHTML = `
    <div class="feed-search">
      <svg viewBox="0 0 20 20"><circle cx="9" cy="9" r="6.4"/><line x1="13.8" y1="13.8" x2="18" y2="18"/></svg>
      <input type="text" id="feedSearchInput" placeholder="Search hops, writers, themes…" autocomplete="off" value="${esc(feedSearch)}" />
    </div>
    <select class="cf-select" data-filter="genre">${genreOpts}</select>
    <select class="cf-select" data-filter="type">${typeOpts}</select>`;
  bar.querySelector('#feedSearchInput').addEventListener('input', e => {
    feedSearch = e.target.value; drawFeed();
  });
  bar.querySelector('[data-filter="genre"]').addEventListener('change', e => {
    feedGenre = e.target.value; drawFeed();
  });
  bar.querySelector('[data-filter="type"]').addEventListener('change', e => {
    feedType = e.target.value; drawFeed();
  });
}

// Right rail: profile card, your fluffle, themes cloud, guidelines.
function renderCommunityRail() {
  const rail = document.getElementById('communityRail');
  if (!rail) return;
  if (!currentUser) { rail.innerHTML = ''; return; }
  const handle = displayUsername() || 'you';
  const myPosts = feedCache.filter(p => p.user_id === currentUser.id).length;

  const fluffle = [...myFluffle];
  const fluffleHtml = fluffle.length
    ? `<div class="rail-fluffle">${fluffle.map(id => {
        const name = fluffleNames.get(id) || 'member';
        return `<div class="rfl-row">
          <div class="rfl-av">${esc(initialsOf(name))}</div>
          <div class="rfl-meta">
            <button class="rfl-h" data-uid="${esc(id)}" data-uname="${esc(name)}">@${esc(name)}</button>
          </div>
        </div>`;
      }).join('')}</div>`
    : '<div class="rail-empty">No one in your Fluffle yet. Tap a writer in the feed to add them.</div>';

  const themeCounts = new Map();
  feedCache.forEach(p => (p.themes || []).forEach(t => {
    if (!t) return; themeCounts.set(t, (themeCounts.get(t) || 0) + 1);
  }));
  const themes = [...themeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const themesHtml = themes.length
    ? `<div class="rail-tagcloud">${themes.map(([t, n]) =>
        `<button class="rail-tagchip" data-theme="${esc(t)}">${esc(t)} <b>${n}</b></button>`).join('')}</div>`
    : '<div class="rail-empty">Themes appear here as posts are shared.</div>';

  rail.innerHTML = `
    <div class="rail-card">
      <div class="rpf-head">
        <div class="rpf-av">${esc(initialsOf(handle))}</div>
        <div class="rpf-id"><div class="rpf-handle"><span class="at">@</span>${esc(handle)}</div></div>
      </div>
      <div class="rpf-stats">
        <div><b>${myPosts}</b><span>POSTS</span></div>
        <div><b>${myFluffle.size}</b><span>FLUFFLE</span></div>
        <div><b>${followerCount}</b><span>FOLLOWERS</span></div>
      </div>
      <button class="rail-link" data-act="myprofile">VIEW PROFILE →</button>
    </div>
    <div class="rail-card">
      <h3>YOUR FLUFFLE</h3>
      ${fluffleHtml}
      <button class="rail-link" data-act="findwriters">FIND WRITERS →</button>
    </div>
    <div class="rail-card">
      <h3>THEMES</h3>
      ${themesHtml}
    </div>
    <div class="rail-card">
      <h3>KEEP THE WARREN WARM</h3>
      <p class="rail-note">Feedback is a gift. Be specific, be kind, and <b>quote the line</b> you are reacting to.</p>
    </div>`;

  rail.querySelector('[data-act="myprofile"]')?.addEventListener('click', () =>
    userProfileModal(currentUser.id, displayUsername()));
  rail.querySelector('[data-act="findwriters"]')?.addEventListener('click', () => {
    feedScope = 'all'; feedSort = 'popular'; feedSearch = '';
    renderCommunityTabs(); renderCommunityTools(); drawFeed();
    document.getElementById('communityArea')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  rail.querySelectorAll('.rfl-h').forEach(b =>
    b.addEventListener('click', () => userProfileModal(b.dataset.uid, b.dataset.uname)));
  rail.querySelectorAll('.rail-tagchip').forEach(b => b.addEventListener('click', () => {
    feedSearch = b.dataset.theme;
    renderCommunityTools(); drawFeed();
  }));
}

function visibleFeed() {
  const me = currentUser && currentUser.id;
  const scopeOk = p => feedScope === 'fluffle' ? myFluffle.has(p.user_id)
    : feedScope === 'mine' ? p.user_id === me
    : true;
  const q = feedSearch.trim().toLowerCase();
  const searchOk = p => {
    if (!q) return true;
    const hay = [p.username, p.context, p.hop_title, p.hop_body, p.project_name, p.project_type, p.project_genre,
      ...(p.themes || []), ...((p.entities || []).map(e => e.name))].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  };
  const list = feedCache.filter(p =>
    scopeOk(p) &&
    (!feedGenre || p.project_genre === feedGenre) &&
    (!feedType || p.project_type === feedType) &&
    searchOk(p));
  if (feedSort === 'popular') return [...list].sort((a, b) => b.likeCount - a.likeCount);
  return list;
}

function drawFeed() {
  const el = document.getElementById('communityFeed');
  if (!el) return;
  const noResults = document.getElementById('communityNoResults');
  const list = visibleFeed();
  if (!list.length) {
    if (feedSearch.trim()) {
      el.innerHTML = '';
      if (noResults) noResults.hidden = false;
      return;
    }
    const msg = feedScope === 'fluffle'
      ? 'No posts from your Fluffle yet. Add members from their profile.'
      : feedScope === 'mine'
      ? 'You have not shared any posts yet. Share a hop from its menu.'
      : ((feedGenre || feedType) ? 'No posts match these filters yet.' : 'No posts yet. Share a hop from its menu.');
    el.innerHTML = `<div class="feed-empty">${msg}</div>`;
    return;
  }
  if (noResults) noResults.hidden = true;
  const banner = feedSort === 'popular'
    ? `<div class="feed-popular-note"><span>MOST-LIKED HOPS</span><button data-act="clearpopular">← BACK TO RECENT</button></div>`
    : '';
  el.innerHTML = banner + list.map(feedCardHtml).join('');
  el.querySelector('[data-act="clearpopular"]')?.addEventListener('click', () => {
    feedSort = 'recent'; drawFeed();
  });
  list.forEach(p => wireFeedCard(el.querySelector(`.feed-card[data-id="${p.id}"]`), p));
  const fq = feedSearch.trim();
  if (fq) markSearchHits(el, fq, '.feed-context, .feed-hop-title, .feed-hop-body, .feed-user, .feed-crumb, .feed-theme');
  if (pendingFeedFocus) {
    const card = el.querySelector(`.feed-card[data-id="${pendingFeedFocus}"]`);
    pendingFeedFocus = null;
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 1600);
    }
  }
}

// Render a frozen character/location snapshot. Each entity is a collapsed row —
// just the colored name — that expands on click to reveal its overview (summary)
// and highlights (notes). Native <details> so it works with no JS wiring in the
// feed card, the post preview, and the manage-posts modal alike.
function entitySnapshotHtml(entities) {
  if (!entities || !entities.length) return '';
  const item = e => {
    const notes = (e.notes || []).map(n => `<li>${esc(n)}</li>`).join('');
    const hasBody = !!(e.summary || notes);
    return `<details class="ent-item">
      <summary class="ent-item-name" style="color:${e.color || 'var(--accent)'}">${esc(e.name)}</summary>
      <div class="ent-item-body">
        ${e.summary ? `<div class="ent-snap-overview">${esc(e.summary)}</div>` : ''}
        ${notes ? `<ul class="ent-snap-notes">${notes}</ul>` : ''}
        ${hasBody ? '' : '<div class="ent-snap-overview ent-snap-empty">No details added.</div>'}
      </div>
    </details>`;
  };
  const section = (label, kind) => {
    const items = entities.filter(e => e.kind === kind);
    if (!items.length) return '';
    return `<div class="ent-snap-group"><div class="ent-snap-label">${label}</div>${items.map(item).join('')}</div>`;
  };
  const body = section('CHARACTERS', 'character') + section('LOCATIONS', 'location');
  return body ? `<div class="ent-snap">${body}</div>` : '';
}

// Compact character / location chips shown inside a feed card hop box.
function feedEntityChipsHtml(entities) {
  if (!entities || !entities.length) return '';
  const group = (label, kind) => {
    const items = entities.filter(e => e.kind === kind);
    if (!items.length) return '';
    const chips = items.map(e =>
      `<span class="feed-ent-chip" style="--ec:${e.color || 'var(--accent)'}"><span class="dot"></span>${esc(e.name)}</span>`).join('');
    return `<div class="feed-ent-group"><div class="feed-ent-label">${label}</div><div class="feed-ent-chips">${chips}</div></div>`;
  };
  const body = group('CHARACTERS', 'character') + group('LOCATIONS', 'location');
  return body ? `<div class="feed-ent-sep"></div>${body}` : '';
}

// AI-assigned theme tags for a post; click drops the theme into the feed search.
function feedThemesHtml(themes) {
  if (!themes || !themes.length) return '';
  return `<div class="feed-themes">${themes.map(t =>
    `<button class="feed-theme" data-theme="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;
}

// Prominent project header for a post: name on its own line, type · genre beneath.
// Used by the focused single-post modals (VIEW FULL HOP / archived view).
function feedProjHtml(p) {
  const name = p.project_name || '';
  const meta = [p.project_type, p.project_genre].filter(Boolean).join(' · ');
  if (!name && !meta) return '';
  return `<div class="feed-proj">
    ${name ? `<span class="feed-proj-name">${esc(name)}</span>` : ''}
    ${meta ? `<span class="feed-proj-meta">${esc(meta)}</span>` : ''}
  </div>`;
}

// Inline line icon for a project type, shown in the avatar slot so each post
// reads as a BOOK / MOVIE / JOURNAL etc. at a glance instead of a generic face.
function projectTypeIcon(type) {
  const P = {
    book: '<path d="M8 4.3C6.7 3.5 5 3.1 3.2 3.1H2.3v8.9h1c1.7 0 3.4.4 4.7 1.2M8 4.3c1.3-.8 3-1.2 4.8-1.2h.9v8.9h-1c-1.7 0-3.4.4-4.7 1.2M8 4.3v8.9"/>',
    movie: '<rect x="2.4" y="3" width="11.2" height="10"/><path d="M5.2 3v10M10.8 3v10M2.4 6.3h2.8M2.4 9.6h2.8M10.8 6.3h2.8M10.8 9.6h2.8"/>',
    play: '<path d="M2.8 3.3c0 6 2.1 8.7 5.2 8.7s5.2-2.7 5.2-8.7z"/><circle cx="6" cy="6" r=".55"/><circle cx="10" cy="6" r=".55"/><path d="M6.2 8.6c1 1 2.6 1 3.6 0"/>',
    show: '<rect x="2.3" y="3.6" width="11.4" height="8"/><path d="M6 13.4h4M8 11.6v1.8"/>',
    'short story': '<path d="M4 2.4h5l3 3v8.2H4z"/><path d="M9 2.4v3h3M6 8h4M6 10.4h4"/>',
    journal: '<rect x="4" y="2.4" width="8.4" height="11.2"/><path d="M4 5.2H2.6M4 8H2.6M4 10.8H2.6M6.8 5.6h3.2M6.8 8h3.2"/>',
    other: '<rect x="3.4" y="2.5" width="9.2" height="11"/><path d="M5.5 5.8h5M5.5 8.2h5M5.5 10.6h3"/>'
  };
  const paths = P[(type || '').toLowerCase()] || P.other;
  return `<svg viewBox="0 0 16 16" aria-hidden="true">${paths}</svg>`;
}

// Audience pill with a globe (public) or lock (fluffle) glyph.
function feedVisHtml(p) {
  const fluffle = p.visibility === 'fluffle';
  const icon = fluffle
    ? '<svg viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="6.3"/><path d="M5.6 7V5a2.4 2.4 0 0 1 4.8 0v2"/></svg>'
    : '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2"/><path d="M1.8 8H14.2M8 1.8C10 4 10 12 8 14.2 6 12 6 4 8 1.8"/></svg>';
  return `<span class="feed-vis" title="${fluffle ? 'Visible to your Fluffle' : 'Visible to everyone'}">${icon}<span>${visibilityLabel(p.visibility)}</span></span>`;
}

// Quiet source breadcrumb: PROJECT / TYPE / GENRE.
function feedCrumbHtml(p) {
  const segs = [];
  if (p.project_name) segs.push(`<span class="proj">${esc(p.project_name)}</span>`);
  if (p.project_type) segs.push(`<span class="seg">${esc(p.project_type.toUpperCase())}</span>`);
  if (p.project_genre) segs.push(`<span class="seg">${esc(p.project_genre.toUpperCase())}</span>`);
  if (!segs.length) return '';
  return `<div class="feed-crumb">${segs.join('<span class="div">/</span>')}</div>`;
}

function feedCardHtml(p) {
  const mine = currentUser && p.user_id === currentUser.id;
  const archived = p.status === 'closed';
  const comments = p.comments.map(c =>
    `<div class="feed-comment">${c.user_id
      ? `<button class="feed-comment-user" data-uid="${esc(c.user_id)}" data-uname="${esc(c.username)}">@${esc(c.username)}</button>`
      : `<span class="feed-comment-user">@${esc(c.username)}</span>`} ${esc(c.body)}</div>`).join('');
  const accentStyle = ` style="--accent:${esc(p.accent || DEFAULT_ACCENT)}"`;
  return `
  <article class="feed-card"${accentStyle} data-id="${p.id}">
    <div class="feed-head">
      <div class="feed-avatar" title="${esc(p.project_type || 'Project')}">${projectTypeIcon(p.project_type)}</div>
      <div class="feed-who">
        <div class="feed-who-line">
          <button class="feed-user" data-f="user"><span class="at">@</span>${esc(p.username)}</button>
          ${myFluffle.has(p.user_id) ? '<span class="feed-fluffle-tag" title="In your Fluffle">★</span>' : ''}
          <span class="feed-dotsep"></span>
          <span class="feed-time">${timeAgo(p.created_at)}</span>
        </div>
        ${feedCrumbHtml(p)}
      </div>
      <div class="feed-head-r">
        ${mine ? `${archived ? '<span class="mp-status closed">ARCHIVED</span>' : ''}${feedVisHtml(p)}
        <details class="hop-kebab feed-kebab"><summary>⋮</summary><div class="hop-menu">
          <button class="add-btn" data-f="editpost">EDIT</button>
          <button class="add-btn" data-f="${archived ? 'reactivatepost' : 'archivepost'}">${archived ? 'REACTIVATE' : 'ARCHIVE'}</button>
          <button class="add-btn danger" data-f="delpost">DELETE</button>
        </div></details>` : ''}
      </div>
    </div>
    ${p.context ? `<p class="feed-context">${esc(p.context)}</p>` : ''}
    <div class="feed-hop" data-f="hopbox">
      ${p.hop_title ? `<div class="feed-hop-title">${esc(p.hop_title)}</div>` : ''}
      <div class="feed-hop-body clamp">${esc(p.hop_body)}</div>
      <button class="feed-view" data-f="viewhop" hidden>VIEW FULL HOP <span>→</span></button>
      ${feedEntityChipsHtml(p.entities)}
    </div>
    ${feedThemesHtml(p.themes)}
    <div class="feed-actions">
      <button class="feed-btn like ${p.likedByMe ? 'on' : ''}" data-f="like">
        <svg class="fa-ic" viewBox="0 0 20 20"><path class="fa-heart" d="M10,17 C10,17 2.5,12.2 2.5,7.2 C2.5,4.6 4.5,3 6.6,3 C8.2,3 9.4,4 10,5.2 C10.6,4 11.8,3 13.4,3 C15.5,3 17.5,4.6 17.5,7.2 C17.5,12.2 10,17 10,17 Z"/></svg>
        <span class="n">${p.likeCount}</span>
      </button>
      <button class="feed-btn cmt ${p.commentsOpen ? 'on' : ''}" data-f="comments">
        <svg class="fa-ic" viewBox="0 0 20 20"><path class="fa-bubble" d="M3,4 H17 V14 H8 L4,17.5 V14 H3 Z"/></svg>
        <span>COMMENT</span> <span class="n">${p.comments.length}</span>
      </button>
    </div>
    <div class="feed-comments" ${p.commentsOpen ? '' : 'hidden'}>
      ${comments}
      <div class="feed-comment-add">
        <input type="text" class="feed-comment-input" placeholder="Add a comment…" maxlength="280" />
        <button class="add-btn feed-comment-send">SEND</button>
      </div>
    </div>
  </article>`;
}

function wireFeedCard(card, p) {
  if (!card) return;
  const bodyEl = card.querySelector('.feed-hop-body');
  const viewBtn = card.querySelector('[data-f="viewhop"]');
  if (bodyEl && viewBtn && bodyEl.scrollHeight - bodyEl.clientHeight > 4) viewBtn.hidden = false;
  card.querySelector('[data-f="hopbox"]')?.addEventListener('click', () => viewHopModal(p));
  card.querySelectorAll('.feed-theme').forEach(b => b.addEventListener('click', () => {
    feedSearch = b.dataset.theme;
    renderCommunityTools(); drawFeed();
  }));
  card.querySelector('[data-f="user"]')?.addEventListener('click', () => userProfileModal(p.user_id, p.username));
  card.querySelectorAll('button.feed-comment-user').forEach(b =>
    b.addEventListener('click', () => userProfileModal(b.dataset.uid, b.dataset.uname)));
  card.querySelector('[data-f="like"]').addEventListener('click', () => toggleLike(p));
  card.querySelector('[data-f="comments"]').addEventListener('click', () => {
    p.commentsOpen = !p.commentsOpen; drawFeed();
  });
  const kebab = card.querySelector('.feed-kebab');
  if (kebab) kebab.addEventListener('toggle', () => { if (kebab.open) positionHopMenu(kebab); });
  card.querySelector('[data-f="editpost"]')?.addEventListener('click', () => {
    if (kebab) kebab.open = false;
    editPostVisibilityModal(p, drawFeed);
  });
  card.querySelector('[data-f="archivepost"]')?.addEventListener('click', () => {
    if (kebab) kebab.open = false;
    archivePostFromFeed(p);
  });
  const delBtn = card.querySelector('[data-f="delpost"]');
  if (delBtn) delBtn.addEventListener('click', () => { if (kebab) kebab.open = false; deletePost(p); });
  const input = card.querySelector('.feed-comment-input');
  const send = card.querySelector('.feed-comment-send');
  if (send) send.addEventListener('click', () => addComment(p, input));
  if (input) input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addComment(p, input); }
  });
}

async function toggleLike(p, redraw = drawFeed) {
  if (!currentUser) return;
  if (p.likedByMe) {
    p.likedByMe = false; p.likeCount = Math.max(0, p.likeCount - 1); redraw();
    await sb.from('community_likes').delete().eq('post_id', p.id).eq('user_id', currentUser.id);
  } else {
    p.likedByMe = true; p.likeCount += 1; redraw();
    await sb.from('community_likes').insert({ post_id: p.id, user_id: currentUser.id });
  }
}

async function addComment(p, input, redraw = drawFeed) {
  if (!currentUser || !input) return;
  const body = input.value.trim();
  if (!body) return;
  const username = displayUsername();
  if (!username) { alertModal('Set a username first to comment.', { title: 'COMMENT' }); return; }
  input.value = '';
  const { data, error } = await sb.from('community_comments')
    .insert({ post_id: p.id, user_id: currentUser.id, username, body }).select().single();
  if (error) { alertModal('Could not comment.', { title: 'COMMENT' }); return; }
  p.comments.push(data); p.commentsOpen = true; redraw();
}

// Full, un-clamped view of a post's hop opened from the feed's VIEW button.
// Wide (matches ADD HOP), tinted in the post's project accent, with the full
// comment chain and an inline add-comment box.
function viewHopModal(p) {
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  const accent = p.accent || DEFAULT_ACCENT;
  overlay.innerHTML = `
    <div class="ui-modal vh-modal" style="--accent:${esc(accent)}">
      <button class="ui-modal-x" data-act="close" title="Close">✕</button>
      <div class="ui-modal-title">${p.hop_title ? esc(p.hop_title) : 'HOP'}</div>
      <div class="ui-modal-scroll">
        ${feedProjHtml(p)}
        ${p.context ? `<div class="feed-context">${esc(p.context)}</div>` : ''}
        <div class="feed-hop-body">${esc(p.hop_body)}</div>
        ${entitySnapshotHtml(p.entities)}
        <div class="vh-comments">
          <div class="vh-comments-head">COMMENTS <span class="vh-comment-count">${p.comments.length}</span></div>
          <div class="vh-comment-list"></div>
          <div class="feed-comment-add">
            <input type="text" class="feed-comment-input" placeholder="Add a comment…" maxlength="280" />
            <button class="add-btn feed-comment-send">SEND</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="close"]').addEventListener('click', close);

  const list = overlay.querySelector('.vh-comment-list');
  const renderComments = () => {
    list.innerHTML = p.comments.map(c =>
      `<div class="feed-comment">${c.user_id
        ? `<button class="feed-comment-user" data-uid="${esc(c.user_id)}" data-uname="${esc(c.username)}">@${esc(c.username)}</button>`
        : `<span class="feed-comment-user">@${esc(c.username)}</span>`} ${esc(c.body)}</div>`).join('')
      || '<div class="feed-empty">No comments yet.</div>';
    list.querySelectorAll('button.feed-comment-user').forEach(b =>
      b.addEventListener('click', () => userProfileModal(b.dataset.uid, b.dataset.uname)));
    const cnt = overlay.querySelector('.vh-comment-count');
    if (cnt) cnt.textContent = p.comments.length;
  };
  renderComments();

  const input = overlay.querySelector('.feed-comment-input');
  const submit = async () => { await addComment(p, input); renderComments(); };
  overlay.querySelector('.feed-comment-send').addEventListener('click', submit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
}

async function deletePost(p) {
  if (!await confirmModal('Delete this post?')) return;
  const { error } = await sb.from('community_posts').delete().eq('id', p.id);
  if (error) { alertModal('Could not delete.', { title: 'DELETE' }); return; }
  feedCache = feedCache.filter(x => x.id !== p.id);
  drawFeed();
}

// Change only a post's audience (FOR EVERYONE vs MY FLUFFLE). Title, body, and
// entity snapshot are frozen at post time, so EDIT exposes nothing else.
function editPostVisibilityModal(p, onSaved) {
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  const cur = p.visibility === 'fluffle' ? 'fluffle' : 'public';
  overlay.innerHTML = `
    <div class="ui-modal">
      <div class="ui-modal-title">EDIT POST</div>
      <div class="ui-modal-scroll">
        <div class="post-field">
          <span class="post-field-head">WHO CAN SEE THIS</span>
          <div class="vis-opts" id="editVis">
            <button type="button" class="vis-btn ${cur === 'public' ? 'active' : ''}" data-vis="public">FOR EVERYONE</button>
            <button type="button" class="vis-btn ${cur === 'fluffle' ? 'active' : ''}" data-vis="fluffle">MY FLUFFLE ONLY</button>
          </div>
        </div>
        <p class="vis-note">Only the audience can be changed. The hop text and its characters and locations are frozen from when you posted.</p>
      </div>
      <div class="ui-modal-actions">
        <button class="ui-modal-btn" data-act="cancel">Cancel</button>
        <button class="ui-modal-btn solid" data-act="save">SAVE</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  let visibility = cur;
  overlay.querySelectorAll('#editVis .vis-btn').forEach(b => b.addEventListener('click', () => {
    visibility = b.dataset.vis;
    overlay.querySelectorAll('#editVis .vis-btn').forEach(x => x.classList.toggle('active', x === b));
  }));
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
  overlay.querySelector('[data-act="save"]').addEventListener('click', async () => {
    const btn = overlay.querySelector('[data-act="save"]');
    btn.disabled = true; btn.textContent = 'SAVING…';
    const { error } = await sb.from('community_posts').update({ visibility }).eq('id', p.id);
    if (error) { btn.disabled = false; btn.textContent = 'SAVE'; alertModal('Could not update.', { title: 'EDIT POST' }); return; }
    p.visibility = visibility;
    close();
    if (onSaved) onSaved();
  });
}

// Archive (hide from the community) one of your own posts, updating the local
// feed cache so it disappears from the feed without a full reload.
async function archivePostFromFeed(p) {
  if (!await confirmModal('Archive this post? It will no longer be viewable to the community, but you keep full access to it from your profile.', { title: 'ARCHIVE POST', okText: 'Archive', danger: false })) return;
  const { error } = await sb.from('community_posts').update({ status: 'closed' }).eq('id', p.id);
  if (error) { alertModal('Could not archive.', { title: 'ARCHIVE' }); return; }
  feedCache = feedCache.filter(x => x.id !== p.id);
  drawFeed(); loadHopPostCounts();
}

// Human label for a post's audience setting.
function visibilityLabel(v) { return v === 'fluffle' ? 'MY FLUFFLE' : 'FOR EVERYONE'; }

// All of a hop's community posts (open + closed), owned by the current user, with
// per-post like/comment activity and CLOSE / REOPEN / DELETE controls. CLOSE hides
// a post from the community but keeps the record here; DELETE is a hard delete.
async function managePostsModal(chunk) {
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  overlay.innerHTML = `
    <div class="ui-modal">
      <div class="ui-modal-title">COMMUNITY POSTS</div>
      <div class="ui-modal-scroll" id="mpScroll"><div class="feed-empty">Loading…</div></div>
      <div class="ui-modal-actions">
        <button class="ui-modal-btn" data-act="close">Done</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="close"]').addEventListener('click', close);
  const scroll = overlay.querySelector('#mpScroll');

  async function load() {
    const { data: posts, error } = await sb.from('community_posts')
      .select('*').eq('chunk_id', chunk.id).eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });
    if (error) { scroll.innerHTML = '<div class="feed-empty">Could not load posts.</div>'; return; }
    if (!posts.length) {
      scroll.innerHTML = '<div class="feed-empty">No posts for this hop yet. Use ↗ POST to share it.</div>';
      return;
    }
    const ids = posts.map(p => p.id);
    const [lr, cr] = await Promise.all([
      sb.from('community_likes').select('post_id').in('post_id', ids),
      sb.from('community_comments').select('post_id').in('post_id', ids)
    ]);
    const likes = lr.data || [], comments = cr.data || [];
    const active = posts.filter(p => p.status !== 'closed').length;
    scroll.innerHTML =
      `<div class="mp-count">${active} active · ${posts.length} total</div>` +
      posts.map(p => {
        const lc = likes.filter(l => l.post_id === p.id).length;
        const cc = comments.filter(c => c.post_id === p.id).length;
        const closed = p.status === 'closed';
        const sample = (p.hop_body || '').slice(0, 180);
        const snippet = sample + ((p.hop_body || '').length > 180 ? '…' : '');
        return `
        <div class="mp-post ${closed ? 'is-closed' : ''}" data-id="${p.id}">
          <div class="mp-head">
            <span class="mp-status ${closed ? 'closed' : 'active'}">${closed ? 'ARCHIVED' : 'ACTIVE'}</span>
            <span class="mp-time">${timeAgo(p.created_at)}</span>
          </div>
          ${p.context ? `<div class="mp-context">${esc(p.context)}</div>` : ''}
          <div class="mp-sample">${esc(snippet) || '<span class="muted">(no content)</span>'}</div>
          <div class="mp-activity">♥ ${lc} · COMMENTS ${cc}</div>
          <div class="mp-actions">
            ${closed
              ? '<button class="add-btn" data-f="viewarchived">VIEW POST</button>'
              : '<button class="add-btn" data-f="viewpost">VIEW POST</button>'}
            ${closed
              ? '<button class="add-btn" data-f="reopen">REACTIVATE</button>'
              : '<button class="add-btn" data-f="archive">ARCHIVE</button>'}
            <button class="add-btn danger" data-f="delete">DELETE</button>
          </div>
        </div>`;
      }).join('');
    posts.forEach(p => {
      const row = scroll.querySelector(`.mp-post[data-id="${p.id}"]`);
      if (!row) return;
      row.querySelector('[data-f="viewpost"]')?.addEventListener('click', () => {
        close(); gotoCommunityPost(p.id);
      });
      row.querySelector('[data-f="viewarchived"]')?.addEventListener('click', () => viewArchivedPostModal(p));
      row.querySelector('[data-f="archive"]')?.addEventListener('click', async () => {
        if (!await confirmModal('Archive this post? It will no longer be viewable to the community, but you keep full access to it here.', { title: 'ARCHIVE POST', okText: 'Archive', danger: false })) return;
        await sb.from('community_posts').update({ status: 'closed' }).eq('id', p.id);
        load(); loadHopPostCounts();
        if (currentRoute() === 'community') renderCommunity();
      });
      row.querySelector('[data-f="reopen"]')?.addEventListener('click', async () => {
        await sb.from('community_posts').update({ status: 'open' }).eq('id', p.id);
        load(); loadHopPostCounts();
        if (currentRoute() === 'community') renderCommunity();
      });
      row.querySelector('[data-f="delete"]')?.addEventListener('click', async () => {
        if (!await confirmModal('Delete this post permanently? This cannot be undone.')) return;
        await sb.from('community_posts').delete().eq('id', p.id);
        load(); loadHopPostCounts();
        if (currentRoute() === 'community') renderCommunity();
      });
    });
  }
  load();
}

// Read-only detail view for an archived post: its hop, entity snapshot, and the
// full comment thread. Archived posts are hidden from the community feed, so this
// is the only place their owner can revisit the discussion they generated.
async function viewArchivedPostModal(p) {
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  overlay.innerHTML = `
    <div class="ui-modal" style="--accent:${esc(p.accent || DEFAULT_ACCENT)}">
      <div class="ui-modal-title">${p.hop_title ? esc(p.hop_title) : 'ARCHIVED POST'}</div>
      <div class="ui-modal-scroll" id="apScroll"><div class="feed-empty">Loading…</div></div>
      <div class="ui-modal-actions">
        <button class="ui-modal-btn" data-act="close">Done</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="close"]').addEventListener('click', close);
  const scroll = overlay.querySelector('#apScroll');

  const [lr, cr] = await Promise.all([
    sb.from('community_likes').select('post_id').eq('post_id', p.id),
    sb.from('community_comments').select('*').eq('post_id', p.id).order('created_at', { ascending: true })
  ]);
  const lc = (lr.data || []).length;
  const comments = cr.data || [];
  const commentsHtml = comments.length
    ? comments.map(c => `<div class="feed-comment"><span class="feed-comment-user">@${esc(c.username)}</span> ${esc(c.body)}</div>`).join('')
    : '<div class="feed-empty">No comments on this post.</div>';

  scroll.innerHTML = `
    <div class="mp-head"><span class="mp-status closed">ARCHIVED</span><span class="mp-time">${timeAgo(p.created_at)}</span></div>
    ${feedProjHtml(p)}
    ${p.context ? `<div class="feed-context">${esc(p.context)}</div>` : ''}
    <div class="feed-hop-body">${esc(p.hop_body)}</div>
    ${entitySnapshotHtml(p.entities)}
    <div class="mp-activity">♥ ${lc} · COMMENTS ${comments.length}</div>
    <div class="feed-comments">${commentsHtml}</div>`;
}

// Jump to the community feed and bring a specific post into view, flashing it.
// Filters are reset so the target is never hidden by an active scope/genre.
function gotoCommunityPost(postId) {
  pendingFeedFocus = postId;
  feedScope = 'all'; feedGenre = '';
  if (currentRoute() === 'community') { renderCommunity(); }
  else { location.hash = '#community'; }
}

// A community member's public page: their handle, community activity, the
// projects they've shared (community DB only), their posts, and an ADD TO
// FLUFFLE toggle that favorites them.
async function userProfileModal(userId, username) {
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  overlay.innerHTML = `
    <div class="ui-modal up-modal">
      <button class="ui-modal-x" data-act="close" title="Close">✕</button>
      <div class="ui-modal-title">@${esc(username || '')}</div>
      <div class="ui-modal-scroll" id="upScroll"><div class="feed-empty">Loading…</div></div>
      <div class="ui-modal-actions">
        <button class="ui-modal-btn" data-act="close">Done</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('[data-act="close"]').forEach(b => b.addEventListener('click', close));
  const scroll = overlay.querySelector('#upScroll');
  const isSelf = currentUser && userId === currentUser.id;

  let postsQuery = sb.from('community_posts')
    .select('*').eq('user_id', userId).order('created_at', { ascending: false });
  if (!isSelf) postsQuery = postsQuery.eq('status', 'open');
  const { data: posts, error } = await postsQuery;
  if (error) { scroll.innerHTML = '<div class="feed-empty">Could not load this profile.</div>'; return; }

  const ids = posts.map(p => p.id);
  let likeTotal = 0, commentTotal = 0, allComments = [], likeRows = [];
  if (ids.length) {
    const [lr, cr] = await Promise.all([
      sb.from('community_likes').select('post_id, user_id').in('post_id', ids),
      sb.from('community_comments').select('*').in('post_id', ids).order('created_at', { ascending: true })
    ]);
    likeRows = lr.data || [];
    likeTotal = likeRows.length;
    allComments = cr.data || [];
    commentTotal = allComments.length;
  }
  const { count: followers } = await sb.from('community_follows')
    .select('user_id', { count: 'exact', head: true }).eq('friend_id', userId);
  const followerTotal = followers || 0;
  const liveAccent = await resolveLivePostAccents(posts);
  const meId = currentUser && currentUser.id;
  posts.forEach(p => {
    p.comments = allComments.filter(c => c.post_id === p.id);
    p.accent = liveAccent[p.chunk_id] || p.accent || DEFAULT_ACCENT;
    p.likeCount = likeRows.filter(l => l.post_id === p.id).length;
    p.likedByMe = likeRows.some(l => l.post_id === p.id && l.user_id === meId);
    p.commentsOpen = false;
  });
  const projects = [...new Map(posts
    .filter(p => p.project_name)
    .map(p => [p.project_name, { name: p.project_name, meta: [p.project_type, p.project_genre].filter(Boolean).join(' · ') }]))
    .values()];

  // Hop streak — live for yourself, published value (if still standing) for others.
  let streakVal = 0;
  if (isSelf) {
    streakVal = computeStreak(writingDaysCache);
  } else {
    const { data: sd } = await sb.from('community_stats')
      .select('hop_streak, streak_day').eq('user_id', userId).maybeSingle();
    if (sd && sd.streak_day) {
      const today = localDayKey();
      const yd = new Date(); yd.setDate(yd.getDate() - 1);
      if (sd.streak_day === today || sd.streak_day === localDayKey(yd)) streakVal = sd.hop_streak || 0;
    }
  }

  function fluffleBtnHtml() {
    if (isSelf) return '';
    const inFluffle = myFluffle.has(userId);
    return `<button class="up-fluffle ${inFluffle ? 'on' : ''}" data-f="fluffle">${inFluffle ? '★ IN YOUR FLUFFLE' : '☆ ADD TO FLUFFLE'}</button>`;
  }

  function render() {
    scroll.innerHTML = `
      <div class="up-head">
        <div class="up-stats">
          <span class="up-streak" title="Consecutive days with a new hop">${RABBIT_ICON}<strong>${streakVal}</strong> hop streak</span>
          <span><strong>${posts.length}</strong> posts</span>
          <span><strong>${followerTotal}</strong> followers</span>
          <span><strong>${projects.length}</strong> projects</span>
          <span><strong>${likeTotal}</strong> ♥</span>
          <span><strong>${commentTotal}</strong> comments</span>
        </div>
        ${fluffleBtnHtml()}
      </div>
      ${projects.length ? `<div class="up-section">
        <div class="up-label">PROJECTS</div>
        ${projects.map(pr => `<div class="up-proj"><span class="up-proj-name">${esc(pr.name)}</span>${pr.meta ? `<span class="up-proj-meta">${esc(pr.meta)}</span>` : ''}</div>`).join('')}
      </div>` : ''}
      <div class="up-section">
        <div class="up-label">POSTS</div>
        <div class="up-feed" id="upFeed"></div>
      </div>`;
    scroll.querySelector('[data-f="fluffle"]')?.addEventListener('click', async () => {
      if (myFluffle.has(userId)) {
        myFluffle.delete(userId); fluffleNames.delete(userId);
        await sb.from('community_follows').delete().eq('user_id', currentUser.id).eq('friend_id', userId);
      } else {
        myFluffle.add(userId); fluffleNames.set(userId, username || '');
        await sb.from('community_follows').insert({ user_id: currentUser.id, friend_id: userId, friend_username: username || '' });
      }
      updateFluffleCount();
      render();
      if (currentRoute() === 'community') { renderCommunityTabs(); drawFeed(); renderCommunityRail(); }
    });
    drawUpFeed();
  }

  // Render the profile's posts exactly as they appear in the community feed,
  // wired to a profile-local redraw so likes/comments and own-post management
  // update inside the modal instead of the page behind it.
  function drawUpFeed() {
    const feedEl = scroll.querySelector('#upFeed');
    if (!feedEl) return;
    if (!posts.length) {
      feedEl.innerHTML = `<div class="feed-empty">${isSelf ? 'You have not shared any posts yet.' : 'No public posts.'}</div>`;
      return;
    }
    feedEl.innerHTML = posts.map(feedCardHtml).join('');
    posts.forEach(p => wireUpCard(feedEl.querySelector(`.feed-card[data-id="${p.id}"]`), p));
  }

  function wireUpCard(card, p) {
    if (!card) return;
    const bodyEl = card.querySelector('.feed-hop-body');
    const viewBtn = card.querySelector('[data-f="viewhop"]');
    if (bodyEl && viewBtn && bodyEl.scrollHeight - bodyEl.clientHeight > 4) viewBtn.hidden = false;
    const openHop = () => (p.status === 'closed' ? viewArchivedPostModal(p) : viewHopModal(p));
    card.querySelector('[data-f="hopbox"]')?.addEventListener('click', openHop);
    card.querySelector('[data-f="user"]')?.addEventListener('click', () => userProfileModal(p.user_id, p.username));
    card.querySelectorAll('button.feed-comment-user').forEach(b =>
      b.addEventListener('click', () => userProfileModal(b.dataset.uid, b.dataset.uname)));
    card.querySelector('[data-f="like"]').addEventListener('click', () => toggleLike(p, drawUpFeed));
    card.querySelector('[data-f="comments"]').addEventListener('click', () => { p.commentsOpen = !p.commentsOpen; drawUpFeed(); });
    const kebab = card.querySelector('.feed-kebab');
    if (kebab) kebab.addEventListener('toggle', () => { if (kebab.open) positionHopMenu(kebab); });
    card.querySelector('[data-f="editpost"]')?.addEventListener('click', () => {
      if (kebab) kebab.open = false;
      editPostVisibilityModal(p, () => {
        drawUpFeed();
        if (currentRoute() === 'community') { feedCache = feedCache.map(x => x.id === p.id ? { ...x, visibility: p.visibility } : x); drawFeed(); }
      });
    });
    card.querySelector('[data-f="archivepost"]')?.addEventListener('click', async () => {
      if (kebab) kebab.open = false;
      if (!await confirmModal('Archive this post? It will no longer be viewable to the community, but you keep full access to it from your profile.', { title: 'ARCHIVE POST', okText: 'Archive', danger: false })) return;
      const { error } = await sb.from('community_posts').update({ status: 'closed' }).eq('id', p.id);
      if (error) { alertModal('Could not archive.', { title: 'ARCHIVE' }); return; }
      p.status = 'closed';
      feedCache = feedCache.filter(x => x.id !== p.id);
      drawUpFeed(); loadHopPostCounts();
      if (currentRoute() === 'community') drawFeed();
    });
    card.querySelector('[data-f="reactivatepost"]')?.addEventListener('click', async () => {
      if (kebab) kebab.open = false;
      const { error } = await sb.from('community_posts').update({ status: 'open' }).eq('id', p.id);
      if (error) { alertModal('Could not reactivate.', { title: 'REACTIVATE' }); return; }
      p.status = 'open';
      drawUpFeed(); loadHopPostCounts();
      if (currentRoute() === 'community') renderCommunity();
    });
    card.querySelector('[data-f="delpost"]')?.addEventListener('click', async () => {
      if (kebab) kebab.open = false;
      if (!await confirmModal('Delete this post permanently? This cannot be undone.')) return;
      const { error } = await sb.from('community_posts').delete().eq('id', p.id);
      if (error) { alertModal('Could not delete.', { title: 'DELETE' }); return; }
      const i = posts.indexOf(p); if (i >= 0) posts.splice(i, 1);
      feedCache = feedCache.filter(x => x.id !== p.id);
      drawUpFeed(); loadHopPostCounts();
      if (currentRoute() === 'community') drawFeed();
    });
    const input = card.querySelector('.feed-comment-input');
    const send = card.querySelector('.feed-comment-send');
    if (send) send.addEventListener('click', () => addComment(p, input, drawUpFeed));
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addComment(p, input, drawUpFeed); } });
  }
  render();
}

window.addEventListener('hashchange', route);

/* ---------------- DRAWER ---------------- */
const drawer = document.getElementById('drawer');
const overlay = document.getElementById('drawerOverlay');
const drawerToggle = document.getElementById('drawerToggle');
function openDrawer() { drawer.classList.add('open'); overlay.classList.add('show'); drawerToggle.classList.add('is-open'); }
function closeDrawer() { drawer.classList.remove('open'); overlay.classList.remove('show'); drawerToggle.classList.remove('is-open'); }
drawerToggle.addEventListener('click', () => { drawer.classList.contains('open') ? closeDrawer() : openDrawer(); });
overlay.addEventListener('click', closeDrawer);

/* ---------------- GLOBAL ADD HOP ---------------- */
// Create a hop from anywhere via the header CTA, then open it in the modal so
// the author can write and run per-hop detection without leaving the page.
function addHopGlobal() {
  if (!activeProjectId) { alertModal('Open a project first.', { title: 'ADD HOP' }); return; }
  if (!db.chapters.length) {
    db.chapters.push({ id: uid(), title: 'Chapter 1', order: 0, color: CHAPTER_PALETTE[0] });
  }
  const chapterId = (db.ui.activeChapter && db.chapters.some(c => c.id === db.ui.activeChapter))
    ? db.ui.activeChapter : db.chapters[0].id;
  const id = uid();
  // Held as a draft — only committed to the project when SAVE is clicked.
  draftChunk = {
    id, chapterId, title: '', body: '',
    orderInChapter: chunksOf(chapterId).length,
    narrativeOrder: db.chunks.length,
    chronoOrder: db.chunks.length,
    chronoLabel: '', characterIds: [], locationIds: [], tagIds: []
  };
  openChunkModal(id);
}
document.getElementById('addHopBtn').addEventListener('click', addHopGlobal);
document.getElementById('addPracticeHopBtn')?.addEventListener('click', addPracticeHopFlow);

/* ---------------- HEADER META ---------------- */
function renderHeaderMeta() {
  const words = db.chunks.reduce((n, c) => n + (c.body || '').trim().split(/\s+/).filter(Boolean).length, 0);
  document.getElementById('headerMeta').textContent =
    `${db.chunks.length} hops · ${words.toLocaleString()} words`;
}

/* =====================================================================
   SECTIONS
   ===================================================================== */
// transient UI state (not persisted): which chunks are expanded for read-only
// preview in display mode. Editing always happens in the chunk modal.
const expandedChunks = new Set();

// SECTIONS has two levels: the BOARD (every section as a swimlane of hop cards)
// and the per-section DETAIL editor (today's hop list). 'board' is the default;
// clicking a section drills into 'detail', BACK returns to 'board'. Transient so
// navigating to SECTIONS always lands on the board.
let sectionsMode = 'board';
// Section OVERVIEW (characters/locations/tags/events panel) open state. Collapsed
// by default, and remembered across re-renders so expanding a hop — which re-renders
// the whole pane — never reopens it.
let sectionSummaryOpen = false;

function chunksOf(chapterId) {
  return db.chunks
    .filter(c => c.chapterId === chapterId)
    .sort((a, b) => (a.orderInChapter ?? 0) - (b.orderInChapter ?? 0));
}

// Archived chunks are hidden everywhere unless the SHOW ARCHIVED toggle is on.
function isVisibleChunk(c) { return !!db.ui.showArchived || !c.archived; }

// How many archived hops the current view can reveal: the active section's on
// the SECTIONS view (that list only shows its own chapter), the whole project
// elsewhere (timelines and entity views span every section).
function archivedRevealCount() {
  // In the per-section DETAIL editor, scope the count to the open section.
  // On the SECTIONS board (and everywhere else) count the whole project.
  if (currentRoute() === 'sections' && sectionsMode === 'detail') {
    const id = db.ui.activeChapter;
    return id ? db.chunks.filter(c => c.chapterId === id && c.archived).length : 0;
  }
  return db.chunks.filter(c => c.archived).length;
}

// Sync every SHOW/HIDE ARCHIVED toggle button to the shared ui state, with a
// count of how many archived items the toggle would reveal.
function updateArchiveToggles() {
  const on = !!db.ui.showArchived;
  const n = archivedRevealCount();
  document.querySelectorAll('[data-arch]').forEach(btn => {
    btn.textContent = (on ? 'HIDE ARCHIVED' : 'SHOW ARCHIVED') + ' (' + n + ')';
    btn.classList.toggle('on', on);
  });
}

function renderSections() {
  const board = document.getElementById('sectionsBoard');
  const detail = document.getElementById('sectionsDetail');
  if (!board || !detail) return;
  const haveActive = db.chapters.some(c => c.id === db.ui.activeChapter);
  if (sectionsMode === 'detail' && haveActive) {
    board.hidden = true; detail.hidden = false;
    renderSectionDetail();
  } else {
    sectionsMode = 'board';
    detail.hidden = true; board.hidden = false;
    renderSectionsBoard();
  }
  updateArchiveToggles();
}

// Drill into a section: set it active and show the full hop editor (detail).
function openSectionDetail(chapterId) {
  if (!db.chapters.some(c => c.id === chapterId)) return;
  db.ui.activeChapter = chapterId;
  sectionSearchQuery = '';
  sectionsMode = 'detail';
  save();
  renderSections();
}

// BOARD: one swimlane per section, each holding its hop cards. Cards carry a
// pencil (inline rename) and a kebab (full hop options); a plain click opens the
// hop modal. Clicking the lane header drills into that section's editor.
function renderSectionsBoard() {
  const stage = document.getElementById('sectionsBoardStage');
  if (!stage) return;
  const chapters = [...db.chapters].sort((a, b) => a.order - b.order);
  if (!chapters.length) {
    stage.innerHTML = `<div class="pane-empty">No sections yet. Use + ADD SECTION to begin.</div>`;
    return;
  }
  let nOrd = 0; // running narrative position across every lane, in reading order
  stage.innerHTML = `<div class="kanban sb-kanban">` + chapters.map(ch => {
    const color = chapterColor(ch.id);
    const hops = chunksOf(ch.id).filter(isVisibleChunk);
    const cards = hops.map(c => {
      const ord = ++nOrd;
      return `
      <div class="tl-kanban-card sb-card ${c.archived ? 'archived' : ''}" data-id="${c.id}" draggable="true" style="border-left:3px solid ${color}">
        <span class="tl-kc-ord">N${ord}</span>
        <span class="sb-card-title">${esc(c.title) || 'Untitled hop'}</span>
        <button class="icon-btn sb-card-edit" data-f="title-edit" title="Rename hop">${IC_PENCIL}</button>
        ${c.archived ? '<span class="arch-badge">ARCHIVED</span>' : ''}
        <details class="hop-kebab sb-card-kebab">
          <summary title="Options">⋮</summary>
          <div class="hop-menu">
            <button class="add-btn" data-f="analyze">${hasAnalysis(c.analysis) ? IC_ANALYZE + ' VIEW ANALYSIS' : IC_ANALYZE + ' ANALYZE'}</button>
            <button class="add-btn" data-f="post">↗ POST TO COMMUNITY</button>
            <button class="add-btn" data-f="viewposts">▤ VIEW POSTS <span class="pc-badge">0</span></button>
            <button class="add-btn" data-f="archive">${c.archived ? 'UNARCHIVE' : 'ARCHIVE'}</button>
            <button class="add-btn" data-f="edit">EDIT</button>
            <button class="add-btn danger" data-f="del">DELETE</button>
          </div>
        </details>
      </div>`;
    }).join('') || `<div class="lane-empty">No hops yet</div>`;
    return `
      <div class="lane tl-lane sb-lane" data-chapter="${ch.id}">
        <div class="lane-head sb-lane-head" data-chapter="${ch.id}" title="Open this section">
          <span class="ci-dot" style="background:${color}"></span>
          <span class="lane-title-static" style="color:${color}">${esc(ch.title)}</span>
          <span class="lane-count">${hops.length}</span>
          <span class="sb-lane-open">→</span>
        </div>
        <div class="lane-cards tl-lane-cards" data-chapter="${ch.id}">${cards}</div>
      </div>`;
  }).join('') + `</div>`;

  stage.querySelectorAll('.sb-lane-head').forEach(head =>
    head.addEventListener('click', () => openSectionDetail(head.dataset.chapter)));
  stage.querySelectorAll('.sb-card').forEach(wireBoardCard);
  stage.querySelectorAll('.sb-lane .tl-lane-cards').forEach(wireTlLaneDnD);
  refreshHopPostBadges();
}

// A board hop card: plain click opens the modal; the pencil renames inline; the
// kebab runs the same hop actions as the detail list. Dragging reorders/moves
// the hop between sections (shared tl-lane drag wiring).
function wireBoardCard(card) {
  const id = card.dataset.id;
  const c = db.chunks.find(x => x.id === id);
  if (!c) return;

  card.addEventListener('click', e => {
    if (card.classList.contains('dragging')) return;
    if (e.target.closest('.hop-kebab > summary')) { e.stopPropagation(); return; }
    const actEl = e.target.closest('[data-f]');
    if (actEl) {
      const f = actEl.dataset.f;
      const closeKebab = () => card.querySelector('.hop-kebab[open]')?.removeAttribute('open');
      if (f === 'title-edit') { e.stopPropagation(); inlineEditBoardCardTitle(card, c); return; }
      if (f === 'edit') { e.stopPropagation(); closeKebab(); openChunkModal(id); return; }
      if (f === 'archive') { e.stopPropagation(); c.archived = !c.archived; save(); renderSections(); return; }
      if (f === 'analyze') { e.stopPropagation(); closeKebab(); analyzeChunk(c, actEl); return; }
      if (f === 'post') { e.stopPropagation(); closeKebab(); postToCommunityModal(c); return; }
      if (f === 'viewposts') { e.stopPropagation(); closeKebab(); managePostsModal(c); return; }
      if (f === 'del') {
        e.stopPropagation(); closeKebab();
        (async () => {
          if (!await confirmModal('Delete this hop?')) return;
          db.chunks = db.chunks.filter(x => x.id !== id);
          save(); renderSections();
        })();
        return;
      }
    }
    openChunkModal(id);
  });

  card.addEventListener('dragstart', e => {
    tlDragId = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    requestAnimationFrame(() => card.classList.add('dragging'));
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    clearTlLaneMarkers();
    tlDragId = null;
  });

  const kebab = card.querySelector('.hop-kebab');
  if (kebab) kebab.addEventListener('toggle', () => { if (kebab.open) positionHopMenu(kebab); });
}

// Inline rename right on a board card (Enter/blur commits, Escape cancels).
function inlineEditBoardCardTitle(card, c) {
  const titleEl = card.querySelector('.sb-card-title');
  if (!titleEl || card.querySelector('.sb-card-title-input')) return;
  const pencil = card.querySelector('[data-f="title-edit"]');
  const input = document.createElement('input');
  input.className = 'sb-card-title-input';
  input.value = c.title || '';
  input.placeholder = 'Untitled hop';
  titleEl.replaceWith(input);
  if (pencil) pencil.style.display = 'none';
  const wasDraggable = card.getAttribute('draggable');
  card.setAttribute('draggable', 'false');
  input.focus(); input.select();

  let settled = false;
  const settle = keep => {
    if (settled) return; settled = true;
    if (keep) { c.title = input.value.trim(); save(); }
    if (wasDraggable !== null) card.setAttribute('draggable', wasDraggable);
    const span = document.createElement('span');
    span.className = 'sb-card-title';
    span.innerHTML = esc(c.title) || 'Untitled hop';
    input.replaceWith(span);
    if (pencil) pencil.style.display = '';
  };
  input.addEventListener('click', e => e.stopPropagation());
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); settle(true); }
    else if (e.key === 'Escape') { e.preventDefault(); settle(false); }
  });
  input.addEventListener('blur', () => settle(true));
}

// DETAIL: the full per-section hop editor (unchanged), reached by drilling in.
function renderSectionDetail() {
  const ch = db.chapters.find(c => c.id === db.ui.activeChapter);
  if (!ch) { sectionsMode = 'board'; renderSections(); return; }
  const label = document.getElementById('sectionDetailLabel');
  if (label) { label.textContent = ch.title; label.style.color = chapterColor(ch.id); }
  renderChunkPane();
}

// Master roll-up for the open section: every character, location, tag, and event
// present across any hop in the section, as clickable chips.
function sectionSummaryHTML(ch) {
  const hops = chunksOf(ch.id).filter(isVisibleChunk);
  const charSet = new Set(), locSet = new Set(), tagSet = new Set();
  hops.forEach(c => {
    db.characters.forEach(ent => { if (chunkEntityPresence(ENTITY_KINDS.character, c, ent).on) charSet.add(ent.id); });
    db.locations.forEach(ent => { if (chunkEntityPresence(ENTITY_KINDS.location, c, ent).on) locSet.add(ent.id); });
    (c.tagIds || []).forEach(t => tagSet.add(t));
  });
  const hopIds = new Set(hops.map(c => c.id));
  const events = (db.events || [])
    .filter(e => !e.dismissed && e.hopId && hopIds.has(e.hopId))
    .sort((a, b) => (a.chronoPos ?? 0) - (b.chronoPos ?? 0));

  const entChips = (ids, coll) => {
    const arr = [...ids].map(id => db[coll].find(x => x.id === id)).filter(Boolean);
    if (!arr.length) return `<span class="ci-count">none</span>`;
    return arr.map(ent => `<span class="ss-chip" data-ss-ent="${coll}:${ent.id}" style="--cc:${ent.color || 'var(--accent)'}" title="Open ${esc(ent.name)}"><span class="ent-dot"></span>${esc(ent.name)}</span>`).join('');
  };
  const tagChips = () => {
    const arr = [...tagSet].map(id => db.tags.find(t => t.id === id)).filter(Boolean);
    if (!arr.length) return `<span class="ci-count">none</span>`;
    return arr.map(t => `<span class="lbl-chip on" style="--lc:${t.color}">${esc(t.name)}</span>`).join('');
  };
  const evChips = () => {
    if (!events.length) return `<span class="ci-count">none</span>`;
    return events.map(e => `<span class="ss-chip ss-ev" data-ss-ev="${e.id}" title="Open this event">${e.dateLabel ? `<span class="ss-ev-when">${esc(e.dateLabel)}</span>` : ''}${esc(e.title || 'Untitled event')}</span>`).join('');
  };

  return `
    <details class="section-summary"${sectionSummaryOpen ? ' open' : ''}>
      <summary>SECTION OVERVIEW</summary>
      <div class="ss-grid">
        <div class="ss-row"><span class="ss-label">CHARACTERS</span><span class="ss-vals">${entChips(charSet, 'characters')}</span></div>
        <div class="ss-row"><span class="ss-label">LOCATIONS</span><span class="ss-vals">${entChips(locSet, 'locations')}</span></div>
        <div class="ss-row"><span class="ss-label">TAGS</span><span class="ss-vals">${tagChips()}</span></div>
        <div class="ss-row"><span class="ss-label">EVENTS</span><span class="ss-vals">${evChips()}</span></div>
      </div>
    </details>`;
}

function renderChunkPane() {
  const pane = document.getElementById('chunkPane');
  const ch = db.chapters.find(c => c.id === db.ui.activeChapter);
  if (!ch) { pane.innerHTML = `<div class="pane-empty">Add a chapter to begin.</div>`; return; }

  const chunks = chunksOf(ch.id).filter(isVisibleChunk);
  const head = `
    <div class="chunk-card-head">
      <input type="color" class="chap-color" id="chapColor" value="${chapterColor(ch.id)}" title="Chapter accent color" />
      <input class="chunk-title-input" id="chapTitle" value="${esc(ch.title)}" />
      <details class="head-kebab" id="chapKebab">
        <summary title="More actions" aria-label="More actions">⋮</summary>
        <div class="head-kebab-menu">
          ${chunks.length ? `<button class="add-btn" id="sectionPreviewBtn" title="Preview all hops as one document">\u25A4 PREVIEW</button>` : ''}
          <button class="add-btn danger" id="delChapBtn" title="Delete chapter">DELETE</button>
        </div>
      </details>
    </div>`;

  const aiKey = 'section:' + ch.id;
  const aiMine = entitySearch.key === aiKey;
  const searchRow = chunks.length
    ? `<div class="section-search-row">
        <input type="search" class="section-search" id="sectionSearch" placeholder="Search within ${esc(ch.title)}\u2026" value="${esc(sectionSearchQuery)}" />
        <button class="add-btn es-run" id="sectionAiBtn" title="Ask a question about this section">${AI_STAR} RUN AI SEARCH</button>
      </div>
      <div class="es-block section-ai" data-es="${aiKey}">
        <div class="es-progress">${aiMine ? entitySearchProgressHTML() : ''}</div>
        <div class="es-results">${aiMine ? entitySearchResultsHTML() : ''}</div>
      </div>`
    : '';

  const importJob = sectionImportJobs.get(ch.id);
  const importStrip = importJob
    ? `<div class="section-import-strip" data-secimport="${ch.id}">${sectionImportProgressHTML(importJob)}</div>`
    : '';

  pane.innerHTML = head + sectionSummaryHTML(ch) + importStrip + searchRow + `<div id="chunkList"></div>`;

  // Section overview chips jump to the entity / event they represent.
  pane.querySelectorAll('[data-ss-ent]').forEach(el => el.addEventListener('click', () => {
    const [coll, id] = el.dataset.ssEnt.split(':');
    gotoEntity(coll === 'characters' ? 'character' : 'location', id);
  }));
  pane.querySelectorAll('[data-ss-ev]').forEach(el =>
    el.addEventListener('click', () => openEventModal(el.dataset.ssEv)));

  const stripEl = pane.querySelector('[data-secimport]');
  if (stripEl) wireSectionImportDismiss(stripEl, ch.id);

  document.getElementById('chapTitle').addEventListener('input', e => {
    ch.title = e.target.value; save();
    const label = document.getElementById('sectionDetailLabel');
    if (label) label.textContent = ch.title;
  });
  document.getElementById('chapColor').addEventListener('input', e => {
    ch.color = e.target.value; save();
    const label = document.getElementById('sectionDetailLabel');
    if (label) label.style.color = ch.color;
  });
  wireHeadKebab(document.getElementById('chapKebab'));
  // Remember whether the author opened the SECTION OVERVIEW so a hop expand (which
  // re-renders this whole pane) does not snap it back open or closed.
  const summaryEl = pane.querySelector('details.section-summary');
  if (summaryEl) summaryEl.addEventListener('toggle', () => { sectionSummaryOpen = summaryEl.open; });
  document.getElementById('sectionPreviewBtn')?.addEventListener('click', () => sectionPreviewModal(ch.id));
  // The desktop PREVIEW button lives up in the page-title row (.section-detail-head),
  // in line with the chapter title. Show it only when there are hops to preview and
  // point it at this chapter.
  const headPreview = document.getElementById('sectionPreviewHeadBtn');
  if (headPreview) {
    headPreview.hidden = !chunks.length;
    headPreview.onclick = () => sectionPreviewModal(ch.id);
  }
  document.getElementById('delChapBtn').addEventListener('click', async () => {
    if (!await confirmModal('Delete this chapter and its hops?')) return;
    db.chunks = db.chunks.filter(c => c.chapterId !== ch.id);
    db.chapters = db.chapters.filter(c => c.id !== ch.id);
    db.ui.activeChapter = db.chapters[0]?.id || null;
    sectionsMode = 'board'; // deleting the open section returns to the board
    save(); renderSections();
  });

  const searchEl = document.getElementById('sectionSearch');
  if (searchEl) searchEl.addEventListener('input', e => {
    sectionSearchQuery = e.target.value;
    renderChunkList(ch);
  });
  const aiBtn = document.getElementById('sectionAiBtn');
  const runAi = () => runScopedSearch(aiKey, searchEl ? searchEl.value : '', chunks);
  if (aiBtn) aiBtn.addEventListener('click', runAi);
  if (searchEl) searchEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runAi(); } });
  // Re-wire any restored AI results (stop button + open-on-click) for this section.
  if (aiMine) paintEntitySearch(aiKey);

  renderChunkList(ch);
  refreshHopPostBadges();
}

// Transient (not persisted): live filter for the active chapter's hop list.
// Cleared when the active chapter changes so a stale filter never hides hops in
// a freshly opened section.
let sectionSearchQuery = '';
// While a text filter is active, matched hops are force-expanded so the search
// term is visible (and highlightable) in the body, not just the title.
let sectionForceExpandAll = false;

// Render only the active chapter's hop cards into #chunkList. Kept separate from
// renderChunkPane so live text filtering can repaint the list without recreating
// (and unfocusing) the search box above it.
function renderChunkList(ch) {
  const listEl = document.getElementById('chunkList');
  if (!listEl) return;
  const chunks = chunksOf(ch.id).filter(isVisibleChunk);
  const q = (sectionSearchQuery || '').trim().toLowerCase();
  const matches = c => !q
    || (c.title || '').toLowerCase().includes(q)
    || (c.body || '').toLowerCase().includes(q);
  const shown = q ? chunks.filter(matches) : chunks;

  sectionForceExpandAll = !!q;
  if (!chunks.length) listEl.innerHTML = `<div class="pane-empty">No hops yet. Add one above.</div>`;
  else if (!shown.length) listEl.innerHTML = `<div class="pane-empty">No hops match your search.</div>`;
  else listEl.innerHTML = shown.map(renderChunkCard).join('');
  sectionForceExpandAll = false;

  if (q) markSearchHits(listEl, q);
  listEl.querySelectorAll('.chunk-card').forEach(card => wireChunkCard(card));
  if (!q) enableChunkDragReorder(listEl, ch.id); // reorder only makes sense over the full, unfiltered list
}

// Wrap every plain-text occurrence of `q` inside hop titles and bodies in a
// <mark.search-hit>. Walks text nodes only, so it never corrupts the entity
// highlight spans or HTML attributes already in the rendered card.
function markSearchHits(root, q, selector = '.chunk-disp-title, .chunk-disp-body') {
  const needle = (q || '').toLowerCase();
  if (!needle) return;
  root.querySelectorAll(selector).forEach(scope => {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n; while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(node => {
      const text = node.nodeValue;
      const lc = text.toLowerCase();
      if (!lc.includes(needle)) return;
      const frag = document.createDocumentFragment();
      let i = 0, idx;
      while ((idx = lc.indexOf(needle, i)) !== -1) {
        if (idx > i) frag.appendChild(document.createTextNode(text.slice(i, idx)));
        const mark = document.createElement('mark');
        mark.className = 'search-hit';
        mark.textContent = text.slice(idx, idx + needle.length);
        frag.appendChild(mark);
        i = idx + needle.length;
      }
      if (i < text.length) frag.appendChild(document.createTextNode(text.slice(i)));
      node.parentNode.replaceChild(frag, node);
    });
  });
}

/* ---- drag-and-drop reorder of chunks within a chapter ---- */
function clearChunkDropMarkers(pane) {
  pane.querySelectorAll('.chunk-card').forEach(c => c.classList.remove('drop-before', 'drop-after'));
}

function chunkDragAfter(pane, y) {
  const cards = [...pane.querySelectorAll('.chunk-card[draggable="true"]:not(.dragging)')];
  return cards.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: -Infinity, element: null }).element;
}

function enableChunkDragReorder(pane, chapterId) {
  let draggingId = null;

  pane.querySelectorAll('.chunk-card[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', e => {
      draggingId = card.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggingId);
      requestAnimationFrame(() => card.classList.add('dragging'));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      clearChunkDropMarkers(pane);
      draggingId = null;
    });
  });

  // assigned (not addEventListener) so re-renders don't stack duplicate handlers
  pane.ondragover = e => {
    if (!draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearChunkDropMarkers(pane);
    const after = chunkDragAfter(pane, e.clientY);
    if (after) after.classList.add('drop-before');
    else {
      const cards = pane.querySelectorAll('.chunk-card[draggable="true"]:not(.dragging)');
      if (cards.length) cards[cards.length - 1].classList.add('drop-after');
    }
  };
  pane.ondrop = e => {
    if (!draggingId) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || draggingId;
    const after = chunkDragAfter(pane, e.clientY);
    clearChunkDropMarkers(pane);
    if (id) reorderChunkInChapter(chapterId, id, after ? after.dataset.id : null);
  };
}

// Move dragged chunk before `beforeId` (or to the end if null) within its
// chapter, then renumber orderInChapter. Archived chunks keep their slots.
function reorderChunkInChapter(chapterId, draggedId, beforeId) {
  const ordered = chunksOf(chapterId);
  const dragged = ordered.find(c => c.id === draggedId);
  if (!dragged || draggedId === beforeId) return;
  const without = ordered.filter(c => c.id !== draggedId);
  const insertIdx = beforeId ? without.findIndex(c => c.id === beforeId) : without.length;
  without.splice(insertIdx < 0 ? without.length : insertIdx, 0, dragged);
  without.forEach((c, idx) => c.orderInChapter = idx);
  save();
  renderSections();
}

function renderChunkCard(c) {
  return renderChunkCardDisplay(c);
}

// Is this character/location present in this chunk? Either the author explicitly
// linked it, or its name/alias literally shows up (a live, non-dismissed mention).
// "auto" flags the mention-only case so the editor can show it as detected.
function chunkEntityPresence(K, chunk, ent) {
  const linked = (chunk[K.link] || []).includes(ent.id);
  const live = occurrencesOf(ent, chunk).some(o => !o.dismissed);
  return { linked, live, on: linked || live, auto: live && !linked };
}

// The chunk modal lists the characters/locations present in this hop as a plain
// text list, with an ADD MORE control that reveals a dropdown of the remaining
// entities. "auto" entities (named in the text but not explicitly linked) show a
// badge and can't be removed here — they're present because the prose mentions
// them.
function entityListHTML(K, chunk) {
  const coll = db[K.coll];
  if (!coll.length) return `<span class="ci-count">no ${K.noun}s yet — add them in ${K.NOUNS}</span>`;
  const present = [], absent = [];
  coll.forEach(ent => (chunkEntityPresence(K, chunk, ent).on ? present : absent).push(ent));
  const items = present.length
    ? present.map(ent => {
        const { auto, linked } = chunkEntityPresence(K, chunk, ent);
        const removable = linked && !auto;
        return `<span class="ent-item" style="--cc:${ent.color || 'var(--accent)'}">
          <span class="ent-dot"></span><span class="ent-name-link" data-ent-goto="${ent.id}" title="Open ${esc(ent.name)}">${esc(ent.name)}</span>${auto ? '<span class="chip-auto" title="Named in this hop\u2019s text">auto</span>' : ''}${removable ? `<button class="ent-x" data-ent-rm="${ent.id}" title="Remove from this hop">✕</button>` : ''}
        </span>`;
      }).join('')
    : `<span class="ci-count">No ${K.noun}s in this hop yet.</span>`;
  const adder = absent.length
    ? `<div class="ent-adder">
        <button class="add-btn ent-add-btn" data-ent-addmore>+ ADD MORE</button>
        <select class="ent-add-select" data-ent-select hidden>
          <option value="">Add a ${K.noun}…</option>
          ${absent.map(ent => `<option value="${ent.id}">${esc(ent.name)}</option>`).join('')}
        </select>
      </div>`
    : '';
  return `<div class="ent-list">${items}</div>${adder}`;
}

// Render the present-list + ADD MORE control into a container and wire it. Adding
// or removing flips the explicit link; auto (mention-only) entities have no remove
// button so they persist. Re-renders in place after each change.
function renderEntityListInto(container, K, chunk) {
  container.innerHTML = entityListHTML(K, chunk);
  container.querySelectorAll('[data-ent-goto]').forEach(el => {
    el.addEventListener('click', () => {
      closeChunkModal();
      gotoEntity(K.noun, el.dataset.entGoto);
    });
  });
  container.querySelectorAll('[data-ent-rm]').forEach(btn => {
    btn.addEventListener('click', () => {
      const arr = chunk[K.link] || (chunk[K.link] = []);
      const i = arr.indexOf(btn.dataset.entRm);
      if (i >= 0) arr.splice(i, 1);
      save(); markChunkDirty();
      renderEntityListInto(container, K, chunk);
      if (typeof renderEditorHighlights === 'function') renderEditorHighlights();
    });
  });
  const addBtn = container.querySelector('[data-ent-addmore]');
  const sel = container.querySelector('[data-ent-select]');
  if (addBtn && sel) {
    addBtn.addEventListener('click', () => { addBtn.hidden = true; sel.hidden = false; sel.focus(); });
    sel.addEventListener('change', () => {
      const id = sel.value;
      if (!id) return;
      if (!Array.isArray(chunk[K.link])) chunk[K.link] = [];
      if (!chunk[K.link].includes(id)) chunk[K.link].push(id);
      save(); markChunkDirty();
      renderEntityListInto(container, K, chunk);
      if (typeof renderEditorHighlights === 'function') renderEditorHighlights();
    });
  }
}

// Ask the model which existing tags fit this scene and what new tags to add,
// then let the author confirm before applying.
async function generateChunkTags(chunk, btn) {
  if (!(chunk.body || '').trim()) { alertModal('Write some content first.', { title: 'DETECT TAGS' }); return; }
  const original = aiBtnStart(btn, IC_DETECT, 'SCANNING…');
  try {
    const result = await aiInvoke({
      task: 'suggest_tags',
      chunk: { title: chunk.title, body: chunk.body },
      existing: db.tags.map(l => l.name)
    });
    aiBtnDone(btn, original);
    const assign = (result.assign || []).filter(Boolean);
    const suggest = (result.suggest || []).filter(Boolean);
    if (!assign.length && !suggest.length) { alertModal('No tags suggested for this scene.', { title: 'DETECT TAGS' }); return; }
    const chosen = await tagReviewModal(assign, suggest);
    if (!chosen || !chosen.length) return;
    if (!Array.isArray(chunk.tagIds)) chunk.tagIds = [];
    chosen.forEach(name => {
      const lab = ensureTag(name);
      if (lab && !chunk.tagIds.includes(lab.id)) chunk.tagIds.push(lab.id);
    });
    save(); renderSections();
    if (modalChunkId === chunk.id) {
      const lw = document.getElementById('chunkModalTags');
      if (lw) { lw.innerHTML = tagEditorHTML(chunk.tagIds || []); const le = lw.querySelector('.label-editor'); if (le) wireTagEditor(le, chunk); }
    }
  } catch (err) {
    aiBtnDone(btn, original);
    alertModal('Tag generation failed.\n\n' + (err.message || ''), { title: 'DETECT TAGS' });
  }
}

// Draft body prose for a hop from its title. Reads the live editor fields so an
// unsaved title counts; warns before overwriting existing body text.
// Snapshot of the whole project sent alongside a GENERATE BODY request so the
// AI grounds new prose in the existing manuscript, cast, places, and sections
// rather than writing from the title in a vacuum.
function projectGenContext(excludeId) {
  return {
    context: db.chunks
      .filter(c => c.id !== excludeId && (c.body || '').trim())
      .map(c => ({ title: c.title, body: c.body, section: chapterTitle(c.chapterId) })),
    characters: db.characters.map(c => c.name).filter(Boolean),
    locations: (db.locations || []).map(l => l.name).filter(Boolean),
    chapters: [...db.chapters].sort((a, b) => a.order - b.order).map(ch => ch.title).filter(Boolean)
  };
}

async function generateChunkBody(chunk, btn) {
  const titleEl = document.getElementById('chunkModalTitle');
  const title = (titleEl ? titleEl.value : chunk.title || '').trim();
  if (!title) { alertModal('Give the hop a title first — the body is generated from it.', { title: 'TITLE IT FIRST' }); return; }
  if ((typeof getEditorText === 'function' ? getEditorText() : chunk.body || '').trim() &&
      !await confirmModal('This will replace the existing body text. Is that okay?', { title: 'REPLACE BODY', okText: 'Replace', danger: false })) return;
  // Collect an optional steering prompt and optional character/location/event/tag
  // picks before drafting. Everything is optional — an empty spec writes from the
  // title alone, exactly like before.
  const spec = await generateBodyPromptModal(chunk, title);
  if (spec == null) return;   // cancelled
  const original = aiBtnStart(btn, IC_GENERATE, 'WRITING…');
  try {
    const proj = projectsCache.find(p => p.id === activeProjectId);
    const gen = projectGenContext(chunk.id);

    // Resolve the chosen ids into the rich detail the model can lean on.
    const charMap = new Map((db.characters || []).map(c => [c.id, c]));
    const locMap = new Map((db.locations || []).map(l => [l.id, l]));
    const evMap = new Map((db.events || []).map(e => [e.id, e]));
    const tagMap = new Map((db.tags || []).map(t => [t.id, t]));
    const selChars = (spec.characterIds || []).map(id => charMap.get(id)).filter(Boolean);
    const selLocs = (spec.locationIds || []).map(id => locMap.get(id)).filter(Boolean);
    const selEvents = (spec.eventIds || []).map(id => evMap.get(id)).filter(Boolean);
    const selTags = (spec.tagIds || []).map(id => tagMap.get(id)).filter(Boolean);

    const segs = [
      'Write the body prose for a single hop (one scene or beat) in my book. ' +
      'Output ONLY the prose for the hop body — no preamble, no title line, no surrounding quotes, ' +
      'no commentary, no markdown. Stay consistent with the rest of the manuscript.',
      `\nHOP TITLE: ${title}`
    ];
    if (chunk.chapterId) segs.push(`SECTION: ${chapterTitle(chunk.chapterId)}`);
    if (proj?.type || proj?.genre) segs.push(`PROJECT: ${[proj?.type, proj?.genre].filter(Boolean).join(' / ')}`);
    if (spec.prompt) segs.push(`\nHOW I WANT IT WRITTEN:\n${spec.prompt}`);
    if (selChars.length) segs.push('\nCHARACTERS TO FEATURE:\n' + selChars.map(c =>
      `- ${c.name}${(c.aliases || []).length ? ` (aka ${c.aliases.join(', ')})` : ''}${c.summary ? `: ${c.summary}` : ''}`).join('\n'));
    if (selLocs.length) segs.push('\nLOCATIONS TO USE:\n' + selLocs.map(l =>
      `- ${l.name}${l.summary ? `: ${l.summary}` : ''}`).join('\n'));
    if (selEvents.length) segs.push('\nEVENTS THIS HOP SHOULD REFLECT:\n' + selEvents.map(e =>
      `- ${e.title}${e.dateLabel ? ` [${e.dateLabel}]` : ''}${e.description ? `: ${e.description}` : ''}`).join('\n'));
    if (selTags.length) segs.push('\nTAGS / THEMES TO HONOR: ' + selTags.map(t => t.name).join(', '));

    const { reply } = await aiInvoke({
      task: 'chat',
      messages: [{ role: 'user', content: segs.join('\n') }],
      context: {
        project: proj?.name || '',
        type: proj?.type || '',
        genre: proj?.genre || '',
        chapters: gen.chapters,
        characters: (db.characters || []).map(c => ({ name: c.name })).filter(c => c.name)
      }
    });
    aiBtnDone(btn, original);
    let text = (reply || '').trim().replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '').trim();
    if (!text) { alertModal('No body text came back. Try again.', { title: 'GENERATE BODY' }); return; }
    chunk.body = text;
    const bodyEl = document.getElementById('chunkModalBody');
    if (bodyEl) typeWriter(bodyEl, text, { onDone: () => setEditorContent(text) });
    else if (typeof setEditorContent === 'function') setEditorContent(text);

    // Link any picked characters/locations/tags to the hop so the selection sticks.
    const linkInto = (field, ids) => {
      if (!Array.isArray(chunk[field])) chunk[field] = [];
      ids.forEach(id => { if (id && !chunk[field].includes(id)) chunk[field].push(id); });
    };
    linkInto('characterIds', spec.characterIds);
    linkInto('locationIds', spec.locationIds);
    linkInto('tagIds', spec.tagIds);

    save(); markChunkDirty();
  } catch (err) {
    aiBtnDone(btn, original);
    alertModal('Body generation failed.\n\n' + (err.message || ''), { title: 'GENERATE BODY' });
  }
}

// GENERATE BODY setup screen: a free-text steering prompt plus optional toggle-chip
// pickers for characters, locations, events, and tags. Pre-checks whatever is already
// linked to the hop. Resolves to { prompt, characterIds, locationIds, eventIds, tagIds }
// or null if cancelled. Cmd/Ctrl+Enter generates.
function generateBodyPromptModal(chunk, title) {
  return new Promise(resolve => {
    const chars = (db.characters || []).filter(c => c.name);
    const locs = (db.locations || []).filter(l => l.name);
    const events = (db.events || []).filter(e => !e.dismissed && e.title);
    const tags = (db.tags || []).filter(t => t.name);

    const preChars = new Set(chunk.characterIds || []);
    const preLocs = new Set(chunk.locationIds || []);
    const preTags = new Set(chunk.tagIds || []);
    const preEvents = new Set(events.filter(e => e.hopId === chunk.id).map(e => e.id));

    const countLabel = n => n ? `${n} selected` : 'optional';
    const section = (items, label, pre, kind) => items.length ? `
      <details class="gb-dd" data-kind="${kind}">
        <summary class="gb-dd-sum">
          <span class="gb-dd-label">${label}</span>
          <span class="gb-dd-count" data-count="${kind}">${countLabel(pre.size)}</span>
          <span class="gb-dd-caret">▾</span>
        </summary>
        <div class="gb-chips" data-kind="${kind}">
          ${items.map(it => `<button type="button" class="gb-chip${pre.has(it.id) ? ' on' : ''}"${it.color ? ` style="--chip:${esc(it.color)}"` : ''} data-id="${it.id}">${esc(it.name || it.title)}</button>`).join('')}
        </div>
      </details>` : '';

    const overlay = document.createElement('div');
    overlay.className = 'ui-modal-overlay';
    overlay.innerHTML = `
      <div class="ui-modal genbody-modal" role="dialog" aria-modal="true">
        <button class="ui-modal-x" data-act="cancel" aria-label="Close" title="Close">&times;</button>
        <div class="ui-modal-title">${IC_GENERATE} GENERATE BODY</div>
        <div class="ui-modal-scroll">
          <div class="ui-modal-msg">Drafting the body for <strong>${esc(title)}</strong>. Describe how you want it written, and optionally pick characters, locations, events, or tags to weave in. Leave it all blank to generate from the title alone.</div>
          <textarea class="ui-modal-input genbody-prompt" rows="4" placeholder="e.g. tense, close third person from Ava&rsquo;s POV; build dread; end on a cliffhanger…"></textarea>
          ${section(chars, 'CHARACTERS', preChars, 'char')}
          ${section(locs, 'LOCATIONS', preLocs, 'loc')}
          ${section(events, 'EVENTS', preEvents, 'event')}
          ${section(tags, 'TAGS', preTags, 'tag')}
        </div>
        <div class="ui-modal-actions">
          <button class="ui-modal-btn" data-act="cancel">Cancel</button>
          <button class="ui-modal-btn solid" data-act="ok">${IC_GENERATE} GENERATE</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const ta = overlay.querySelector('textarea');
    overlay.querySelectorAll('.gb-chip').forEach(c =>
      c.addEventListener('click', () => {
        c.classList.toggle('on');
        const dd = c.closest('.gb-dd');
        const badge = dd && dd.querySelector('.gb-dd-count');
        if (badge) badge.textContent = countLabel(dd.querySelectorAll('.gb-chip.on').length);
      }));
    const pick = kind => [...overlay.querySelectorAll(`.gb-chips[data-kind="${kind}"] .gb-chip.on`)].map(c => c.dataset.id);
    const done = val => { document.removeEventListener('keydown', onKey); overlay.remove(); resolve(val); };
    const submit = () => done({
      prompt: ta.value.trim(),
      characterIds: pick('char'),
      locationIds: pick('loc'),
      eventIds: pick('event'),
      tagIds: pick('tag')
    });
    overlay.querySelector('[data-act="ok"]').addEventListener('click', submit);
    overlay.querySelectorAll('[data-act="cancel"]').forEach(b => b.addEventListener('click', () => done(null)));
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) done(null); });
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); done(null); }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
    }
    document.addEventListener('keydown', onKey);
    ta.focus();
  });
}

// RE-WRITE: revise an existing hop body from a free-text instruction. Opens a
// prompt modal for the instruction, then asks the AI to rewrite the current body
// (grounded in the project) and swaps the new version into the editor.
async function rewriteChunkBody(chunk, btn) {
  const titleEl = document.getElementById('chunkModalTitle');
  const title = (titleEl ? titleEl.value : chunk.title || '').trim();
  const current = (typeof getEditorText === 'function' ? getEditorText() : chunk.body || '').trim();
  if (!current) { generateChunkBody(chunk, btn); return; }   // nothing to rewrite → draft fresh
  const instruction = await rewritePromptModal();
  if (instruction == null) return;                            // cancelled
  const instr = instruction.trim();
  if (!instr) return;
  const original = aiBtnStart(btn, IC_GENERATE, 'RE-WRITING…');
  try {
    const proj = projectsCache.find(p => p.id === activeProjectId);
    const gen = projectGenContext(chunk.id);
    const userMsg =
      'Rewrite the body of a single hop (a scene or beat) in my book according to my instruction below. ' +
      'Output ONLY the rewritten prose for the hop body — no preamble, no title line, no surrounding quotes, ' +
      'no commentary, no markdown. Stay consistent with the rest of the manuscript and keep a length similar ' +
      'to the current body unless the instruction asks otherwise.\n\n' +
      (title ? `HOP TITLE: ${title}\n` : '') +
      (chunk.chapterId ? `SECTION: ${chapterTitle(chunk.chapterId)}\n` : '') +
      `\nCURRENT BODY:\n${current}\n\nREWRITE INSTRUCTION:\n${instr}`;
    const { reply } = await aiInvoke({
      task: 'chat',
      messages: [{ role: 'user', content: userMsg }],
      context: {
        project: proj?.name || '',
        type: proj?.type || '',
        genre: proj?.genre || '',
        chapters: gen.chapters,
        characters: (db.characters || []).map(c => ({ name: c.name })).filter(c => c.name)
      }
    });
    aiBtnDone(btn, original);
    let text = (reply || '').trim().replace(/^["'\u201c\u2018]+|["'\u201d\u2019]+$/g, '').trim();
    if (!text) { alertModal('No body text came back. Try again.', { title: 'RE-WRITE' }); return; }
    chunk.body = text;
    const bodyEl = document.getElementById('chunkModalBody');
    if (bodyEl) typeWriter(bodyEl, text, { onDone: () => setEditorContent(text) });
    else if (typeof setEditorContent === 'function') setEditorContent(text);
    save(); markChunkDirty();
  } catch (err) {
    aiBtnDone(btn, original);
    alertModal('Re-write failed.\n\n' + (err.message || ''), { title: 'RE-WRITE' });
  }
}

// Multiline prompt for a RE-WRITE instruction. Resolves to the entered string,
// or null if the writer cancels. Cmd/Ctrl+Enter submits.
function rewritePromptModal() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'ui-modal-overlay';
    overlay.innerHTML = `
      <div class="ui-modal" role="dialog" aria-modal="true">
        <div class="ui-modal-title">RE-WRITE BODY</div>
        <div class="ui-modal-msg">Describe how you want this hop rewritten. The current body is replaced with a new AI version.</div>
        <textarea class="ui-modal-input rewrite-prompt" rows="4" placeholder="e.g. tighten the pacing, add sensory detail, shift to past tense…"></textarea>
        <div class="ui-modal-actions">
          <button class="ui-modal-btn" data-act="cancel">Cancel</button>
          <button class="ui-modal-btn solid" data-act="ok">${IC_GENERATE} RE-WRITE</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const ta = overlay.querySelector('textarea');
    const done = val => { document.removeEventListener('keydown', onKey); overlay.remove(); resolve(val); };
    overlay.querySelector('[data-act="ok"]').addEventListener('click', () => done(ta.value));
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => done(null));
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) done(null); });
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); done(null); }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); done(ta.value); }
    }
    document.addEventListener('keydown', onKey);
    ta.focus();
  });
}

function tagReviewModal(assign, suggest) {
  return new Promise(resolve => {
    const rows = [
      ...assign.map(n => ({ name: n, isNew: false })),
      ...suggest.map(n => ({ name: n, isNew: true }))
    ];
    const overlay = document.createElement('div');
    overlay.className = 'ui-modal-overlay';
    overlay.innerHTML = `
      <div class="ui-modal detect-modal">
        <div class="ui-modal-title">SUGGESTED TAGS</div>
        <div class="ui-modal-msg">Existing tags that fit, plus new ones to create. Uncheck any you don't want.</div>
        <div class="detect-list">
          ${rows.map((r, i) => `
            <label class="detect-row">
              <input type="checkbox" data-i="${i}" checked />
              <span class="detect-name">${esc(r.name)}</span>
              <span class="detect-aliases">${r.isNew ? 'new' : 'existing'}</span>
            </label>`).join('')}
        </div>
        <div class="ui-modal-actions">
          <button class="ui-modal-btn" data-act="cancel">Cancel</button>
          <button class="ui-modal-btn solid" data-act="add">Apply selected</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = val => { overlay.remove(); resolve(val); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));
    overlay.querySelector('[data-act="add"]').addEventListener('click', () => {
      const picked = [...overlay.querySelectorAll('.detect-row input:checked')].map(inp => rows[+inp.dataset.i].name);
      close(picked);
    });
  });
}

// Per-hop entity detection: scan THIS hop's text for characters/locations,
// match against existing entities or propose new ones, and link the chosen ones
// to the hop. Mirrors the project-wide DETECT but scoped to a single hop.
async function detectChunkEntities(K, chunk, btn) {
  if (!(chunk.body || '').trim()) { alertModal('Write some content first.', { title: `DETECT ${K.NOUNS}` }); return; }
  const original = aiBtnStart(btn, IC_DETECT, 'SCANNING…');
  try {
    const result = await aiInvoke({
      task: K.detectTask,
      chunks: [{ title: chunk.title, body: chunk.body }],
      existing: db[K.coll].map(e => e.name)
    });
    aiBtnDone(btn, original);
    const bodyLc = (chunk.body || '').toLowerCase();
    const inBody = name => { const n = (name || '').trim().toLowerCase(); return n && bodyLc.includes(n); };
    const found = (result[K.resultKey] || []).filter(f =>
      f && f.name && (inBody(f.name) || (f.aliases || []).some(inBody)));
    if (!found.length) { alertModal(`No ${K.noun}s found in this hop.`, { title: `DETECT ${K.NOUNS}` }); return; }

    const byKey = new Map();
    db[K.coll].forEach(e => {
      byKey.set(e.name.toLowerCase(), e);
      (e.aliases || []).forEach(a => byKey.set(a.toLowerCase(), e));
    });
    const link = Array.isArray(chunk[K.link]) ? chunk[K.link] : (chunk[K.link] = []);
    const rows = found.map(f => {
      const match = byKey.get(f.name.toLowerCase()) || null;
      return { name: f.name, aliases: f.aliases || [], existing: match, linked: match ? link.includes(match.id) : false };
    });
    const chosen = await chunkDetectReviewModal(K, rows);
    if (!chosen || !chosen.length) return;
    chosen.forEach(r => {
      let ent = r.existing;
      if (!ent) {
        ent = { id: uid(), name: r.name, aliases: r.aliases || [], summary: '', notes: [], color: CHAPTER_PALETTE[db[K.coll].length % CHAPTER_PALETTE.length], dismissedRefs: [] };
        db[K.coll].push(ent);
      }
      if (!link.includes(ent.id)) link.push(ent.id);
    });
    save();
    refreshModalEntityChips(K, chunk);
  } catch (err) {
    aiBtnDone(btn, original);
    alertModal('Detection failed.\n\n' + (err.message || ''), { title: `DETECT ${K.NOUNS}` });
  }
}

function chunkDetectReviewModal(K, rows) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'ui-modal-overlay';
    overlay.innerHTML = `
      <div class="ui-modal detect-modal">
        <div class="ui-modal-title">DETECTED ${K.NOUNS}</div>
        <div class="ui-modal-msg">Found in this hop. Checked items get linked; “new” ones are created first.</div>
        <div class="detect-list">
          ${rows.map((r, i) => `
            <label class="detect-row">
              <input type="checkbox" data-i="${i}" checked ${r.linked ? 'disabled' : ''} />
              <span class="detect-name">${esc(r.name)}</span>
              <span class="detect-aliases">${r.linked ? 'linked' : (r.existing ? 'existing' : 'new')}</span>
            </label>`).join('')}
        </div>
        <div class="ui-modal-actions">
          <button class="ui-modal-btn" data-act="cancel">Cancel</button>
          <button class="ui-modal-btn solid" data-act="add">Link selected</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = val => { overlay.remove(); resolve(val); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));
    overlay.querySelector('[data-act="add"]').addEventListener('click', () => {
      const picked = [...overlay.querySelectorAll('.detect-row input:checked')]
        .filter(inp => !inp.disabled).map(inp => rows[+inp.dataset.i]);
      close(picked);
    });
  });
}

// AI read of a single hop in the context of the whole manuscript: what's
// working, plus a few gently-delivered suggestions. Surfaced in a result modal.
function hasAnalysis(a) { return !!a && (((a.strengths || []).length) || ((a.suggestions || []).length)); }

// Call the AI to analyze one hop against the whole manuscript. Returns
// { strengths, suggestions } (filtered), or throws.
async function runChunkAnalysis(chunk) {
  const proj = projectsCache.find(p => p.id === activeProjectId);
  const context = db.chunks
    .filter(c => c.id !== chunk.id && (c.body || '').trim())
    .map(c => ({ title: c.title, body: c.body }));
  const result = await aiInvoke({
    task: 'analyze_chunk',
    chunk: { title: chunk.title, body: chunk.body },
    context,
    type: proj?.type || '',
    genre: proj?.genre || '',
    characters: db.characters.map(c => c.name).filter(Boolean),
    locations: (db.locations || []).map(l => l.name).filter(Boolean)
  });
  return {
    strengths: (result.strengths || []).filter(Boolean),
    suggestions: (result.suggestions || []).filter(Boolean)
  };
}

// After an analysis is first saved, flip the hop's ANALYZE buttons to VIEW
// ANALYSIS — both the open edit modal and the rendered card surfaces.
function refreshAnalyzeButtons(chunk) {
  const az = document.getElementById('chunkModalAnalyze');
  if (az && modalChunkId === chunk.id) az.innerHTML = IC_ANALYZE + ' VIEW ANALYSIS';
  rerenderActiveView();
}

// Entry from a hop card / edit modal. If we already saved an analysis for this
// hop, show it instantly; otherwise generate, persist, then show.
async function analyzeChunk(chunk, btn) {
  if (hasAnalysis(chunk.analysis)) { analysisResultModal(chunk); return; }
  if (!(chunk.body || '').trim()) { alertModal('Write some content first.', { title: 'ANALYZE' }); return; }
  const original = aiBtnStart(btn, IC_ANALYZE, 'READING…');
  try {
    const out = await runChunkAnalysis(chunk);
    aiBtnDone(btn, original);
    if (!hasAnalysis(out)) { alertModal('No analysis came back for this hop.', { title: 'ANALYZE' }); return; }
    chunk.analysis = { ...out, ts: Date.now() };
    save();
    refreshAnalyzeButtons(chunk);
    analysisResultModal(chunk);
  } catch (err) {
    aiBtnDone(btn, original);
    alertModal('Analysis failed.\n\n' + (err.message || ''), { title: 'ANALYZE' });
  }
}

function analysisResultModal(chunk) {
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  overlay.innerHTML = `
    <div class="ui-modal analysis-modal">
      <div class="ui-modal-title">ANALYSIS · ${esc(chunk.title) || 'UNTITLED HOP'}</div>
      <div class="ui-modal-scroll" id="analysisBody"></div>
      <div class="ui-modal-actions">
        <button class="ui-modal-btn" data-act="reanalyze">↻ REANALYZE</button>
        <button class="ui-modal-btn solid" data-act="close">Done</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const body = overlay.querySelector('#analysisBody');
  const reBtn = overlay.querySelector('[data-act="reanalyze"]');
  const list = (items, cls) => items.map(t => `<li class="analysis-item ${cls}">${esc(t)}</li>`).join('');
  const proj = projectsCache.find(p => p.id === activeProjectId);
  const isJournal = (proj?.type || '').toLowerCase() === 'journal';
  const strengthsHead = isJournal ? 'POWERFUL MOMENTS' : "WHAT'S WORKING";
  const suggestionsHead = isJournal ? 'OBSERVATIONS & ADVICE' : 'GENTLE NUDGES';
  const renderBody = () => {
    const a = chunk.analysis || {};
    const strengths = a.strengths || [], suggestions = a.suggestions || [];
    const stamp = a.ts ? `<div class="analysis-stamp">Saved ${new Date(a.ts).toLocaleString()}</div>` : '';
    body.innerHTML =
      (strengths.length ? `<div class="analysis-group"><div class="analysis-head">${strengthsHead}</div><ul class="analysis-list">${list(strengths, 'good')}</ul></div>` : '') +
      (suggestions.length ? `<div class="analysis-group"><div class="analysis-head">${suggestionsHead}</div><ul class="analysis-list">${list(suggestions, 'nudge')}</ul></div>` : '') +
      stamp;
  };
  renderBody();
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="close"]').addEventListener('click', close);
  reBtn.addEventListener('click', async () => {
    if (!(chunk.body || '').trim()) { alertModal('Write some content first.', { title: 'REANALYZE' }); return; }
    const orig = aiBtnStart(reBtn, IC_ANALYZE, 'READING…');
    try {
      const out = await runChunkAnalysis(chunk);
      if (!hasAnalysis(out)) { alertModal('No analysis came back for this hop.', { title: 'REANALYZE' }); return; }
      chunk.analysis = { ...out, ts: Date.now() };
      save();
      renderBody();
    } catch (err) {
      alertModal('Analysis failed.\n\n' + (err.message || ''), { title: 'REANALYZE' });
    } finally {
      aiBtnDone(reBtn, orig);
    }
  });
}

// 1-based narrative (N) and chronological (C) position of a hop among all
// visible hops, matching the ordering shown on the Timelines view.
function chunkOrdinals(c) {
  const vis = db.chunks.filter(isVisibleChunk);
  const rank = key => [...vis].sort((a, b) => (a[key] ?? 0) - (b[key] ?? 0)).findIndex(x => x.id === c.id) + 1;
  return { n: rank('narrativeOrder'), c: rank('chronoOrder') };
}

function renderChunkCardDisplay(c) {
  const expanded = sectionForceExpandAll || expandedChunks.has(c.id);
  const words = (c.body || '').trim().split(/\s+/).filter(Boolean).length;
  const charCount = db.characters.filter(ch => chunkEntityPresence(ENTITY_KINDS.character, c, ch).on).length;
  const locCount = (db.locations || []).filter(l => chunkEntityPresence(ENTITY_KINDS.location, c, l).on).length;
  const ord = chunkOrdinals(c);
  const meta = [
    `<span class="hop-ord" title="Narrative position">N${ord.n}</span>`,
    `<span class="hop-ord" title="Chronological position">C${ord.c}</span>`,
    `${words} ${words === 1 ? 'word' : 'words'}`,
    c.chronoLabel ? esc(c.chronoLabel) : '',
    charCount ? `${charCount} char` : '',
    locCount ? `${locCount} loc` : ''
  ].filter(Boolean).join(' · ');
  const body = expanded
    ? `${chunkSummaryHeader(c)}<div class="chunk-disp-body">${c.body ? highlightNames(c.body, entityHighlightTerms()) : '<span class="muted">(no content yet)</span>'}</div>`
    : '';
  return `
  <div class="chunk-card collapsed ${expanded ? 'is-expanded' : ''} ${c.archived ? 'archived' : ''}" data-id="${c.id}" draggable="${expanded ? 'false' : 'true'}">
    <div class="chunk-display" data-f="open">
      <span class="chunk-grip" data-f="grip" title="Drag to reorder">⠿</span>
      <span class="chunk-chevron">${expanded ? '▾' : '▸'}</span>
      <span class="chunk-disp-title">${esc(c.title) || '<em>Untitled hop</em>'}</span>
      <button class="icon-btn hop-title-edit" data-f="title-edit" title="Rename hop">${IC_PENCIL}</button>
      ${c.archived ? '<span class="arch-badge">ARCHIVED</span>' : ''}
      <span class="chunk-disp-meta">${meta}</span>
      <span class="chunk-disp-actions">
        <button class="add-btn hop-act" data-f="analyze" title="AI: analyze this hop">${hasAnalysis(c.analysis) ? IC_ANALYZE + ' VIEW ANALYSIS' : IC_ANALYZE + ' ANALYZE'}</button>
        <button class="add-btn hop-act" data-f="post" title="Share this hop to the community">↗ POST</button>
        <button class="add-btn hop-act" data-f="viewposts" title="Manage this hop's community posts">▤ POSTS <span class="pc-badge">0</span></button>
        <button class="add-btn hop-act" data-f="archive">${c.archived ? 'UNARCHIVE' : 'ARCHIVE'}</button>
        <button class="add-btn hop-act" data-f="edit">EDIT</button>
        <button class="icon-btn hop-act" data-f="del" title="Delete hop">✕</button>
        <details class="hop-kebab">
          <summary title="Options">⋮</summary>
          <div class="hop-menu">
            <button class="add-btn" data-f="analyze">${hasAnalysis(c.analysis) ? IC_ANALYZE + ' VIEW ANALYSIS' : IC_ANALYZE + ' ANALYZE'}</button>
            <button class="add-btn" data-f="post">↗ POST TO COMMUNITY</button>
            <button class="add-btn" data-f="viewposts">▤ VIEW POSTS <span class="pc-badge">0</span></button>
            <button class="add-btn" data-f="archive">${c.archived ? 'UNARCHIVE' : 'ARCHIVE'}</button>
            <button class="add-btn" data-f="edit">EDIT</button>
            <button class="add-btn danger" data-f="del">DELETE</button>
          </div>
        </details>
      </span>
    </div>
    ${body}
  </div>`;
}

// Every entity of kind K present in a chunk (explicit links plus auto-detected
// mentions), as {name, color} so each name can render in its own entity color.
// The single source of truth for "who/where is in this chunk".
function chunkEntities(K, c) {
  return (db[K.coll] || []).filter(e => chunkEntityPresence(K, c, e).on)
    .map(e => ({ id: e.id, name: e.name, color: e.color || '' }));
}

// One row ("CHARACTERS  Ada, Mara") — the shared, canonical way to show a
// chunk's characters/locations, each name tinted with its own entity color.
function csTextRow(label, ents) {
  if (!ents.length) return '';
  const kind = label === 'LOCATIONS' ? 'location' : 'character';
  const inner = ents.map(e =>
    `<span class="cs-ent" data-ent-kind="${kind}" data-ent-id="${e.id}" style="color:${e.color || 'var(--accent)'}">${esc(e.name)}</span>`).join(', ');
  return `<div class="cs-row"><span class="cs-label">${label}</span>`
    + `<span class="cs-vals"><span class="cs-text">${inner}</span></span></div>`;
}

// Clicking a character/location name anywhere it is surfaced jumps to that
// entity's workbench and selects it. Bound as a capture-phase delegate (below)
// so the jump wins over any chunk-card click handler sitting underneath.
function gotoEntity(kind, id) {
  const K = ENTITY_KINDS[kind];
  if (!K || !(db[K.coll] || []).some(e => e.id === id)) return;
  if (db.ui[K.active] !== id) expandedRefs.clear();
  db.ui[K.active] = id;
  save();
  if (currentRoute() === K.coll) renderEntityList(K);
  else location.hash = '#' + K.coll;
}
document.addEventListener('click', e => {
  const chip = e.target.closest('.cs-ent');
  if (!chip || !chip.dataset.entId) return;
  e.preventDefault();
  e.stopPropagation();
  gotoEntity(chip.dataset.entKind, chip.dataset.entId);
}, true);

// Compact characters + locations line shown anywhere a chunk is surfaced
// outside the Sections editor: timeline cards, reference rows, tag breakdown.
function chunkCharLocLine(c) {
  const chars = chunkEntities(ENTITY_KINDS.character, c);
  const locs = chunkEntities(ENTITY_KINDS.location, c);
  if (!chars.length && !locs.length) return '';
  return `<div class="chunk-charloc">${csTextRow('CHARACTERS', chars)}${csTextRow('LOCATIONS', locs)}</div>`;
}

// SECTION / FULL PREVIEW — hops shown as one continuous document in a wide modal.
// Called with a chapterId it previews that one section; called with no argument it
// previews the whole story, every section in order. Each hop carries its own EDIT
// button: it highlights that hop, dims the rest, and swaps the title + body into
// inline editable fields. SAVE commits straight to the project (save()) and
// re-renders the block; CANCEL discards.
function sectionPreviewModal(chapterId) {
  const fullMode = !chapterId;
  const chapters = fullMode
    ? db.chapters.slice().sort((a, b) => a.order - b.order)
    : [db.chapters.find(c => c.id === chapterId)].filter(Boolean);
  if (!chapters.length) return;

  const proj = projectsCache.find(p => p.id === activeProjectId) || {};
  const headAccent = fullMode ? (proj.accent || DEFAULT_ACCENT) : chapterColor(chapters[0].id);
  const headKicker = fullMode ? 'FULL PREVIEW' : 'SECTION PREVIEW';
  const headTitle = fullMode ? (proj.name || 'THE WHOLE STORY') : chapters[0].title;

  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  overlay.innerHTML = `
    <div class="ui-modal section-preview-modal" style="--accent:${esc(headAccent)}">
      <div class="spv-head">
        <div class="spv-titles">
          <div class="ui-modal-title">${headKicker}</div>
          <div class="spv-section">${esc(headTitle)}</div>
        </div>
        <button class="ui-modal-btn" data-act="close">Close</button>
      </div>
      <div class="ui-modal-scroll spv-doc" id="spvDoc"></div>
    </div>`;
  document.body.appendChild(overlay);

  let editingId = null;
  const doc = overlay.querySelector('#spvDoc');
  const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
  const onKey = e => { if (e.key === 'Escape' && !editingId) close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', e => { if (e.target === overlay && !editingId) close(); });
  overlay.querySelector('[data-act="close"]').addEventListener('click', () => { if (!editingId) close(); });

  function clearDim() { doc.querySelectorAll('.spv-hop').forEach(b => b.classList.remove('is-dimmed')); }

  function displayHtml(c, i) {
    const body = c.body
      ? highlightNames(c.body, entityHighlightTerms())
      : '<span class="spv-empty">(empty hop)</span>';
    return `
      <div class="spv-hop-head">
        <div class="spv-hop-meta">
          <span class="spv-eyebrow">HOP ${i + 1}${c.chronoLabel ? ' · ' + esc(c.chronoLabel) : ''}</span>
          <h3 class="spv-hop-title">${esc(c.title || 'Untitled hop')}</h3>
        </div>
        <button class="add-btn spv-edit" data-f="edit">EDIT</button>
      </div>
      <div class="spv-hop-body">${body}</div>`;
  }

  function editHtml(c, i) {
    return `
      <div class="spv-hop-head">
        <div class="spv-hop-meta">
          <span class="spv-eyebrow">HOP ${i + 1} · EDITING</span>
          <input class="spv-title-input" value="${esc(c.title || '')}" placeholder="Untitled hop" />
        </div>
        <div class="spv-edit-actions">
          <button class="add-btn solid spv-save" data-f="save">✓ SAVE</button>
          <button class="add-btn spv-cancel" data-f="cancel">CANCEL</button>
        </div>
      </div>
      <div class="spv-hop-body spv-editing" contenteditable="true" spellcheck="true"></div>`;
  }

  function renderHop(block, c, i) {
    const editing = editingId === c.id;
    block.classList.toggle('is-editing', editing);
    block.innerHTML = editing ? editHtml(c, i) : displayHtml(c, i);
    if (editing) {
      block.querySelector('.spv-hop-body').textContent = c.body || '';
      block.querySelector('.spv-title-input').focus();
    }
    wireHop(block, c, i);
  }

  function wireHop(block, c, i) {
    block.querySelector('[data-f="edit"]')?.addEventListener('click', () => {
      if (editingId) return; // one hop at a time
      editingId = c.id;
      doc.querySelectorAll('.spv-hop').forEach(b => b.classList.toggle('is-dimmed', b.dataset.id !== c.id));
      renderHop(block, c, i);
    });
    block.querySelector('[data-f="save"]')?.addEventListener('click', () => {
      c.title = block.querySelector('.spv-title-input').value.trim();
      c.body = block.querySelector('.spv-hop-body').textContent;
      save();
      editingId = null; clearDim();
      renderHop(block, c, i);
      renderSections();
    });
    block.querySelector('[data-f="cancel"]')?.addEventListener('click', () => {
      editingId = null; clearDim();
      renderHop(block, c, i);
    });
  }

  function renderDoc() {
    doc.innerHTML = '';
    let total = 0;
    chapters.forEach(chap => {
      const chunks = chunksOf(chap.id).filter(isVisibleChunk);
      if (fullMode) {
        const divider = document.createElement('div');
        divider.className = 'spv-section-divider';
        divider.style.setProperty('--sec', chapterColor(chap.id));
        divider.innerHTML = `<span class="spv-sec-dot"></span><span class="spv-sec-name">${esc(chap.title)}</span><span class="spv-sec-count">${chunks.length} ${chunks.length === 1 ? 'HOP' : 'HOPS'}</span>`;
        doc.appendChild(divider);
      }
      if (!chunks.length) {
        const empty = document.createElement('div');
        empty.className = 'spv-empty-doc';
        empty.textContent = 'No hops in this section yet.';
        doc.appendChild(empty);
        return;
      }
      chunks.forEach((c, i) => {
        total++;
        const block = document.createElement('div');
        block.className = 'spv-hop';
        block.dataset.id = c.id;
        doc.appendChild(block);
        renderHop(block, c, i);
      });
    });
    if (!total && !fullMode) {
      doc.innerHTML = '<div class="spv-empty-doc">No hops in this section yet.</div>';
    }
  }
  renderDoc();
}

// Header shown at the top of an expanded chunk: current tags, characters, and
// locations attached to this scene (explicit links plus auto-detected mentions).
// Tags are chips; characters and locations are plain accent-colored text.
function chunkSummaryHeader(c) {
  const tags = (c.tagIds || []).map(id =>
    `<span class="tag" style="--lc:${tagColor(id)}">${esc(tagName(id))}</span>`).join('');
  const tagRow = `<div class="cs-row"><span class="cs-label">TAGS</span>`
    + `<span class="cs-vals">${tags || '<span class="cs-empty">—</span>'}</span></div>`;
  const chars = chunkEntities(ENTITY_KINDS.character, c);
  const locs = chunkEntities(ENTITY_KINDS.location, c);
  const orDash = (label, names) => names.length ? csTextRow(label, names)
    : `<div class="cs-row"><span class="cs-label">${label}</span><span class="cs-vals"><span class="cs-empty">—</span></span></div>`;
  return `<div class="chunk-summary">
    ${tagRow}
    ${orDash('CHARACTERS', chars)}
    ${orDash('LOCATIONS', locs)}
  </div>`;
}

function wireChunkCard(card) {
  const id = card.dataset.id;
  const c = db.chunks.find(x => x.id === id);
  if (!c) return;

  const del = async () => {
    if (!await confirmModal('Delete this hop?')) return;
    db.chunks = db.chunks.filter(x => x.id !== id);
    save(); renderSections();
  };

  card.querySelector('.chunk-display').addEventListener('click', e => {
    if (e.target.closest('[data-f="grip"]')) { e.stopPropagation(); return; }
    if (e.target.closest('.hop-kebab > summary')) { e.stopPropagation(); return; }
    if (e.target.closest('[data-f="del"]')) { e.stopPropagation(); del(); return; }
    if (e.target.closest('[data-f="archive"]')) {
      e.stopPropagation(); c.archived = !c.archived; save(); renderSections(); return;
    }
    if (e.target.closest('[data-f="title-edit"]')) { e.stopPropagation(); inlineEditHopTitle(card, c); return; }
    if (e.target.closest('[data-f="edit"]')) { e.stopPropagation(); openChunkModal(id); return; }
    if (e.target.closest('[data-f="analyze"]')) {
      e.stopPropagation(); analyzeChunk(c, e.target.closest('[data-f="analyze"]')); return;
    }
    if (e.target.closest('[data-f="post"]')) {
      e.stopPropagation();
      card.querySelector('.hop-kebab[open]')?.removeAttribute('open');
      postToCommunityModal(c); return;
    }
    if (e.target.closest('[data-f="viewposts"]')) {
      e.stopPropagation();
      card.querySelector('.hop-kebab[open]')?.removeAttribute('open');
      managePostsModal(c); return;
    }
    if (expandedChunks.has(id)) expandedChunks.delete(id); else expandedChunks.add(id);
    renderSections();
  });

  const kebab = card.querySelector('.hop-kebab');
  if (kebab) kebab.addEventListener('toggle', () => { if (kebab.open) positionHopMenu(kebab); });
}

// Swap the hop title for an inline input right in the card, so a quick rename
// never needs the full edit modal. Enter or blur commits, Escape cancels.
function inlineEditHopTitle(card, c) {
  const titleEl = card.querySelector('.chunk-disp-title');
  if (!titleEl || card.querySelector('.hop-title-input')) return;
  const pencil = card.querySelector('[data-f="title-edit"]');
  const input = document.createElement('input');
  input.className = 'hop-title-input';
  input.value = c.title || '';
  input.placeholder = 'Untitled hop';
  titleEl.replaceWith(input);
  if (pencil) pencil.style.display = 'none';
  // Suspend drag-and-drop so the input behaves like a normal text field
  // (highlighting/deleting text doesn't start dragging the card).
  const wasDraggable = card.getAttribute('draggable');
  card.setAttribute('draggable', 'false');
  input.focus(); input.select();

  let settled = false;
  const settle = keep => {
    if (settled) return; settled = true;
    if (keep) { c.title = input.value.trim(); save(); }
    if (wasDraggable !== null) card.setAttribute('draggable', wasDraggable);
    const span = document.createElement('span');
    span.className = 'chunk-disp-title';
    span.innerHTML = esc(c.title) || '<em>Untitled hop</em>';
    input.replaceWith(span);
    if (pencil) pencil.style.display = '';
    // While a text filter is active the rename can change what matches, so
    // rebuild the filtered list (also re-applies search highlights).
    if (keep && (sectionSearchQuery || '').trim()) {
      const ch = db.chapters.find(x => x.id === c.chapterId);
      if (ch) renderChunkList(ch);
    }
  };
  input.addEventListener('click', e => e.stopPropagation());
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); settle(true); }
    else if (e.key === 'Escape') { e.preventDefault(); settle(false); }
  });
  input.addEventListener('blur', () => settle(true));
}

// The hop menu is position:fixed, so place it under (or above) its summary using
// viewport coordinates. Flips upward when there isn't room below.
function positionHopMenu(details) {
  const summary = details.querySelector('summary');
  const menu = details.querySelector('.hop-menu');
  if (!summary || !menu) return;
  const r = summary.getBoundingClientRect();
  menu.style.visibility = 'hidden';
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = Math.max(8, r.right - mw);
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) {
    top = r.top - mh - 4;
    if (top < 8) top = Math.max(8, window.innerHeight - mh - 8);
  }
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.style.visibility = '';
}

// Close any open hop kebab menu when tapping outside of it.
document.addEventListener('click', e => {
  document.querySelectorAll('.hop-kebab[open]').forEach(d => {
    if (!d.contains(e.target)) d.removeAttribute('open');
  });
});
// A fixed menu would visually detach on scroll — close it instead.
window.addEventListener('scroll', () => {
  document.querySelectorAll('.hop-kebab[open]').forEach(d => d.removeAttribute('open'));
}, true);

// Cast / places search boxes filter their rail list live.
['charSearch', 'locSearch'].forEach(id => {
  const input = document.getElementById(id);
  if (input) input.addEventListener('input', () =>
    applyRailSearch(id === 'charSearch' ? ENTITY_KINDS.character : ENTITY_KINDS.location));
});

// TIMELINE is an EVENT timeline: discrete events fixed in time, each optionally
// surfacing in a hop but positioned independently on the chronological axis.
document.getElementById('addEventBtn')?.addEventListener('click', () => openEventModal(null));
document.getElementById('detectEventsBtn')?.addEventListener('click', detectEvents);
document.getElementById('generateOrderBtn')?.addEventListener('click', generateEventOrder);
document.getElementById('viewDismissedBtn')?.addEventListener('click', openDismissedModal);
document.getElementById('eventViewToggle')?.addEventListener('click', e => {
  const btn = e.target.closest('.ev-view-btn');
  if (!btn) return;
  evView = btn.dataset.view;
  document.querySelectorAll('#eventViewToggle .ev-view-btn')
    .forEach(b => b.classList.toggle('active', b === btn));
  renderTimelines();
});

document.getElementById('addChapterBtn').addEventListener('click', () => {
  const id = uid();
  const color = CHAPTER_PALETTE[db.chapters.length % CHAPTER_PALETTE.length];
  db.chapters.push({ id, title: `Chapter ${db.chapters.length + 1}`, order: db.chapters.length, color });
  db.ui.activeChapter = id;
  save(); renderSections();
});

document.getElementById('importSectionBtn')?.addEventListener('click', () => {
  const ch = db.chapters.find(c => c.id === db.ui.activeChapter) || db.chapters[0];
  if (!ch) { alertModal('Add a chapter first, then import content into it.', { title: 'IMPORT' }); return; }
  openSectionImportModal(ch);
});

document.getElementById('fullPreviewBtn')?.addEventListener('click', () => sectionPreviewModal());

// BACK from a section's detail editor to the full sections board.
document.getElementById('sectionBackBtn')?.addEventListener('click', () => {
  sectionsMode = 'board';
  renderSections();
});

// SHOW/HIDE ARCHIVED: shared toggle across sections, timelines, characters, tags.
document.querySelectorAll('[data-arch]').forEach(btn => {
  btn.addEventListener('click', () => {
    db.ui.showArchived = !db.ui.showArchived;
    save();
    route();
  });
});

/* =====================================================================
   TIMELINES
   ===================================================================== */
function chapterTitle(id) { return db.chapters.find(c => c.id === id)?.title || '—'; }

let tlDragId = null;
/* ---- Multiple timelines: named timelines + per-event membership ----
   Events carry a timelineIds[] set; an event can belong to many timelines (or
   none). The Timeline view has a tab strip — ALL plus one tab per timeline —
   that filters the chrono axis / kanban to the selected timeline. */
const TIMELINE_PALETTE = CHAPTER_PALETTE;
function timelinesSorted() {
  return [...(db.timelines || [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}
// The selected timeline id, or '' for ALL. Falls back to ALL if the stored id
// no longer exists (e.g. deleted, or switched projects).
function activeTimelineId() {
  const id = db.ui.activeTimeline || '';
  if (id && !(db.timelines || []).some(t => t.id === id)) return '';
  return id;
}
function visibleTimelineEvents() {
  const tl = activeTimelineId();
  const evs = eventsSorted();
  return tl ? evs.filter(e => (e.timelineIds || []).includes(tl)) : evs;
}
function timelineEventCount(id) {
  return (db.events || []).filter(e => !e.dismissed && (e.timelineIds || []).includes(id)).length;
}
function addTimeline(name) {
  db.timelines = db.timelines || [];
  const t = { id: uid(), name: (name || 'New timeline'), color: TIMELINE_PALETTE[db.timelines.length % TIMELINE_PALETTE.length], position: db.timelines.length };
  db.timelines.push(t);
  save();
  return t;
}
function deleteTimeline(id) {
  db.timelines = (db.timelines || []).filter(t => t.id !== id);
  (db.events || []).forEach(e => { if (Array.isArray(e.timelineIds)) e.timelineIds = e.timelineIds.filter(x => x !== id); });
  if (db.ui.activeTimeline === id) db.ui.activeTimeline = '';
  db.timelines.forEach((t, i) => t.position = i);
  save();
}

// The ALL/timeline tab strip above the event stage.
function renderTimelineTabs() {
  const wrap = document.getElementById('timelineTabs');
  if (!wrap) return;
  const active = activeTimelineId();
  const tab = (id, label, color, count) => {
    const dot = color ? `<span class="tl-tab-dot" style="background:${color}"></span>` : '';
    return `<button class="tl-tab ${id === active ? 'on' : ''}" data-tl="${esc(id)}">${dot}<span class="tl-tab-label">${esc(label)}</span><span class="tl-tab-count">${count}</span></button>`;
  };
  const allCount = (db.events || []).filter(e => !e.dismissed).length;
  wrap.innerHTML =
    tab('', 'ALL', '', allCount) +
    timelinesSorted().map(t => tab(t.id, t.name || 'Untitled', t.color || 'var(--accent)', timelineEventCount(t.id))).join('') +
    `<button class="tl-tab tl-tab-manage" data-act="manage" title="Manage timelines">＋</button>`;
  wrap.querySelectorAll('.tl-tab[data-tl]').forEach(btn =>
    btn.addEventListener('click', () => {
      db.ui.activeTimeline = btn.dataset.tl;
      save();
      renderTimelines();
    }));
  wrap.querySelector('[data-act="manage"]')?.addEventListener('click', openTimelineManageModal);
}

// Manage modal: add / rename (inline) / recolor (swatches) / delete timelines.
function openTimelineManageModal() {
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  overlay.innerHTML = `
    <div class="ui-modal tl-manage-modal" role="dialog" aria-modal="true">
      <button class="ui-modal-x" data-act="close" aria-label="Close" title="Close">&times;</button>
      <div class="ui-modal-title">TIMELINES</div>
      <div class="ui-modal-scroll">
        <div class="tl-manage-list"></div>
        <button class="ui-modal-btn solid tl-manage-add" data-act="add">＋ ADD TIMELINE</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const listEl = overlay.querySelector('.tl-manage-list');
  const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); renderTimelines(); };
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="close"]').addEventListener('click', close);
  overlay.querySelector('[data-act="add"]').addEventListener('click', () => {
    const t = addTimeline('New timeline');
    drawList();
    listEl.querySelector(`.tl-manage-row[data-id="${t.id}"] .tl-manage-name`)?.focus();
  });

  function drawList() {
    const tls = timelinesSorted();
    listEl.innerHTML = tls.length ? tls.map(t => `
      <div class="tl-manage-row" data-id="${t.id}">
        <span class="tl-manage-dot" style="background:${t.color || 'var(--accent)'}"></span>
        <input class="tl-manage-name" value="${esc(t.name || '')}" maxlength="80" placeholder="Timeline name…" />
        <div class="tl-manage-swatches">${TIMELINE_PALETTE.map(c => `<button type="button" class="tl-sw ${c === t.color ? 'on' : ''}" data-color="${c}" style="--sw:${c}" title="${c}"></button>`).join('')}</div>
        <button class="tl-manage-del" data-act="del" title="Delete timeline">✕</button>
      </div>`).join('') : `<div class="tl-manage-empty">No timelines yet. Add one to group events.</div>`;
    listEl.querySelectorAll('.tl-manage-row').forEach(row => {
      const id = row.dataset.id;
      const t = (db.timelines || []).find(x => x.id === id);
      if (!t) return;
      row.querySelector('.tl-manage-name').addEventListener('input', e => { t.name = e.target.value; save(); });
      row.querySelectorAll('.tl-sw').forEach(sw => sw.addEventListener('click', () => {
        t.color = sw.dataset.color;
        row.querySelector('.tl-manage-dot').style.background = t.color;
        row.querySelectorAll('.tl-sw').forEach(s => s.classList.toggle('on', s === sw));
        save();
      }));
      row.querySelector('[data-act="del"]').addEventListener('click', async () => {
        const n = timelineEventCount(id);
        const msg = n ? `Delete this timeline? ${n} event${n === 1 ? '' : 's'} will be removed from it (the events themselves stay).` : 'Delete this timeline?';
        if (!await confirmModal(msg, { title: 'DELETE TIMELINE', okText: 'Delete', danger: true })) return;
        deleteTimeline(id);
        drawList();
      });
    });
  }
  drawList();
}

function renderTimelines() {
  renderTimelineTabs();
  // populate character filter
  const sel = document.getElementById('timelineCharFilter');
  const prev = sel.value;
  sel.innerHTML = `<option value="">— all —</option>` +
    db.characters.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  sel.value = prev;
  sel.onchange = renderTimelines;
  const filterChar = sel.value;

  // Surface the VIEW DISMISSED button only when there are dismissed events.
  const dismissBtn = document.getElementById('viewDismissedBtn');
  if (dismissBtn) {
    const n = dismissedEvents().length;
    dismissBtn.hidden = n === 0;
    dismissBtn.innerHTML = `\u25CB VIEW DISMISSED (${n})`;
  }

  renderEventTimeline(document.getElementById('timelineStage'), filterChar);
}

/* ---- EVENT views: chronological axis OR by-section kanban ---- */
let evDragId = null;
let evExpanded = new Set();      // event ids currently expanded (title-only by default)
let evView = 'chrono';          // 'chrono' | 'section'
function eventsSorted() {
  return [...(db.events || [])].filter(e => !e.dismissed).sort((a, b) => (a.chronoPos ?? 0) - (b.chronoPos ?? 0));
}
function dismissedEvents() {
  return [...(db.events || [])].filter(e => e.dismissed).sort((a, b) => (a.chronoPos ?? 0) - (b.chronoPos ?? 0));
}
function toggleEvExpand(id) {
  if (evExpanded.has(id)) evExpanded.delete(id); else evExpanded.add(id);
  renderTimelines();
}

// Shared inner card used by both event views: the title (+ when) shows always;
// the description / hop link / characters reveal on EXPAND; a kebab folds the
// EDIT + DELETE actions.
function eventCardInner(ev, opts = {}) {
  const expanded = evExpanded.has(ev.id);
  const hop = ev.hopId ? db.chunks.find(c => c.id === ev.hopId) : null;
  const color = hop ? chapterColor(hop.chapterId) : 'var(--accent)';
  const chars = (ev.characterIds || []).map(id => db.characters.find(c => c.id === id)).filter(Boolean);
  const locs = (ev.locationIds || []).map(id => (db.locations || []).find(l => l.id === id)).filter(Boolean);
  const hasDetail = !!(ev.description || hop || chars.length || locs.length);
  return `
    <div class="ev-card ${expanded ? 'is-expanded' : ''}" style="border-left:3px solid ${color}">
      <div class="ev-card-head">
        <button class="ev-expand" data-act="toggle" title="${expanded ? 'Collapse' : 'Expand'}">${hasDetail ? (expanded ? '\u25BE' : '\u25B8') : '\u00B7'}</button>
        <span class="ev-card-headmain">
          ${(!opts.hideDate && ev.dateLabel) ? `<span class="ev-date">${esc(ev.dateLabel)}</span>` : ''}
          <span class="ev-card-title">${esc(ev.title || 'Untitled event')}</span>
        </span>
        <details class="hop-kebab ev-kebab">
          <summary title="Options">\u22EE</summary>
          <div class="hop-menu">
            <button class="add-btn" data-act="edit">EDIT</button>
            <button class="add-btn danger" data-act="del">DELETE</button>
          </div>
        </details>
      </div>
      ${expanded && hasDetail ? `
        <div class="ev-card-detail">
          ${ev.description ? `<span class="ev-card-desc">${esc(ev.description)}</span>` : ''}
          <span class="ev-card-foot">
            ${hop ? `<span class="ev-hop-link" data-hop="${hop.id}" title="Open the hop this surfaces in">\u21B7 ${esc(hop.title || 'Untitled hop')}</span>` : `<span class="ev-hop-none">unlinked</span>`}
            ${chars.length ? `<span class="ev-card-chars">${chars.map(c => esc(c.name)).join(', ')}</span>` : ''}
            ${locs.length ? `<span class="ev-card-chars ev-card-locs">${locs.map(l => esc(l.name)).join(', ')}</span>` : ''}
          </span>
        </div>` : ''}
    </div>`;
}

// Click delegation shared by both views: kebab EDIT/DELETE, hop link, expand.
function wireEventCard(cardEl, id) {
  if (!cardEl) return;
  const kebab = cardEl.querySelector('.ev-kebab');
  if (kebab) kebab.addEventListener('toggle', () => { if (kebab.open) positionHopMenu(kebab); });
  cardEl.addEventListener('click', e => {
    if (e.target.closest('.ev-kebab > summary')) return;     // let <details> toggle
    const hopLink = e.target.closest('.ev-hop-link');
    if (hopLink) { e.stopPropagation(); openChunkModal(hopLink.dataset.hop); return; }
    const closeKebab = () => cardEl.querySelector('.ev-kebab[open]')?.removeAttribute('open');
    const actEl = e.target.closest('[data-act]');
    if (actEl) {
      const act = actEl.dataset.act;
      if (act === 'toggle') { e.stopPropagation(); toggleEvExpand(id); return; }
      if (act === 'edit') { e.stopPropagation(); closeKebab(); openEventModal(id); return; }
      if (act === 'del') {
        e.stopPropagation(); closeKebab();
        (async () => {
          if (await confirmModal('Delete this event? This cannot be undone.', { title: 'DELETE EVENT' })) {
            db.events = (db.events || []).filter(x => x.id !== id);
            save(); renderTimelines();
          }
        })();
        return;
      }
    }
    if (e.target.closest('.ev-card-headmain')) { toggleEvExpand(id); return; }
  });
}

function renderEventTimeline(stage, filterChar) {
  if (evView === 'section') return renderEventKanban(stage, filterChar);
  const events = visibleTimelineEvents();
  if (!events.length) {
    stage.innerHTML = `<div class="pane-empty">${activeTimelineId() ? 'No events in this timeline yet. Add an event, or open an event and assign it to this timeline.' : 'No events yet. Add one by hand, or DETECT EVENTS to pull moments fixed in time straight from your writing.'}</div>`;
    return;
  }
  stage.innerHTML = `<div class="ev-timeline">` + events.map(ev => {
    const dim = filterChar && !(ev.characterIds || []).includes(filterChar) ? 'dim' : '';
    const hop = ev.hopId ? db.chunks.find(c => c.id === ev.hopId) : null;
    const color = hop ? chapterColor(hop.chapterId) : 'var(--accent)';
    return `
      <div class="ev-row ${dim}" data-id="${ev.id}" draggable="true">
        <div class="ev-when-gutter">${ev.dateLabel ? esc(ev.dateLabel) : ''}</div>
        <div class="ev-axis"><span class="ev-dot" style="background:${color}"></span></div>
        ${eventCardInner(ev, { hideDate: true })}
      </div>`;
  }).join('') + `</div>`;

  stage.querySelectorAll('.ev-row').forEach(row => {
    const id = row.dataset.id;
    wireEventCard(row.querySelector('.ev-card'), id);
    row.addEventListener('dragstart', e => {
      evDragId = id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      requestAnimationFrame(() => row.classList.add('dragging'));
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      clearEvMarkers();
      evDragId = null;
    });
  });
  wireEvTimelineDnD(stage.querySelector('.ev-timeline'));
}

// BY SECTION: one swimlane per section holding the events whose linked hop lives
// in that section; events with no hop link gather in an UNLINKED lane.
function renderEventKanban(stage, filterChar) {
  const events = visibleTimelineEvents();
  if (!events.length) {
    stage.innerHTML = `<div class="pane-empty">${activeTimelineId() ? 'No events in this timeline yet. Add an event, or open an event and assign it to this timeline.' : 'No events yet. Add one by hand, or DETECT EVENTS to pull moments fixed in time straight from your writing.'}</div>`;
    return;
  }
  const chapters = [...db.chapters].sort((a, b) => a.order - b.order);
  const byCh = new Map(chapters.map(ch => [ch.id, []]));
  const unlinked = [];
  events.forEach(ev => {
    const hop = ev.hopId ? db.chunks.find(c => c.id === ev.hopId) : null;
    if (hop && byCh.has(hop.chapterId)) byCh.get(hop.chapterId).push(ev);
    else unlinked.push(ev);
  });
  const lanes = chapters
    .map(ch => ({ title: ch.title, color: chapterColor(ch.id), evs: byCh.get(ch.id) }))
    .filter(l => l.evs.length);
  if (unlinked.length) lanes.push({ title: 'UNLINKED', color: 'var(--muted)', evs: unlinked });

  stage.innerHTML = `<div class="kanban ev-kanban">` + lanes.map(lane => {
    const cards = lane.evs.map(ev => {
      const dim = filterChar && !(ev.characterIds || []).includes(filterChar) ? 'dim' : '';
      return `<div class="ev-kan-card ${dim}" data-id="${ev.id}">${eventCardInner(ev)}</div>`;
    }).join('');
    return `
      <div class="lane ev-lane">
        <div class="lane-head">
          <span class="ci-dot" style="background:${lane.color}"></span>
          <span class="lane-title-static" style="color:${lane.color}">${esc(lane.title)}</span>
          <span class="lane-count">${lane.evs.length}</span>
        </div>
        <div class="lane-cards ev-lane-cards">${cards}</div>
      </div>`;
  }).join('') + `</div>`;

  stage.querySelectorAll('.ev-kan-card').forEach(card =>
    wireEventCard(card.querySelector('.ev-card'), card.dataset.id));
}

function clearEvMarkers() {
  document.querySelectorAll('.ev-row.drop-before, .ev-row.drop-after')
    .forEach(r => r.classList.remove('drop-before', 'drop-after'));
}
function evDragAfter(container, y) {
  const rows = [...container.querySelectorAll('.ev-row:not(.dragging)')];
  for (const r of rows) {
    const box = r.getBoundingClientRect();
    if (y < box.top + box.height / 2) return r;
  }
  return null;
}
function wireEvTimelineDnD(container) {
  if (!container) return;
  container.addEventListener('dragover', e => {
    if (!evDragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearEvMarkers();
    const after = evDragAfter(container, e.clientY);
    if (after) after.classList.add('drop-before');
    else {
      const rows = container.querySelectorAll('.ev-row:not(.dragging)');
      if (rows.length) rows[rows.length - 1].classList.add('drop-after');
    }
  });
  container.addEventListener('drop', e => {
    if (!evDragId) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || evDragId;
    const after = evDragAfter(container, e.clientY);
    clearEvMarkers();
    reorderEvent(id, after ? after.dataset.id : null);
  });
}
// Move event `id` to sit before `beforeId` (end if null) on the chrono axis, then
// renumber every event's chronoPos to its index so the order is stable.
function reorderEvent(id, beforeId) {
  if (id === beforeId) return;
  const ordered = eventsSorted().filter(e => e.id !== id);
  const moving = (db.events || []).find(e => e.id === id);
  if (!moving) return;
  let idx = beforeId ? ordered.findIndex(e => e.id === beforeId) : ordered.length;
  if (idx < 0) idx = ordered.length;
  ordered.splice(idx, 0, moving);
  ordered.forEach((e, i) => e.chronoPos = i);
  save();
  renderTimelines();
}

/* ---- EVENT editor modal ---- */
let modalEventId = null;       // id of the event being edited, or null for a new draft
let eventDraft = null;         // working copy; committed to db.events only on SAVE

function openEventModal(eventId, presetHopId = null) {
  const existing = eventId ? (db.events || []).find(e => e.id === eventId) : null;
  modalEventId = eventId;
  // Edit a copy so cancelling discards changes; a brand-new event starts blank.
  eventDraft = existing
    ? { ...existing, characterIds: [...(existing.characterIds || [])], locationIds: [...(existing.locationIds || [])], timelineIds: [...(existing.timelineIds || [])] }
    : { id: uid(), hopId: presetHopId || null, title: '', description: '', dateLabel: '', chronoPos: (db.events || []).length, characterIds: [], locationIds: [], timelineIds: activeTimelineId() ? [activeTimelineId()] : [] };

  document.getElementById('eventModalKicker').textContent = existing ? 'EVENT' : 'NEW EVENT';
  document.getElementById('eventModalTitle').value = eventDraft.title || '';
  document.getElementById('eventModalDate').value = eventDraft.dateLabel || '';
  document.getElementById('eventModalDesc').value = eventDraft.description || '';
  document.getElementById('eventModalDelete').style.display = existing ? '' : 'none';

  const hopSel = document.getElementById('eventModalHop');
  const hopOpts = db.chapters
    .slice().sort((a, b) => a.order - b.order)
    .flatMap(ch => chunksOf(ch.id).map(c => ({ id: c.id, label: `${ch.title} · ${c.title || 'Untitled hop'}` })));
  hopSel.innerHTML = `<option value="">— not linked —</option>` +
    hopOpts.map(o => `<option value="${o.id}" ${o.id === eventDraft.hopId ? 'selected' : ''}>${esc(o.label)}</option>`).join('');

  renderEventChars();
  renderEventLocs();
  renderEventTimelines();

  document.getElementById('eventModalOverlay').hidden = false;
  document.getElementById('eventModalTitle').focus();
}

// Timeline membership chips in the event modal. Toggling adds/removes the event
// from that timeline; a trailing chip creates a new timeline inline.
function renderEventTimelines() {
  const wrap = document.getElementById('eventModalTimelines');
  if (!wrap) return;
  const chips = timelinesSorted().map(t => {
    const on = (eventDraft.timelineIds || []).includes(t.id);
    return `<button type="button" class="ev-char-chip ${on ? 'on' : ''}" data-tlid="${t.id}" style="--cc:${t.color || 'var(--accent)'}">${esc(t.name || 'Untitled')}</button>`;
  }).join('');
  wrap.innerHTML = chips + `<button type="button" class="ev-char-chip ev-tl-new" data-act="newtl">＋ NEW TIMELINE</button>`;
  wrap.querySelectorAll('.ev-char-chip[data-tlid]').forEach(chip => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.tlid;
      const arr = eventDraft.timelineIds || (eventDraft.timelineIds = []);
      const i = arr.indexOf(id);
      if (i >= 0) arr.splice(i, 1); else arr.push(id);
      chip.classList.toggle('on');
    });
  });
  wrap.querySelector('[data-act="newtl"]')?.addEventListener('click', async () => {
    const name = await promptModal('Timeline name:', '', { title: 'NEW TIMELINE', okText: 'Add' });
    if (!name || !name.trim()) return;
    const t = addTimeline(name.trim());
    (eventDraft.timelineIds || (eventDraft.timelineIds = [])).push(t.id);
    renderEventTimelines();
  });
}

function renderEventChars() {
  const wrap = document.getElementById('eventModalChars');
  if (!wrap) return;
  if (!db.characters.length) {
    wrap.innerHTML = `<span class="ci-count">no characters yet — add them in CHARACTERS</span>`;
    return;
  }
  wrap.innerHTML = db.characters.map(c => {
    const on = (eventDraft.characterIds || []).includes(c.id);
    return `<button type="button" class="ev-char-chip ${on ? 'on' : ''}" data-cid="${c.id}" style="--cc:${c.color || 'var(--accent)'}">${esc(c.name)}</button>`;
  }).join('');
  wrap.querySelectorAll('.ev-char-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.cid;
      const arr = eventDraft.characterIds || (eventDraft.characterIds = []);
      const i = arr.indexOf(id);
      if (i >= 0) arr.splice(i, 1); else arr.push(id);
      chip.classList.toggle('on');
    });
  });
}

function renderEventLocs() {
  const wrap = document.getElementById('eventModalLocs');
  if (!wrap) return;
  if (!(db.locations || []).length) {
    wrap.innerHTML = `<span class="ci-count">no locations yet — add them in LOCATIONS</span>`;
    return;
  }
  wrap.innerHTML = db.locations.map(l => {
    const on = (eventDraft.locationIds || []).includes(l.id);
    return `<button type="button" class="ev-char-chip ${on ? 'on' : ''}" data-lid="${l.id}" style="--cc:${l.color || 'var(--accent)'}">${esc(l.name)}</button>`;
  }).join('');
  wrap.querySelectorAll('.ev-char-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.lid;
      const arr = eventDraft.locationIds || (eventDraft.locationIds = []);
      const i = arr.indexOf(id);
      if (i >= 0) arr.splice(i, 1); else arr.push(id);
      chip.classList.toggle('on');
    });
  });
}

function closeEventModal() {
  document.getElementById('eventModalOverlay').hidden = true;
  modalEventId = null;
  eventDraft = null;
}

function saveEventFromModal() {
  if (!eventDraft) return;
  eventDraft.title = document.getElementById('eventModalTitle').value.trim();
  eventDraft.dateLabel = document.getElementById('eventModalDate').value.trim();
  eventDraft.description = document.getElementById('eventModalDesc').value.trim();
  eventDraft.hopId = document.getElementById('eventModalHop').value || null;
  if (!eventDraft.title && !eventDraft.description) { closeEventModal(); return; }
  const existing = modalEventId ? (db.events || []).find(e => e.id === modalEventId) : null;
  if (existing) Object.assign(existing, eventDraft);
  else { db.events = db.events || []; db.events.push(eventDraft); }
  save();
  closeEventModal();
  renderTimelines();
  refreshChunkModalEvents();
}

function deleteEventFromModal() {
  if (!modalEventId) { closeEventModal(); return; }
  db.events = (db.events || []).filter(e => e.id !== modalEventId);
  save();
  closeEventModal();
  renderTimelines();
  refreshChunkModalEvents();
}

// Render the events linked to hop `c` inside the open hop modal. Each row shows
// the event title (+ when); clicking opens the event editor.
function renderChunkEvents(c) {
  const wrap = document.getElementById('chunkModalEvents');
  if (!wrap) return;
  const linked = (db.events || [])
    .filter(e => !e.dismissed && e.hopId === c.id)
    .sort((a, b) => (a.chronoPos ?? 0) - (b.chronoPos ?? 0));
  if (!linked.length) {
    wrap.innerHTML = `<span class="ci-count">No events linked to this hop yet.</span>`;
    return;
  }
  wrap.innerHTML = `<div class="chunk-ev-list">` + linked.map(e => `
    <button type="button" class="chunk-ev-item" data-ev="${e.id}" title="Open this event">
      ${e.dateLabel ? `<span class="chunk-ev-when">${esc(e.dateLabel)}</span>` : ''}
      <span class="chunk-ev-title">${esc(e.title || 'Untitled event')}</span>
    </button>`).join('') + `</div>`;
  wrap.querySelectorAll('.chunk-ev-item').forEach(btn =>
    btn.addEventListener('click', () => openEventModal(btn.dataset.ev)));
}

// Re-render the hop modal's EVENTS list if that modal is currently open (used
// after the event editor saves/deletes an event linked to the open hop).
function refreshChunkModalEvents() {
  const overlay = document.getElementById('chunkModalOverlay');
  if (!overlay || overlay.hidden) return;
  const c = resolveChunk(modalChunkId);
  if (c) renderChunkEvents(c);
}

document.getElementById('eventModalSave')?.addEventListener('click', saveEventFromModal);
document.getElementById('eventModalClose')?.addEventListener('click', closeEventModal);
document.getElementById('eventModalDelete')?.addEventListener('click', async () => {
  if (await confirmModal('Delete this event? This cannot be undone.', { title: 'DELETE EVENT' })) deleteEventFromModal();
});
document.getElementById('eventModalOverlay')?.addEventListener('mousedown', e => {
  if (e.target.id === 'eventModalOverlay') closeEventModal();
});

/* ---- DETECT EVENTS: scan the manuscript for moments fixed in time ---- */
// Loose title key for duplicate detection: lower-cased, punctuation-stripped.
function evNormTitle(s) { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

async function detectEvents() {
  const btn = document.getElementById('detectEventsBtn');
  const manuscript = db.chapters
    .slice().sort((a, b) => a.order - b.order)
    .flatMap(ch => chunksOf(ch.id)
      .filter(c => (c.body || '').trim())
      .map(c => ({ hopId: c.id, section: ch.title, title: c.title || 'Untitled hop', body: c.body })));
  if (!manuscript.length) { alertModal('Write some hops first — there is nothing to scan yet.', { title: 'DETECT EVENTS' }); return; }

  const original = aiBtnStart(btn, IC_DETECT, 'SCANNING…');
  try {
    const hops = manuscript.map(h => ({ id: h.hopId, title: h.title, section: h.section, body: h.body }));
    // Hand the model the events we already have so it can avoid re-reporting them.
    const existing = (db.events || []).map(e => ({ title: e.title, when: e.dateLabel || '' }));
    // Rosters of the author's own characters/locations (name + aliases) so the model
    // tags each event with the EXACT entity names, which we then resolve back to ids.
    const characters = (db.characters || []).map(c => ({ name: c.name, aliases: c.aliases || [] }));
    const locations = (db.locations || []).map(l => ({ name: l.name, aliases: l.aliases || [] }));
    const { events: found = [] } = await aiInvoke({ task: 'detect_events', hops, existing, characters, locations });
    aiBtnDone(btn, original);
    const hadEvents = !!(db.events && db.events.length);
    if (!found.length) {
      alertModal(
        hadEvents
          ? 'All events categorized — no new large-scale events were found.'
          : 'No events were detected. Try adding more detail to your hops.',
        { title: 'DETECT EVENTS' });
      return;
    }

    // Client-side dedup safety net: flag any detected event whose title already
    // exists on the timeline, drop any that match an event the author previously
    // DISMISSED, and collapse duplicates within the batch itself.
    const have = new Set((db.events || []).filter(e => !e.dismissed).map(e => evNormTitle(e.title)));
    const dismissedKeys = new Set((db.events || []).filter(e => e.dismissed).map(e => evNormTitle(e.title)));
    const seen = new Set();
    const annotated = found.map(e => {
      const key = evNormTitle(e.title);
      const dup = !!key && (have.has(key) || seen.has(key));
      if (key) seen.add(key);
      return { ...e, _dup: dup, _dismissed: !!key && dismissedKeys.has(key) };
    });
    // Events the author already waved off never resurface in the review modal.
    const visible = annotated.filter(e => !e._dismissed);
    const newCount = visible.filter(e => !e._dup).length;
    const dupCount = visible.length - newCount;
    // Nothing genuinely new — detection has converged. Report and stop.
    if (newCount === 0) {
      alertModal('All events categorized — every event found is already on your timeline or was dismissed.', { title: 'DETECT EVENTS' });
      return;
    }

    // Resolve AI-returned entity NAMES back to the author's entity ids, matching on
    // canonical name or any alias (case-insensitive). Unknown names are dropped.
    const resolveNames = (names, coll) => {
      if (!Array.isArray(names) || !names.length) return [];
      const ents = db[coll] || [];
      const ids = [];
      names.forEach(nm => {
        const key = (nm || '').trim().toLowerCase();
        if (!key) return;
        const ent = ents.find(e =>
          (e.name || '').trim().toLowerCase() === key ||
          (Array.isArray(e.aliases) && e.aliases.some(a => (a || '').trim().toLowerCase() === key)));
        if (ent && !ids.includes(ent.id)) ids.push(ent.id);
      });
      return ids;
    };

    const review = await eventReviewModal(visible, { dupCount });
    if (!review) return; // cancelled — change nothing
    const { chosen = [], dismissed = [] } = review;
    if (!chosen.length && !dismissed.length) return;
    db.events = db.events || [];
    let pos = eventsSorted().length;
    const validHops = new Set(db.chunks.map(c => c.id));
    const mkEvent = (ev, isDismissed) => ({
      id: uid(),
      hopId: validHops.has(ev.hopId) ? ev.hopId : null,
      title: (ev.title || '').slice(0, 200),
      description: ev.description || '',
      dateLabel: ev.when || '',
      chronoPos: isDismissed ? 0 : pos++,
      characterIds: resolveNames(ev.characters, 'characters'),
      locationIds: resolveNames(ev.locations, 'locations'),
      timelineIds: (!isDismissed && activeTimelineId()) ? [activeTimelineId()] : [],
      dismissed: isDismissed
    });
    chosen.forEach(ev => db.events.push(mkEvent(ev, false)));
    // Unchecked candidates are remembered as DISMISSED so future detections skip them.
    dismissed.forEach(ev => db.events.push(mkEvent(ev, true)));
    save();
    renderTimelines();
  } catch (err) {
    aiBtnDone(btn, original);
    alertModal('Event detection failed.\n\n' + (err.message || ''), { title: 'DETECT EVENTS' });
  }
}

/* ---- GENERATE ORDER: sort EXISTING events into in-world chronological order ----
   Adds nothing new. Hands the current events (title + when + description) to the
   sort-events function and reassigns chronoPos from the returned ordering. Manual
   dot-dragging still overrides afterward. */
async function generateEventOrder() {
  const btn = document.getElementById('generateOrderBtn');
  const active = eventsSorted();
  if (active.length < 2) {
    alertModal('Add at least two events before generating an order.', { title: 'GENERATE ORDER' });
    return;
  }
  const original = aiBtnStart(btn, IC_DETECT, 'ORDERING…');
  try {
    const payload = active.map(e => ({
      id: e.id,
      title: e.title || '',
      when: e.dateLabel || '',
      description: (e.description || '').slice(0, 400)
    }));
    const tier = (currentProfile && currentProfile.ai_tier) || 'standard';
    const { data, error } = await sb.functions.invoke('sort-events', { body: { events: payload, tier } });
    if (error) {
      let detail = error.message || 'request failed';
      try { const ctx = await error.context?.json?.(); if (ctx?.error) detail = ctx.error; } catch (_) {}
      throw new Error(detail);
    }
    if (data && data.error) throw new Error(data.error);
    const order = Array.isArray(data && data.order) ? data.order : [];
    aiBtnDone(btn, original);
    if (!order.length) { alertModal('Could not determine an order. Try again.', { title: 'GENERATE ORDER' }); return; }
    // Reassign chronoPos by the returned ranking; any id the sorter omitted keeps
    // its current relative position appended at the end.
    const rank = new Map(order.map((id, i) => [id, i]));
    const fallback = active.length;
    const reordered = [...active].sort((a, b) =>
      (rank.has(a.id) ? rank.get(a.id) : fallback) - (rank.has(b.id) ? rank.get(b.id) : fallback));
    reordered.forEach((e, i) => { const ev = db.events.find(x => x.id === e.id); if (ev) ev.chronoPos = i; });
    save();
    renderTimelines();
  } catch (err) {
    aiBtnDone(btn, original);
    alertModal('Generate order failed.\n\n' + (err.message || ''), { title: 'GENERATE ORDER' });
  }
}

// Review modal: pick which detected events to add. Events already on the timeline
// (marked `_dup`) are shown with an ALREADY ON TIMELINE badge and start unchecked.
// Resolves to the chosen array (in original order) or null on cancel.
function eventReviewModal(events, opts = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'ui-modal-overlay';
    const hopName = id => { const c = db.chunks.find(x => x.id === id); return c ? (c.title || 'Untitled hop') : ''; };
    const dupNote = opts.dupCount
      ? ` ${opts.dupCount} already on your timeline ${opts.dupCount === 1 ? 'is' : 'are'} pre-unchecked.`
      : '';
    overlay.innerHTML = `
      <div class="ui-modal ev-review" role="dialog" aria-modal="true">
        <div class="ui-modal-title">DETECTED EVENTS</div>
        <div class="ui-modal-msg">${events.length} event${events.length === 1 ? '' : 's'} found. Uncheck any you don't want — they'll be remembered as dismissed and won't resurface on future detections (restore them anytime via VIEW DISMISSED).${dupNote}</div>
        <div class="ev-review-list">
          ${events.map((e, i) => `
            <label class="ev-review-item ${e._dup ? 'is-dup' : ''}">
              <input type="checkbox" data-i="${i}" ${e._dup ? '' : 'checked'} />
              <span class="ev-review-body">
                ${e.when ? `<span class="ev-review-when">${esc(e.when)}</span>` : ''}
                <span class="ev-review-title">${esc(e.title || 'Untitled event')}${e._dup ? ' <span class="ev-review-dup">ALREADY ON TIMELINE</span>' : ''}</span>
                ${e.description ? `<span class="ev-review-desc">${esc(e.description)}</span>` : ''}
                ${e.hopId && hopName(e.hopId) ? `<span class="ev-review-hop">↳ ${esc(hopName(e.hopId))}</span>` : ''}
              </span>
            </label>`).join('')}
        </div>
        <div class="ui-modal-actions">
          <button class="ui-modal-btn" data-act="cancel">Cancel</button>
          <button class="ui-modal-btn solid" data-act="ok">Add selected</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = val => { overlay.remove(); resolve(val); };
    overlay.querySelector('[data-act="ok"]').addEventListener('click', () => {
      const chosen = [], dismissed = [];
      events.forEach((e, i) => {
        const cb = overlay.querySelector(`input[data-i="${i}"]`);
        if (cb && cb.checked) chosen.push(e);
        else if (!e._dup) dismissed.push(e); // unchecked & not already on timeline → dismiss
      });
      done({ chosen, dismissed });
    });
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => done(null));
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) done(null); });
  });
}

// DISMISSED EVENTS: candidates the author waved off during detection. They stay in
// the DB (dismissed=true) so future detections skip them, but can be RESTORED back
// onto the timeline or permanently DELETED here.
function openDismissedModal() {
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  const hopName = id => { const c = db.chunks.find(x => x.id === id); return c ? (c.title || 'Untitled hop') : ''; };
  const close = () => overlay.remove();
  function render() {
    const list = dismissedEvents();
    if (!list.length) { close(); renderTimelines(); return; }
    overlay.innerHTML = `
      <div class="ui-modal ev-review" role="dialog" aria-modal="true">
        <div class="ui-modal-title">DISMISSED EVENTS</div>
        <div class="ui-modal-msg">${list.length} dismissed event${list.length === 1 ? '' : 's'}. These are hidden from your timeline and skipped on future detections. RESTORE one to put it back, or DELETE it for good.</div>
        <div class="ev-review-list">
          ${list.map(e => `
            <div class="ev-review-item is-dismissed" data-id="${e.id}">
              <span class="ev-review-body">
                ${e.dateLabel ? `<span class="ev-review-when">${esc(e.dateLabel)}</span>` : ''}
                <span class="ev-review-title">${esc(e.title || 'Untitled event')}</span>
                ${e.description ? `<span class="ev-review-desc">${esc(e.description)}</span>` : ''}
                ${e.hopId && hopName(e.hopId) ? `<span class="ev-review-hop">\u21B7 ${esc(hopName(e.hopId))}</span>` : ''}
              </span>
              <span class="ev-dismiss-actions">
                <button class="add-btn" data-act="restore" data-id="${e.id}">RESTORE</button>
                <button class="add-btn danger" data-act="del" data-id="${e.id}">DELETE</button>
              </span>
            </div>`).join('')}
        </div>
        <div class="ui-modal-actions">
          <button class="ui-modal-btn" data-act="done">Done</button>
        </div>
      </div>`;
    overlay.querySelector('[data-act="done"]').addEventListener('click', () => { close(); renderTimelines(); });
    overlay.querySelectorAll('[data-act="restore"]').forEach(btn => btn.addEventListener('click', () => {
      const ev = (db.events || []).find(x => x.id === btn.dataset.id);
      if (ev) { ev.dismissed = false; ev.chronoPos = eventsSorted().length; save(); }
      render();
    }));
    overlay.querySelectorAll('[data-act="del"]').forEach(btn => btn.addEventListener('click', async () => {
      if (!await confirmModal('Delete this dismissed event for good? This cannot be undone.', { title: 'DELETE EVENT' })) return;
      db.events = (db.events || []).filter(x => x.id !== btn.dataset.id);
      save();
      render();
    }));
  }
  document.body.appendChild(overlay);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) { close(); renderTimelines(); } });
  render();
}

// Is this hop dimmed under the current filters? (presence = explicit link OR mention)
function tlDimmed(c, filterChar, filterLabel) {
  const charEnt = filterChar ? db.characters.find(x => x.id === filterChar) : null;
  const hideChar = charEnt && !chunkEntityPresence(ENTITY_KINDS.character, c, charEnt).on;
  const hideLabel = filterLabel && !(c.tagIds || []).includes(filterLabel);
  return hideChar || hideLabel;
}

/* ---- NARRATIVE: kanban board, one swimlane per section (chapter) ---- */
function renderNarrativeTimeline(stage, filterChar, filterLabel) {
  const chapters = [...db.chapters].sort((a, b) => a.order - b.order);
  if (!chapters.length) { stage.innerHTML = `<div class="pane-empty">Add a section to begin.</div>`; return; }

  let nOrd = 0; // running narrative position across every lane, in reading order
  stage.innerHTML = `<div class="kanban tl-kanban">` + chapters.map(ch => {
    const color = chapterColor(ch.id);
    const hops = chunksOf(ch.id).filter(isVisibleChunk);
    const cards = hops.map(c => {
      const dim = tlDimmed(c, filterChar, filterLabel) ? 'dim' : '';
      const ord = ++nOrd;
      return `
      <div class="tl-kanban-card ${dim} ${c.archived ? 'archived' : ''}" data-id="${c.id}" draggable="true" style="border-left:3px solid ${color}">
        <span class="tl-kc-ord">N${ord}</span>
        <span class="tl-kc-title">${esc(c.title || 'Untitled hop')}</span>
        ${c.archived ? '<span class="arch-badge">ARCHIVED</span>' : ''}
      </div>`;
    }).join('') || `<div class="lane-empty">Drop hops here</div>`;
    return `
      <div class="lane tl-lane" data-chapter="${ch.id}">
        <div class="lane-head">
          <span class="ci-dot" style="background:${color}"></span>
          <span class="lane-title-static" style="color:${color}">${esc(ch.title)}</span>
          <span class="lane-count">${hops.length}</span>
        </div>
        <div class="lane-cards tl-lane-cards" data-chapter="${ch.id}">${cards}</div>
      </div>`;
  }).join('') + `</div>`;

  stage.querySelectorAll('.tl-kanban-card').forEach(card => {
    const id = card.dataset.id;
    card.addEventListener('click', () => { if (!card.classList.contains('dragging')) openChunkModal(id); });
    card.addEventListener('dragstart', e => {
      tlDragId = id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      requestAnimationFrame(() => card.classList.add('dragging'));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      clearTlLaneMarkers();
      tlDragId = null;
    });
  });
  stage.querySelectorAll('.tl-lane-cards').forEach(wireTlLaneDnD);
}

function clearTlLaneMarkers() {
  document.querySelectorAll('.tl-kanban-card.drop-before, .tl-kanban-card.drop-after')
    .forEach(c => c.classList.remove('drop-before', 'drop-after'));
  document.querySelectorAll('.tl-lane-cards.drop-into').forEach(c => c.classList.remove('drop-into'));
}
function tlLaneDragAfter(container, y) {
  const cards = [...container.querySelectorAll('.tl-kanban-card:not(.dragging)')];
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    if (y < r.top + r.height / 2) return c;
  }
  return null;
}
function wireTlLaneDnD(container) {
  container.addEventListener('dragover', e => {
    if (!tlDragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearTlLaneMarkers();
    const after = tlLaneDragAfter(container, e.clientY);
    if (after) after.classList.add('drop-before');
    else {
      const cards = container.querySelectorAll('.tl-kanban-card:not(.dragging)');
      if (cards.length) cards[cards.length - 1].classList.add('drop-after');
      else container.classList.add('drop-into');
    }
  });
  container.addEventListener('drop', e => {
    if (!tlDragId) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || tlDragId;
    const after = tlLaneDragAfter(container, e.clientY);
    clearTlLaneMarkers();
    moveChunkToChapter(id, container.dataset.chapter, after ? after.dataset.id : null);
  });
}
// Move a hop into `chapterId`, positioned before `beforeId` (end if null), then
// renumber orderInChapter across that section.
function moveChunkToChapter(chunkId, chapterId, beforeId) {
  const ch = db.chunks.find(c => c.id === chunkId);
  if (!ch || chunkId === beforeId) return;
  ch.chapterId = chapterId;
  const ordered = chunksOf(chapterId).filter(c => c.id !== chunkId);
  let idx = beforeId ? ordered.findIndex(c => c.id === beforeId) : ordered.length;
  if (idx < 0) idx = ordered.length;
  ordered.splice(idx, 0, ch);
  ordered.forEach((c, i) => c.orderInChapter = i);
  save();
  // The kanban drag wiring is shared by the SECTIONS board and the TIMELINES
  // view — re-render whichever one is on screen.
  if (currentRoute() === 'sections') renderSections();
  else renderTimelines();
}

/* ---- CHRONOLOGICAL: horizontal running timeline, cards above/below the axis ---- */
function renderChronoTimeline(stage, filterChar, filterLabel) {
  const ordered = [...db.chunks].filter(isVisibleChunk).sort((a, b) => (a.chronoOrder ?? 0) - (b.chronoOrder ?? 0));
  if (!ordered.length) { stage.innerHTML = `<div class="pane-empty">No hops yet.</div>`; return; }

  stage.innerHTML = `<div class="chrono-wrap"><div class="chrono-track">` + ordered.map((c, i) => {
    const dim = tlDimmed(c, filterChar, filterLabel) ? 'dim' : '';
    const color = chapterColor(c.chapterId);
    const side = i % 2 === 0 ? 'top' : 'bottom';
    return `
      <div class="chrono-item ${side} ${dim} ${c.archived ? 'archived' : ''}" data-id="${c.id}" draggable="true">
        <div class="chrono-card" style="border-color:${color}">
          <span class="chrono-card-ord">C${i + 1}</span>
          <span class="chrono-card-title">${esc(c.title || 'Untitled hop')}</span>
          ${c.chronoLabel ? `<span class="chrono-card-label">${esc(c.chronoLabel)}</span>` : ''}
        </div>
        <span class="chrono-stem" style="background:${color}"></span>
        <span class="chrono-dot" style="background:${color}"></span>
      </div>`;
  }).join('') + `</div></div>`;

  const track = stage.querySelector('.chrono-track');
  stage.querySelectorAll('.chrono-item').forEach(item => {
    const id = item.dataset.id;
    item.querySelector('.chrono-card').addEventListener('click', () => {
      if (!item.classList.contains('dragging')) openChunkModal(id);
    });
    item.addEventListener('dragstart', e => {
      tlDragId = id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      requestAnimationFrame(() => item.classList.add('dragging'));
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      clearChronoMarkers(track);
      tlDragId = null;
    });
  });
  wireChronoDnD(track);
}
function clearChronoMarkers(track) {
  track.querySelectorAll('.chrono-item').forEach(c => c.classList.remove('drop-before', 'drop-after'));
}
function chronoDragAfter(track, x) {
  const items = [...track.querySelectorAll('.chrono-item:not(.dragging)')];
  for (const c of items) {
    const r = c.getBoundingClientRect();
    if (x < r.left + r.width / 2) return c;
  }
  return null;
}
function wireChronoDnD(track) {
  track.ondragover = e => {
    if (!tlDragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearChronoMarkers(track);
    const after = chronoDragAfter(track, e.clientX);
    if (after) after.classList.add('drop-before');
    else {
      const items = track.querySelectorAll('.chrono-item:not(.dragging)');
      if (items.length) items[items.length - 1].classList.add('drop-after');
    }
  };
  track.ondrop = e => {
    if (!tlDragId) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || tlDragId;
    const after = chronoDragAfter(track, e.clientX);
    clearChronoMarkers(track);
    if (id) reorderChunk('chronoOrder', id, after ? after.dataset.id : null);
  };
}

/* ---- chunk edit modal (opened from timeline cards) ---- */
let modalChunkId = null;
// A freshly-added hop lives here until the author clicks SAVE. It is NOT in
// db.chunks, so closing/cancelling the modal discards it without a trace.
let draftChunk = null;
function resolveChunk(id) {
  return db.chunks.find(x => x.id === id) || (draftChunk && draftChunk.id === id ? draftChunk : null);
}

// The hop modal's SAVE button reflects edit state: 'pristine' on open (nothing
// touched, disabled), 'dirty' once an edit is made (highlighted + enabled), and
// 'saved' after a save (disabled) until the next edit flips it back to dirty.
let chunkDirty = false;
function setChunkSaveState(state) {
  const sv = document.getElementById('chunkModalSave');
  if (!sv) return;
  chunkDirty = state === 'dirty';
  sv.disabled = state !== 'dirty';
  sv.classList.toggle('solid', state === 'dirty');
  sv.textContent = state === 'saved' ? '✓ SAVED' : '✓ SAVE';
}
function markChunkDirty() {
  if (chunkDirty) return;
  if (document.getElementById('chunkModalOverlay').hidden) return;
  setChunkSaveState('dirty');
}

function openChunkModal(chunkId) {
  const c = resolveChunk(chunkId);
  if (!c) return;
  modalChunkId = chunkId;

  document.getElementById('chunkModalTitle').value = c.title;
  setEditorContent(c.body);
  document.getElementById('chunkModalChrono').value = c.chronoLabel || '';
  document.getElementById('chunkModalArchive').textContent = c.archived ? 'UNARCHIVE' : 'ARCHIVE';
  const vpBadge = document.querySelector('#chunkModalViewPosts .pc-badge');
  if (vpBadge) {
    const n = (hopPostCounts[c.id] || {}).active || 0;
    vpBadge.textContent = n;
    vpBadge.classList.toggle('has', n > 0);
  }
  document.getElementById('chunkModalChapter').textContent = chapterTitle(c.chapterId);
  document.getElementById('chunkModalChapter').style.color = chapterColor(c.chapterId);
  const projEl = document.getElementById('chunkModalProject');
  if (projEl) projEl.textContent = projectsCache.find(p => p.id === activeProjectId)?.name || '';

  const sel = document.getElementById('chunkModalChapterSel');
  sel.innerHTML = db.chapters.map(ch =>
    `<option value="${ch.id}" ${ch.id === c.chapterId ? 'selected' : ''}>${esc(ch.title)}</option>`).join('');

  renderEntityListInto(document.getElementById('chunkModalChars'), ENTITY_KINDS.character, c);
  renderEntityListInto(document.getElementById('chunkModalLocs'), ENTITY_KINDS.location, c);

  const tagsWrap = document.getElementById('chunkModalTags');
  tagsWrap.innerHTML = tagEditorHTML(c.tagIds || []);
  const le = tagsWrap.querySelector('.label-editor');
  if (le) wireTagEditor(le, c);

  renderChunkEvents(c);
  const addEvBtn = document.getElementById('chunkModalAddEvent');
  if (addEvBtn) addEvBtn.onclick = () => openEventModal(null, c.id);

  // The DETECT pop-down's summary is the visible button; selecting an option
  // closes the menu and runs the work, so the working state must live on the
  // summary (the chosen menu item is hidden once the pop-down collapses).
  const detectSummary = document.getElementById('chunkDetectMenu')?.querySelector('summary');
  const gt = document.getElementById('chunkModalGenTags');
  gt.onclick = () => { document.getElementById('chunkDetectMenu')?.removeAttribute('open'); generateChunkTags(c, detectSummary); };
  // Close the DETECT pop-down on an outside click (wired once for the element).
  const dm = document.getElementById('chunkDetectMenu');
  if (dm && !dm._outsideWired) {
    dm._outsideWired = true;
    document.addEventListener('click', e => {
      if (dm.hasAttribute('open') && !dm.contains(e.target)) dm.removeAttribute('open');
    });
  }

  // GENERATE BODY when the hop has no body yet; once there is body text the same
  // button becomes RE-WRITE, which opens a prompt modal to revise the existing body.
  const gb = document.getElementById('chunkModalGenBody');
  if (gb) {
    const hasBody = (c.body || '').trim().length > 0;
    gb.innerHTML = IC_GENERATE + (hasBody ? ' RE-WRITE' : ' GENERATE BODY');
    gb.title = hasBody ? 'AI: rewrite the body from a prompt' : 'AI: draft body text from the title';
    gb.onclick = hasBody ? () => rewriteChunkBody(c, gb) : () => generateChunkBody(c, gb);
  }

  // One DETECT button → pop-down with CHARACTERS / LOCATIONS / TAGS. Each choice
  // closes the menu, then runs the matching per-hop detection.
  const detectMenu = document.getElementById('chunkDetectMenu');
  const closeDetect = () => detectMenu && detectMenu.removeAttribute('open');
  const dc = document.getElementById('chunkDetectChars');
  dc.onclick = () => { closeDetect(); detectChunkEntities(ENTITY_KINDS.character, c, detectSummary); };
  const dl = document.getElementById('chunkDetectLocs');
  dl.onclick = () => { closeDetect(); detectChunkEntities(ENTITY_KINDS.location, c, detectSummary); };

  const sv = document.getElementById('chunkModalSave');
  sv.onclick = () => {
    // First SAVE on a fresh hop commits the draft into the project; later
    // SAVEs just flush the autosaved edits.
    if (draftChunk && modalChunkId === draftChunk.id) {
      db.chunks.push(draftChunk);
      draftChunk = null;
      save(); recordWritingActivity();
    } else {
      save();
    }
    setChunkSaveState('saved');
  };

  const az = document.getElementById('chunkModalAnalyze');
  if (az) {
    az.innerHTML = hasAnalysis(c.analysis) ? IC_ANALYZE + ' VIEW ANALYSIS' : IC_ANALYZE + ' ANALYZE';
    az.onclick = () => {
      // Analyze the live editor text, not the last-saved body.
      c.title = document.getElementById('chunkModalTitle').value;
      c.body = getEditorText();
      analyzeChunk(c, az);
    };
  }

  hideChunkPop();
  renderEditorHighlights();
  setChunkSaveState('pristine');
  document.getElementById('chunkModalOverlay').hidden = false;
}

// Re-render the character/location list for kind K inside the open hop modal —
// used after per-hop detection links new entities to the hop.
function refreshModalEntityChips(K, c) {
  const id = K === ENTITY_KINDS.character ? 'chunkModalChars' : 'chunkModalLocs';
  const wrap = document.getElementById(id);
  if (!wrap) return;
  renderEntityListInto(wrap, K, c);
  renderEditorHighlights();
}

function closeChunkModal() {
  // Closing via X / overlay / Escape discards an uncommitted new hop.
  if (draftChunk && modalChunkId === draftChunk.id) draftChunk = null;
  hideChunkPop();
  document.getElementById('chunkModalOverlay').hidden = true;
  modalChunkId = null;
  rerenderActiveView();
}

// Re-render whichever view is currently showing, so edits made in the chunk
// modal (opened from any surface) are reflected when it closes.
function rerenderActiveView() {
  const r = currentRoute();
  if (r === 'home') renderHome();
  else if (r === 'sections') renderSections();
  else if (r === 'timelines') renderTimelines();
  else if (r === 'characters') renderCharacters();
  else if (r === 'locations') renderLocations();
  else if (r === 'tags') renderTags();
  else if (r === 'ideas') renderIdeas();
}

(function wireChunkModal() {
  const cur = () => resolveChunk(modalChunkId);
  document.getElementById('chunkModalTitle').addEventListener('input', e => { const c = cur(); if (c) { c.title = e.target.value; save(); markChunkDirty(); } });
  const onBodyInput = () => { const c = cur(); if (!c) return; c.body = getEditorText(); save(); markChunkDirty(); hideChunkPop(); scheduleRehighlight(); };
  document.getElementById('chunkModalBody').addEventListener('input', onBodyInput);
  document.getElementById('chunkModalChrono').addEventListener('input', e => { const c = cur(); if (c) { c.chronoLabel = e.target.value; save(); markChunkDirty(); } });
  document.getElementById('chunkModalChapterSel').addEventListener('change', e => {
    const c = cur(); if (!c) return;
    c.chapterId = e.target.value;
    c.orderInChapter = chunksOf(c.chapterId).length;
    save(); markChunkDirty();
    document.getElementById('chunkModalChapter').textContent = chapterTitle(c.chapterId);
    document.getElementById('chunkModalChapter').style.color = chapterColor(c.chapterId);
  });
  document.getElementById('chunkModalArchive').addEventListener('click', e => {
    const c = cur(); if (!c) return;
    c.archived = !c.archived; save(); markChunkDirty();
    e.currentTarget.textContent = c.archived ? 'UNARCHIVE' : 'ARCHIVE';
    document.getElementById('chunkModalKebab')?.removeAttribute('open');
  });
  document.getElementById('chunkModalPost').addEventListener('click', () => {
    const c = cur(); if (!c) return;
    document.getElementById('chunkModalKebab')?.removeAttribute('open');
    postToCommunityModal(c);
  });
  document.getElementById('chunkModalViewPosts').addEventListener('click', () => {
    const c = cur(); if (!c) return;
    document.getElementById('chunkModalKebab')?.removeAttribute('open');
    managePostsModal(c);
  });
  document.getElementById('chunkModalDelete').addEventListener('click', async () => {
    const c = cur(); if (!c) return;
    document.getElementById('chunkModalKebab')?.removeAttribute('open');
    if (!await confirmModal('Delete this hop?')) return;
    db.chunks = db.chunks.filter(x => x.id !== c.id);
    if (draftChunk && c.id === draftChunk.id) draftChunk = null;
    save();
    closeChunkModal();
  });
  const modalKebab = document.getElementById('chunkModalKebab');
  if (modalKebab) modalKebab.addEventListener('toggle', () => { if (modalKebab.open) positionHopMenu(modalKebab); });
  // Label toggles and new-label typing also count as edits (character/location
  // add/remove mark dirty directly in renderEntityListInto). This container is
  // static, so wire once.
  const tagsWrap = document.getElementById('chunkModalTags');
  tagsWrap.addEventListener('click', e => { if (e.target.closest('.lbl-chip')) markChunkDirty(); });
  tagsWrap.addEventListener('input', () => markChunkDirty());
  const bodyEl = document.getElementById('chunkModalBody');
  bodyEl.addEventListener('compositionstart', () => { imeComposing = true; });
  bodyEl.addEventListener('compositionend', () => { imeComposing = false; scheduleRehighlight(); });
  bodyEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); insertTextAtCaret('\n'); onBodyInput(); }
  });
  bodyEl.addEventListener('paste', e => {
    e.preventDefault();
    const t = ((e.clipboardData || window.clipboardData).getData('text/plain') || '');
    insertTextAtCaret(t); onBodyInput();
  });
  bodyEl.addEventListener('scroll', () => { if (!document.getElementById('chunkHlPop').hidden) hideChunkPop(); });
  bodyEl.addEventListener('mouseup', () => setTimeout(onChunkBodySelect, 0));
  bodyEl.addEventListener('blur', () => setTimeout(() => {
    const pop = document.getElementById('chunkHlPop');
    if (pop && !pop.contains(document.activeElement)) { hideChunkPop(); renderEditorHighlights(); }
  }, 150));
  document.addEventListener('mousedown', e => {
    const pop = document.getElementById('chunkHlPop');
    if (pop && !pop.hidden && !pop.contains(e.target) && !bodyEl.contains(e.target)) hideChunkPop();
  });
  document.getElementById('chunkModalClose').addEventListener('click', closeChunkModal);
  document.getElementById('chunkModalOverlay').addEventListener('click', e => {
    if (e.target.id === 'chunkModalOverlay') closeChunkModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('chunkModalOverlay').hidden) return;
    const pop = document.getElementById('chunkHlPop');
    if (pop && !pop.hidden) { hideChunkPop(); return; }
    closeChunkModal();
  });
})();

/* ---- inline character/location highlighting in the hop body ----
   The hop body is a contenteditable that paints names in their entity colors,
   exactly like the Sections VIEW. Names recolor shortly after you stop typing
   (caret preserved). Clicking a colored name offers to remove it from the hop;
   selecting any text shows a small + button that expands into a tag picker. */

// Live, non-dismissed character + location mentions in this chunk's body, sorted
// and de-overlapped (first match wins), each carrying its entity + ordinal so a
// click can dismiss exactly that mention.
function chunkHighlightSpans(chunk) {
  const ranges = [];
  [ENTITY_KINDS.character, ENTITY_KINDS.location].forEach(K => {
    (db[K.coll] || []).forEach(ent => {
      occurrencesOf(ent, chunk).forEach(o => {
        if (o.dismissed) return;
        ranges.push({ start: o.index, end: o.index + o.text.length, ord: o.ord, ent, kind: K, color: ent.color || '' });
      });
    });
  });
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = []; let lastEnd = -1;
  ranges.forEach(r => { if (r.start >= lastEnd) { kept.push(r); lastEnd = r.end; } });
  return kept;
}

function getEditorText() {
  const el = document.getElementById('chunkModalBody');
  return el ? el.textContent : '';
}

// Set the editor's full content from plain text (used on open / generate).
function setEditorContent(text) {
  const el = document.getElementById('chunkModalBody');
  if (el) el.innerHTML = highlightNames(text || '', entityHighlightTerms());
}

// Lightweight "typing" reveal for AI output: stream `text` into `el` in small
// batches (~30fps) so generated prose appears as if typed, instead of popping in
// all at once. Plain-text only — it sets textContent, which respects the
// editor's pre-wrap newlines. Pass onDone to swap in rich rendering once the
// reveal finishes (e.g. re-apply name highlighting on the body editor). Aims for
// a steady ~3s regardless of length so a long hop body never drags. Bails if the
// target leaves the DOM (modal closed / re-rendered) so it never writes into a
// stale or replaced node. Returns cancel() which finishes the reveal instantly.
function typeWriter(el, text, opts = {}) {
  text = String(text == null ? '' : text);
  const onDone = opts.onDone;
  if (!el) { if (onDone) onDone(); return () => {}; }
  const perTick = Math.max(1, Math.ceil(text.length / 90));
  let i = 0, done = false;
  const finish = () => {
    if (done) return; done = true;
    clearInterval(timer);
    if (onDone) onDone(); else el.textContent = text;
  };
  const timer = setInterval(() => {
    if (!el.isConnected) { clearInterval(timer); done = true; return; }
    i = Math.min(text.length, i + perTick);
    el.textContent = text.slice(0, i);
    el.scrollTop = el.scrollHeight;
    if (i >= text.length) finish();
  }, 33);
  return finish;
}

// Re-paint the editor from its own current text, optionally keeping the caret.
function renderEditorHighlights(opts) {
  const el = document.getElementById('chunkModalBody');
  const chunk = resolveChunk(modalChunkId);
  if (!el || !chunk) return;
  const preserve = opts && opts.preserveCaret && document.activeElement === el;
  const off = preserve ? getCaretOffset(el) : null;
  el.innerHTML = highlightNames(getEditorText(), entityHighlightTerms());
  if (off != null) setCaretOffset(el, off);
}

let rehighlightTimer = null, imeComposing = false;
function scheduleRehighlight() {
  clearTimeout(rehighlightTimer);
  rehighlightTimer = setTimeout(() => {
    if (imeComposing) return;
    if (document.getElementById('chunkModalOverlay').hidden) return;
    renderEditorHighlights({ preserveCaret: true });
  }, 500);
}

function insertTextAtCaret(text) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node); range.collapse(true);
  sel.removeAllRanges(); sel.addRange(range);
}

// Caret/selection helpers in the editor's plain-text character domain (newlines
// are real "\n" characters, so these stay consistent across re-highlights).
function getCaretOffset(root) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.endContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}
function offsetToNode(root, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n, acc = 0;
  while ((n = walker.nextNode())) {
    const len = n.nodeValue.length;
    if (offset <= acc + len) return { node: n, off: offset - acc };
    acc += len;
  }
  return { node: root, off: root.childNodes.length };
}
function setCaretOffset(root, offset) {
  const p = offsetToNode(root, offset);
  const range = document.createRange();
  try { range.setStart(p.node, p.off); } catch { range.selectNodeContents(root); range.collapse(false); }
  range.collapse(true);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
}

// Current editor selection as { start, end, text, rect } in the text domain.
function editorSelection() {
  const el = document.getElementById('chunkModalBody');
  const sel = window.getSelection();
  if (!el || !sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(el); pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const text = range.toString();
  return { start, end: start + text.length, text, rect: range.getBoundingClientRect() };
}

function editorRectForRange(s, e) {
  const el = document.getElementById('chunkModalBody');
  const a = offsetToNode(el, s), b = offsetToNode(el, e);
  const range = document.createRange();
  try { range.setStart(a.node, a.off); range.setEnd(b.node, b.off); } catch { return null; }
  const r = range.getBoundingClientRect();
  return (r.width || r.height) ? r : (range.getClientRects()[0] || r);
}

function placeChunkPop(pop, rect) {
  const wrap = document.getElementById('chunkBodyWrap');
  if (!rect) { hideChunkPop(); return; }
  const wr = wrap.getBoundingClientRect();
  pop.hidden = false;
  let left = rect.left - wr.left;
  left = Math.max(4, Math.min(left, wrap.clientWidth - pop.offsetWidth - 4));
  let top = rect.bottom - wr.top + 4;
  if (top + pop.offsetHeight > wrap.clientHeight) top = Math.max(4, rect.top - wr.top - pop.offsetHeight - 4);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

function hideChunkPop() {
  const pop = document.getElementById('chunkHlPop');
  if (pop) { pop.hidden = true; pop.innerHTML = ''; }
}

// A real selection -> show the + tag button; a bare caret inside a colored
// name -> show the remove popover.
function onChunkBodySelect() {
  const chunk = resolveChunk(modalChunkId);
  if (!chunk || document.getElementById('chunkModalOverlay').hidden) return;
  const sr = editorSelection();
  if (!sr) return hideChunkPop();
  if (sr.end > sr.start && sr.text.trim()) return showAddTagButton(sr);
  const hit = chunkHighlightSpans({ ...chunk, body: getEditorText() }).find(r => sr.start >= r.start && sr.start <= r.end);
  if (hit) return showRemoveTagPop(hit);
  hideChunkPop();
}

function showRemoveTagPop(hit) {
  const pop = document.getElementById('chunkHlPop');
  pop.innerHTML = `
    <div class="hl-pop-title">${hit.kind.NOUN}</div>
    <button class="hl-pop-rm" type="button">✕ Remove ${esc(hit.ent.name)} from this hop</button>`;
  pop.querySelector('.hl-pop-rm').addEventListener('click', () => removeMentionTag(hit));
  placeChunkPop(pop, editorRectForRange(hit.start, hit.end));
}

function removeMentionTag(hit) {
  const chunk = resolveChunk(modalChunkId);
  if (!chunk) return;
  const K = hit.kind, ent = hit.ent;
  ent.dismissedRefs = ent.dismissedRefs || [];
  const key = chunk.id + ':' + hit.ord;
  if (!ent.dismissedRefs.includes(key)) ent.dismissedRefs.push(key);
  const stillLive = occurrencesOf(ent, chunk).some(o => !o.dismissed);
  if (!stillLive && Array.isArray(chunk[K.link])) chunk[K.link] = chunk[K.link].filter(id => id !== ent.id);
  save(); markChunkDirty();
  refreshModalEntityChips(K, chunk);
  renderEditorHighlights();
  hideChunkPop();
}

// First step of tagging: a compact + button so the entity list does NOT pop up
// automatically on every selection. Clicking it expands into the picker.
function showAddTagButton(sr) {
  const pop = document.getElementById('chunkHlPop');
  pop.innerHTML = `<button class="hl-pop-add" type="button" title="Tag this selection">+ Tag</button>`;
  const btn = pop.querySelector('.hl-pop-add');
  btn.addEventListener('mousedown', e => e.preventDefault());   // keep the selection
  btn.addEventListener('click', () => showAddTagPicker(sr));
  placeChunkPop(pop, sr.rect);
}

// Expanded picker: choose CHARACTER/LOCATION, then link an existing entity
// (adding the selected phrase as an alias so it highlights) or create a new one.
let addTagKind = null;
function showAddTagPicker(sr) {
  const pop = document.getElementById('chunkHlPop');
  const sel = sr.text.trim();
  if (!addTagKind) addTagKind = ENTITY_KINDS.character;
  const draw = () => {
    const K = addTagKind;
    const coll = (db[K.coll] || []);
    pop.innerHTML = `
      <div class="hl-pop-title">Tag “${esc(sel)}”</div>
      <div class="hl-pop-toggle">
        <button type="button" data-k="character" class="${K === ENTITY_KINDS.character ? 'on' : ''}">CHARACTER</button>
        <button type="button" data-k="location" class="${K === ENTITY_KINDS.location ? 'on' : ''}">LOCATION</button>
      </div>
      <input class="hl-pop-search" type="text" placeholder="Filter ${K.noun}s…" />
      <div class="hl-pop-list"></div>`;
    pop.querySelectorAll('.hl-pop-toggle button').forEach(b => {
      // Keep the editor focused/selected so switching kind doesn't trigger the
      // blur-close (draw() rebuilds these buttons, dropping activeElement).
      b.addEventListener('mousedown', e => e.preventDefault());
      b.addEventListener('click', () => {
        addTagKind = b.dataset.k === 'location' ? ENTITY_KINDS.location : ENTITY_KINDS.character;
        draw();
      });
    });
    const search = pop.querySelector('.hl-pop-search');
    const list = pop.querySelector('.hl-pop-list');
    const fill = () => {
      const q = search.value.trim().toLowerCase();
      const matches = coll.filter(en => !q || en.name.toLowerCase().includes(q));
      list.innerHTML =
        matches.map(en => `<button class="hl-pop-row" type="button" data-id="${en.id}"><span class="hl-pop-dot" style="--cc:${en.color || 'var(--accent)'}"></span>${esc(en.name)}</button>`).join('')
        + `<button class="hl-pop-row create" type="button" data-create="1">+ Create “${esc(sel)}” as new ${K.noun}</button>`;
      list.querySelectorAll('[data-id]').forEach(row => row.addEventListener('click', () => {
        tagSelectionExisting(K, coll.find(en => en.id === row.dataset.id), sel);
      }));
      list.querySelector('[data-create]').addEventListener('click', () => tagSelectionNew(K, sel));
    };
    search.addEventListener('input', fill);
    fill();
  };
  draw();
  placeChunkPop(pop, sr.rect);
}

function tagSelectionExisting(K, ent, text) {
  if (!ent) return;
  const chunk = resolveChunk(modalChunkId);
  if (!chunk) return;
  const t = text.trim();
  const known = [ent.name, ...(ent.aliases || [])].map(x => (x || '').toLowerCase());
  if (t && !known.includes(t.toLowerCase())) { ent.aliases = ent.aliases || []; ent.aliases.push(t); }
  chunk[K.link] = chunk[K.link] || [];
  if (!chunk[K.link].includes(ent.id)) chunk[K.link].push(ent.id);
  save(); markChunkDirty();
  refreshModalEntityChips(K, chunk);
  renderEditorHighlights();
  hideChunkPop();
}

function tagSelectionNew(K, text) {
  const t = text.trim();
  if (!t) return;
  const chunk = resolveChunk(modalChunkId);
  if (!chunk) return;
  const ent = { id: uid(), name: t, aliases: [], summary: '', notes: [], color: CHAPTER_PALETTE[db[K.coll].length % CHAPTER_PALETTE.length], dismissedRefs: [] };
  db[K.coll].push(ent);
  chunk[K.link] = chunk[K.link] || [];
  chunk[K.link].push(ent.id);
  save(); markChunkDirty();
  refreshModalEntityChips(K, chunk);
  renderEditorHighlights();
  hideChunkPop();
}

// Move dragged chunk to sit before `beforeId` (or to the end if null), then renumber.
function reorderChunk(orderKey, draggedId, beforeId) {
  const ordered = [...db.chunks].sort((a, b) => (a[orderKey] ?? 0) - (b[orderKey] ?? 0));
  const dragged = ordered.find(c => c.id === draggedId);
  if (!dragged || draggedId === beforeId) return;
  const without = ordered.filter(c => c.id !== draggedId);
  const insertIdx = beforeId ? without.findIndex(c => c.id === beforeId) : without.length;
  without.splice(insertIdx < 0 ? without.length : insertIdx, 0, dragged);
  without.forEach((c, idx) => c[orderKey] = idx);
  save();
  renderTimelines();
}

/* =====================================================================
   ENTITIES — CHARACTERS + LOCATIONS (identical UI, different detection)
   ===================================================================== */
// Each "kind" is the same reference workbench (list, summary, mentions,
// merge, AI detect) over a different collection + chunk link + AI task.
const ENTITY_KINDS = {
  character: {
    coll: 'characters', link: 'characterIds', active: 'activeChar', scannedKey: 'detectScannedIds',
    listId: 'charList', paneId: 'charPane', detectId: 'detectCharsBtn', addId: 'addCharBtn', searchId: 'charSearch',
    detectTask: 'detect_characters', resultKey: 'characters', sumTask: 'char_summary',
    noun: 'character', NOUN: 'CHARACTER', NOUNS: 'CHARACTERS', newName: 'New character'
  },
  location: {
    coll: 'locations', link: 'locationIds', active: 'activeLoc', scannedKey: 'detectScannedLocs',
    listId: 'locList', paneId: 'locPane', detectId: 'detectLocsBtn', addId: 'addLocBtn', searchId: 'locSearch',
    detectTask: 'detect_locations', resultKey: 'locations', sumTask: 'loc_summary',
    noun: 'location', NOUN: 'LOCATION', NOUNS: 'LOCATIONS', newName: 'New location'
  }
};

function renderCharacters() { renderEntityList(ENTITY_KINDS.character); }
function renderLocations() { renderEntityList(ENTITY_KINDS.location); }

function renderEntityList(K) {
  const coll = db[K.coll];
  const list = document.getElementById(K.listId);
  if (!list) return;
  // Hop count per entity, computed once. Lists are sorted by it (most-referenced
  // first), ties broken alphabetically.
  const hopCount = new Map(coll.map(c => [c.id, refsFor(K, c).length]));
  const byHops = (a, b) => (hopCount.get(b.id) - hopCount.get(a.id)) || (a.name || '').localeCompare(b.name || '');
  const rowHTML = c => `
        <div class="chapter-item ${c.id === db.ui[K.active] ? 'active' : ''}" data-id="${c.id}">
          <span class="ci-dot" style="background:${c.color || 'var(--accent)'}"></span>
          <span class="ci-title">${esc(c.name)}</span>
          <span class="ci-count">${hopCount.get(c.id)}</span>
        </div>`;
  if (!coll.length) {
    list.innerHTML = `<div class="pane-empty" style="border:none">No ${K.noun}s yet.</div>`;
  } else {
    const cats = collCats(K.coll);
    if (!cats.length) {
      list.innerHTML = [...coll].sort(byHops).map(rowHTML).join('');
    } else {
      const groups = cats.map(cat => ({
        id: cat.id, name: cat.name,
        items: coll.filter(e => collCatOf(K.coll, e.id) === cat.id).sort(byHops)
      }));
      groups.push({ id: '', name: 'UNCATEGORIZED', items: coll.filter(e => !collCatOf(K.coll, e.id)).sort(byHops) });
      list.innerHTML = groups
        .filter(g => g.id || g.items.length)
        .map(g => `
          <div class="tag-cat-group" data-cat="${esc(g.id)}">
            <div class="tag-cat-head">
              <span class="tcc-name">${esc(g.name)}</span>
              ${g.id ? `<span class="tcc-actions">
                <button class="tcc-btn" data-cat-rename="${esc(g.id)}" title="Rename category">✎</button>
                <button class="tcc-btn" data-cat-del="${esc(g.id)}" title="Delete category">✕</button>
              </span>` : ''}
            </div>
            ${g.items.map(rowHTML).join('') || `<div class="tag-cat-empty">No ${K.noun}s</div>`}
          </div>`).join('');
      list.querySelectorAll('[data-cat-rename]').forEach(btn =>
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          const cur = btn.dataset.catRename;
          const next = await promptModal('Category name:', cur, { title: 'RENAME CATEGORY', okText: 'Save' });
          if (next && next.trim()) { renameCollCat(K.coll, cur, next); renderEntityList(K); }
        }));
      list.querySelectorAll('[data-cat-del]').forEach(btn =>
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          if (!await confirmModal(`Delete this category? ${K.NOUNS} inside move to Uncategorized.`)) return;
          deleteCollCat(K.coll, btn.dataset.catDel);
          renderEntityList(K);
        }));
    }
  }
  list.querySelectorAll('.chapter-item').forEach(el => {
    el.addEventListener('click', () => {
      if (db.ui[K.active] !== el.dataset.id) expandedRefs.clear();
      db.ui[K.active] = el.dataset.id; save();
      list.closest('.chapter-rail')?.classList.remove('rail-open'); // collapse the mobile dropdown after picking
      renderEntityList(K);
    });
  });
  wireRailSelect(K);
  applyRailSearch(K);
  renderEntityPane(K);
}

// Mobile only: the cast/places list is hidden behind a dropdown trigger that
// shows the current selection. Tapping it reveals the list; picking an entity
// (handled in renderEntityList) collapses it again. On desktop the trigger is
// hidden via CSS and the list is always shown.
function wireRailSelect(K) {
  const active = db[K.coll].find(x => x.id === db.ui[K.active]);
  wireRailSelectInto(K.listId, active ? active.name : `Select ${K.noun}`);
}

// Generic version used by Sections (chapters) and Tags, which have no `K`.
// Sets the trigger label and toggles the list open on tap.
function wireRailSelectInto(listId, label) {
  const rail = document.getElementById(listId)?.closest('.chapter-rail');
  const btn = rail?.querySelector('.rail-select');
  if (!btn) return;
  const labelEl = btn.querySelector('.rail-select-label');
  if (labelEl) labelEl.textContent = label;
  btn.setAttribute('aria-expanded', rail.classList.contains('rail-open') ? 'true' : 'false');
  btn.onclick = () => {
    const open = rail.classList.toggle('rail-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
}

// Shared dropdown for the kebab (⋮) on entity/chapter/tag head rows: closes
// after an item is clicked and on any outside click.
function wireHeadKebab(kebab) {
  if (!kebab) return;
  kebab.querySelectorAll('.head-kebab-menu .add-btn').forEach(b =>
    b.addEventListener('click', () => kebab.removeAttribute('open')));
  document.addEventListener('click', e => {
    if (kebab.hasAttribute('open') && !kebab.contains(e.target)) kebab.removeAttribute('open');
  });
}

// Filter the cast/places list by the rail search box (mobile). Re-applied
// after every list render so the active filter survives selection changes.
function applyRailSearch(K) {
  const input = K.searchId && document.getElementById(K.searchId);
  if (!input) return;
  const q = input.value.trim().toLowerCase();
  document.querySelectorAll(`#${K.listId} .chapter-item`).forEach(el => {
    const name = (el.querySelector('.ci-title')?.textContent || '').toLowerCase();
    el.style.display = (!q || name.includes(q)) ? '' : 'none';
  });
  document.querySelectorAll(`#${K.listId} .tag-cat-group`).forEach(g => {
    const anyVisible = [...g.querySelectorAll('.chapter-item')].some(el => el.style.display !== 'none');
    g.style.display = anyVisible ? '' : 'none';
  });
}

// Transient (not persisted): chunk ids whose reference body is expanded in the pane.
let expandedRefs = new Set();

// Every match of this entity's name/aliases inside a chunk's body, in document
// order, each tagged with a stable ordinal so individual mentions can be dismissed.
// Dismissal is keyed "chunkId:ord" in c.dismissedRefs.
function occurrencesOf(c, chunk) {
  const terms = [c.name, ...(c.aliases || [])].map(t => (t || '').trim()).filter(Boolean);
  if (!terms.length) return [];
  const re = new RegExp('\\b(' + terms.map(escapeReg).join('|') + ')\\b', 'gi');
  const dismissed = new Set(c.dismissedRefs || []);
  const body = String(chunk.body || '');
  const out = [];
  let m, ord = 0;
  while ((m = re.exec(body)) !== null) {
    out.push({ ord, index: m.index, text: m[0], dismissed: dismissed.has(chunk.id + ':' + ord) });
    ord++;
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  // A span of text belongs only to the single most-specific (longest) matching
  // name. Drop any match that sits strictly inside a longer mention of a sibling
  // entity, so "MARK" inside "MARK MALMGREN" does not also count for a separate
  // character named MARK. Ords are assigned before filtering so dismissal keys
  // (chunkId:ord) stay stable across the suppression.
  const competing = competingSpans(c, chunk);
  if (competing.length) {
    return out.filter(o => {
      const i = o.index, j = o.index + o.text.length;
      return !competing.some(s => s.len > o.text.length && s.start <= i && j <= s.end);
    });
  }
  return out;
}

// occurrencesOf runs once per entity per chunk during a render, so rebuilding a
// regex over every sibling and rescanning each body per call froze the UI. The
// competing terms only change when data changes, and the match spans in a chunk
// are identical for every entity in the same collection — so both are memoized
// against _dataVersion and reused. A combined regex over the whole collection
// (longest terms first) yields the maximal span at each position; a match is only
// ever suppressed by a strictly longer span containing it, so including c's own
// terms is harmless.
const _competingCache = new Map();
function competingCacheFor(collKey) {
  let entry = _competingCache.get(collKey);
  if (!entry || entry.version !== _dataVersion) {
    const terms = [];
    (db[collKey] || []).forEach(x => {
      if (x.archived) return;
      [x.name, ...(x.aliases || [])].forEach(t => {
        t = (t || '').trim();
        if (t) terms.push(t);
      });
    });
    let regex = null;
    if (terms.length) {
      terms.sort((a, b) => b.length - a.length);
      regex = new RegExp('\\b(' + terms.map(escapeReg).join('|') + ')\\b', 'gi');
    }
    entry = { version: _dataVersion, regex, spans: new Map() };
    _competingCache.set(collKey, entry);
  }
  return entry;
}
function competingSpans(c, chunk) {
  const collKey = (db.characters || []).includes(c) ? 'characters'
    : (db.locations || []).includes(c) ? 'locations' : null;
  if (!collKey) return [];
  const entry = competingCacheFor(collKey);
  if (!entry.regex) return [];
  let spans = entry.spans.get(chunk.id);
  if (!spans) {
    spans = [];
    const re = entry.regex;
    re.lastIndex = 0;
    const body = String(chunk.body || '');
    let m;
    while ((m = re.exec(body)) !== null) {
      spans.push({ start: m.index, end: m.index + m[0].length, len: m[0].length });
      if (re.lastIndex === m.index) re.lastIndex++;
    }
    entry.spans.set(chunk.id, spans);
  }
  return spans;
}

function refStatus(K, c, chunk) {
  const occ = occurrencesOf(c, chunk);
  const live = occ.filter(o => !o.dismissed).length;
  return { occ, live, total: occ.length, linked: (chunk[K.link] || []).includes(c.id) };
}

// Active references: explicitly linked, or with at least one live (non-dismissed) mention.
function refsFor(K, c) {
  return db.chunks.filter(isVisibleChunk).filter(chunk => {
    const s = refStatus(K, c, chunk);
    return s.linked || s.live > 0;
  });
}

// Chunks that mention this entity but where every mention has been dismissed —
// hidden from the active list, surfaced under a disclosure so they can be restored.
function dismissedRefsFor(K, c) {
  return db.chunks.filter(isVisibleChunk).filter(chunk => {
    const s = refStatus(K, c, chunk);
    return !s.linked && s.live === 0 && s.total > 0;
  });
}

// Chunk body with each name/alias mention wrapped in a clickable .occ span:
// live mentions are tinted + clickable to dismiss, dismissed ones are struck
// through + clickable to restore.
function renderRefBody(c, chunk) {
  const raw = String(chunk.body || '');
  const occ = occurrencesOf(c, chunk);
  if (!occ.length) return raw ? esc(raw) : '<span style="color:var(--muted)">(empty)</span>';
  const col = c.color || '';
  let out = '', last = 0;
  occ.forEach(o => {
    out += esc(raw.slice(last, o.index));
    const tint = (!o.dismissed && col) ? ` style="color:${col}"` : '';
    const menu = o.dismissed
      ? `<span class="occ-menu"><button type="button" class="occ-act" data-occ-restore>RESTORE</button></span>`
      : `<span class="occ-menu"><button type="button" class="occ-act" data-occ-reassign>REASSIGN</button><button type="button" class="occ-act danger" data-occ-remove>REMOVE</button></span>`;
    out += `<span class="occ${o.dismissed ? ' occ-off' : ''}" data-chunk="${chunk.id}" data-occ="${o.ord}"${tint}>${esc(o.text)}${menu}</span>`;
    last = o.index + o.text.length;
  });
  out += esc(raw.slice(last));
  return out;
}

function renderEntityPane(K) {
  const pane = document.getElementById(K.paneId);
  const c = db[K.coll].find(x => x.id === db.ui[K.active]);
  if (!c) { pane.innerHTML = `<div class="pane-empty">Select or add a ${K.noun}.</div>`; return; }

  const refs = refsFor(K, c);
  const dismissedRefs = dismissedRefsFor(K, c);
  const curCat = collCatOf(K.coll, c.id);
  const catOpts = `<option value="">Uncategorized</option>`
    + collCats(K.coll).map(cat => `<option value="${esc(cat.id)}" ${cat.id === curCat ? 'selected' : ''}>${esc(cat.name)}</option>`).join('')
    + `<option value="__new">＋ New category…</option>`;
  const refRow = (r, off) => {
    const open = expandedRefs.has(r.id);
    return `
      <div class="ref-row ${open ? 'is-open' : ''} ${off ? 'ref-off' : ''}" data-ref="${r.id}" style="border-left:3px solid ${chapterColor(r.chapterId)}">
        <div class="ref-head">
          <button class="ref-expand" data-ref-toggle title="Show this reference">${open ? '▾' : '▸'}</button>
          <div class="ref-meta">
            <div class="ref-title">${esc(r.title || 'Untitled')}</div>
            <div class="ref-where">${esc(chapterTitle(r.chapterId))}${r.chronoLabel ? ' · ' + esc(r.chronoLabel) : ''}</div>
            ${chunkCharLocLine(r)}
          </div>
          <button class="add-btn ref-edit" data-ref-edit="${r.id}" title="Edit this chunk">EDIT</button>
        </div>
        ${open ? `<div class="ref-body">${renderRefBody(c, r)}</div>` : ''}
      </div>`;
  };
  pane.innerHTML = `
    <div class="chunk-card-head">
      <input type="color" class="chap-color" data-f="color" value="${c.color || '#e0a96d'}" title="${K.NOUN} color" />
      <input class="chunk-title-input head-name" data-f="name" value="${esc(c.name)}" />
      <details class="head-kebab" data-f="kebabWrap">
        <summary title="More actions" aria-label="More actions">⋮</summary>
        <div class="head-kebab-menu">
          <button class="add-btn" data-f="merge" title="Merge another ${K.noun} into this one">MERGE</button>
          <button class="add-btn danger" data-f="del" title="Delete this ${K.noun}">DELETE</button>
        </div>
      </details>
    </div>
    <div class="meta-field" style="margin:0 0 14px">CATEGORY
      <select data-f="catSel" title="Category">${catOpts}</select>
    </div>
    <div class="char-block">
      <h3>ALIASES <span style="color:var(--muted);font-weight:400">(comma separated — used to find references)</span></h3>
      <input class="chunk-title-input alias-input" data-f="aliases" value="${esc((c.aliases || []).join(', '))}" placeholder="alternate names, nicknames…" />
    </div>
    ${entitySearchBlockHTML(K.noun + ':' + c.id, K.noun)}
    <div class="char-block">
      <h3>SUMMARY</h3>
      <div class="char-summary" id="entitySummaryBox">${c.summary ? esc(c.summary) : '<span style="color:var(--muted)">No summary yet.</span>'}</div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="add-btn" data-f="gen" title="AI: summarize from every chunk that references this ${K.noun}">${IC_GENERATE} GENERATE</button>
        <button class="add-btn" data-f="editsum">EDIT MANUALLY</button>
      </div>
    </div>
    ${K.noun === 'character' ? `
    <div class="char-block">
      <h3>CHARACTER ARC</h3>
      ${renderArc(c)}
      ${renderPrinciples(c)}
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="add-btn" data-f="genarc" title="AI: trace this character's growth and core principles across every reference, in story order">${IC_GENERATE} ${((c.arc || []).length || (c.principles || []).length) ? 'REGENERATE ARC' : 'GENERATE ARC'}</button>
        ${((c.arc || []).length || (c.principles || []).length) ? '<button class="add-btn" data-f="cleararc">CLEAR</button>' : ''}
      </div>
    </div>
    <div class="char-block">
      <h3>RELATIONSHIPS</h3>
      ${renderRelationships(c)}
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="add-btn" data-f="genrel" title="AI: find every other character this one is tied to, with references">${IC_ANALYZE} ${(c.relationships || []).length ? 'REGENERATE' : 'ANALYZE RELATIONSHIPS'}</button>
        ${(c.relationships || []).length ? '<button class="add-btn" data-f="clearrel">CLEAR</button>' : ''}
      </div>
    </div>` : ''}
    <div class="char-block">
      <h3>REFERENCES (${refs.length})</h3>
      <div style="color:var(--muted);font-size:11px;margin-bottom:8px">Expand a reference, then hover a highlighted mention to REMOVE it or REASSIGN it to another ${K.noun}.</div>
      <div class="char-refs">
        ${refs.length ? refs.map(r => refRow(r, false)).join('') : '<span style="color:var(--muted)">No references found.</span>'}
      </div>
      ${dismissedRefs.length ? `
        <details class="ref-dismissed-wrap">
          <summary>${dismissedRefs.length} fully dismissed — review / restore</summary>
          <div class="char-refs" style="margin-top:8px">
            ${dismissedRefs.map(r => refRow(r, true)).join('')}
          </div>
        </details>` : ''}
    </div>
    <div class="char-block">
      <h3>NOTES</h3>
      <div data-f="noteList">${(c.notes || []).map(n => `
        <div class="note-row" data-nid="${n.id}">
          <span class="note-text">${esc(n.text)}</span>
          <button class="icon-btn" data-del-note>✕</button>
        </div>`).join('')}</div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <input class="chunk-title-input" data-f="note" placeholder="Add a note…" />
        <button class="add-btn" data-f="addnote">ADD</button>
      </div>
    </div>`;

  const q = sel => pane.querySelector(sel);
  const nameAtRender = c.name;
  const nameInput = q('[data-f="name"]');
  nameInput.addEventListener('change', () => renameEntityEverywhere(K, c, nameAtRender, nameInput.value.trim()));
  q('[data-f="color"]').addEventListener('input', e => {
    c.color = e.target.value; save();
    const d = document.querySelector(`#${K.listId} .chapter-item[data-id="${c.id}"] .ci-dot`);
    if (d) d.style.background = c.color;
  });
  q('[data-f="aliases"]').addEventListener('input', e => {
    c.aliases = e.target.value.split(',').map(s => s.trim()).filter(Boolean); save();
  });
  q('[data-f="aliases"]').addEventListener('change', () => renderEntityList(K));
  q('[data-f="catSel"]').addEventListener('change', async e => {
    if (e.target.value === '__new') {
      const name = await promptModal('New category name:', '', { title: 'NEW CATEGORY', okText: 'Create' });
      setCollCat(K.coll, c.id, name && name.trim() ? name : '');
    } else {
      setCollCat(K.coll, c.id, e.target.value);
    }
    renderEntityList(K);
  });
  q('[data-f="del"]').addEventListener('click', async () => {
    if (!await confirmModal(`Delete this ${K.noun}?`)) return;
    db.chunks.forEach(ch => { ch[K.link] = (ch[K.link] || []).filter(id => id !== c.id); });
    db[K.coll] = db[K.coll].filter(x => x.id !== c.id);
    db.ui[K.active] = db[K.coll][0]?.id || null;
    save(); renderEntityList(K);
  });
  q('[data-f="merge"]').addEventListener('click', () => openMergeModal(K, c));
  wireHeadKebab(q('[data-f="kebabWrap"]'));
  pane.querySelectorAll('[data-ref-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('.ref-row').dataset.ref;
      if (expandedRefs.has(id)) expandedRefs.delete(id); else expandedRefs.add(id);
      renderEntityPane(K);
    });
  });
  pane.querySelectorAll('[data-ref-edit]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openChunkModal(btn.dataset.refEdit); });
  });
  const setDismissed = (el, dismiss) => {
    const occ = el.closest('.occ');
    const key = occ.dataset.chunk + ':' + occ.dataset.occ;
    c.dismissedRefs = c.dismissedRefs || [];
    const i = c.dismissedRefs.indexOf(key);
    if (dismiss && i < 0) c.dismissedRefs.push(key);
    if (!dismiss && i >= 0) c.dismissedRefs.splice(i, 1);
    save(); renderEntityList(K);
  };
  pane.querySelectorAll('[data-occ-remove]').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); setDismissed(b, true); }));
  pane.querySelectorAll('[data-occ-restore]').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); setDismissed(b, false); }));
  pane.querySelectorAll('[data-occ-reassign]').forEach(b =>
    b.addEventListener('click', e => {
      e.stopPropagation();
      const occ = b.closest('.occ');
      const chunk = db.chunks.find(x => x.id === occ.dataset.chunk);
      if (chunk) reassignOccModal(K, c, chunk, +occ.dataset.occ);
    }));
  q('[data-f="gen"]').addEventListener('click', e => generateEntitySummary(K, c, e.currentTarget));
  q('[data-f="genarc"]')?.addEventListener('click', e => generateCharArc(K, c, e.currentTarget));
  q('[data-f="cleararc"]')?.addEventListener('click', async () => {
    if (!await confirmModal('Clear this character arc?', { title: 'CHARACTER ARC', okText: 'Clear', danger: false })) return;
    c.arc = []; c.principles = []; save(); renderEntityPane(K);
  });
  q('[data-f="genrel"]')?.addEventListener('click', e => generateCharRelationships(K, c, e.currentTarget));
  q('[data-f="clearrel"]')?.addEventListener('click', async () => {
    if (!await confirmModal('Clear this relationship analysis?', { title: 'RELATIONSHIPS', okText: 'Clear', danger: false })) return;
    c.relationships = []; save(); renderEntityPane(K);
  });
  q('[data-f="editsum"]').addEventListener('click', async () => {
    const next = await promptModal(`${K.NOUN[0] + K.noun.slice(1)} summary:`, c.summary || '', { okText: 'Save' });
    if (next !== null) { c.summary = next; save(); renderEntityPane(K); }
  });
  q('[data-f="addnote"]').addEventListener('click', () => {
    const input = q('[data-f="note"]');
    const text = input.value.trim(); if (!text) return;
    c.notes = c.notes || []; c.notes.push({ id: uid(), text, ts: Date.now() });
    save(); renderEntityPane(K);
  });
  pane.querySelectorAll('[data-del-note]').forEach(btn => {
    btn.addEventListener('click', e => {
      const nid = e.target.closest('.note-row').dataset.nid;
      c.notes = c.notes.filter(n => n.id !== nid); save(); renderEntityPane(K);
    });
  });
  wireEntitySearch(pane, K.noun + ':' + c.id, refs);
}

// Merge `secondary` into `primary`: primary keeps `primaryName`, every other name
// (the loser's name + both alias sets) becomes an alias, chunk links + notes +
// dismissed refs are unioned, then the secondary entity is deleted.
function mergeEntities(K, primaryId, secondaryId, primaryName) {
  const coll = db[K.coll];
  const primary = coll.find(c => c.id === primaryId);
  const secondary = coll.find(c => c.id === secondaryId);
  if (!primary || !secondary || primary === secondary) return;

  const winner = primaryName || primary.name;
  const aliasPool = [primary.name, secondary.name, ...(primary.aliases || []), ...(secondary.aliases || [])];
  const seen = new Set([winner.toLowerCase()]);
  const aliases = [];
  aliasPool.forEach(a => {
    const v = (a || '').trim();
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); aliases.push(v); }
  });

  primary.name = winner;
  primary.aliases = aliases;
  primary.notes = [...(primary.notes || []), ...(secondary.notes || [])];
  primary.summary = primary.summary || secondary.summary || '';
  const dismissed = new Set([...(primary.dismissedRefs || []), ...(secondary.dismissedRefs || [])]);
  primary.dismissedRefs = [...dismissed];

  db.chunks.forEach(ch => {
    const ids = ch[K.link] || [];
    if (ids.includes(secondary.id)) {
      ch[K.link] = ids.filter(id => id !== secondary.id);
      if (!ch[K.link].includes(primary.id)) ch[K.link].push(primary.id);
    }
  });

  db[K.coll] = coll.filter(c => c.id !== secondary.id);
  db.ui[K.active] = primary.id;
  expandedRefs.clear();
  save(); renderEntityList(K);
}

// Modal: pick another entity to fold into `c`, then choose which of the two
// names survives as the primary (the other becomes an alias).
function openMergeModal(K, c) {
  const all = db[K.coll].filter(x => x.id !== c.id);
  if (!all.length) { alertModal(`Need at least two ${K.noun}s to merge.`, { title: `MERGE ${K.NOUNS}` }); return; }

  // Likely duplicates of THIS record, by name/alias heuristic — pre-checked so
  // the author can confirm a combo merge without leaving the modal.
  const reasonById = {};
  mergeCandidatesFor(K, c).forEach(s => { reasonById[s.id] = s.reason; });
  const suggested = all.filter(x => reasonById[x.id])
    .sort((a, b) => refsFor(K, b).length - refsFor(K, a).length);
  const rest = all.filter(x => !reasonById[x.id])
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const ordered = [...suggested, ...rest];

  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  overlay.innerHTML = `
    <div class="ui-modal merge-modal">
      <div class="ui-modal-title">MERGE ${K.NOUNS}</div>
      <div class="ui-modal-msg">Fold duplicate ${K.noun}s into <strong>${esc(c.name)}</strong>. Their references and notes move over; unused names become aliases.</div>
      <div class="merge-field">
        <label class="merge-label">${suggested.length ? `Likely duplicates of ${esc(c.name)} are pre-checked` : `Pick ${K.noun}s to merge in`}</label>
        <input type="text" class="chunk-title-input merge-search" id="mergeSearch" placeholder="Search ${K.noun}s…" autocomplete="off" />
        <div class="merge-checklist" id="mergeList">
          ${ordered.map(o => `
            <label class="merge-row${reasonById[o.id] ? ' is-suggested' : ''}" data-name="${esc((o.name || '').toLowerCase())}" data-aliases="${esc((o.aliases || []).join(' ').toLowerCase())}">
              <input type="checkbox" class="merge-pick" value="${o.id}"${reasonById[o.id] ? ' checked' : ''} />
              <span class="merge-row-name">${esc(o.name)}</span>
              ${reasonById[o.id] ? `<span class="merge-row-reason">${esc(reasonById[o.id])}</span>` : ''}
            </label>`).join('')}
        </div>
      </div>
      <div class="merge-field">
        <label class="merge-label">Primary name (kept)</label>
        <select class="chunk-title-input merge-select" id="mergePrimaryName"></select>
      </div>
      <div class="ui-modal-actions">
        <button class="ui-modal-btn" data-act="cancel">Cancel</button>
        <button class="ui-modal-btn solid" data-act="merge">Merge</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const listBox = overlay.querySelector('#mergeList');
  const searchInp = overlay.querySelector('#mergeSearch');
  const primarySel = overlay.querySelector('#mergePrimaryName');
  const mergeBtn = overlay.querySelector('[data-act="merge"]');

  const checkedIds = () => [...listBox.querySelectorAll('.merge-pick:checked')].map(cb => cb.value);
  // Primary-name choices = the viewed record plus every currently-checked target.
  function refreshPrimary() {
    const prev = primarySel.value;
    const names = [c.name, ...checkedIds().map(id => (all.find(x => x.id === id) || {}).name)].filter(Boolean);
    const uniq = [...new Set(names)];
    primarySel.innerHTML = uniq.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    primarySel.value = uniq.includes(prev) ? prev : c.name;
  }
  function refreshBtn() {
    const n = checkedIds().length;
    mergeBtn.textContent = n > 1 ? `Merge ${n}` : 'Merge';
    mergeBtn.disabled = !n;
  }
  function filterList() {
    const q = searchInp.value.trim().toLowerCase();
    listBox.querySelectorAll('.merge-row').forEach(row => {
      const hit = !q || row.dataset.name.includes(q) || row.dataset.aliases.includes(q);
      row.style.display = hit ? '' : 'none';
    });
  }

  listBox.addEventListener('change', () => { refreshPrimary(); refreshBtn(); });
  searchInp.addEventListener('input', filterList);
  refreshPrimary(); refreshBtn();
  searchInp.focus();

  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
  mergeBtn.addEventListener('click', async () => {
    const ids = checkedIds();
    if (!ids.length) return;
    const primaryName = primarySel.value || c.name;
    close();
    const msg = ids.length > 1
      ? `Merge ${ids.length} ${K.noun}s into "${primaryName}"? This cannot be undone.`
      : `Merge "${(all.find(x => x.id === ids[0]) || {}).name}" into "${primaryName}"? This cannot be undone.`;
    if (!await confirmModal(msg, { title: `MERGE ${K.NOUNS}`, okText: 'Merge' })) return;
    ids.forEach(id => mergeEntities(K, c.id, id, primaryName));
  });
}

// ---- MERGE CANDIDATE HEURISTIC -----------------------------------------
// Fully client-side (no AI): score whether two entities are likely the same,
// based only on their name + aliases. Used to pre-check duplicates of the
// viewed record inside the MERGE modal.

// Lowercase, strip accents/punctuation, collapse whitespace.
function normalizeName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Classic Levenshtein edit distance (small strings, fine to compute directly).
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

// Every comparable label for an entity: its name plus all aliases, normalized.
function entityLabels(c) {
  return [c.name, ...(c.aliases || [])]
    .map(normalizeName)
    .filter(Boolean);
}

// Decide whether two entities likely refer to the same person/place, and why.
// Returns a short human reason string, or '' if they should not be suggested.
function mergeReason(a, b) {
  const la = entityLabels(a), lb = entityLabels(b);
  const setA = new Set(la), setB = new Set(lb);

  // Exact shared label (identical name, or one name equals the other's alias,
  // or they share an alias).
  for (const label of setA) {
    if (setB.has(label)) {
      if (label === normalizeName(a.name) && label === normalizeName(b.name)) return 'Identical name';
      return `Shared name/alias “${label}”`;
    }
  }

  // Token-subset containment: one full label is a multi-word subset of the
  // other (e.g. "Tom" inside "Tom Riddle", "Mrs Weasley" inside "Molly Weasley").
  for (const x of la) {
    const tx = x.split(' ');
    for (const y of lb) {
      const ty = y.split(' ');
      if (tx.length > 1 || ty.length > 1) {
        const big = tx.length >= ty.length ? new Set(tx) : new Set(ty);
        const small = tx.length >= ty.length ? ty : tx;
        if (small.length && small.every(t => big.has(t))) return `“${x}” / “${y}” overlap`;
      }
    }
  }

  // Near-identical spelling (typo / variant), for labels long enough that a
  // single edit is meaningful rather than coincidental.
  for (const x of la) {
    for (const y of lb) {
      if (x.length >= 4 && y.length >= 4 && Math.abs(x.length - y.length) <= 1
          && levenshtein(x, y) <= 1) return `“${x}” ≈ “${y}”`;
    }
  }
  return '';
}

// Entities likely to be the same as `c`, each with a short reason. Excludes
// archived records and `c` itself.
function mergeCandidatesFor(K, c) {
  return (db[K.coll] || [])
    .filter(x => x.id !== c.id && !x.archived)
    .map(x => ({ id: x.id, name: x.name, reason: mergeReason(c, x) }))
    .filter(x => x.reason);
}

// Reassign one highlighted mention (by ordinal) from `c` to another entity:
// rewrite just that occurrence in the chunk body to the target's primary name,
// then re-key c's dismissals so the rest stay intact. Lets the author pick off
// individual misattributed mentions in the body without a full merge.
function reassignOccToEntity(K, c, chunk, ord, targetId) {
  const target = db[K.coll].find(x => x.id === targetId);
  if (!target || target.id === c.id) return;
  const occ = occurrencesOf(c, chunk);
  const hit = occ.find(o => o.ord === ord);
  if (!hit || hit.dismissed) return;

  const body = String(chunk.body || '');
  const editIndex = hit.index;
  const delta = target.name.length - hit.text.length;
  // Where the other (untouched) dismissed mentions will land after the edit.
  const dismissedNewIdx = new Set(
    occ.filter(o => o.dismissed)
      .map(o => (o.index < editIndex ? o.index : o.index + delta))
  );
  chunk.body = body.slice(0, editIndex) + target.name + body.slice(editIndex + hit.text.length);

  // Rebuild c's dismissals for this chunk: keep the previously-dismissed ones,
  // and dismiss anything now sitting inside the rewritten span (covers a target
  // name that still contains c's name as a token, e.g. "John" -> "John Smith").
  const fresh = occurrencesOf(c, chunk);
  c.dismissedRefs = (c.dismissedRefs || []).filter(k => k.split(':')[0] !== chunk.id);
  const dismissedOrds = new Set();
  fresh.forEach(o => {
    const insideReplacement = o.index >= editIndex && o.index < editIndex + target.name.length;
    if (insideReplacement || dismissedNewIdx.has(o.index)) {
      c.dismissedRefs.push(chunk.id + ':' + o.ord);
      dismissedOrds.add(o.ord);
    }
  });

  // Link the target so it owns the mention; drop c's explicit link only if c has
  // no live mentions left here.
  chunk[K.link] = chunk[K.link] || [];
  if (!chunk[K.link].includes(target.id)) chunk[K.link].push(target.id);
  if (!fresh.some(o => !dismissedOrds.has(o.ord))) {
    chunk[K.link] = chunk[K.link].filter(id => id !== c.id);
  }

  save();
  renderEntityList(K);
}

// Picker for reassignOccToEntity: searchable list of other entities to move the
// mention to. Rewrites just this mention to that entity's primary name.
function reassignOccModal(K, c, chunk, ord) {
  const others = db[K.coll].filter(x => x.id !== c.id)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  if (!others.length) { alertModal(`Need another ${K.noun} to reassign to.`, { title: `REASSIGN ${K.NOUN}` }); return; }
  const hit = occurrencesOf(c, chunk).find(o => o.ord === ord);

  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  overlay.innerHTML = `
    <div class="ui-modal merge-modal">
      <div class="ui-modal-title">REASSIGN MENTION</div>
      <div class="ui-modal-msg">Move the mention <strong>${esc(hit ? hit.text : c.name)}</strong> in <strong>${esc(chunk.title || 'this hop')}</strong> to another ${K.noun}. It will be rewritten to that ${K.noun}'s primary name.</div>
      <div class="merge-field">
        <label class="merge-label">Reassign to</label>
        <input type="text" class="chunk-title-input merge-search" id="reassignSearch" placeholder="Search ${K.noun}s…" autocomplete="off" />
        <select class="chunk-title-input merge-select" id="reassignTarget" size="6">
          ${others.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}
        </select>
      </div>
      <div class="ui-modal-actions">
        <button class="ui-modal-btn" data-act="cancel">Cancel</button>
        <button class="ui-modal-btn solid" data-act="go">Reassign</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const sel = overlay.querySelector('#reassignTarget');
  const searchInp = overlay.querySelector('#reassignSearch');
  function filterOptions() {
    const query = searchInp.value.trim().toLowerCase();
    const matches = others.filter(o => !query
      || (o.name || '').toLowerCase().includes(query)
      || (o.aliases || []).some(a => (a || '').toLowerCase().includes(query)));
    sel.innerHTML = matches.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('');
    if (matches.length) sel.value = matches[0].id;
  }
  searchInp.addEventListener('input', filterOptions);
  searchInp.focus();

  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
  overlay.querySelector('[data-act="go"]').addEventListener('click', () => {
    const targetId = sel.value;
    if (!targetId) return;
    close();
    reassignOccToEntity(K, c, chunk, ord, targetId);
  });
}

// AI summary — sends every chunk that references the entity to the model.
async function generateEntitySummary(K, c, btn) {
  const refs = refsFor(K, c);
  if (!refs.length) { alertModal(`No chunks reference this ${K.noun} yet.`, { title: 'AI SUMMARY' }); return; }
  const original = aiBtnStart(btn, IC_GENERATE, 'THINKING…');
  try {
    const { reply } = await aiInvoke({
      task: K.sumTask,
      name: c.name,
      aliases: c.aliases || [],
      chunks: refs.map(r => ({ title: r.title, body: r.body }))
    });
    c.summary = reply || ''; save(); renderEntityPane(K);
    if (reply) { const sumEl = document.getElementById('entitySummaryBox'); if (sumEl) typeWriter(sumEl, reply); }
  } catch (err) {
    aiBtnDone(btn, original);
    alertModal('Could not generate summary.\n\n' + (err.message || ''), { title: 'AI SUMMARY' });
  }
}

// Vertical timeline of a character's growth: ordered stages, each a labeled beat
// with a short summary, dotted in the character's color.
function renderArc(c) {
  const arc = c.arc || [];
  if (!arc.length) {
    return '<div class="char-summary"><span style="color:var(--muted)">No arc yet. Generate one to plot this character\u2019s growth across the story.</span></div>';
  }
  const col = c.color || 'var(--accent)';
  return `<div class="arc-timeline" style="--arc:${esc(col)}">${arc.map((s, i) => `
    <div class="arc-stage">
      <div class="arc-stage-label">${esc(s.stage || ('Stage ' + (i + 1)))}</div>
      ${s.summary ? `<div class="arc-stage-summary">${esc(s.summary)}</div>` : ''}
    </div>`).join('')}</div>`;
}

// CORE PRINCIPLES — high-level 2-5 word epithets. Each is a single row: the
// principle name, a start→end arrow showing how it shifted (or held), and a
// CHANGED/HELD tag. Expand a row to see the hops (and their sections) that
// inform it. Built as <details> so the expand needs no JS wiring.
function renderPrinciples(c) {
  const principles = c.principles || [];
  if (!principles.length) return '';
  const col = c.color || 'var(--accent)';
  return `<div class="char-principles" style="--arc:${esc(col)}">
    <h4 class="principles-head">CORE PRINCIPLES</h4>
    ${principles.map(p => {
      const refs = Array.isArray(p.refs) ? p.refs.filter(r => r && (r.hop || r.section || r.note)) : [];
      return `
    <details class="principle">
      <summary class="principle-row">
        <span class="principle-caret">▸</span>
        <span class="principle-name">${esc(p.principle || '')}</span>
        <span class="principle-flow">
          <span class="principle-start">${esc(p.start || '')}</span>
          <span class="principle-arrow">→</span>
          <span class="principle-end">${esc(p.end || '')}</span>
        </span>
        <span class="principle-tag ${p.changed ? 'changed' : 'held'}">${p.changed ? 'CHANGED' : 'HELD'}</span>
      </summary>
      <div class="principle-refs">
        ${refs.length ? refs.map(r => `
        <div class="principle-ref">
          <div class="pr-where">${r.hop ? `<span class="pr-hop">${esc(r.hop)}</span>` : ''}${r.hop && r.section ? '<span class="pr-dot">·</span>' : ''}${r.section ? `<span class="pr-section">${esc(r.section)}</span>` : ''}</div>
          ${r.note ? `<div class="pr-note">${esc(r.note)}</div>` : ''}
        </div>`).join('') : '<div class="pr-note" style="opacity:.6">No supporting references cited.</div>'}
      </div>
    </details>`;
    }).join('')}
  </div>`;
}

// AI character arc — sends every reference in narrative order and plots the
// character's growth as an ordered set of stages stored on c.arc.
async function generateCharArc(K, c, btn) {
  const refs = refsFor(K, c).slice().sort((a, b) => (a.narrativeOrder ?? 0) - (b.narrativeOrder ?? 0));
  if (!refs.length) { alertModal('No chunks reference this character yet.', { title: 'CHARACTER ARC' }); return; }
  const original = aiBtnStart(btn, IC_GENERATE, 'PLOTTING…');
  try {
    const { arc, principles } = await aiInvoke({
      task: 'char_arc',
      name: c.name,
      aliases: c.aliases || [],
      chunks: refs.map(r => ({ title: r.title, body: r.body, section: chapterTitle(r.chapterId) }))
    });
    c.arc = Array.isArray(arc) ? arc : [];
    c.principles = Array.isArray(principles) ? principles : [];
    save(); renderEntityPane(K);
    if (!c.arc.length && !c.principles.length) alertModal('Could not plot an arc from these references.', { title: 'CHARACTER ARC' });
  } catch (err) {
    aiBtnDone(btn, original);
    alertModal('Could not generate arc.\n\n' + (err.message || ''), { title: 'CHARACTER ARC' });
  }
}

// RELATIONSHIPS — each other character this one is tied to, with a summary and
// the hops (and their sections) where they intersect. Expandable rows, same
// <details> pattern as principles so no JS wiring is needed for the expand.
function renderRelationships(c) {
  const rels = c.relationships || [];
  if (!rels.length) {
    return '<div class="char-summary"><span style="color:var(--muted)">No relationships analyzed yet. Run it to map who this character is tied to across the story.</span></div>';
  }
  const col = c.color || 'var(--accent)';
  return `<div class="char-rels" style="--arc:${esc(col)}">
    ${rels.map(r => {
      const refs = Array.isArray(r.refs) ? r.refs.filter(x => x && (x.hop || x.section || x.note)) : [];
      return `
    <details class="rel">
      <summary class="rel-row">
        <span class="rel-caret">▸</span>
        <span class="rel-name">${esc(r.character || '')}</span>
        <span class="rel-count">${refs.length}</span>
      </summary>
      ${r.summary ? `<div class="rel-summary">${esc(r.summary)}</div>` : ''}
      <div class="rel-refs">
        ${refs.length ? refs.map(x => `
        <div class="rel-ref">
          <div class="pr-where">${x.hop ? `<span class="pr-hop">${esc(x.hop)}</span>` : ''}${x.hop && x.section ? '<span class="pr-dot">·</span>' : ''}${x.section ? `<span class="pr-section">${esc(x.section)}</span>` : ''}</div>
          ${x.note ? `<div class="pr-note">${esc(x.note)}</div>` : ''}
        </div>`).join('') : '<div class="pr-note" style="opacity:.6">No supporting references cited.</div>'}
      </div>
    </details>`;
    }).join('')}
  </div>`;
}

// Core relationship analysis — sends every hop referencing this character plus
// the roster of all other tracked characters, stores the result on c. Returns
// the relationships array. No UI; drives the per-character ANALYZE button.
async function analyzeOneRelationship(K, c) {
  const refs = refsFor(K, c).slice().sort((a, b) => (a.narrativeOrder ?? 0) - (b.narrativeOrder ?? 0));
  const others = db[K.coll].filter(x => x.id !== c.id);
  if (!refs.length || !others.length) return [];
  const { relationships } = await aiInvoke({
    task: 'char_relationships',
    name: c.name,
    aliases: c.aliases || [],
    others: others.map(x => ({ name: x.name, aliases: x.aliases || [] })),
    chunks: refs.map(r => ({ title: r.title, body: r.body, section: chapterTitle(r.chapterId) }))
  });
  c.relationships = Array.isArray(relationships) ? relationships : [];
  save();
  return c.relationships;
}

async function generateCharRelationships(K, c, btn) {
  if (!refsFor(K, c).length) { alertModal('No chunks reference this character yet.', { title: 'RELATIONSHIPS' }); return; }
  if (!db[K.coll].some(x => x.id !== c.id)) { alertModal('Add more characters first — there is no one to relate this character to.', { title: 'RELATIONSHIPS' }); return; }
  const original = aiBtnStart(btn, IC_ANALYZE, 'ANALYZING…');
  try {
    await analyzeOneRelationship(K, c);
    renderEntityPane(K);
    if (!c.relationships.length) alertModal('No relationships found among the other tracked characters.', { title: 'RELATIONSHIPS' });
  } catch (err) {
    aiBtnDone(btn, original);
    alertModal('Could not analyze relationships.\n\n' + (err.message || ''), { title: 'RELATIONSHIPS' });
  }
}

/* =====================================================================
   SEARCH — AI reads every hop in full, batch by batch, to find content
   that matches a free-form question or description.
   ===================================================================== */
// Module state survives navigation away and back, so results stay on the page.
let searchState = { query: '', running: false, canceled: false, scanned: 0, total: 0, results: [], done: false, error: '' };
const SEARCH_BATCH = 5;

(function wireSearch() {
  const input = document.getElementById('searchInput');
  const btn = document.getElementById('searchRunBtn');
  if (!input || !btn) return;
  btn.addEventListener('click', () => runSearch(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runSearch(input.value); } });
})();

function renderSearch() {
  const input = document.getElementById('searchInput');
  if (input && document.activeElement !== input) input.value = searchState.query;
  renderSearchProgress();
  renderSearchResults();
}

function renderSearchProgress() {
  const el = document.getElementById('searchProgress');
  if (!el) return;
  if (!searchState.running && !searchState.done) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const pct = searchState.total ? Math.round((searchState.scanned / searchState.total) * 100) : 0;
  const n = searchState.results.length;
  el.innerHTML = `
    <div class="sp-row">
      <span class="sp-label">${searchState.running ? AI_STAR + ' SCANNING HOPS' : (searchState.canceled ? 'SCAN STOPPED' : 'SCAN COMPLETE')}</span>
      <span class="sp-count">${searchState.scanned} / ${searchState.total} hops · ${n} match${n === 1 ? '' : 'es'}</span>
      ${searchState.running ? '<button class="add-btn sp-stop" data-stop>STOP</button>' : ''}
    </div>
    <div class="sp-bar"><div class="sp-fill" style="width:${pct}%"></div></div>`;
  el.querySelector('[data-stop]')?.addEventListener('click', () => { searchState.canceled = true; });
}

function renderSearchResults() {
  const el = document.getElementById('searchResults');
  if (!el) return;
  if (searchState.error) { el.innerHTML = `<div class="pane-empty">${esc(searchState.error)}</div>`; return; }
  if (!searchState.query) {
    el.innerHTML = '<div class="search-hint">Type a question or describe a moment, then hit SEARCH. Every hop is read in full — this can take a minute on a long manuscript, and progress shows above.</div>';
    return;
  }
  const r = searchState.results;
  if (!r.length) {
    el.innerHTML = searchState.running
      ? '<div class="search-hint">Reading hops…</div>'
      : `<div class="pane-empty">No hops matched <b>${esc(searchState.query)}</b>.</div>`;
    return;
  }
  el.innerHTML = `<div class="sr-count">${r.length} result${r.length === 1 ? '' : 's'} for <b>${esc(searchState.query)}</b></div>` +
    r.map(res => `
      <div class="search-result" data-open="${res.id}" style="border-left:3px solid ${chapterColor(res.chapterId)}">
        <div class="sr-head">
          <span class="sr-title">${esc(res.title || 'Untitled')}</span>
          <span class="sr-score">${res.score}</span>
        </div>
        <div class="sr-where">${esc(chapterTitle(res.chapterId))}</div>
        ${res.reason ? `<div class="sr-reason">${esc(res.reason)}</div>` : ''}
        ${res.quote ? `<div class="sr-quote">&ldquo;${esc(res.quote)}&rdquo;</div>` : ''}
      </div>`).join('');
  el.querySelectorAll('[data-open]').forEach(card =>
    card.addEventListener('click', () => openChunkModal(card.dataset.open)));
}

async function runSearch(query) {
  query = (query || '').trim();
  if (!query || searchState.running) return;
  const hops = db.chunks.filter(isVisibleChunk).filter(c => (c.body || '').trim() || (c.title || '').trim());
  if (!hops.length) {
    searchState = { query, running: false, canceled: false, scanned: 0, total: 0, results: [], done: true, error: '' };
    renderSearch();
    alertModal('There are no hops with text to search yet.', { title: 'SEARCH' });
    return;
  }
  searchState = { query, running: true, canceled: false, scanned: 0, total: hops.length, results: [], done: false, error: '' };
  renderSearch();
  try {
    for (let i = 0; i < hops.length; i += SEARCH_BATCH) {
      if (searchState.canceled) break;
      const batch = hops.slice(i, i + SEARCH_BATCH);
      try {
        const res = await aiInvoke({
          task: 'search_hops',
          query,
          hops: batch.map(h => ({ title: h.title, section: chapterTitle(h.chapterId), body: h.body }))
        });
        (Array.isArray(res.matches) ? res.matches : []).forEach(m => {
          const hop = batch[(parseInt(m.index, 10) || 0) - 1];
          if (!hop) return;
          searchState.results.push({
            id: hop.id, chapterId: hop.chapterId, title: hop.title,
            score: Math.max(0, Math.min(100, Math.round(Number(m.score) || 0))),
            reason: typeof m.reason === 'string' ? m.reason : '',
            quote: typeof m.quote === 'string' ? m.quote : ''
          });
        });
      } catch (_) { /* skip this batch, keep scanning the rest */ }
      searchState.scanned = Math.min(hops.length, i + SEARCH_BATCH);
      searchState.results.sort((a, b) => b.score - a.score);
      renderSearch();
    }
  } catch (err) {
    searchState.error = 'Search failed. ' + (err.message || '');
  }
  searchState.running = false; searchState.done = true;
  renderSearch();
}

// --- Scoped AI search: same model task as global SEARCH, but the hop set is
// limited to one entity's references (character / location / tag). State lives
// in a single module object keyed by entity so results survive pane re-renders.
let entitySearch = { key: '', query: '', running: false, canceled: false, scanned: 0, total: 0, results: [], done: false, error: '' };

function entitySearchProgressHTML() {
  const s = entitySearch;
  if (!s.running && !s.done) return '';
  const pct = s.total ? Math.round((s.scanned / s.total) * 100) : 0;
  const n = s.results.length;
  return `
    <div class="sp-row">
      <span class="sp-label">${s.running ? AI_STAR + ' SCANNING HOPS' : (s.canceled ? 'SCAN STOPPED' : 'SCAN COMPLETE')}</span>
      <span class="sp-count">${s.scanned} / ${s.total} hops · ${n} match${n === 1 ? '' : 'es'}</span>
      ${s.running ? '<button class="add-btn es-stop">STOP</button>' : ''}
    </div>
    <div class="sp-bar"><div class="sp-fill" style="width:${pct}%"></div></div>`;
}

function entitySearchResultsHTML() {
  const s = entitySearch;
  if (s.error) return `<div class="pane-empty">${esc(s.error)}</div>`;
  if (!s.query) return '';
  const r = s.results;
  if (!r.length) {
    return s.running ? '<div class="search-hint">Reading references…</div>'
      : `<div class="pane-empty">No references matched <b>${esc(s.query)}</b>.</div>`;
  }
  return `<div class="sr-count">${r.length} result${r.length === 1 ? '' : 's'} for <b>${esc(s.query)}</b></div>` +
    r.map(res => `
      <div class="search-result" data-es-open="${res.id}" style="border-left:3px solid ${chapterColor(res.chapterId)}">
        <div class="sr-head">
          <span class="sr-title">${esc(res.title || 'Untitled')}</span>
          <span class="sr-score">${res.score}</span>
        </div>
        <div class="sr-where">${esc(chapterTitle(res.chapterId))}</div>
        ${res.reason ? `<div class="sr-reason">${esc(res.reason)}</div>` : ''}
        ${res.quote ? `<div class="sr-quote">&ldquo;${esc(res.quote)}&rdquo;</div>` : ''}
      </div>`).join('');
}

// The search bar + progress + results, ready to drop into an entity pane. `noun`
// only flavors the placeholder copy.
function entitySearchBlockHTML(key, noun) {
  const mine = entitySearch.key === key;
  return `
    <div class="char-block es-block" data-es="${key}">
      <h3>SEARCH <span style="color:var(--muted);font-weight:400">(AI — reads only this ${esc(noun)}'s references)</span></h3>
      <div class="es-bar">
        <input class="chunk-title-input es-input" placeholder="Ask about this ${esc(noun)}…" value="${mine ? esc(entitySearch.query) : ''}" />
        <button class="add-btn es-run">${AI_STAR} SEARCH</button>
      </div>
      <div class="es-progress">${mine ? entitySearchProgressHTML() : ''}</div>
      <div class="es-results">${mine ? entitySearchResultsHTML() : ''}</div>
    </div>`;
}

// Repaint just the progress + results sub-containers (keeps the input focused
// and avoids a heavy full-pane re-render on every batch).
function paintEntitySearch(key) {
  const block = document.querySelector(`.es-block[data-es="${key}"]`);
  if (!block) return;
  const mine = entitySearch.key === key;
  block.querySelector('.es-progress').innerHTML = mine ? entitySearchProgressHTML() : '';
  block.querySelector('.es-results').innerHTML = mine ? entitySearchResultsHTML() : '';
  block.querySelector('.es-stop')?.addEventListener('click', () => { entitySearch.canceled = true; });
  block.querySelectorAll('[data-es-open]').forEach(card =>
    card.addEventListener('click', () => openChunkModal(card.dataset.esOpen)));
}

// Wire a freshly rendered search block. `hops` is the entity's reference set,
// snapshotted at render time.
function wireEntitySearch(pane, key, hops) {
  const block = pane.querySelector(`.es-block[data-es="${key}"]`);
  if (!block) return;
  const input = block.querySelector('.es-input');
  const run = () => runScopedSearch(key, input.value, hops);
  block.querySelector('.es-run').addEventListener('click', run);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  block.querySelector('.es-stop')?.addEventListener('click', () => { entitySearch.canceled = true; });
  block.querySelectorAll('[data-es-open]').forEach(card =>
    card.addEventListener('click', () => openChunkModal(card.dataset.esOpen)));
}

async function runScopedSearch(key, query, hops) {
  query = (query || '').trim();
  if (!query || entitySearch.running) return;
  const usable = (hops || []).filter(c => (c.body || '').trim() || (c.title || '').trim());
  if (!usable.length) {
    entitySearch = { key, query, running: false, canceled: false, scanned: 0, total: 0, results: [], done: true, error: 'No references with text to search yet.' };
    paintEntitySearch(key);
    return;
  }
  entitySearch = { key, query, running: true, canceled: false, scanned: 0, total: usable.length, results: [], done: false, error: '' };
  paintEntitySearch(key);
  try {
    for (let i = 0; i < usable.length; i += SEARCH_BATCH) {
      if (entitySearch.canceled) break;
      const batch = usable.slice(i, i + SEARCH_BATCH);
      try {
        const res = await aiInvoke({
          task: 'search_hops',
          query,
          hops: batch.map(h => ({ title: h.title, section: chapterTitle(h.chapterId), body: h.body }))
        });
        (Array.isArray(res.matches) ? res.matches : []).forEach(m => {
          const hop = batch[(parseInt(m.index, 10) || 0) - 1];
          if (!hop) return;
          entitySearch.results.push({
            id: hop.id, chapterId: hop.chapterId, title: hop.title,
            score: Math.max(0, Math.min(100, Math.round(Number(m.score) || 0))),
            reason: typeof m.reason === 'string' ? m.reason : '',
            quote: typeof m.quote === 'string' ? m.quote : ''
          });
        });
      } catch (_) { /* skip this batch, keep scanning */ }
      entitySearch.scanned = Math.min(usable.length, i + SEARCH_BATCH);
      entitySearch.results.sort((a, b) => b.score - a.score);
      paintEntitySearch(key);
    }
  } catch (err) {
    entitySearch.error = 'Search failed. ' + (err.message || '');
  }
  entitySearch.running = false; entitySearch.done = true;
  paintEntitySearch(key);
}

// Rename an entity and propagate the change into prose, with a confirmation that
// shows how many occurrences will be rewritten. Cancel reverts (no change at all).
async function renameEntityEverywhere(K, c, oldName, newName) {
  if (!newName || newName === oldName) { renderEntityPane(K); return; }
  const re = new RegExp('\\b' + escapeReg(oldName) + '\\b', 'g');
  let occ = 0, hits = 0;
  db.chunks.forEach(ch => {
    const n = ((ch.body || '').match(re) || []).length + ((ch.title || '').match(re) || []).length;
    if (n) { occ += n; hits += 1; }
  });
  if (occ > 0) {
    const ok = await confirmModal(
      `Replace ${occ} occurrence${occ === 1 ? '' : 's'} of "${oldName}" with "${newName}" across ${hits} chunk${hits === 1 ? '' : 's'}?`,
      { title: `RENAME ${K.NOUN}`, okText: 'Replace', danger: false }
    );
    if (!ok) { renderEntityPane(K); return; }
    db.chunks.forEach(ch => {
      if (ch.body) ch.body = ch.body.replace(re, () => newName);
      if (ch.title) ch.title = ch.title.replace(re, () => newName);
    });
  }
  c.name = newName;
  save(); renderEntityList(K);
}

function wireEntityRail(K) {
  const addBtn = document.getElementById(K.addId);
  if (addBtn) addBtn.addEventListener('click', () => {
    const id = uid();
    const color = CHAPTER_PALETTE[db[K.coll].length % CHAPTER_PALETTE.length];
    db[K.coll].push({ id, name: K.newName, aliases: [], summary: '', notes: [], color, dismissedRefs: [] });
    db.ui[K.active] = id; save(); renderEntityList(K);
  });
  const detectBtn = document.getElementById(K.detectId);
  if (detectBtn) detectBtn.addEventListener('click', () => detectEntities(K));
}
wireEntityRail(ENTITY_KINDS.character);
wireEntityRail(ENTITY_KINDS.location);

function detectSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// One detect call for a single hop, with exponential backoff. Firing many
// sequential calls makes the Anthropic API reject some with a quick 5xx (rate
// limit / overloaded); those clear if we wait and retry, so a failed hop backs
// off (~1.5s, 3s, 6s, 11s + jitter) and tries again rather than being dropped.
async function detectScanHop(K, chunk, existing, shouldStop) {
  const delays = [1500, 3000, 6000, 11000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (shouldStop()) return null;
    try {
      return await aiInvoke({
        task: K.detectTask,
        chunks: [{ title: chunk.title, body: chunk.body }],
        existing
      });
    } catch (_) {
      if (attempt === delays.length) return null;
      const jitter = delays[attempt] * (0.7 + Math.random() * 0.6);
      await detectSleep(jitter);
    }
  }
  return null;
}

// Merge one hop's detected entities into the running map and stream them into
// the live modal. Only trusts names the model can point to in this hop's text.
function detectMergeHop(K, chunk, result, known, merged, ui) {
  const bodyLc = (chunk.body || '').toLowerCase();
  const inBody = name => { const n = (name || '').trim().toLowerCase(); return n && bodyLc.includes(n); };
  (result[K.resultKey] || []).forEach(f => {
    if (!f || !f.name || !f.name.trim()) return;
    if (!(inBody(f.name) || (f.aliases || []).some(inBody))) return;
    const key = f.name.trim().toLowerCase();
    if (!merged.has(key)) {
      const entry = { name: f.name.trim(), aliases: new Set(), isNew: !known.has(key) };
      merged.set(key, entry);
      ui.addFound(key, entry.name, entry.isNew);
    }
    (f.aliases || []).forEach(a => a && a.trim() && merged.get(key).aliases.add(a.trim()));
    ui.updateAliases(key, [...merged.get(key).aliases], merged.get(key).isNew);
  });
}

// Scan chunk text hop-by-hop and surface a live modal that shows the scan
// advancing through hops with candidates appearing in real time. Scanning one
// hop per call keeps each payload small — the proven-reliable path the per-hop
// DETECT button uses — while backoff + a retry pass over rejected hops keeps the
// API's rate-limit rejections from silently dropping characters.
async function detectEntities(K) {
  const btn = document.getElementById(K.detectId);
  const all = db.chunks.filter(c => (c.body || '').trim() || (c.title || '').trim());
  if (!all.length) { alertModal('No chunk text to scan yet.', { title: `DETECT ${K.NOUNS}` }); return; }

  const scanned = new Set(db.ui[K.scannedKey] || []);
  const fresh = all.filter(c => !scanned.has(c.id));
  // Limit the scan to content added since the last run — this avoids re-surfacing
  // entities whose references the author previously dismissed.
  const scope = await detectScopeModal(K, fresh.length, all.length);
  if (!scope) return;
  const chunks = scope === 'new' ? fresh : all;
  if (!chunks.length) { alertModal('No new content since the last scan.', { title: `DETECT ${K.NOUNS}` }); return; }

  const original = aiBtnStart(btn, IC_DETECT, 'SCANNING…');
  const known = new Set(db[K.coll].flatMap(c => [c.name, ...(c.aliases || [])]).map(s => s.toLowerCase()));
  const merged = new Map();   // lowercased name -> { name, aliases:Set, isNew }
  const scannedIds = [];
  const ui = liveDetectModal(K, chunks.length);
  const stop = () => ui.canceled;
  const existingNames = () => [...known, ...[...merged.values()].map(m => m.name)];

  // First pass, in order.
  let failed = [];
  for (let i = 0; i < chunks.length; i++) {
    if (ui.canceled) break;
    const chunk = chunks[i];
    ui.setProgress(i, chunk.title || `Hop ${i + 1}`);
    const result = await detectScanHop(K, chunk, existingNames(), stop);
    scannedIds.push(chunk.id);
    if (!result) { failed.push(chunk); ui.setFailed(failed.length); continue; }
    detectMergeHop(K, chunk, result, known, merged, ui);
    if (i < chunks.length - 1) await detectSleep(250);   // gentle pacing between hops
  }

  // Second pass over hops the API rejected — by now any rate-limit window has
  // cleared, so most stragglers come back clean.
  if (failed.length && !ui.canceled) {
    const retry = failed; failed = [];
    for (let i = 0; i < retry.length; i++) {
      if (ui.canceled) break;
      ui.setRetry(i + 1, retry.length);
      const result = await detectScanHop(K, retry[i], existingNames(), stop);
      if (!result) { failed.push(retry[i]); continue; }
      detectMergeHop(K, retry[i], result, known, merged, ui);
      await detectSleep(250);
    }
    ui.setFailed(failed.length);
  }
  ui.setProgress(chunks.length, null);

  // Only mark hops we actually read as scanned — a hop that never came back
  // should be eligible for a future "new only" run.
  const failedIds = new Set(failed.map(c => c.id));
  const readIds = scannedIds.filter(id => !failedIds.has(id));
  const nowScanned = new Set([...(db.ui[K.scannedKey] || []), ...readIds]);
  db.ui[K.scannedKey] = [...nowScanned];

  const keys = await ui.finish();   // selected NEW candidate keys, or null if dismissed
  aiBtnDone(btn, original);
  if (!keys || !keys.length) { save(); return; }
  keys.forEach(key => {
    const m = merged.get(key); if (!m) return;
    db[K.coll].push({ id: uid(), name: m.name, aliases: [...m.aliases], summary: '', notes: [], color: CHAPTER_PALETTE[db[K.coll].length % CHAPTER_PALETTE.length], dismissedRefs: [] });
  });
  db.ui[K.active] = db[K.coll][db[K.coll].length - 1].id;
  save(); renderEntityList(K);
}

// Live scanning modal: a progress bar advances hop-by-hop while detected
// candidates stream into a checklist. Returns a small controller the scan loop
// drives; `finish()` resolves with the lowercased keys of the checked NEW
// candidates once the author clicks Add (or null if they cancel/dismiss).
function liveDetectModal(K, total) {
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  overlay.innerHTML = `
    <div class="ui-modal detect-modal live-detect">
      <div class="ui-modal-title">SCANNING ${K.NOUNS}</div>
      <div class="ld-progress">
        <div class="ld-bar"><div class="ld-fill" style="width:0%"></div></div>
        <div class="ld-status">Starting…</div>
      </div>
      <div class="ld-count"><span class="ld-found-n">0</span> new ${K.noun}(s) found</div>
      <div class="ld-warn" hidden></div>
      <div class="detect-list ld-list"><div class="ld-empty">No ${K.noun}s yet…</div></div>
      <div class="ui-modal-actions">
        <button class="ui-modal-btn" data-act="stop">Stop</button>
        <button class="ui-modal-btn solid" data-act="add" disabled>Scanning…</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const fill = overlay.querySelector('.ld-fill');
  const status = overlay.querySelector('.ld-status');
  const list = overlay.querySelector('.ld-list');
  const foundN = overlay.querySelector('.ld-found-n');
  const stopBtn = overlay.querySelector('[data-act="stop"]');
  const addBtn = overlay.querySelector('[data-act="add"]');
  const warn = overlay.querySelector('.ld-warn');
  const rows = new Map();   // key -> { el, checkbox, isNew }
  let newCount = 0, failed = 0;
  const api = { canceled: false };

  api.setProgress = (done, title) => {
    const pct = total ? Math.round((done / total) * 100) : 100;
    fill.style.width = pct + '%';
    status.textContent = done >= total
      ? 'Scan complete'
      : `Hop ${done + 1} / ${total}${title ? ' — ' + title : ''}`;
  };
  // The API rate-limits bursts of calls; surface that honestly instead of
  // letting rejected hops look like "nothing found".
  api.setFailed = n => {
    failed = n;
    if (!n) { warn.hidden = true; return; }
    warn.hidden = false;
    warn.textContent = `⚠ ${n} hop(s) hit a rate limit — retrying`;
  };
  api.setRetry = (i, totalRetry) => {
    status.textContent = `Retrying rejected hops · ${i} / ${totalRetry}`;
  };
  api.addFound = (key, name, isNew) => {
    const empty = list.querySelector('.ld-empty'); if (empty) empty.remove();
    const row = document.createElement('label');
    row.className = 'detect-row ld-row' + (isNew ? ' is-new' : ' is-existing');
    row.dataset.key = key;
    row.innerHTML = `<input type="checkbox" ${isNew ? 'checked' : 'disabled'} />
      <span class="detect-name">${esc(name)}</span>
      <span class="detect-aliases">${isNew ? 'new' : 'existing'}</span>`;
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
    rows.set(key, { el: row, checkbox: row.querySelector('input'), isNew });
    if (isNew) { newCount++; foundN.textContent = String(newCount); }
  };
  api.updateAliases = (key, aliases, isNew) => {
    const r = rows.get(key); if (!r || !aliases || !aliases.length) return;
    r.el.querySelector('.detect-aliases').textContent = (isNew ? 'new · ' : 'existing · ') + aliases.join(', ');
  };

  let finishResolve;
  const settle = val => { overlay.remove(); finishResolve && finishResolve(val); };
  // During the scan, Stop just flips the cancel flag; the loop exits and then
  // calls finish(), which rebinds these controls for the review step.
  stopBtn.addEventListener('click', () => { api.canceled = true; });

  api.finish = () => new Promise(resolve => {
    finishResolve = resolve;
    fill.style.width = '100%';
    status.textContent = newCount
      ? `Scan complete — ${newCount} new ${K.noun}(s)`
      : `Scan complete — no new ${K.noun}s`;
    if (failed) { warn.hidden = false; warn.textContent = `⚠ ${failed} hop(s) could not be read — run DETECT again to retry them`; }
    else warn.hidden = true;
    stopBtn.textContent = 'Cancel';
    addBtn.disabled = newCount === 0;
    addBtn.textContent = newCount ? `Add selected (${newCount})` : 'Nothing new';
    const recount = () => {
      let n = 0; rows.forEach(r => { if (r.isNew && r.checkbox.checked) n++; });
      addBtn.disabled = n === 0; addBtn.textContent = n ? `Add selected (${n})` : 'Add selected';
    };
    list.querySelectorAll('input').forEach(cb => cb.addEventListener('change', recount));
    stopBtn.addEventListener('click', () => settle(null), { once: true });
    overlay.addEventListener('click', e => { if (e.target === overlay) settle(null); });
    addBtn.addEventListener('click', () => {
      const chosen = [];
      rows.forEach((r, key) => { if (r.isNew && r.checkbox.checked) chosen.push(key); });
      settle(chosen);
    });
  });
  return api;
}

// Ask whether to scan only content added since the last DETECT, or everything.
function detectScopeModal(K, newCount, allCount) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'ui-modal-overlay';
    overlay.innerHTML = `
      <div class="ui-modal">
        <div class="ui-modal-title">DETECT ${K.NOUNS}</div>
        <div class="ui-modal-msg">Scan only what's new since the last run, or re-scan everything?</div>
        <div class="ui-modal-actions" style="flex-wrap:wrap">
          <button class="ui-modal-btn" data-act="cancel">Cancel</button>
          <button class="ui-modal-btn" data-act="all">All content (${allCount})</button>
          <button class="ui-modal-btn solid" data-act="new" ${newCount ? '' : 'disabled'}>New only (${newCount})</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = val => { overlay.remove(); resolve(val); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));
    overlay.querySelector('[data-act="all"]').addEventListener('click', () => close('all'));
    overlay.querySelector('[data-act="new"]').addEventListener('click', () => close('new'));
  });
}

/* =====================================================================
   TAGS
   ===================================================================== */
function tagUsage(id) {
  const chunks = db.chunks.filter(isVisibleChunk).filter(c => (c.tagIds || []).includes(id));
  const ideas = db.ideas.filter(i => (i.tagIds || []).includes(id));
  return { chunks, ideas, count: chunks.length + ideas.length };
}

function tagRowHTML(l) {
  return `<div class="chapter-item ${l.id === db.ui.activeTag ? 'active' : ''}" data-id="${l.id}">
    <span class="ci-dot" style="background:${l.color}"></span>
    <span class="ci-title">${esc(l.name)}</span>
    <span class="ci-count">${tagUsage(l.id).count}</span>
  </div>`;
}

function renderTags() {
  const list = document.getElementById('tagList');
  const activeTag = db.tags.find(x => x.id === db.ui.activeTag);
  const tagSelLabel = activeTag ? activeTag.name : 'Select tag';
  const pickTag = el => {
    db.ui.activeTag = el.dataset.id;
    list.closest('.chapter-rail')?.classList.remove('rail-open'); // collapse the mobile dropdown after picking
    save(); renderTags();
  };
  if (!db.tags.length) {
    list.innerHTML = `<div class="pane-empty" style="border:none">No tags yet. Add tags to hops and ideas, or create one here.</div>`;
    wireRailSelectInto('tagList', tagSelLabel);
    renderTagPane();
    return;
  }
  // Hop count per tag, computed once; lists sort by it (most-used first), then name.
  const tagHops = new Map(db.tags.map(l => [l.id, tagUsage(l.id).chunks.length]));
  const byTagHops = (a, b) => (tagHops.get(b.id) - tagHops.get(a.id)) || (a.name || '').localeCompare(b.name || '');
  const cats = tagCats();
  if (!cats.length) {
    list.innerHTML = [...db.tags].sort(byTagHops).map(tagRowHTML).join('');
    list.querySelectorAll('.chapter-item').forEach(el =>
      el.addEventListener('click', () => pickTag(el)));
    wireRailSelectInto('tagList', tagSelLabel);
    renderTagPane();
    return;
  }
  const groups = cats.map(c => ({
    id: c.id, name: c.name,
    tags: db.tags.filter(l => tagCatOf(l.id) === c.id).sort(byTagHops)
  }));
  const uncategorized = db.tags.filter(l => !tagCatName(tagCatOf(l.id))).sort(byTagHops);
  groups.push({ id: '', name: 'UNCATEGORIZED', tags: uncategorized });
  list.innerHTML = groups
    .filter(g => g.id || g.tags.length)
    .map(g => `
      <div class="tag-cat-group" data-cat="${g.id}">
        <div class="tag-cat-head">
          <span class="tcc-name">${esc(g.name)}</span>
          ${g.id ? `<span class="tcc-actions">
            <button class="tcc-btn" data-cat-rename="${g.id}" title="Rename category">✎</button>
            <button class="tcc-btn" data-cat-del="${g.id}" title="Delete category">✕</button>
          </span>` : ''}
        </div>
        ${g.tags.map(tagRowHTML).join('') || '<div class="tag-cat-empty">No tags</div>'}
      </div>`).join('');
  list.querySelectorAll('.chapter-item').forEach(el =>
    el.addEventListener('click', () => pickTag(el)));
  list.querySelectorAll('[data-cat-rename]').forEach(btn =>
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const cur = btn.dataset.catRename;
      const next = await promptModal('Category name:', cur, { title: 'RENAME CATEGORY', okText: 'Save' });
      if (next && next.trim()) { renameTagCat(cur, next); renderTags(); }
    }));
  list.querySelectorAll('[data-cat-del]').forEach(btn =>
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!await confirmModal('Delete this category? Tags inside move to Uncategorized.')) return;
      deleteTagCat(btn.dataset.catDel);
      renderTags();
    }));
  wireRailSelectInto('tagList', tagSelLabel);
  renderTagPane();
}

function renderTagPane() {
  const pane = document.getElementById('tagPane');
  const l = db.tags.find(x => x.id === db.ui.activeTag);
  if (!l) { pane.innerHTML = `<div class="pane-empty">Select or add a tag.</div>`; return; }

  const { chunks, ideas } = tagUsage(l.id);
  const curCat = tagCatOf(l.id);
  const catOpts = `<option value="">Uncategorized</option>`
    + tagCats().map(c => `<option value="${esc(c.id)}" ${c.id === curCat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')
    + `<option value="__new">＋ New category…</option>`;
  pane.innerHTML = `
    <div class="chunk-card-head">
      <input type="color" class="chap-color" id="tagColor" value="${l.color}" title="Tag color" />
      <input class="chunk-title-input" id="tagName" value="${esc(l.name)}" />
      <button class="icon-btn" id="delTagBtn" title="Delete tag">✕</button>
    </div>
    <div class="meta-field" style="margin:0 0 14px">CATEGORY
      <select id="tagCatSel">${catOpts}</select>
    </div>
    ${entitySearchBlockHTML('tag:' + l.id, 'tag')}
    <div class="char-block">
      <h3>SUMMARY <span style="color:var(--muted);font-weight:400">(AI — themes across tagged chunks)</span></h3>
      <div class="char-summary" id="tagSummary">${l.summary ? esc(l.summary) : '<span style="color:var(--muted)">No summary yet.</span>'}</div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="add-btn" id="genTagSummaryBtn">${IC_GENERATE} GENERATE</button>
        <button class="add-btn" id="editTagSummaryBtn">EDIT MANUALLY</button>
      </div>
    </div>
    <div class="char-block">
      <h3>CHUNKS (${chunks.length})</h3>
      <div class="char-refs">
        ${chunks.length ? chunks.map(c => `
          <div class="ref-row">
            <div class="ref-head">
              <div class="ref-meta">
                <div class="ref-title">${esc(c.title) || 'Untitled chunk'}</div>
                <div class="ref-where">${esc(chapterTitle(c.chapterId))}${c.chronoLabel ? ' · ' + esc(c.chronoLabel) : ''}</div>
                ${chunkCharLocLine(c)}
              </div>
              <button class="add-btn ref-edit" data-chunk-edit="${c.id}" title="Edit this chunk">EDIT</button>
            </div>
          </div>`).join('') : '<span style="color:var(--muted)">No hops tagged.</span>'}
      </div>
    </div>
    <div class="char-block">
      <h3>IDEAS (${ideas.length})</h3>
      <div class="idea-grid">
        ${ideas.length ? ideas.map(i => `
          <div class="idea-card"><div class="idea-text">${esc(i.title || i.body || 'Untitled idea')}</div></div>`).join('')
          : '<span style="color:var(--muted)">No ideas tagged.</span>'}
      </div>
    </div>`;

  document.getElementById('tagName').addEventListener('input', e => {
    const caret = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase();
    e.target.setSelectionRange(caret, caret);
    l.name = e.target.value; save();
    const t = document.querySelector(`#tagList .chapter-item[data-id="${l.id}"] .ci-title`);
    if (t) t.textContent = l.name;
  });
  document.getElementById('tagColor').addEventListener('input', e => {
    l.color = e.target.value; save();
    const d = document.querySelector(`#tagList .chapter-item[data-id="${l.id}"] .ci-dot`);
    if (d) d.style.background = l.color;
  });
  document.getElementById('tagCatSel').addEventListener('change', async e => {
    if (e.target.value === '__new') {
      const name = await promptModal('New category name:', '', { title: 'NEW CATEGORY', okText: 'Create' });
      setTagCat(l.id, name && name.trim() ? name : '');
    } else {
      setTagCat(l.id, e.target.value);
    }
    renderTags();
  });
  document.getElementById('delTagBtn').addEventListener('click', async () => {
    if (!await confirmModal('Delete this tag? It will be removed from all hops and ideas.')) return;
    db.chunks.forEach(c => { if (c.tagIds) c.tagIds = c.tagIds.filter(id => id !== l.id); });
    db.ideas.forEach(i => { if (i.tagIds) i.tagIds = i.tagIds.filter(id => id !== l.id); });
    db.tags = db.tags.filter(x => x.id !== l.id);
    db.ui.activeTag = db.tags[0]?.id || null;
    save(); renderTags();
  });
  document.getElementById('genTagSummaryBtn').addEventListener('click', e => generateTagSummary(l, e.currentTarget));
  document.getElementById('editTagSummaryBtn').addEventListener('click', async () => {
    const next = await promptModal('Tag summary:', l.summary || '', { title: 'TAG SUMMARY', okText: 'Save' });
    if (next !== null) { l.summary = next; save(); renderTagPane(); }
  });
  pane.querySelectorAll('[data-chunk-edit]').forEach(btn =>
    btn.addEventListener('click', () => openChunkModal(btn.dataset.chunkEdit)));
  wireEntitySearch(pane, 'tag:' + l.id, chunks);
}

async function generateTagSummary(l, btn) {
  const chunks = tagUsage(l.id).chunks;
  if (!chunks.length) { alertModal('No hops use this tag yet.', { title: 'TAG SUMMARY' }); return; }
  const original = aiBtnStart(btn, IC_GENERATE, 'THINKING…');
  try {
    const { reply } = await aiInvoke({
      task: 'tag_summary',
      tagName: l.name,
      chunks: chunks.map(c => ({ title: c.title, body: c.body }))
    });
    l.summary = reply || ''; save(); renderTagPane();
    if (reply) { const sumEl = document.getElementById('tagSummary'); if (sumEl) typeWriter(sumEl, reply); }
  } catch (err) {
    aiBtnDone(btn, original);
    alertModal('Could not generate summary.\n\n' + (err.message || ''), { title: 'TAG SUMMARY' });
  }
}

document.getElementById('addTagBtn').addEventListener('click', () => {
  const lab = { id: uid(), name: 'NEW TAG', color: CHAPTER_PALETTE[db.tags.length % CHAPTER_PALETTE.length] };
  db.tags.push(lab);
  db.ui.activeTag = lab.id;
  save(); renderTags();
});

/* =====================================================================
   IDEA BACKLOG
   ===================================================================== */
let ideaFilterTag = ''; // label id ('' = all)
let draggingIdeaId = null;

const DEFAULT_IDEA_LANES = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'upnext', title: 'Up Next' },
  { id: 'best', title: 'Best Ideas' }
];

function ideaLanes() {
  if (!Array.isArray(db.ui.ideaLanes) || !db.ui.ideaLanes.length) {
    db.ui.ideaLanes = DEFAULT_IDEA_LANES.map(l => ({ ...l }));
  }
  return db.ui.ideaLanes;
}
function ideaOrder() {
  if (!db.ui.ideaOrder || typeof db.ui.ideaOrder !== 'object') db.ui.ideaOrder = {};
  return db.ui.ideaOrder;
}
// laneId -> [idea,...] in saved order; any unfiled ideas drop into the first lane (newest first).
function ideasByLane() {
  const lanes = ideaLanes(), order = ideaOrder();
  const byId = new Map(db.ideas.map(i => [i.id, i]));
  const placed = new Set();
  const result = new Map();
  lanes.forEach(l => {
    const arr = [];
    (Array.isArray(order[l.id]) ? order[l.id] : []).forEach(id => {
      const it = byId.get(id);
      if (it && !placed.has(id)) { arr.push(it); placed.add(id); }
    });
    result.set(l.id, arr);
  });
  const leftover = db.ideas.filter(i => !placed.has(i.id)).sort((a, b) => b.ts - a.ts);
  if (leftover.length) result.set(lanes[0].id, [...leftover, ...result.get(lanes[0].id)]);
  return result;
}
function laneRemoveIdea(id) {
  const order = ideaOrder();
  Object.keys(order).forEach(k => { order[k] = (order[k] || []).filter(x => x !== id); });
}
function moveIdeaToLane(id, laneId, beforeId) {
  const order = ideaOrder();
  laneRemoveIdea(id);
  if (!Array.isArray(order[laneId])) order[laneId] = [];
  let idx = beforeId ? order[laneId].indexOf(beforeId) : order[laneId].length;
  if (idx < 0) idx = order[laneId].length;
  order[laneId].splice(idx, 0, id);
}

function renderIdeas() {
  const filterWrap = document.getElementById('ideaTagFilter');
  const usedIds = [...new Set(db.ideas.flatMap(i => i.tagIds || []))]
    .filter(id => getTag(id))
    .sort((a, b) => tagName(a).localeCompare(tagName(b)));
  filterWrap.innerHTML = usedIds.length
    ? `<span class="tag clickable ${ideaFilterTag === '' ? 'on' : ''}" data-l="">ALL</span>` +
      usedIds.map(id => `<span class="tag clickable ${ideaFilterTag === id ? 'on' : ''}" data-l="${id}" style="--lc:${tagColor(id)}">${esc(tagName(id))}</span>`).join('')
    : '';
  filterWrap.querySelectorAll('.tag').forEach(t =>
    t.addEventListener('click', () => { ideaFilterTag = t.dataset.l; renderIdeas(); }));

  const board = document.getElementById('ideaGrid');
  const lanes = ideaLanes();
  const grouped = ideasByLane();
  const matches = i => !ideaFilterTag || (i.tagIds || []).includes(ideaFilterTag);
  board.innerHTML = `<div class="kanban">` + lanes.map(l => {
    const items = (grouped.get(l.id) || []).filter(matches);
    const cards = items.map(renderIdeaCard).join('') || `<div class="lane-empty">Drop ideas here</div>`;
    return `
      <div class="lane" data-lane="${l.id}">
        <div class="lane-head">
          <input class="lane-title" data-lane="${l.id}" value="${esc(l.title)}" />
          <span class="lane-count">${items.length}</span>
          ${lanes.length > 1 ? `<button class="lane-del" data-lane="${l.id}" title="Delete lane">✕</button>` : ''}
        </div>
        <div class="lane-cards" data-lane="${l.id}">${cards}</div>
      </div>`;
  }).join('') + `<button class="lane-add" id="addLaneBtn" title="Add a swim lane">+ LANE</button></div>`;

  board.querySelectorAll('.idea-card').forEach(wireIdeaCard);
  board.querySelectorAll('.lane-cards').forEach(wireLaneDnD);
  board.querySelectorAll('.lane-title').forEach(wireLaneTitle);
  board.querySelectorAll('.lane-del').forEach(btn =>
    btn.addEventListener('click', () => deleteLane(btn.dataset.lane)));
  const addBtn = board.querySelector('#addLaneBtn');
  if (addBtn) addBtn.addEventListener('click', addLane);
}

function renderIdeaCard(i) {
  const tags = (i.tagIds || []).map(id =>
    `<span class="tag" style="--lc:${tagColor(id)}">${esc(tagName(id))}</span>`).join('');
  const name = i.title || '';
  const body = i.body || '';
  const nameHTML = name ? `<div class="idea-name">${esc(name)}</div>` : '';
  const bodyHTML = body ? `<div class="idea-body">${esc(body)}</div>` : '';
  return `
    <div class="idea-card" data-id="${i.id}" draggable="true">
      ${nameHTML || bodyHTML ? nameHTML + bodyHTML : `<div class="idea-name">Untitled idea</div>`}
      <div class="idea-foot">
        <div class="idea-tags">${tags}</div>
        <span class="idea-actions">
          <button class="add-btn" data-f="edit">EDIT</button>
          <button class="icon-btn" data-f="del" title="Delete">✕</button>
        </span>
      </div>
    </div>`;
}

function wireIdeaCard(card) {
  const id = card.dataset.id;
  const idea = db.ideas.find(x => x.id === id);
  if (!idea) return;
  card.querySelector('[data-f="del"]').addEventListener('click', () => {
    db.ideas = db.ideas.filter(x => x.id !== id);
    laneRemoveIdea(id);
    save(); renderIdeas();
  });
  const editBtn = card.querySelector('[data-f="edit"]');
  if (editBtn) editBtn.addEventListener('click', () => ideaEditModal(idea));

  if (card.getAttribute('draggable') === 'true') {
    card.addEventListener('dragstart', e => {
      draggingIdeaId = id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      requestAnimationFrame(() => card.classList.add('dragging'));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      clearLaneMarkers();
      draggingIdeaId = null;
    });
  }
}

/* ---- Kanban: drag-and-drop + lane management ---- */
function ideaDragAfter(container, y) {
  const cards = [...container.querySelectorAll('.idea-card:not(.dragging)')];
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    if (y < r.top + r.height / 2) return c;
  }
  return null;
}
function clearLaneMarkers() {
  document.querySelectorAll('.idea-card.drop-before, .idea-card.drop-after')
    .forEach(c => c.classList.remove('drop-before', 'drop-after'));
  document.querySelectorAll('.lane-cards.drop-into').forEach(c => c.classList.remove('drop-into'));
}
function wireLaneDnD(container) {
  container.addEventListener('dragover', e => {
    if (!draggingIdeaId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearLaneMarkers();
    const after = ideaDragAfter(container, e.clientY);
    if (after) after.classList.add('drop-before');
    else {
      const cards = container.querySelectorAll('.idea-card:not(.dragging)');
      if (cards.length) cards[cards.length - 1].classList.add('drop-after');
      else container.classList.add('drop-into');
    }
  });
  container.addEventListener('drop', e => {
    if (!draggingIdeaId) return;
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || draggingIdeaId;
    const after = ideaDragAfter(container, e.clientY);
    clearLaneMarkers();
    moveIdeaToLane(id, container.dataset.lane, after ? after.dataset.id : null);
    save(); renderIdeas();
  });
}
function wireLaneTitle(input) {
  const laneId = input.dataset.lane;
  const commit = () => {
    const lane = ideaLanes().find(l => l.id === laneId);
    if (!lane) return;
    const v = input.value.trim() || 'Untitled';
    if (v !== lane.title) { lane.title = v; save(); }
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
}
function addLane() {
  ideaLanes().push({ id: uid(), title: 'New Lane' });
  save(); renderIdeas();
  const inputs = document.querySelectorAll('.lane-title');
  const last = inputs[inputs.length - 1];
  if (last) { last.focus(); last.select(); }
}
function deleteLane(laneId) {
  const lanes = ideaLanes();
  if (lanes.length <= 1) return;
  const order = ideaOrder();
  const moved = order[laneId] || [];
  if (moved.length && !confirm('Delete this lane? Its ideas move to the first lane.')) return;
  const idx = lanes.findIndex(l => l.id === laneId);
  if (idx < 0) return;
  lanes.splice(idx, 1);
  const target = lanes[0].id;
  if (!Array.isArray(order[target])) order[target] = [];
  order[target].push(...moved);
  delete order[laneId];
  save(); renderIdeas();
}

document.getElementById('addIdeaBtn').addEventListener('click', () => {
  ideaEditModal({ id: uid(), title: '', body: '', tagIds: [], ts: Date.now() }, { isNew: true });
});

document.getElementById('suggestIdeasBtn').addEventListener('click', generateIdeaSuggestions);

// Read every chunk with body text, ask the model for next-chunk ideas, then let
// the author pick which to pin to the backlog.
async function generateIdeaSuggestions() {
  const btn = document.getElementById('suggestIdeasBtn');
  const chunks = db.chunks.filter(c => (c.body || '').trim());
  if (!chunks.length) { alertModal('No hop content to read yet.', { title: 'GENERATE IDEAS' }); return; }
  const original = aiBtnStart(btn, IC_GENERATE, 'THINKING…');
  try {
    const proj = projectsCache.find(p => p.id === activeProjectId);
    const { ideas } = await aiInvoke({
      task: 'suggest_ideas',
      type: proj?.type || '',
      genre: proj?.genre || '',
      chunks: chunks.map(c => ({ title: c.title, body: c.body }))
    });
    aiBtnDone(btn, original);
    if (!ideas || !ideas.length) { alertModal('No ideas came back. Try again.', { title: 'GENERATE IDEAS' }); return; }
    const chosen = await ideaReviewModal(ideas);
    if (!chosen || !chosen.length) return;
    const now = Date.now();
    chosen.forEach((text, i) => db.ideas.push({ id: uid(), title: text, body: '', tagIds: [], ts: now + i }));
    save(); renderIdeas();
    chosen.forEach(() => recordWritingActivity());
  } catch (err) {
    aiBtnDone(btn, original);
    alertModal('Could not generate ideas.\n\n' + (err.message || ''), { title: 'GENERATE IDEAS' });
  }
}

function ideaReviewModal(suggestions) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'ui-modal-overlay';
    overlay.innerHTML = `
      <div class="ui-modal detect-modal">
        <div class="ui-modal-title">SUGGESTED IDEAS</div>
        <div class="ui-modal-msg">Pick the ones worth keeping. They'll be pinned to your backlog.</div>
        <div class="detect-list">
          ${suggestions.map((s, i) => `
            <label class="detect-row">
              <input type="checkbox" data-i="${i}" checked />
              <span class="detect-name" style="font-weight:400">${esc(s)}</span>
            </label>`).join('')}
        </div>
        <div class="ui-modal-actions">
          <button class="ui-modal-btn" data-act="cancel">Cancel</button>
          <button class="ui-modal-btn solid" data-act="add">Pin selected</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = val => { overlay.remove(); resolve(val); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));
    overlay.querySelector('[data-act="add"]').addEventListener('click', () => {
      const picked = [...overlay.querySelectorAll('.detect-row input:checked')].map(inp => suggestions[+inp.dataset.i]);
      close(picked);
    });
  });
}

// Edit an idea in a focused modal: NAME, GENERATE-from-body, BODY, tags.
// Works on a copy so CANCEL reverts; SAVE commits back to the live idea.
function ideaEditModal(idea, opts = {}) {
  const isNew = !!opts.isNew;
  const work = { tagIds: [...(idea.tagIds || [])] };
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  overlay.innerHTML = `
    <div class="ui-modal idea-edit-modal" role="dialog" aria-modal="true">
      <div class="ui-modal-title">${isNew ? 'NEW IDEA' : 'EDIT IDEA'}</div>
      <div class="ie-field">
        <div class="ie-label-row">
          <span class="ie-label">NAME</span>
          <button class="ie-gen" data-act="gen">${IC_GENERATE} GENERATE</button>
        </div>
        <input class="ie-name" type="text" maxlength="120" placeholder="Idea name…" />
      </div>
      <div class="ie-field">
        <div class="ie-label-row">
          <span class="ie-label">BODY</span>
          <button class="ie-gen" data-act="genbody">${IC_GENERATE} GENERATE BODY</button>
        </div>
        <textarea class="ie-body" rows="7" placeholder="Flesh it out…"></textarea>
      </div>
      <div class="ie-field">
        <span class="ie-label">TAGS</span>
        ${tagEditorHTML(work.tagIds)}
      </div>
      <div class="ui-modal-actions ie-actions">
        ${isNew ? '' : '<button class="ui-modal-btn danger ghost" data-act="del">Delete</button>'}
        <span class="ie-spacer"></span>
        <button class="ui-modal-btn" data-act="cancel">Cancel</button>
        <button class="ui-modal-btn solid" data-act="save">${isNew ? 'Add' : 'Save'}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const nameInput = overlay.querySelector('.ie-name');
  const bodyInput = overlay.querySelector('.ie-body');
  const genBtn = overlay.querySelector('[data-act="gen"]');
  nameInput.value = idea.title || '';
  bodyInput.value = idea.body || '';
  wireTagEditor(overlay.querySelector('.label-editor'), work);

  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);

  overlay.querySelector('[data-act="save"]').addEventListener('click', () => {
    const title = nameInput.value.trim();
    const body = bodyInput.value;
    if (isNew && !title && !body.trim()) { close(); return; }
    idea.title = title;
    idea.body = body;
    idea.tagIds = work.tagIds;
    if (isNew) {
      db.ideas.push(idea);
      const lanes = ideaLanes(), order = ideaOrder();
      if (!Array.isArray(order[lanes[0].id])) order[lanes[0].id] = [];
      order[lanes[0].id].unshift(idea.id);   // new ideas land on top of the first lane
      recordWritingActivity();
    }
    save();
    close();
    renderIdeas();
  });

  const delBtn = overlay.querySelector('[data-act="del"]');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!await confirmModal('Delete this idea? This cannot be undone.', { title: 'DELETE IDEA', okText: 'Delete', danger: true })) return;
    db.ideas = db.ideas.filter(x => x.id !== idea.id);
    laneRemoveIdea(idea.id);
    save();
    close();
    renderIdeas();
  });

  genBtn.addEventListener('click', async () => {
    const body = bodyInput.value.trim();
    if (!body) { alertModal('Write some body text first, then generate a title from it.', { title: 'NOTHING TO TITLE' }); return; }
    const prev = aiBtnStart(genBtn, IC_GENERATE, '…');
    try {
      const { title } = await aiInvoke({ task: 'idea_title', body });
      if (title) nameInput.value = title;
    } catch (err) {
      alertModal(err.message || 'Could not generate a title.', { title: 'GENERATE FAILED' });
    } finally {
      aiBtnDone(genBtn, prev);
    }
  });

  const genBodyBtn = overlay.querySelector('[data-act="genbody"]');
  genBodyBtn.addEventListener('click', async () => {
    const title = nameInput.value.trim();
    if (!title) { alertModal('Give the idea a name first — the body is generated from it.', { title: 'NAME IT FIRST' }); return; }
    if (bodyInput.value.trim() && !await confirmModal('This will replace the existing body text. Is that okay?', { title: 'REPLACE BODY', okText: 'Replace', danger: false })) return;
    const prev = aiBtnStart(genBodyBtn, IC_GENERATE, '…');
    try {
      const proj = projectsCache.find(p => p.id === activeProjectId);
      const { body: text } = await aiInvoke({ task: 'generate_body', kind: 'idea', title, type: proj?.type || '', genre: proj?.genre || '', ...projectGenContext(null) });
      if (text) bodyInput.value = text;
    } catch (err) {
      alertModal(err.message || 'Could not generate body text.', { title: 'GENERATE FAILED' });
    } finally {
      aiBtnDone(genBodyBtn, prev);
    }
  });

  setTimeout(() => nameInput.focus(), 0);
}

/* =====================================================================
   EXPORT / IMPORT
   ===================================================================== */
document.getElementById('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rabbithole-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
});
// --- Per-project DOWNLOAD as Markdown ------------------------------------
// The active project lives in `db`; for any other project we pull just the
// fields markdown needs (no join tables), without disturbing the open one.
async function fetchProjectExport(projectId) {
  const [chapters, chunks, characters, locations, tags] = await Promise.all([
    sb.from('chapters').select('*').eq('project_id', projectId),
    sb.from('chunks').select('*').eq('project_id', projectId),
    sb.from('characters').select('*').eq('project_id', projectId),
    sb.from('locations').select('*').eq('project_id', projectId),
    sb.from('tags').select('*').eq('project_id', projectId)
  ]);
  return {
    chapters: (chapters.data || []).map(r => ({ id: r.id, title: r.title, order: r.position })),
    chunks: (chunks.data || []).map(r => ({ id: r.id, chapterId: r.chapter_id, title: r.title, body: r.body, orderInChapter: r.order_in_chapter, archived: !!r.archived })),
    characters: (characters.data || []).map(r => ({ name: r.name, aliases: r.aliases || [], summary: r.summary || '' })),
    locations: (locations.data || []).map(r => ({ name: r.name, aliases: r.aliases || [], summary: r.summary || '' })),
    tags: (tags.data || []).map(r => ({ name: (r.name || '').toUpperCase(), summary: r.summary || '' }))
  };
}

function exportHopsOf(source, chapterId) {
  return (source.chunks || [])
    .filter(c => c.chapterId === chapterId && !c.archived)
    .sort((a, b) => (a.orderInChapter || 0) - (b.orderInChapter || 0));
}

function projectMarkdown(project, source, opts) {
  const lines = [`# ${project.name || 'Untitled project'}`, ''];
  const chapters = [...(source.chapters || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  chapters.filter(ch => opts.chapterIds.includes(ch.id)).forEach(ch => {
    lines.push(`## ${ch.title || 'Untitled section'}`, '');
    const hops = exportHopsOf(source, ch.id);
    if (!hops.length) { lines.push('_No hops in this section._', ''); return; }
    hops.forEach(h => {
      if ((h.title || '').trim()) lines.push(`### ${h.title.trim()}`, '');
      if ((h.body || '').trim()) lines.push(h.body.trim(), '');
    });
  });
  const appendEntities = (heading, coll) => {
    if (!coll || !coll.length) return;
    lines.push(`## ${heading}`, '');
    coll.forEach(e => {
      const alias = (e.aliases || []).length ? ` _(${e.aliases.join(', ')})_` : '';
      lines.push(`### ${e.name}${alias}`, '');
      lines.push((e.summary || '').trim() || '_No summary yet._', '');
    });
  };
  if (opts.chars) appendEntities('CHARACTERS', source.characters);
  if (opts.locs) appendEntities('LOCATIONS', source.locations);
  if (opts.tags) {
    const tags = source.tags || [];
    if (tags.length) {
      lines.push('## TAGS', '');
      tags.forEach(l => { lines.push(`### ${l.name}`, ''); lines.push((l.summary || '').trim() || '_No summary yet._', ''); });
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function downloadMarkdown(name, md) {
  const slug = (name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${slug}-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function downloadProjectFlow(projectId, btn) {
  const project = projectsCache.find(p => p.id === projectId);
  if (!project) return;
  let source;
  if (projectId === activeProjectId) {
    source = db;
  } else {
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    try { source = await fetchProjectExport(projectId); }
    catch (err) { if (btn) { btn.disabled = false; btn.textContent = label; } alertModal('Could not load this project.\n\n' + (err.message || ''), { title: 'DOWNLOAD' }); return; }
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
  showDownloadModal(project, source);
}

function showDownloadModal(project, source) {
  const chapters = [...(source.chapters || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const nChars = (source.characters || []).length;
  const nLocs = (source.locations || []).length;
  const nTags = (source.tags || []).length;
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  overlay.innerHTML = `
    <div class="ui-modal dl-modal">
      <div class="ui-modal-title">DOWNLOAD MARKDOWN</div>
      <div class="ui-modal-msg">Pick the sections and reference lists to include. Everything checked is written into a single .md file.</div>
      <div class="dl-group-head"><span>SECTIONS</span>${chapters.length ? '<button class="add-btn" data-all>Toggle all</button>' : ''}</div>
      <div class="detect-list">
        ${chapters.length ? chapters.map(ch => {
          const n = exportHopsOf(source, ch.id).length;
          return `<label class="detect-row">
            <input type="checkbox" data-ch="${ch.id}" checked />
            <span class="detect-name">${esc(ch.title || 'Untitled section')}</span>
            <span class="detect-aliases">${n} hop${n === 1 ? '' : 's'}</span>
          </label>`;
        }).join('') : '<div class="dl-empty">No sections in this project.</div>'}
      </div>
      <div class="dl-group-head"><span>INCLUDE</span></div>
      <div class="detect-list">
        <label class="detect-row"><input type="checkbox" data-inc="chars" /><span class="detect-name">Character list and summaries</span><span class="detect-aliases">${nChars}</span></label>
        <label class="detect-row"><input type="checkbox" data-inc="locs" /><span class="detect-name">Location list and summaries</span><span class="detect-aliases">${nLocs}</span></label>
        <label class="detect-row"><input type="checkbox" data-inc="tags" /><span class="detect-name">Tag list and summaries</span><span class="detect-aliases">${nTags}</span></label>
      </div>
      <div class="dl-warn" hidden>Pick at least one thing to include.</div>
      <div class="ui-modal-actions">
        <button class="ui-modal-btn" data-act="cancel">Cancel</button>
        <button class="ui-modal-btn solid" data-act="download">Download .md</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
  overlay.querySelector('[data-all]')?.addEventListener('click', () => {
    const boxes = [...overlay.querySelectorAll('[data-ch]')];
    const allOn = boxes.every(b => b.checked);
    boxes.forEach(b => { b.checked = !allOn; });
  });
  overlay.querySelector('[data-act="download"]').addEventListener('click', () => {
    const chapterIds = [...overlay.querySelectorAll('[data-ch]:checked')].map(b => b.dataset.ch);
    const inc = sel => !!overlay.querySelector(`[data-inc="${sel}"]`).checked;
    const opts = { chapterIds, chars: inc('chars'), locs: inc('locs'), tags: inc('tags') };
    if (!chapterIds.length && !opts.chars && !opts.locs && !opts.tags) {
      overlay.querySelector('.dl-warn').hidden = false;
      return;
    }
    downloadMarkdown(project.name, projectMarkdown(project, source, opts));
    close();
  });
}

document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { db = JSON.parse(reader.result); save(); route(); }
    catch { alertModal('Invalid JSON file.', { title: 'IMPORT FAILED' }); }
  };
  reader.readAsText(file);
});

/* ---------------- util ---------------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Character + location names/aliases for in-prose highlighting, each tinted with
// its own assigned color. Longest-first so multi-word names win over their
// substrings; characters take precedence on an exact name clash.
function entityHighlightTerms() {
  const seen = new Set(), terms = [];
  const add = coll => (coll || []).forEach(c => {
    const color = c.color || '';
    [c.name, ...(c.aliases || [])].forEach(t => {
      const v = (t || '').trim();
      if (v && !seen.has(v)) { seen.add(v); terms.push({ t: v, color }); }
    });
  });
  add(db.characters);
  add(db.locations);
  return terms.sort((a, b) => b.t.length - a.t.length);
}

// Escape `raw` for HTML while wrapping any character name/alias in a highlight
// span tinted with that character's own color (falls back to the accent).
function highlightNames(raw, terms) {
  raw = String(raw ?? '');
  if (!terms || !terms.length) return esc(raw);
  const colorByTerm = new Map(terms.map(o => [o.t, o.color]));
  const re = new RegExp('\\b(' + terms.map(o => escapeReg(o.t)).join('|') + ')\\b', 'g');
  let out = '', last = 0, m;
  while ((m = re.exec(raw)) !== null) {
    out += esc(raw.slice(last, m.index));
    const col = colorByTerm.get(m[0]);
    out += '<span class="char-ref"' + (col ? ` style="color:${col}"` : '') + '>' + esc(m[0]) + '</span>';
    last = m.index + m[0].length;
    if (re.lastIndex === m.index) re.lastIndex++; // guard against zero-width
  }
  out += esc(raw.slice(last));
  return out;
}

// Turn a raw Anthropic/edge error string into a short, human message. The API
// returns a wall of JSON for things like rate limits; surface the gist instead.
function friendlyAiError(raw) {
  const s = String(raw || '');
  if (/\b429\b|rate_limit/i.test(s)) {
    return 'The AI hit its token rate limit for this minute. This usually means the ' +
      'request was large — a big project sends a lot of text at once. Wait a minute and ' +
      'try again; if it keeps failing, the project may be too large for a single request.';
  }
  if (/\b529\b|overloaded/i.test(s)) {
    return 'The AI is temporarily overloaded. Give it a moment and try again.';
  }
  if (/\b401\b|authentication|invalid x-api-key/i.test(s)) {
    return 'The AI key was rejected. The server-side API key may need attention.';
  }
  if (/\b500\b|\b502\b|\b503\b|\b504\b/.test(s)) {
    return 'The AI service hit a temporary error. Please try again.';
  }
  return s || 'request failed';
}

// Single entry point for the ai-chat edge function. Throws on error.
async function aiInvoke(payload) {
  const tier = (currentProfile && currentProfile.ai_tier) || 'standard';
  const body = Object.assign({ tier }, payload);
  const { data, error } = await sb.functions.invoke('ai-chat', { body });
  if (error) {
    // Surface the function's JSON error body when present.
    let detail = error.message || 'request failed';
    try { const ctx = await error.context?.json?.(); if (ctx?.error) detail = ctx.error; } catch (_) {}
    throw new Error(friendlyAiError(detail));
  }
  if (data && data.error) throw new Error(friendlyAiError(data.error));
  return data || {};
}

/* ---------------- modal dialogs (replace native prompt/confirm/alert) ---------------- */
function uiModal({ title = '', message = '', input = false, defaultValue = '',
                  okText = 'OK', cancelText = 'Cancel', danger = false }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'ui-modal-overlay';
    overlay.innerHTML = `
      <div class="ui-modal" role="dialog" aria-modal="true">
        ${title ? `<div class="ui-modal-title">${esc(title)}</div>` : ''}
        ${message ? `<div class="ui-modal-msg">${esc(message)}</div>` : ''}
        ${input ? `<input class="ui-modal-input" type="text" />` : ''}
        <div class="ui-modal-actions">
          ${cancelText ? `<button class="ui-modal-btn" data-act="cancel">${esc(cancelText)}</button>` : ''}
          <button class="ui-modal-btn solid${danger ? ' danger' : ''}" data-act="ok">${esc(okText)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const inputEl = overlay.querySelector('.ui-modal-input');
    const cancelBtn = overlay.querySelector('[data-act="cancel"]');
    const done = val => { document.removeEventListener('keydown', onKey); overlay.remove(); resolve(val); };
    const onOk = () => done(input ? inputEl.value : true);
    const onCancel = () => done(input ? null : false);
    overlay.querySelector('[data-act="ok"]').addEventListener('click', onOk);
    if (cancelBtn) cancelBtn.addEventListener('click', onCancel);
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) onCancel(); });
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); onOk(); }
    }
    document.addEventListener('keydown', onKey);
    if (input) { inputEl.value = defaultValue; inputEl.focus(); inputEl.select(); }
    else overlay.querySelector('[data-act="ok"]').focus();
  });
}
const confirmModal = (message, opts = {}) =>
  uiModal({ message, okText: 'Delete', danger: true, ...opts });
const promptModal = (message, defaultValue = '', opts = {}) =>
  uiModal({ message, input: true, defaultValue, ...opts });
const alertModal = (message, opts = {}) =>
  uiModal({ message, cancelText: '', ...opts });

// Name + type + genre + theme color editor. Resolves to
// { name, type, genre, accent } or null on cancel.
function projectSettingsModal({ title = 'PROJECT', name = '', type = '', genre = '', accent = '', okText = 'Save' } = {}) {
  return new Promise(resolve => {
    const typeOpts = PROJECT_TYPES.map(t =>
      `<option value="${esc(t)}" ${t === type ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const genreOpts = `<option value="" ${!genre ? 'selected' : ''}>— none —</option>` +
      GENRES.map(g => `<option value="${esc(g)}" ${g === genre ? 'selected' : ''}>${esc(g)}</option>`).join('');
    let chosenAccent = accent || DEFAULT_ACCENT;
    const swatches = PROJECT_ACCENTS.map(a =>
      `<button type="button" class="ps-swatch ${a.value === chosenAccent ? 'active' : ''}" data-accent="${esc(a.value)}" style="--sw:${esc(a.value)}" title="${esc(a.name)}" aria-label="${esc(a.name)}"></button>`).join('');
    const overlay = document.createElement('div');
    overlay.className = 'ui-modal-overlay';
    overlay.innerHTML = `
      <div class="ui-modal" role="dialog" aria-modal="true">
        <div class="ui-modal-title">${esc(title)}</div>
        <label class="ps-field"><span class="ps-label">NAME</span>
          <input class="ui-modal-input" id="psName" type="text" />
        </label>
        <label class="ps-field"><span class="ps-label">TYPE</span>
          <select class="ui-modal-input" id="psType">${typeOpts}</select>
        </label>
        <label class="ps-field"><span class="ps-label">GENRE</span>
          <select class="ui-modal-input" id="psGenre">${genreOpts}</select>
        </label>
        <div class="ps-field"><span class="ps-label">THEME COLOR</span>
          <div class="ps-swatches" id="psSwatches">${swatches}</div>
        </div>
        <div class="ui-modal-actions">
          <button class="ui-modal-btn" data-act="cancel">Cancel</button>
          <button class="ui-modal-btn solid" data-act="ok">${esc(okText)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const nameEl = overlay.querySelector('#psName');
    nameEl.value = name;
    // Live-preview the theme as the user picks; restore on cancel.
    applyProjectAccent(chosenAccent);
    overlay.querySelector('#psSwatches').addEventListener('click', e => {
      const sw = e.target.closest('.ps-swatch');
      if (!sw) return;
      chosenAccent = sw.dataset.accent;
      overlay.querySelectorAll('.ps-swatch').forEach(s => s.classList.toggle('active', s === sw));
      applyProjectAccent(chosenAccent);
    });
    const restoreAccent = () => applyProjectAccent(projectsCache.find(p => p.id === activeProjectId)?.accent);
    const done = val => {
      document.removeEventListener('keydown', onKey);
      if (!val) restoreAccent();
      overlay.remove();
      resolve(val);
    };
    const onOk = () => {
      const n = nameEl.value.trim();
      if (!n) { nameEl.focus(); return; }
      done({ name: n, type: overlay.querySelector('#psType').value, genre: overlay.querySelector('#psGenre').value, accent: chosenAccent });
    };
    overlay.querySelector('[data-act="ok"]').addEventListener('click', onOk);
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => done(null));
    overlay.addEventListener('mousedown', e => { if (e.target === overlay) done(null); });
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); done(null); } }
    document.addEventListener('keydown', onKey);
    nameEl.focus(); nameEl.select();
  });
}

/* ---------------- AUTH ---------------- */
const authScreen  = document.getElementById('authScreen');
const authStage   = document.getElementById('authStage');
const authEars    = document.getElementById('authEars');
const authForm    = document.getElementById('authForm');
const authMsgEl   = document.getElementById('authMsg');
const authSubmit  = document.getElementById('authSubmit');
const authSubmitTx= authSubmit.querySelector('.auth-submit-tx');
const tabSignIn   = document.getElementById('tabSignIn');
const tabSignUp   = document.getElementById('tabSignUp');
const authEmail   = document.getElementById('authEmail');
const authPassword= document.getElementById('authPassword');
const authFirst   = document.getElementById('authFirst');
const authLast    = document.getElementById('authLast');
const authUsername= document.getElementById('authUsername');
const authConfirm = document.getElementById('authConfirm');
const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;
let authMode = 'signin';
let currentUser = null;
let currentProfile = null;
const ADMIN_EMAIL = 'carterwarrenhurst@gmail.com';
function isAdmin() { return !!currentUser && (currentUser.email || '').toLowerCase() === ADMIN_EMAIL; }
let booted = false;
let authWhooshPending = false;       // a dive is in flight → showApp must leave the card up
let authBusy = false;
const AUTH_REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EARS_PEEK = 'translate(0 34) scale(1.28)';   // resting peek transform

function authMsg(t) { authMsgEl.textContent = t || ''; }

// Put the card back to its drawn, peeking, un-dissolved state.
function resetAuthCard() {
  authStage.classList.remove('dissolving');
  authScreen.classList.remove('fading');
  authEars.classList.add('peeking');
  authEars.setAttribute('transform', EARS_PEEK);
}

function showSignIn() {
  authMode = 'signin';
  authScreen.classList.remove('mode-signup', 'mode-sent');
  tabSignIn.classList.add('active'); tabSignUp.classList.remove('active');
  authSubmitTx.textContent = 'SIGN IN';
  authPassword.setAttribute('autocomplete', 'current-password');
  authMsg(''); resetAuthCard();
  authScreen.hidden = false;
  setTimeout(() => { try { authEmail.focus({ preventScroll: true }); } catch (_) {} }, 60);
}

function showSignUp() {
  authMode = 'signup';
  authScreen.classList.remove('mode-sent');
  authScreen.classList.add('mode-signup');
  tabSignUp.classList.add('active'); tabSignIn.classList.remove('active');
  authSubmitTx.textContent = 'JOIN THE WARREN';
  authPassword.setAttribute('autocomplete', 'new-password');
  authMsg(''); resetAuthCard();
  authScreen.hidden = false;
  setTimeout(() => { try { authFirst.focus({ preventScroll: true }); } catch (_) {} }, 60);
}

function hideAuthUI() { authScreen.hidden = true; }

function setAuthMode(m) { if (m === 'signup') showSignUp(); else showSignIn(); }

function showAuthSent(email) {
  authScreen.classList.remove('mode-signup');
  document.getElementById('authSentEmail').textContent = email;
  authScreen.classList.add('mode-sent');
  authScreen.hidden = false;
}

// The bunny dive — ported phase-for-phase from the handoff (DIP→PERK→HOLD→down),
// in the rabbit SVG's own units (hole centred at y=0). Drives #authEars.
function runDive(done) {
  authEars.classList.remove('peeking');
  const S = 1.28, peekY = 34, riseY = 0, downY = 184;
  const DIP = 120, PERK = DIP + 240, HOLD = PERK + 150, A = HOLD + 290, END = A + 260;
  const easeIn = p => p * p;
  const easeOutBack = p => { const c = 2.4; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
  const place = (y, sx, sy, rot) => authEars.setAttribute('transform',
    `translate(0 ${y.toFixed(2)}) rotate(${(rot || 0).toFixed(2)}) scale(${(S * (sx || 1)).toFixed(3)} ${(S * (sy || 1)).toFixed(3)})`);
  if (AUTH_REDUCE) { place(downY, 1, 1); done && done(); return; }
  const t0 = performance.now();
  const loop = now => {
    const t = now - t0; let yy, sx = 1, sy = 1;
    if (t <= DIP) { const p = t / DIP; yy = peekY + 10 * Math.sin(Math.PI * 0.5 * p); sy = 1 - 0.06 * p; sx = 1 + 0.06 * p; }
    else if (t <= PERK) { const p = (t - DIP) / (PERK - DIP); yy = (peekY + 10) + (riseY - (peekY + 10)) * easeOutBack(p);
      const q = Math.sin(Math.PI * Math.min(1, p * 1.2)); sy = 1 + 0.16 * q; sx = 1 - 0.13 * q; }
    else if (t <= HOLD) { const p = (t - PERK) / (HOLD - PERK); yy = riseY + 2 * Math.sin(p * Math.PI * 5); }
    else if (t <= A) { const p = (t - HOLD) / (A - HOLD); yy = riseY + (downY - riseY) * easeIn(p); sy = 1 + 0.14 * p; sx = 1 - 0.08 * p; }
    else { place(downY, 0.92, 1.14); done && done(); return; }
    place(yy, sx, sy);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// Success transition: retract the card's lines + dive the bunny, then reveal app.
function playTransition() {
  authStage.classList.add('dissolving');   // CSS retracts every .auth-card .rl + fades text
  runDive(() => {
    authScreen.classList.add('fading');
    setTimeout(() => { authWhooshPending = false; revealApp(); }, 400);
  });
}

async function doSubmit(e) {
  if (e) e.preventDefault();
  if (authBusy) return;
  const email = authEmail.value.trim();
  const password = authPassword.value;
  if (!email || !password) { authMsg('Enter your email and password.'); return; }
  authBusy = true; authSubmit.disabled = true; authMsg('');
  try {
    if (authMode === 'signup') {
      const first = authFirst.value.trim(), last = authLast.value.trim();
      const username = authUsername.value.trim();
      if (!USERNAME_RE.test(username)) { authMsg('Username: 3-24 chars, letters, numbers, underscore.'); return; }
      if (password !== authConfirm.value) { authMsg('Passwords do not match.'); return; }
      if (password.length < 6) { authMsg('Password must be at least 6 characters.'); return; }
      const { data: avail } = await sb.rpc('username_available', { handle: username });
      if (avail === false) { authMsg('That username is taken. Pick another.'); return; }
      // Claim the dive before awaiting so onAuthStateChange leaves the card up.
      authWhooshPending = true;
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { first_name: first, last_name: last, username }, emailRedirectTo: window.location.origin }
      });
      if (error) { authWhooshPending = false; authMsg(error.message); return; }
      // Claim the handle now if we have a live session; otherwise it is stashed in
      // user_metadata and applied on first sign-in (see applyPendingUsername).
      if (data.session && data.user) {
        const { error: uErr } = await sb.from('profiles').update({ username }).eq('id', data.user.id);
        if (uErr && uErr.code === '23505') { authWhooshPending = false; authMsg('That username is taken. Pick another.'); return; }
      }
      if (!data.session) { authWhooshPending = false; showAuthSent(email); return; }
      playTransition();
    } else {
      authWhooshPending = true;
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { authWhooshPending = false; authMsg(error.message); return; }
      playTransition();
    }
  } finally {
    authBusy = false; authSubmit.disabled = false;
  }
}

// The handle the user posts under in the community feed.
function displayUsername() {
  return (currentProfile && currentProfile.username) || '';
}

tabSignIn.addEventListener('click', () => showSignIn());
tabSignUp.addEventListener('click', () => showSignUp());
document.getElementById('authBackBtn').addEventListener('click', () => showSignIn());
authForm.addEventListener('submit', doSubmit);

function showAuth() {
  currentUser = null;
  activeProjectId = null;
  booted = false;
  authBusy = false;
  db = seed();
  applyProjectAccent(DEFAULT_ACCENT);
  document.body.classList.add('locked');
  authWhooshPending = false;
  showSignIn();
}
function showApp(session) {
  currentUser = session.user;
  const meta = currentUser.user_metadata || {};
  const who = [meta.first_name, meta.last_name].filter(Boolean).join(' ') || currentUser.email;
  const initials = ([meta.first_name, meta.last_name].filter(Boolean).map(s => s[0]).join('')
    || currentUser.email[0]).toUpperCase();
  const userEl = document.getElementById('profileInitials');
  userEl.textContent = initials;
  document.getElementById('profileBtn').title = who + ' · ' + currentUser.email;
  renderSettings();
  // Keep the app hidden (body stays .locked) until boot finishes applying the
  // project accent and routing, so the user never sees a flash of the default
  // accent or the wrong view. revealApp() uncovers it once everything is ready.
  bootApp();
}

// Uncover the app once it is fully loaded (accent applied, route resolved).
// During a sign-in dive the auth screen stays on top and runs its own fade.
function revealApp() {
  document.body.classList.remove('locked');
  if (!authWhooshPending) hideAuthUI();
}

async function bootApp() {
  if (booted) return;
  booted = true;
  try {
    await ensureProfile();
    await loadProfile();
    await applyPendingUsername();
    await loadFluffle();
    await initProjects();   // applies the project accent and resolves the route
    revealApp();
    maybeShowWelcome();
    loadNotifications();
  } catch (e) {
    console.error('boot failed', e);
    document.getElementById('headerMeta').textContent = 'load error';
    revealApp();   // never leave the user stuck on a blank locked screen
  }
}

// First-run welcome: shown once per account (profiles.welcomed). Waits for the
// sign-in whoosh to hand off so it lands on the app, then flips the flag.
async function maybeShowWelcome() {
  if (!currentUser || !currentProfile || currentProfile.welcomed) return;
  await new Promise(resolve => {
    if (authScreen.hidden) return resolve();
    let waited = 0;
    const t = setInterval(() => {
      waited += 120;
      if (authScreen.hidden || waited >= 4000) { clearInterval(t); resolve(); }
    }, 120);
  });
  currentProfile.welcomed = true;
  showWelcomeModal();
  sb.from('profiles').update({ welcomed: true }).eq('id', currentUser.id)
    .then(({ error }) => { if (error) console.warn('welcome flag update failed', error); });
}

// Minimal line-art icons (stroke = currentColor) for the welcome modal.
const WEL_SVG = {
  open: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">',
  hop: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><line x1="12" y1="9" x2="12" y2="15"/><line x1="9" y1="12" x2="15" y2="12"/>',
  detect: '<path d="M4 8V5.5a1.5 1.5 0 0 1 1.5-1.5H8"/><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8"/><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16"/><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><circle cx="12" cy="12" r="2.6"/>',
  analyze: '<path d="M4 5v14h16"/><path d="M7.5 14.5l3-3.5 3 2.5 4-5.5"/>',
  generate: '<path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="M18.5 15l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6Z"/>',
  generate: '<path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="M18.5 15l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6Z"/>',
  comm: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16 6.4a3 3 0 0 1 0 5.2"/><path d="M20.5 19c0-2.3-1.5-4-3.7-4.6"/>',
};
const welIcon = name => WEL_SVG.open + WEL_SVG[name] + '</svg>';

function showWelcomeModal() {
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay welcome-overlay';
  overlay.innerHTML = `
    <div class="welcome-modal">
      <button class="ui-modal-x" data-act="close" title="Close">✕</button>
      <div class="wel-hero">
        <div class="brand wel-brand">
          <svg class="brand-logo" width="36" height="32" viewBox="0 0 30 27" aria-label="Rabbit Hole">
            <ellipse cx="15" cy="21" rx="13" ry="3.6"/>
            <path class="brand-ear brand-earB" d="M11,20 C8.5,12 9.5,3 13.5,2 C16.5,3.6 15,13 14.5,20"/>
            <path class="brand-ear brand-earF" d="M16,20 C16.5,11.5 20,3.5 24,4.5 C26,8 20.5,16 18.5,20"/>
          </svg>
          <span class="brand-word">RABBIT HOLE</span>
        </div>
        <div class="wel-h1">Congratulations &mdash; you&rsquo;ve fallen down the rabbit hole!</div>
      </div>
      <div class="wel-scroll">
        <section class="wel-feat wel-primary">
          <div class="wel-feat-head"><span class="wel-step-n">1</span>${welIcon('hop')}<span>START HOPPING</span></div>
          <div class="wel-feat-row">
            <div class="wel-wire wel-wire-hop">
              <div class="ww-card">
                <div class="ww-line ww-title"></div>
                <div class="ww-line"></div>
                <div class="ww-line short"></div>
              </div>
              <div class="ww-add">+ ADD HOP</div>
            </div>
            <p>Hops are the most approachable chunks of content. It doesn&rsquo;t have to be a complete section &mdash; just anything you can add. Every bit counts, so <b>start hopping.</b></p>
          </div>
        </section>

        <section class="wel-feat">
          <div class="wel-feat-head"><span class="wel-step-n">2</span><span>PUT YOUR HOPS TO WORK</span></div>
          <p>Once you have some hops, let AI go further:</p>
          <div class="wel-cap-grid">
            <div class="wel-cap">
              <div class="wel-cap-ic">${welIcon('detect')}</div>
              <div class="wel-cap-name">DETECT</div>
              <div class="wel-cap-desc">characters, locations, tags</div>
            </div>
            <div class="wel-cap">
              <div class="wel-cap-ic">${welIcon('analyze')}</div>
              <div class="wel-cap-name">ANALYZE</div>
              <div class="wel-cap-desc">feedback, suggestions, character relationships</div>
            </div>
            <div class="wel-cap">
              <div class="wel-cap-ic">${welIcon('generate')}</div>
              <div class="wel-cap-name">GENERATE</div>
              <div class="wel-cap-desc">character arcs, summaries, new hops, new ideas</div>
            </div>
          </div>
        </section>

        <section class="wel-feat">
          <div class="wel-feat-head"><span class="wel-step-n">3</span>${welIcon('comm')}<span>JOIN THE COMMUNITY</span></div>
          <div class="wel-feat-row">
            <div class="wel-wire wel-wire-comm">
              <div class="ww-post">
                <div class="ww-post-head"><span class="ww-at">@hopper</span><span class="ww-star">&#9733;</span></div>
                <div class="ww-line"></div>
                <div class="ww-line short"></div>
              </div>
              <div class="ww-post ghost">
                <div class="ww-post-head"><span class="ww-at">@warren</span></div>
                <div class="ww-line short"></div>
              </div>
            </div>
            <p>Post to the community to connect with other <b>HOPPERS</b> and add them to your <b>FLUFFLE</b> &mdash; build strength through collaboration.</p>
          </div>
        </section>
      </div>
      <div class="wel-actions">
        <button class="ui-modal-btn solid" data-act="close">START HOPPING &rarr;</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => {
    overlay.classList.remove('show');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => overlay.remove(), 220);
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('[data-act="close"]').forEach(b => b.addEventListener('click', close));
  requestAnimationFrame(() => overlay.classList.add('show'));
}

// Backstop for the handle_new_user trigger: guarantee a profile row exists for
// the signed-in user even if the trigger didn't fire (e.g. account predates it).
async function ensureProfile() {
  if (!currentUser) return;
  const meta = currentUser.user_metadata || {};
  const { error } = await sb.from('profiles').upsert({
    id: currentUser.id,
    first_name: meta.first_name || null,
    last_name: meta.last_name || null,
    email: currentUser.email,
  }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) console.warn('ensureProfile failed', error);
}

// Pull the full profile row (incl. username) so the account card and the
// community feed know what handle to post under.
async function loadProfile() {
  if (!currentUser) return;
  const { data, error } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  if (error) { console.warn('loadProfile failed', error); return; }
  currentProfile = data || null;
  renderSettings();
}

// Email-confirm signups stash their chosen handle in user_metadata; on the first
// sign-in (profile row exists but has no username yet) we claim it. Best-effort:
// if it was taken in the meantime, the user picks a new one in Settings.
async function applyPendingUsername() {
  if (!currentUser || (currentProfile && currentProfile.username)) return;
  const pending = (currentUser.user_metadata || {}).username;
  if (!pending || !USERNAME_RE.test(pending)) return;
  const { error } = await sb.from('profiles').update({ username: pending }).eq('id', currentUser.id);
  if (error) { if (error.code !== '23505') console.warn('applyPendingUsername failed', error); return; }
  if (currentProfile) currentProfile.username = pending; else currentProfile = { username: pending };
  renderSettings();
}

/* =====================================================================
   SUPABASE DATA LAYER — projects + per-project load/persist
   ===================================================================== */
const activeKey = () => 'rh_active_project_' + (currentUser ? currentUser.id : 'anon');

async function fetchProjects() {
  const { data, error } = await sb.from('projects').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Local YYYY-MM-DD (not UTC) so a "day" matches the writer's wall clock.
function localDayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function fetchWritingDays() {
  if (!currentUser) return;
  const { data, error } = await sb.from('writing_days').select('day, count');
  if (error) { console.warn('writing_days fetch failed', error); return; }
  writingDaysCache = new Map((data || []).map(r => [r.day, r.count || 0]));
}

// Per-day hop + word totals (across all the user's projects) for heatmap tooltips.
async function fetchDayStats() {
  if (!currentUser) return;
  const { data, error } = await sb.from('chunks').select('created_at, body');
  if (error) { console.warn('day stats fetch failed', error); return; }
  const m = new Map();
  for (const r of (data || [])) {
    if (!r.created_at) continue;
    const key = localDayKey(new Date(r.created_at));
    const words = (r.body || '').trim().split(/\s+/).filter(Boolean).length;
    const cur = m.get(key) || { hops: 0, words: 0 };
    cur.hops += 1; cur.words += words;
    m.set(key, cur);
  }
  dayStatsCache = m;
}

// Per-day words, split by source (each project + practice), for the home words chart.
// Reconstructed from current chunk/hop bodies bucketed by created_at day (Option A:
// approximate, no per-day history table).
async function fetchWordsChart() {
  if (!currentUser) return;
  const m = new Map(); // dayKey -> Map(sourceKey -> words)
  const add = (key, src, words) => {
    if (!words) return;
    let row = m.get(key);
    if (!row) { row = new Map(); m.set(key, row); }
    row.set(src, (row.get(src) || 0) + words);
  };
  const wc = body => (body || '').trim().split(/\s+/).filter(Boolean).length;
  const { data: chunks, error: ce } = await sb.from('chunks').select('created_at, body, project_id');
  if (ce) { console.warn('words chart chunks fetch failed', ce); }
  for (const r of (chunks || [])) {
    if (!r.created_at) continue;
    add(localDayKey(new Date(r.created_at)), r.project_id || 'unknown', wc(r.body));
  }
  const { data: hops, error: he } = await sb.from('practice_hops').select('created_at, body');
  if (he) { console.warn('words chart hops fetch failed', he); }
  for (const r of (hops || [])) {
    if (!r.created_at) continue;
    add(localDayKey(new Date(r.created_at)), 'practice', wc(r.body));
  }
  wordsChartCache = m;
}

// The most recent day the streak is still standing on (today or yesterday), or null.
function lastWritingDay() {
  const today = localDayKey();
  if (writingDaysCache.has(today)) return today;
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yk = localDayKey(y);
  if (writingDaysCache.has(yk)) return yk;
  return null;
}

// Publish the current user's hop streak so it shows on their community profile.
async function syncStreakStat() {
  if (!currentUser) return;
  const { error } = await sb.from('community_stats').upsert({
    user_id: currentUser.id,
    username: (currentProfile && currentProfile.username) || null,
    hop_streak: computeStreak(writingDaysCache),
    streak_day: lastWritingDay(),
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
  if (error) console.warn('streak sync failed', error);
}

// Record one writing action (chunk or idea added) on today, account-wide.
// Bumps the per-day count so the heat map can shade by activity volume.
async function recordWritingActivity() {
  if (!currentUser) return;
  const today = localDayKey();
  writingDaysCache.set(today, (writingDaysCache.get(today) || 0) + 1);
  renderHome();
  const { data, error } = await sb.rpc('bump_writing_day', { d: today });
  if (error) { console.warn('bump_writing_day failed', error); return; }
  if (typeof data === 'number') {
    writingDaysCache.set(today, data);
    renderHome();
  }
  syncStreakStat();
}

// Consecutive days ending today (or yesterday if today not yet written).
// `days` is a Map (day -> count); only presence matters here.
function computeStreak(days) {
  if (!days.size) return 0;
  const cursor = new Date();
  if (!days.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (days.has(localDayKey(cursor))) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}

async function createProjectRow(name, type = 'Book', genre = '', accent = '') {
  const { data, error } = await sb.from('projects')
    .insert({ user_id: currentUser.id, name, type, genre: genre || null, accent: accent || null, ui: {} }).select().single();
  if (error) throw error;
  return data;
}

// Remap a db-shaped seed's (possibly legacy short) ids to fresh UUIDs, rewiring
// every cross-reference. Returns a new object; does not touch globals.
function remapSeedData(data) {
  const map = new Map();
  const rid = old => { if (!map.has(old)) map.set(old, crypto.randomUUID()); return map.get(old); };
  const d = {
    chapters: (data.chapters || []).map(c => ({ ...c, id: rid(c.id) })),
    chunks: (data.chunks || []).map(c => ({
      ...c, id: rid(c.id),
      chapterId: c.chapterId ? rid(c.chapterId) : null,
      tagIds: (c.tagIds || []).map(rid),
      characterIds: (c.characterIds || []).map(rid),
      locationIds: (c.locationIds || []).map(rid)
    })),
    characters: (data.characters || []).map(c => ({ ...c, id: rid(c.id) })),
    locations: (data.locations || []).map(c => ({ ...c, id: rid(c.id) })),
    tags: (data.tags || data.labels || []).map(l => ({ ...l, id: rid(l.id) })),
    ideas: (data.ideas || []).map(i => ({ ...i, id: rid(i.id), title: i.title || '', body: (i.body != null ? i.body : (i.text || '')), tagIds: (i.tagIds || []).map(rid) })),
    ui: {}
  };
  d.ui = { activeChapter: d.chapters[0]?.id || null, activeChar: null, activeLoc: null, activeTag: null };
  return d;
}

// Map the in-memory `db` shape onto a brand-new project (used by the quick,
// foreground path — fresh projects and the initial seed). Background imports
// use runProjectImportBuild instead so they don't clobber the open project.
async function seedProjectContent(projectId, data) {
  const d = data ? remapSeedData(data) : seed();
  db = d;
  activeProjectId = projectId;
  await persistProject();
}

async function loadProject(projectId) {
  activeProjectId = projectId;
  const [proj, chapters, chunks, characters, locations, tags, ideas, events, docs, timelines] = await Promise.all([
    sb.from('projects').select('*').eq('id', projectId).single(),
    sb.from('chapters').select('*').eq('project_id', projectId),
    sb.from('chunks').select('*').eq('project_id', projectId),
    sb.from('characters').select('*').eq('project_id', projectId),
    sb.from('locations').select('*').eq('project_id', projectId),
    sb.from('tags').select('*').eq('project_id', projectId),
    sb.from('ideas').select('*').eq('project_id', projectId),
    sb.from('events').select('*').eq('project_id', projectId),
    sb.from('planning_docs').select('*').eq('project_id', projectId),
    sb.from('timelines').select('*').eq('project_id', projectId)
  ]);
  const chunkIds = (chunks.data || []).map(r => r.id);
  const ideaIds = (ideas.data || []).map(r => r.id);
  const [cTags, cChars, cLocs, iTags] = await Promise.all([
    chunkIds.length ? sb.from('chunk_tags').select('*').in('chunk_id', chunkIds) : { data: [] },
    chunkIds.length ? sb.from('chunk_chars').select('*').in('chunk_id', chunkIds) : { data: [] },
    chunkIds.length ? sb.from('chunk_locations').select('*').in('chunk_id', chunkIds) : { data: [] },
    ideaIds.length ? sb.from('idea_tags').select('*').in('idea_id', ideaIds) : { data: [] }
  ]);
  const cl = cTags.data || [], cc = cChars.data || [], clo = cLocs.data || [], il = iTags.data || [];
  db = {
    chapters: (chapters.data || []).map(r => ({ id: r.id, title: r.title, color: r.color, order: r.position })),
    chunks: (chunks.data || []).map(r => ({
      id: r.id, chapterId: r.chapter_id, title: r.title, body: r.body,
      chronoLabel: r.chrono_label || '', narrativeOrder: r.narrative_pos,
      chronoOrder: r.chrono_pos, orderInChapter: r.order_in_chapter,
      archived: !!r.archived, analysis: r.analysis || null,
      characterIds: cc.filter(j => j.chunk_id === r.id).map(j => j.character_id),
      locationIds: clo.filter(j => j.chunk_id === r.id).map(j => j.location_id),
      tagIds: cl.filter(j => j.chunk_id === r.id).map(j => j.tag_id)
    })),
    characters: (characters.data || []).map(r => ({ id: r.id, name: r.name, aliases: r.aliases || [], summary: r.summary || '', notes: r.notes || [], color: r.color || '', category: (r.category || '').toUpperCase(), dismissedRefs: r.dismissed_refs || [], arc: r.arc || [], principles: r.principles || [], relationships: r.relationships || [] })),
    locations: (locations.data || []).map(r => ({ id: r.id, name: r.name, aliases: r.aliases || [], summary: r.summary || '', notes: r.notes || [], color: r.color || '', category: (r.category || '').toUpperCase(), dismissedRefs: r.dismissed_refs || [] })),
    tags: (tags.data || []).map(r => ({ id: r.id, name: (r.name || '').toUpperCase(), color: r.color, summary: r.summary || '', category: (r.category || '').toUpperCase() })),
    ideas: (ideas.data || []).map(r => ({ id: r.id, title: r.title || '', body: (r.body != null ? r.body : (r.text || '')), ts: r.ts || Date.parse(r.created_at), tagIds: il.filter(j => j.idea_id === r.id).map(j => j.tag_id) })),
    events: (events.data || []).map(r => ({ id: r.id, hopId: r.hop_id || null, title: r.title || '', description: r.description || '', dateLabel: r.date_label || '', chronoPos: r.chrono_pos ?? 0, characterIds: r.character_ids || [], locationIds: r.location_ids || [], timelineIds: r.timeline_ids || [], dismissed: !!r.dismissed })),
    timelines: (timelines.data || []).map(r => ({ id: r.id, name: r.name || '', color: r.color || '', position: r.position ?? 0 })),
    docs: (docs.data || []).map(r => ({ id: r.id, title: r.title || '', body: r.body || '', position: r.position ?? 0, ts: r.created_at ? Date.parse(r.created_at) : Date.now(), updatedAt: r.updated_at ? Date.parse(r.updated_at) : Date.now() })),
    ui: (proj.data && proj.data.ui) || {}
  };
  // One-time migration: tag categories used to live in the project ui blob
  // (ui.tagCategories + ui.tagCat map). Fold any of those onto the tags
  // themselves, then drop the blob so it never re-applies. New saves write the
  // tags.category column instead.
  if (db.ui.tagCat && db.ui.tagCategories) {
    const nameById = new Map((db.ui.tagCategories || []).map(c => [c.id, (c.name || '').toUpperCase()]));
    db.tags.forEach(l => {
      if (!l.category) {
        const nm = nameById.get(db.ui.tagCat[l.id]);
        if (nm) l.category = nm;
      }
    });
  }
  delete db.ui.tagCat;
  delete db.ui.tagCategories;
  if (!db.ui.activeChapter) db.ui.activeChapter = db.chapters[0]?.id || null;
  applyProjectAccent(proj.data && proj.data.accent);
  localStorage.setItem(activeKey(), projectId);
  loadHopPostCounts();
}

/* ---- persistence: debounced full-project sync ---- */
let persistTimer = null, persisting = false, dirtyAgain = false;

function schedulePersist() {
  if (!activeProjectId) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistProject, 600);
}
async function flushPersist() {
  clearTimeout(persistTimer);
  await persistProject();
}

async function upsertSync(table, rows, projectId) {
  const ids = new Set(rows.map(r => r.id));
  if (rows.length) {
    const { error } = await sb.from(table).upsert(rows);
    if (error) console.error('upsert ' + table, error);
  }
  const { data: existing } = await sb.from(table).select('id').eq('project_id', projectId);
  const stale = (existing || []).map(r => r.id).filter(id => !ids.has(id));
  if (stale.length) {
    const { error } = await sb.from(table).delete().in('id', stale);
    if (error) console.error('prune ' + table, error);
  }
}

async function clearAndInsert(table, scopeCol, scopeIds, rows) {
  if (scopeIds.length) {
    const { error } = await sb.from(table).delete().in(scopeCol, scopeIds);
    if (error) console.error('clear ' + table, error);
  }
  if (rows.length) {
    const { error } = await sb.from(table).insert(rows);
    if (error) console.error('insert ' + table, error);
  }
}

async function persistProject() {
  if (!activeProjectId || !currentUser) return;
  if (persisting) { dirtyAgain = true; return; }
  persisting = true;
  const P = activeProjectId, U = currentUser.id;
  try {
    const chapters = db.chapters.map((c, i) => ({ id: c.id, user_id: U, project_id: P, title: c.title, color: c.color, position: c.order ?? i }));
    const chunks = db.chunks.map((c, i) => ({ id: c.id, user_id: U, project_id: P, chapter_id: c.chapterId || null, title: c.title, body: c.body, chrono_label: c.chronoLabel || null, narrative_pos: c.narrativeOrder ?? i, chrono_pos: c.chronoOrder ?? i, order_in_chapter: c.orderInChapter ?? 0, archived: !!c.archived, analysis: c.analysis || null }));
    const characters = db.characters.map(c => ({ id: c.id, user_id: U, project_id: P, name: c.name, aliases: c.aliases || [], summary: c.summary || '', notes: c.notes || [], color: c.color || null, category: c.category || null, dismissed_refs: c.dismissedRefs || [], arc: c.arc || [], principles: c.principles || [], relationships: c.relationships || [] }));
    const locations = (db.locations || []).map(c => ({ id: c.id, user_id: U, project_id: P, name: c.name, aliases: c.aliases || [], summary: c.summary || '', notes: c.notes || [], color: c.color || null, category: c.category || null, dismissed_refs: c.dismissedRefs || [] }));
    const tags = db.tags.map(l => ({ id: l.id, user_id: U, project_id: P, name: l.name, color: l.color, summary: l.summary || null, category: l.category || null }));
    const ideas = db.ideas.map(i => ({ id: i.id, user_id: U, project_id: P, title: i.title || null, body: i.body || null, text: (i.body || i.title || ''), ts: i.ts || Date.now() }));
    const events = (db.events || []).map(e => ({ id: e.id, user_id: U, project_id: P, hop_id: e.hopId || null, title: e.title || '', description: e.description || '', date_label: e.dateLabel || null, chrono_pos: e.chronoPos ?? 0, character_ids: e.characterIds || [], location_ids: e.locationIds || [], timeline_ids: e.timelineIds || [], dismissed: !!e.dismissed }));
    const timelines = (db.timelines || []).map((t, i) => ({ id: t.id, user_id: U, project_id: P, name: t.name || '', color: t.color || null, position: t.position ?? i, updated_at: new Date().toISOString() }));
    const docs = (db.docs || []).map((d, i) => ({ id: d.id, user_id: U, project_id: P, title: d.title || '', body: d.body || '', position: d.position ?? i, updated_at: new Date().toISOString() }));

    await upsertSync('chapters', chapters, P);
    await Promise.all([upsertSync('tags', tags, P), upsertSync('characters', characters, P), upsertSync('locations', locations, P), upsertSync('timelines', timelines, P)]);
    await Promise.all([upsertSync('chunks', chunks, P), upsertSync('ideas', ideas, P), upsertSync('events', events, P), upsertSync('planning_docs', docs, P)]);

    const chunkTags = [], chunkChars = [], chunkLocs = [], ideaTags = [];
    db.chunks.forEach(c => {
      (c.tagIds || []).forEach(lid => chunkTags.push({ chunk_id: c.id, tag_id: lid, user_id: U }));
      (c.characterIds || []).forEach(chid => chunkChars.push({ chunk_id: c.id, character_id: chid, user_id: U }));
      (c.locationIds || []).forEach(lid => chunkLocs.push({ chunk_id: c.id, location_id: lid, user_id: U }));
    });
    db.ideas.forEach(i => (i.tagIds || []).forEach(lid => ideaTags.push({ idea_id: i.id, tag_id: lid, user_id: U })));
    const chunkIds = db.chunks.map(c => c.id), ideaIds = db.ideas.map(i => i.id);
    await Promise.all([
      clearAndInsert('chunk_tags', 'chunk_id', chunkIds, chunkTags),
      clearAndInsert('chunk_chars', 'chunk_id', chunkIds, chunkChars),
      clearAndInsert('chunk_locations', 'chunk_id', chunkIds, chunkLocs),
      clearAndInsert('idea_tags', 'idea_id', ideaIds, ideaTags)
    ]);
    await sb.from('projects').update({ ui: db.ui, updated_at: new Date().toISOString() }).eq('id', P);
  } catch (e) {
    console.error('persist failed', e);
  } finally {
    persisting = false;
    if (dirtyAgain) { dirtyAgain = false; schedulePersist(); }
  }
}

/* ---- background project upload ----
   A large imported project is uploaded as a detached job so the new-project
   modal can be dismissed without aborting it. Progress + cancel live on the
   project tile (renderHome). The job uploads directly to its own project id
   and never touches the open project's `db`. */
const uploadJobs = new Map();   // projectId -> { projectId, name, total, done, stage, status, ctl }

// Build an imported project straight into the DB, slice by slice. The project
// row already exists (so its tile is visible); this reads the file, drives the
// AI outline one slice at a time, and inserts each slice's new Sections and
// Hops as it goes. Progress and cancel live on the project tile, so dismissing
// the modal or navigating away never aborts the job. Cancel deletes the
// half-built project (content rows cascade on delete).
async function runProjectImportBuild(projectId, file, instructions, meta, job) {
  const U = currentUser.id, P = projectId;
  try {
    job.stage = 'Reading file…'; paintUploadJobs();
    const text = await extractText(file, (p, n) => {
      job.stage = 'Reading PDF — page ' + p + ' of ' + n; paintUploadJobs();
    });
    if (job.ctl.canceled) throw new Error('canceled');
    if (!text || !text.trim()) throw new Error('No readable text found in that file.');

    const slices = sliceText(text, IMPORT_SLICE);
    if (!slices.length) throw new Error('No readable text found in that file.');
    job.total = slices.length; job.done = 0;

    const sectionId = new Map();    // section title -> chapter id (already in DB)
    const perSection = new Map();   // chapter id -> hop count so far
    let narrative = 0;

    const ensureSection = async title => {
      const t = (title || '').trim() || 'Imported';
      if (!sectionId.has(t)) {
        const id = uid();
        const pos = sectionId.size;
        const { error } = await sb.from('chapters').insert({
          id, user_id: U, project_id: P, title: t,
          color: CHAPTER_PALETTE[pos % CHAPTER_PALETTE.length], position: pos
        });
        if (error) throw error;
        sectionId.set(t, id);
        job.sections = sectionId.size;
      }
      return sectionId.get(t);
    };

    for (let i = 0; i < slices.length; i++) {
      if (job.ctl.canceled) throw new Error('canceled');
      // Update the label before the (slow) AI call so the tile shows which pass
      // is in flight rather than looking frozen on the previous count.
      job.stage = 'Reading pass ' + (i + 1) + ' of ' + slices.length +
        '  ·  ' + (job.sections || 0) + ' section' + ((job.sections || 0) === 1 ? '' : 's') +
        ', ' + (job.hops || 0) + ' hop' + ((job.hops || 0) === 1 ? '' : 's') + ' so far';
      paintUploadJobs();
      let res = null;
      try {
        res = await aiInvoke({
          task: 'import_outline', text: slices[i], instructions,
          type: meta.type, genre: meta.genre,
          sectionsSoFar: [...sectionId.keys()].slice(-60)
        });
      } catch (_) { res = null; }   // skip a failed slice, keep building the rest
      if (res) {
        for (const s of (Array.isArray(res.sections) ? res.sections : [])) {
          await ensureSection(s && s.title);
        }
        const rows = [];
        for (const h of (Array.isArray(res.hops) ? res.hops : [])) {
          const body = (h && h.body || '').trim();
          const title = (h && h.title || '').trim();
          if (!body && !title) continue;
          const cid = await ensureSection(h && h.section);
          const n = perSection.get(cid) || 0; perSection.set(cid, n + 1);
          rows.push({
            id: uid(), user_id: U, project_id: P, chapter_id: cid,
            title: title || 'Untitled', body, chrono_label: null, analysis: null,
            narrative_pos: narrative, chrono_pos: narrative, order_in_chapter: n, archived: false
          });
          narrative++;
        }
        if (rows.length) {
          const { error } = await sb.from('chunks').insert(rows);
          if (error) throw error;
          job.hops = (job.hops || 0) + rows.length;
        }
      }
      job.done = i + 1;
      paintUploadJobs();
    }

    if (job.ctl.canceled) throw new Error('canceled');
    if (!sectionId.size || !job.hops) throw new Error('Could not build any sections or hops from that file.');

    const firstId = [...sectionId.values()][0] || null;
    await sb.from('projects').update({
      ui: { activeChapter: firstId, activeChar: null, activeLoc: null, activeTag: null },
      updated_at: new Date().toISOString()
    }).eq('id', P);

    job.status = 'done'; job.stage = 'Import complete'; paintUploadJobs();
    const projects = await fetchProjects();
    renderProjectSelector(projects, activeProjectId);
    if (currentRoute() === 'home') renderHome();
    setTimeout(() => { uploadJobs.delete(P); if (currentRoute() === 'home') renderHome(); }, 1800);
  } catch (err) {
    if (job.ctl.canceled) {
      await sb.from('projects').delete().eq('id', P).then(() => {}, () => {});
      uploadJobs.delete(P);
      const projects = await fetchProjects();
      renderProjectSelector(projects, activeProjectId);
      if (currentRoute() === 'home') renderHome();
    } else {
      job.status = 'error';
      job.error = (err && err.message) ? err.message : 'Import failed';
      if (currentRoute() === 'home') renderHome();
    }
  }
}

async function startBackgroundImportBuild(spec) {
  let proj;
  try { proj = await createProjectRow(spec.name, spec.type, spec.genre, spec.accent); }
  catch (err) { alertModal('Could not create the project.\n\n' + (err.message || ''), { title: 'NEW PROJECT' }); return; }
  uploadJobs.set(proj.id, {
    projectId: proj.id, name: spec.name, total: 0, done: 0,
    sections: 0, hops: 0, stage: 'Starting…', status: 'building', ctl: { canceled: false }
  });
  const projects = await fetchProjects();
  renderProjectSelector(projects, activeProjectId);
  // The modal live-previewed the new project's accent; the open project hasn't
  // changed, so restore its theme.
  applyProjectAccent(projectsCache.find(p => p.id === activeProjectId)?.accent);
  renderHeaderMeta();
  go('home');
  renderHome();
  runProjectImportBuild(proj.id, spec.importFile, spec.instructions, { type: spec.type, genre: spec.genre }, uploadJobs.get(proj.id));
}

function uploadJobProgressHTML(job) {
  if (job.status === 'error') return `<div class="pc-up-err">${esc(job.error || 'Import failed')}</div>`;
  const done = job.status === 'done';
  const pct = done ? 100 : (job.total ? Math.round((job.done / job.total) * 100) : 0);
  // The shimmer signals "working" even while a slice is in flight and the bar
  // width hasn't moved (each AI pass can take a while on long documents).
  return `<div class="pc-up-bar ${done ? '' : 'is-working'}"><div class="pc-up-fill" style="width:${pct}%"></div></div>
    <div class="pc-up-stage">${esc(job.stage)}</div>`;
}

function uploadingCardHTML(p, job) {
  const err = job.status === 'error';
  return `
    <div class="project-card uploading ${err ? 'has-error' : ''}" style="--accent:${esc(p.accent || DEFAULT_ACCENT)}">
      <div class="pc-body pc-up-body">
        <span class="pc-name">${esc(p.name)}</span>
        <span class="pc-kind">${err ? 'IMPORT FAILED' : 'BUILDING…'}</span>
        <div class="pc-up" data-upjob="${p.id}">${uploadJobProgressHTML(job)}</div>
      </div>
      <div class="pc-actions">
        ${err
          ? `<button class="pc-btn danger" data-updismiss="${p.id}">DISMISS</button>`
          : `<button class="pc-btn danger" data-upcancel="${p.id}">CANCEL IMPORT</button>`}
      </div>
    </div>`;
}

// Lightweight per-batch repaint of just the progress bars (no full re-render).
function paintUploadJobs() {
  if (currentRoute() !== 'home') return;
  document.querySelectorAll('[data-upjob]').forEach(el => {
    const job = uploadJobs.get(el.dataset.upjob);
    if (job && job.status !== 'error') el.innerHTML = uploadJobProgressHTML(job);
  });
}

/* ---- project selector UI ---- */
function renderProjectSelector(projects, activeId) {
  projectsCache = projects;
  const sel = document.getElementById('projectSelect');
  sel.innerHTML = projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  sel.value = activeId;
}

async function initProjects() {
  await fetchWritingDays();
  await fetchDayStats();
  await fetchWordsChart();
  syncStreakStat();
  let projects = await fetchProjects();
  if (!projects.length) {
    const proj = await createProjectRow('My Book');
    await seedProjectContent(proj.id, importableLocalData());
    projects = [proj];
  }
  const saved = localStorage.getItem(activeKey());
  const active = projects.find(p => p.id === saved) || projects[0];
  renderProjectSelector(projects, active.id);
  await loadProject(active.id);
  if (!location.hash) location.hash = '#home';
  renderHeaderMeta();
  route();
}

// Navigate, forcing a render even if the hash is unchanged.
function go(name) {
  const target = '#' + name;
  if (location.hash === target) route();
  else location.hash = target;
}

/* ---- HOME: writing streak ---- */
// Simple rabbit head: two ears and a round face, inherits currentColor.
const RABBIT_ICON =
  '<svg class="icon-rabbit" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
  '<ellipse cx="9" cy="7" rx="2" ry="5"/>' +
  '<ellipse cx="15" cy="7" rx="2" ry="5"/>' +
  '<circle cx="12" cy="15" r="6"/>' +
  '</svg>';

function renderStreakBar() {
  const el = document.getElementById('streakBar');
  if (!el) return;
  const streak = computeStreak(writingDaysCache);
  const DAYS = 14;
  // The strip is a streak-progress bar: filled cells = streak length, so the
  // count, the filled squares, and the rabbit on the leading cell all agree.
  const filled = Math.min(streak, DAYS);
  const cells = [];
  for (let i = 0; i < DAYS; i++) {
    const on = i < filled;
    const lead = on && i === filled - 1;
    cells.push(`<span class="streak-cell${on ? ' on' : ''}${lead ? ' lead' : ''}"></span>`);
  }
  // Rabbit perches on the leading filled cell. CELL (14) + GAP (4) = 18px
  // stride; +7 centers it over a cell.
  const pos = filled - 1;
  const rabbit = streak > 0
    ? `<span class="streak-rabbit" style="left:${pos * 18 + 7}px">${RABBIT_ICON}</span>`
    : '';
  el.innerHTML = `
    <div class="streak-bar">
      <span class="streak-count">${RABBIT_ICON}<strong>${streak}</strong> HOP STREAK</span>
      <div class="streak-cells">${rabbit}${cells.join('')}</div>
    </div>`;
}

// Bucket a day's add-count into a shading level (0 = none, 4 = busiest).
function heatLevel(n) {
  if (!n) return 0;
  if (n <= 1) return 1;
  if (n <= 3) return 2;
  if (n <= 5) return 3;
  return 4;
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// GitHub-style contribution grid: weeks as columns, weekdays as rows, shaded
// by how many chunks/ideas were added that day.
function renderHeatmap() {
  const el = document.getElementById('heatmap');
  if (!el) return;
  const WEEKS = 26;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayKey = localDayKey(today);
  // First column starts on the Sunday WEEKS-1 weeks before this week's Sunday.
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() - (WEEKS - 1) * 7);

  const cells = [];
  const months = [];
  let prevMonth = -1;
  for (let w = 0; w < WEEKS; w++) {
    const colDate = new Date(start);
    colDate.setDate(start.getDate() + w * 7);
    if (colDate.getMonth() !== prevMonth && colDate <= today) {
      prevMonth = colDate.getMonth();
      months.push(`<span class="hm-month" style="left:${w * 14}px">${MONTH_ABBR[prevMonth]}</span>`);
    }
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(start);
      cellDate.setDate(start.getDate() + w * 7 + d);
      if (cellDate > today) { cells.push('<span class="hm-cell future"></span>'); continue; }
      const key = localDayKey(cellDate);
      const n = writingDaysCache.get(key) || 0;
      const lvl = heatLevel(n);
      const isToday = key === todayKey;
      const st = dayStatsCache.get(key);
      const hops = st ? st.hops : n;
      const words = st ? st.words : 0;
      cells.push(`<span class="hm-cell l${lvl}${isToday ? ' today' : ''}" data-date="${key}" data-hops="${hops}" data-words="${words}"></span>`);
    }
  }
  const legend = [0, 1, 2, 3, 4].map(l => `<span class="hm-cell l${l}"></span>`).join('');
  el.innerHTML = `
    <div class="heatmap">
      <div class="hm-title">Activity</div>
      <div class="hm-scroll">
        <div class="hm-months">${months.join('')}</div>
        <div class="hm-grid">${cells.join('')}</div>
      </div>
      <div class="hm-legend"><span>Less</span>${legend}<span>More</span></div>
    </div>`;
  // Orient to the present: show today at the right, scroll back for older days.
  const scroller = el.querySelector('.hm-scroll');
  if (scroller) scroller.scrollLeft = scroller.scrollWidth;
}

/* ---- HOME: heatmap hover tooltip (day stats) ---- */
let _hmTip = null;
function ensureHeatTip() {
  if (_hmTip) return _hmTip;
  _hmTip = document.createElement('div');
  _hmTip.className = 'hm-tip';
  _hmTip.hidden = true;
  document.body.appendChild(_hmTip);
  return _hmTip;
}
function prettyDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function showHeatTip(cell) {
  const date = cell.getAttribute('data-date');
  if (!date) return;
  const tip = ensureHeatTip();
  const hops = +cell.getAttribute('data-hops') || 0;
  const words = +cell.getAttribute('data-words') || 0;
  const hn = hops === 1 ? 'hop' : 'hops';
  const wn = words === 1 ? 'word' : 'words';
  tip.innerHTML =
    `<span class="hm-tip-date">${prettyDay(date)}</span>` +
    `<span class="hm-tip-stat">${hops} ${hn} · ${words.toLocaleString()} ${wn}</span>`;
  tip.hidden = false;
  const r = cell.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  let left = r.left + r.width / 2 - tr.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
  let top = r.top - tr.height - 8;
  if (top < 8) top = r.bottom + 8;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
document.addEventListener('mouseover', e => {
  const cell = e.target.closest && e.target.closest('.hm-cell[data-date]');
  if (cell) showHeatTip(cell);
});
document.addEventListener('mouseout', e => {
  if (_hmTip && e.target.closest && e.target.closest('.hm-cell[data-date]')) _hmTip.hidden = true;
});

/* ---- HOME: words-per-day chart ---- */
// Range filter for the chart: 30 = last 30 active days (default), 'all' = full history.
let wcRange = 30;
// Sources toggled off via the legend. Their words are excluded from the bars
// but they stay in the legend so they can be switched back on.
let wcHidden = new Set();
// Resolve a source key to its label + colour at render time (projectsCache may
// have populated after the fetch).
function wcSourceMeta(src) {
  if (src === 'practice') return { label: 'Practice', color: PRACTICE_BAR_COLOR };
  const p = projectsCache.find(x => x.id === src);
  if (p) return { label: p.name, color: p.accent || DEFAULT_ACCENT };
  return { label: 'Other', color: PRACTICE_BAR_COLOR };
}

function renderWordsChart() {
  const el = document.getElementById('wordsChart');
  if (!el) return;
  // Only days that actually had words — no empty filler. Oldest → newest.
  // Keep the full per-source breakdown so the legend can list every source.
  const entries = [...wordsChartCache.entries()].map(([key, row]) => {
    const segs = [];
    for (const [src, words] of row.entries()) {
      if (words > 0) segs.push({ src, words });
    }
    return { key, segs };
  }).filter(d => d.segs.length).sort((a, b) => (a.key < b.key ? -1 : 1));
  const recent = wcRange === 'all' ? entries : entries.slice(-30);

  // Every source in range drives the legend; hidden ones stay listed so they
  // can be toggled back on. Bar heights count only the visible (on) sources.
  const present = new Set();
  recent.forEach(d => d.segs.forEach(s => present.add(s.src)));
  const visTotal = d => d.segs.reduce((t, s) => wcHidden.has(s.src) ? t : t + s.words, 0);
  const maxTotal = recent.reduce((m, d) => Math.max(m, visTotal(d)), 0);

  if (!recent.length || !present.size) {
    el.innerHTML = `
      <div class="wc-card">
        <div class="wc-title">Words per day</div>
        <div class="wc-empty">No words logged yet. Write a hop to start the chart.</div>
      </div>`;
    return;
  }

  // Each bar's height is its share of the busiest day (tallest = full section).
  // Segments split that bar by flex-grow proportional to each source's words.
  const safeMax = maxTotal || 1;
  const bars = recent.map(day => {
    const sorted = day.segs.filter(s => !wcHidden.has(s.src)).sort((a, b) => b.words - a.words);
    const dayTotal = sorted.reduce((t, s) => t + s.words, 0);
    const stack = sorted.map(s => {
      const { color } = wcSourceMeta(s.src);
      return `<span class="wc-seg" style="flex-grow:${s.words};background:${esc(color)}"></span>`;
    }).join('');
    const hPct = dayTotal > 0 ? Math.max(2, (dayTotal / safeMax) * 100) : 0;
    return `<div class="wc-bar" data-day="${day.key}" data-total="${dayTotal}" style="height:${hPct}%">
      <div class="wc-stack">${stack}</div>
    </div>`;
  }).join('');

  const legend = [...present].map(src => {
    const { label, color } = wcSourceMeta(src);
    const off = wcHidden.has(src);
    return `<button type="button" class="wc-leg${off ? ' off' : ''}" data-wc-src="${esc(src)}" title="Toggle ${esc(label)}"><span class="wc-leg-dot" style="background:${esc(color)}"></span>${esc(label)}</button>`;
  }).join('');

  el.innerHTML = `
    <div class="wc-card">
      <div class="wc-head">
        <div class="wc-title">Words per day</div>
        <div class="wc-range">
          <button class="wc-range-opt ${wcRange === 30 ? 'active' : ''}" data-wc-range="30">30 DAYS</button>
          <button class="wc-range-opt ${wcRange === 'all' ? 'active' : ''}" data-wc-range="all">ALL</button>
        </div>
      </div>
      <div class="wc-bars">${bars}</div>
      <div class="wc-legend">${legend}</div>
    </div>`;
  el.querySelectorAll('[data-wc-range]').forEach(b => b.addEventListener('click', () => {
    wcRange = b.dataset.wcRange === 'all' ? 'all' : 30;
    renderWordsChart();
  }));
  el.querySelectorAll('[data-wc-src]').forEach(b => b.addEventListener('click', () => {
    const src = b.dataset.wcSrc;
    if (wcHidden.has(src)) wcHidden.delete(src); else wcHidden.add(src);
    renderWordsChart();
  }));
}

/* words chart hover tooltip — reuses the heatmap tip element */
function showWordsTip(bar) {
  const key = bar.getAttribute('data-day');
  if (!key) return;
  const tip = ensureHeatTip();
  const total = +bar.getAttribute('data-total') || 0;
  const row = wordsChartCache.get(key);
  let lines = '';
  if (row && total) {
    const sorted = [...row.entries()].sort((a, b) => b[1] - a[1]);
    lines = sorted.map(([src, w]) => {
      const { label, color } = wcSourceMeta(src);
      return `<span class="hm-tip-stat"><span class="wc-leg-dot" style="background:${esc(color)}"></span>${esc(label)} · ${w.toLocaleString()}</span>`;
    }).join('');
  }
  const wn = total === 1 ? 'word' : 'words';
  tip.innerHTML =
    `<span class="hm-tip-date">${prettyDay(key)}</span>` +
    `<span class="hm-tip-stat">${total.toLocaleString()} ${wn}</span>` + lines;
  tip.hidden = false;
  const r = bar.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  let left = r.left + r.width / 2 - tr.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
  let top = r.top - tr.height - 8;
  if (top < 8) top = r.bottom + 8;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
document.addEventListener('mouseover', e => {
  const bar = e.target.closest && e.target.closest('.wc-bar[data-day]');
  if (bar) showWordsTip(bar);
});
document.addEventListener('mouseout', e => {
  if (_hmTip && e.target.closest && e.target.closest('.wc-bar[data-day]')) _hmTip.hidden = true;
});

/* ---- HOME: project cards ---- */
// Replay the staggered "style into place" reveal of the home blocks. Restarting
// the CSS animation needs the class removed, a forced reflow, then re-added.
function playHomeReveal() {
  const v = document.getElementById('view-home');
  if (!v) return;
  v.classList.remove('home-animate');
  void v.offsetWidth;
  v.classList.add('home-animate');
}

function renderHome() {
  renderStreakBar();
  renderHeatmap();
  renderWordsChart();
  const grid = document.getElementById('projectGrid');
  if (!grid) return;
  const cards = projectsCache.map(p => {
    const job = uploadJobs.get(p.id);
    if (job) return uploadingCardHTML(p, job);
    const active = p.id === activeProjectId;
    const stamp = p.updated_at || p.created_at;
    const when = stamp ? new Date(stamp).toLocaleDateString(undefined,
      { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    const kind = [p.type, p.genre].filter(Boolean).join(' · ');
    return `
      <div class="project-card ${active ? 'active' : ''}" style="--accent:${esc(p.accent || DEFAULT_ACCENT)}">
        <button class="pc-body" data-open="${p.id}">
          <span class="pc-name">${esc(p.name)}${active ? '<span class="pc-active-tag">● ACTIVE</span>' : ''}</span>
          ${kind ? `<span class="pc-kind">${esc(kind)}</span>` : ''}
          <span class="pc-meta">${active ? 'open · ' : ''}updated ${esc(when)}</span>
        </button>
        <div class="pc-actions">
          <button class="pc-btn" data-preview="${p.id}">PREVIEW</button>
          <button class="pc-btn" data-download="${p.id}">DOWNLOAD</button>
          <button class="pc-btn" data-edit="${p.id}">EDIT</button>
          <button class="pc-btn danger" data-del="${p.id}">DELETE</button>
        </div>
      </div>`;
  }).join('');
  grid.innerHTML = cards + `
    <button class="project-card new" id="newProjectCard">
      <span class="pc-plus">+</span>
      <span class="pc-new-label">NEW PROJECT</span>
    </button>`;
  grid.querySelectorAll('[data-open]').forEach(el =>
    el.addEventListener('click', () => openProject(el.dataset.open, { stayHome: true })));
  grid.querySelectorAll('[data-preview]').forEach(b =>
    b.addEventListener('click', () => previewProjectFlow(b.dataset.preview)));
  grid.querySelectorAll('[data-download]').forEach(b =>
    b.addEventListener('click', () => downloadProjectFlow(b.dataset.download, b)));
  grid.querySelectorAll('[data-edit]').forEach(b =>
    b.addEventListener('click', () => editProjectFlow(b.dataset.edit)));
  grid.querySelectorAll('[data-del]').forEach(b =>
    b.addEventListener('click', () => deleteProjectFlow(b.dataset.del)));
  grid.querySelectorAll('[data-upcancel]').forEach(b =>
    b.addEventListener('click', () => {
      const job = uploadJobs.get(b.dataset.upcancel);
      if (!job || job.ctl.canceled) return;
      job.ctl.canceled = true; job.stage = 'Canceling';
      b.disabled = true; b.textContent = 'CANCELING…';
    }));
  grid.querySelectorAll('[data-updismiss]').forEach(b =>
    b.addEventListener('click', async () => {
      const id = b.dataset.updismiss;
      b.disabled = true;
      await sb.from('projects').delete().eq('id', id).then(() => {}, () => {});
      uploadJobs.delete(id);
      const projects = await fetchProjects();
      renderProjectSelector(projects, activeProjectId);
      renderHome();
    }));
  grid.querySelector('#newProjectCard').addEventListener('click', createProjectFlow);
  renderSuggestedChunks();
}

/* ---- suggested next chunks (home page) ---- */
let suggestedChunks = null;     // cached AI result for the active project
let suggestedFor = null;        // project id the cache belongs to
let suggestLoading = false;

// Journal projects get reflective advice instead of plot-beat suggestions, so
// the home panel reframes itself around the writer rather than the story.
function isJournalProject() {
  const p = projectsCache.find(x => x.id === activeProjectId);
  return (p?.type || '').toLowerCase() === 'journal';
}

// Most recent journal entries, oldest first, capped by count and total size so
// the advice request stays small and well under the API token limit.
function recentJournalEntries(limit = 15, charBudget = 28000) {
  const withBody = db.chunks.filter(c => (c.body || '').trim()).slice();
  withBody.sort((a, b) => (a.narrativeOrder ?? 0) - (b.narrativeOrder ?? 0));
  const recent = withBody.slice(-limit);
  let total = recent.reduce((n, c) => n + (c.body || '').length, 0);
  while (recent.length > 1 && total > charBudget) {
    total -= (recent[0].body || '').length;
    recent.shift();
  }
  return recent.map(c => ({ title: c.title || '', body: c.body || '', when: c.chronoLabel || '' }));
}

function renderSuggestedChunks() {
  const section = document.getElementById('suggestSection');
  if (!section) return;
  // Only meaningful once a project is open (its content lives in `db`).
  if (!activeProjectId) { section.hidden = true; return; }
  section.hidden = false;

  // Drop a stale cache when the active project changed.
  if (suggestedFor !== activeProjectId) { suggestedChunks = null; suggestedFor = activeProjectId; }

  const journal = isJournalProject();
  const grid = document.getElementById('suggestGrid');
  const sub = document.getElementById('suggestSub');
  const titleEl = document.getElementById('suggestTitle');
  if (titleEl) titleEl.textContent = journal ? 'REFLECTIONS' : 'SUGGESTED NEXT HOPS';
  const refresh = document.getElementById('suggestRefreshBtn');
  refresh.disabled = suggestLoading;
  refresh.innerHTML = suggestLoading ? AI_STAR + ' THINKING…' : '↻ REFRESH';

  if (suggestLoading) {
    sub.textContent = journal ? 'Reading your recent entries…' : 'Reading your work so far…';
    grid.innerHTML = `<div class="suggest-empty">${journal ? 'Reflecting on what you have written lately…' : 'Thinking through what comes next…'}</div>`;
    return;
  }

  if (!suggestedChunks) {
    // Auto-generate the first time there's content to read; otherwise prompt.
    if (db.chunks.some(c => (c.body || '').trim())) { fetchSuggestedChunks(); return; }
    sub.textContent = journal ? 'Write an entry or two, then I can reflect back.' : 'Write a little, then I can suggest where to go next.';
    grid.innerHTML = `<div class="suggest-empty">${journal ? 'Nothing to reflect on yet — write an entry, then hit REFRESH.' : 'No suggestions yet — start writing, then hit REFRESH.'}</div>`;
    return;
  }

  if (!suggestedChunks.length) {
    sub.textContent = journal ? 'No reflections came back. Try refreshing.' : 'No suggestions came back. Try refreshing.';
    grid.innerHTML = `<div class="suggest-empty">Nothing came back. Hit REFRESH to try again.</div>`;
    return;
  }

  if (journal) {
    sub.textContent = 'Gentle reflections and prompts from your recent entries.';
    grid.innerHTML = suggestedChunks.map((it, i) => {
      const isPrompt = it.type === 'prompt';
      return `
        <div class="suggest-card ${isPrompt ? 'is-prompt' : 'is-reflection'}" data-i="${i}">
          <div class="sc-chap" style="color:${isPrompt ? 'var(--accent)' : 'var(--muted)'}">${isPrompt ? 'PROMPT' : 'REFLECTION'}</div>
          <div class="sc-title">${esc(it.title || (isPrompt ? 'Something to explore' : ''))}</div>
          <div class="sc-desc">${esc(it.body || '')}</div>
          ${isPrompt ? `<div class="sc-actions">
            <button class="add-btn solid sc-newentry" data-i="${i}">+ NEW ENTRY</button>
            <button class="add-btn sc-idea" data-i="${i}" title="Save this prompt for later">+ ADD IDEA</button>
          </div>` : ''}
        </div>`;
    }).join('');
    grid.querySelectorAll('.sc-newentry').forEach(b =>
      b.addEventListener('click', () => startJournalEntryFrom(suggestedChunks[+b.dataset.i])));
    grid.querySelectorAll('.sc-idea').forEach(b =>
      b.addEventListener('click', () => saveSuggestedAsIdea(suggestedChunks[+b.dataset.i])));
    return;
  }

  sub.textContent = 'Scenes that would make sense to write next.';
  grid.innerHTML = suggestedChunks.map((s, i) => {
    const ch = matchChapter(s.chapter);
    const chapName = ch ? ch.title : (s.chapter || 'New chapter');
    const chapColor = ch ? (ch.color || 'var(--accent)') : 'var(--muted)';
    return `
      <div class="suggest-card" data-i="${i}">
        <div class="sc-chap" style="color:${chapColor}">${esc(chapName)}${ch ? '' : ' · NEW'}</div>
        <div class="sc-title">${esc(s.title || 'Untitled scene')}</div>
        <div class="sc-desc">${esc(s.description || '')}</div>
        <div class="sc-actions">
          <button class="add-btn solid sc-add" data-i="${i}">+ ADD HOP</button>
          <button class="add-btn sc-idea" data-i="${i}" title="Save this as an idea for later">+ ADD IDEA</button>
        </div>
      </div>`;
  }).join('');
  grid.querySelectorAll('.sc-add').forEach(b =>
    b.addEventListener('click', () => addSuggestedChunk(suggestedChunks[+b.dataset.i])));
  grid.querySelectorAll('.sc-idea').forEach(b =>
    b.addEventListener('click', () => saveSuggestedAsIdea(suggestedChunks[+b.dataset.i])));
}

// Find an existing chapter whose title matches the AI's suggested chapter name.
function matchChapter(name) {
  const n = (name || '').trim().toLowerCase();
  if (!n) return null;
  return db.chapters.find(ch => (ch.title || '').trim().toLowerCase() === n) || null;
}

async function fetchSuggestedChunks() {
  if (suggestLoading) return;
  // Pin the request to the project that was active when it started so results
  // are never applied to a different project the user may have switched to.
  const reqProject = activeProjectId;
  if (!reqProject) return;
  suggestLoading = true;
  renderSuggestedChunks();
  const journal = isJournalProject();
  let result;
  try {
    const proj = projectsCache.find(p => p.id === reqProject);
    if (journal) {
      // Reflect on recent entries only — small request, and recency is what
      // matters for journaling advice.
      result = await aiInvoke({
        task: 'journal_advice',
        type: proj?.type || '',
        genre: proj?.genre || '',
        entries: recentJournalEntries()
      });
    } else {
      result = await aiInvoke({
        task: 'suggest_chunks',
        type: proj?.type || '',
        genre: proj?.genre || '',
        chapters: db.chapters.map(ch => ch.title).filter(Boolean),
        characters: db.characters.map(c => c.name).filter(Boolean),
        locations: (db.locations || []).map(l => l.name).filter(Boolean),
        chunks: db.chunks.filter(c => (c.body || '').trim()).map(c => ({ title: c.title, body: c.body }))
      });
    }
  } catch (err) {
    suggestLoading = false;
    if (activeProjectId === reqProject) {
      suggestedChunks = [];
      renderSuggestedChunks();
      alertModal((journal ? 'Could not reflect on your entries.' : 'Could not suggest next hops.') + '\n\n' + (err.message || ''),
        { title: journal ? 'REFLECTIONS' : 'SUGGESTED NEXT HOPS' });
    } else {
      renderSuggestedChunks();
    }
    return;
  }
  suggestLoading = false;
  // Discard if the user switched projects while the request was in flight.
  if (activeProjectId !== reqProject) { renderSuggestedChunks(); return; }
  const list = journal ? result.items : result.chunks;
  suggestedChunks = Array.isArray(list) ? list : [];
  suggestedFor = reqProject;
  renderSuggestedChunks();
}

// Turn a suggestion into a real chunk in the active project, then open it in the
// chunk editor so the author can refine chapter / characters / locations / tags.
function addSuggestedChunk(s) {
  if (!s) return;
  const ch = matchChapter(s.chapter) || db.chapters.find(x => x.id === db.ui.activeChapter) || db.chapters[0];
  if (!ch) { alertModal('Add a chapter first, then suggestions can be filed.', { title: 'ADD HOP' }); return; }
  const id = uid();
  db.chunks.push({
    id, chapterId: ch.id, title: s.title || '', body: s.description || '',
    orderInChapter: chunksOf(ch.id).length,
    narrativeOrder: db.chunks.length,
    chronoOrder: db.chunks.length,
    chronoLabel: '',
    characterIds: [],
    locationIds: [],
    tagIds: []
  });
  save();
  recordWritingActivity();
  if (Array.isArray(suggestedChunks)) {
    suggestedChunks = suggestedChunks.filter(x => x !== s);
    renderSuggestedChunks();
  }
  openChunkModal(id);
}

// Start a fresh journal entry seeded with a reflective prompt, then open it so
// the writer can respond right away.
function startJournalEntryFrom(item) {
  if (!item) return;
  const ch = db.chapters.find(x => x.id === db.ui.activeChapter) || db.chapters[0];
  if (!ch) { alertModal('Add a section first, then you can start an entry.', { title: 'NEW ENTRY' }); return; }
  const id = uid();
  db.chunks.push({
    id, chapterId: ch.id, title: item.title || '', body: '',
    orderInChapter: chunksOf(ch.id).length,
    narrativeOrder: db.chunks.length,
    chronoOrder: db.chunks.length,
    chronoLabel: '',
    characterIds: [],
    locationIds: [],
    tagIds: []
  });
  save();
  recordWritingActivity();
  if (Array.isArray(suggestedChunks)) {
    suggestedChunks = suggestedChunks.filter(x => x !== item);
    renderSuggestedChunks();
  }
  openChunkModal(id);
}

// Park a suggested scene in the Idea Backlog instead of writing it now, so it
// isn't lost when the suggestion list refreshes.
function saveSuggestedAsIdea(s) {
  if (!s) return;
  const title = (s.title || '').trim();
  const desc = (s.description || s.body || '').trim();
  if (!title && !desc) return;
  db.ideas.push({ id: uid(), title: title || desc, body: title ? desc : '', tagIds: [], ts: Date.now() });
  save();
  recordWritingActivity();
  if (Array.isArray(suggestedChunks)) {
    suggestedChunks = suggestedChunks.filter(x => x !== s);
    renderSuggestedChunks();
  }
}

/* ---- project flows ---- */
async function openProject(id, opts = {}) {
  // A project still importing in the background only has partial content; keep
  // the current project open until its tile finishes.
  if (uploadJobs.has(id)) {
    document.getElementById('projectSelect').value = activeProjectId;
    if (currentRoute() === 'home') renderHome();
    return;
  }
  if (id !== activeProjectId) {
    // Loading a project is several DB round trips and takes a beat. React
    // instantly so the switch never feels frozen: reflect the selection in the
    // dropdown, swap the accent, and show a loading overlay right away.
    const proj = projectsCache.find(p => p.id === id);
    document.getElementById('projectSelect').value = id;
    if (proj) applyProjectAccent(proj.accent);
    showProjectLoading(proj && proj.name);
    try {
      await flushPersist();
      await loadProject(id);   // swaps in the project's content and accent
      localStorage.setItem(activeKey(), id);
      document.getElementById('projectSelect').value = id;
      renderHeaderMeta();
    } finally {
      hideProjectLoading();
    }
  }
  // From the home grid, selecting a project orients the whole app to it
  // (accent, header, suggestions) without leaving the dashboard.
  if (opts.stayHome) { renderHome(); return; }
  go('sections');
}

// From the dashboard card: load the project (if it is not already open) and
// show its whole story in the full-preview modal without leaving home.
async function previewProjectFlow(id) {
  if (uploadJobs.has(id)) return;
  if (id !== activeProjectId) {
    await openProject(id, { stayHome: true });
  }
  sectionPreviewModal();
}

// Lightweight full-screen overlay shown while a project's content loads, so the
// switch feels responsive instead of a multi-second freeze.
let projectLoadingEl = null;
function showProjectLoading(name) {
  if (!projectLoadingEl) {
    projectLoadingEl = document.createElement('div');
    projectLoadingEl.className = 'project-loading';
    projectLoadingEl.innerHTML =
      '<div class="project-loading-box"><div class="project-loading-spinner"></div>' +
      '<div class="project-loading-label"></div></div>';
    document.body.appendChild(projectLoadingEl);
  }
  projectLoadingEl.querySelector('.project-loading-label').textContent =
    name ? 'LOADING ' + name.toUpperCase() : 'LOADING';
  // force reflow so the fade-in transition runs each time
  void projectLoadingEl.offsetWidth;
  projectLoadingEl.classList.add('on');
}
function hideProjectLoading() {
  if (projectLoadingEl) projectLoadingEl.classList.remove('on');
}

/* =====================================================================
   IMPORT — turn an uploaded PDF / TXT / MD into Sections + Hops on a
   brand-new project. Offered at project creation: the file's full text is
   read (not summarized), sliced, and outlined by the AI slice by slice.
   ===================================================================== */
const IMPORT_ACCEPT = '.pdf,.txt,.md,.markdown,.text';
const IMPORT_SUPPORTED = /\.(pdf|txt|md|markdown|text)$/i;
const IMPORT_SLICE = 9000;   // characters of source text per outline slice
// pdf.js is only needed for PDFs, so it's pulled from a CDN on first use.
const PDFJS_VERSION = '4.7.76';
let pdfjsLibPromise = null;

function fmtBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

function loadPdfjs() {
  if (!pdfjsLibPromise) {
    const base = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/`;
    pdfjsLibPromise = import(/* @vite-ignore */ base + 'pdf.min.mjs').then(mod => {
      mod.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
      return mod;
    }).catch(err => { pdfjsLibPromise = null; throw err; });
  }
  return pdfjsLibPromise;
}

// Pull plain text out of a file. PDFs go through pdf.js page by page; txt/md
// (and anything else) are read directly. `onPage` reports PDF progress.
async function extractText(file, onPage) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.pdf')) {
    const lib = await loadPdfjs();
    const buf = await file.arrayBuffer();
    const pdf = await lib.getDocument({ data: buf }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      let line = '';
      const lines = [];
      content.items.forEach(it => {
        if (typeof it.str !== 'string') return;
        line += it.str;
        if (it.hasEOL) { lines.push(line); line = ''; }
      });
      if (line) lines.push(line);
      pages.push(lines.join('\n'));
      if (onPage) onPage(p, pdf.numPages);
    }
    return pages.join('\n\n');
  }
  return await file.text();
}

// Split text into slices near a natural boundary so a unit (entry/scene) is
// less likely to be cut in half across slices.
function sliceText(text, size) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(text.length, i + size);
    if (end < text.length) {
      const w = text.slice(i, end);
      const para = w.lastIndexOf('\n\n');
      const nl = w.lastIndexOf('\n');
      const sp = w.lastIndexOf(' ');
      const min = size * 0.5;
      const cut = para > min ? para : (nl > min ? nl : (sp > min ? sp : -1));
      if (cut > 0) end = i + cut;
    }
    const piece = text.slice(i, end).trim();
    if (piece) out.push(piece);
    i = end;
  }
  return out;
}

/* ---- section import: add hops to an existing section from a file or paste ---- */
const SECTION_IMPORT_ACCEPT = '.txt,.md,.markdown,.text';
const SECTION_IMPORT_SUPPORTED = /\.(txt|md|markdown|text)$/i;

/* The import runs as a detached job keyed by chapter id, so closing the modal
   never aborts it. A live progress strip (with a shimmer while an AI pass is in
   flight) renders at the top of the importing section, and new hops appear in
   the list as each slice completes. */
const sectionImportJobs = new Map();   // chapterId -> { chapterId, total, pct, working, added, stage, status, error }

// Import pasted or uploaded text into an existing section, splitting it into hops
// via the same AI outliner the project importer uses. Runs against the loaded
// project in memory (db + save), so the new hops appear in the active section.
function openSectionImportModal(ch) {
  let chosenFile = null;
  let busy = false;
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  overlay.innerHTML = `
    <div class="ui-modal import-modal" role="dialog" aria-modal="true">
      <div class="ui-modal-title">IMPORT INTO ${esc(ch.title) || 'SECTION'}</div>
      <div class="im-body" id="siBody"></div>
    </div>`;
  document.body.appendChild(overlay);
  const bodyEl = overlay.querySelector('#siBody');

  const finish = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
  function onKey(e) { if (e.key === 'Escape' && !busy) { e.preventDefault(); finish(); } }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay && !busy) finish(); });

  function updateOk() {
    const ok = bodyEl.querySelector('#siOk');
    if (!ok) return;
    const pasted = (bodyEl.querySelector('#siPaste')?.value || '').trim();
    ok.disabled = !chosenFile && !pasted;
  }
  function setFile(f) {
    const nameEl = bodyEl.querySelector('#siFileName');
    if (!f || !nameEl) return;
    if (!SECTION_IMPORT_SUPPORTED.test(f.name || '')) {
      nameEl.textContent = 'Unsupported file — use a TXT or MD file.';
      nameEl.classList.add('bad'); chosenFile = null; updateOk(); return;
    }
    chosenFile = f; nameEl.classList.remove('bad');
    nameEl.textContent = f.name + ' \u00b7 ' + fmtBytes(f.size);
    updateOk();
  }

  function renderForm() {
    bodyEl.innerHTML = `
      <div class="ui-modal-msg">Add content to <b>${esc(ch.title) || 'this section'}</b>. Upload a file or paste text, tell the AI how to break it into hops, and it files them here.</div>
      <label class="im-drop" id="siDrop">
        <input type="file" id="siFile" accept="${SECTION_IMPORT_ACCEPT}" hidden />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M5 20h14"/></svg>
        <span class="im-drop-tx">Drag &amp; drop a TXT or Markdown file, or <b>browse</b></span>
        <span class="im-drop-file" id="siFileName"></span>
      </label>
      <label class="im-field"><span class="im-label">OR PASTE CONTENT</span>
        <textarea class="ui-modal-input im-instr" id="siPaste" rows="6" placeholder="Paste the text you want to break into hops\u2026"></textarea>
      </label>
      <label class="im-field"><span class="im-label">HOW SHOULD THE AI BREAK OUT AND TITLE THE HOPS?</span>
        <textarea class="ui-modal-input im-instr" id="siInstr" rows="3" placeholder="e.g. Make every dated journal entry its own HOP titled with the date. Or: split on scene breaks and title each hop with a short summary."></textarea>
      </label>
      <div class="ui-modal-actions">
        <button class="ui-modal-btn" data-act="cancel">Cancel</button>
        <button class="ui-modal-btn solid" id="siOk" data-act="ok" disabled>IMPORT</button>
      </div>`;
    const fileInput = bodyEl.querySelector('#siFile');
    const drop = bodyEl.querySelector('#siDrop');
    fileInput.addEventListener('change', () => setFile(fileInput.files[0]));
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => { if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });
    bodyEl.querySelector('#siPaste').addEventListener('input', updateOk);
    bodyEl.querySelector('[data-act="cancel"]').addEventListener('click', finish);
    bodyEl.querySelector('#siOk').addEventListener('click', onImport);
    updateOk();
  }

  function renderProgress(stage) {
    bodyEl.innerHTML = `
      <div class="ui-modal-msg si-stage">${esc(stage)}</div>
      <div class="sp-bar is-indeterminate"><div class="sp-fill" style="width:30%"></div></div>`;
  }

  async function onImport() {
    if (busy) return;
    if (sectionImportJobs.has(ch.id)) {
      alertModal('An import is already running for this section. Let it finish first.', { title: 'IMPORT' });
      return;
    }
    const instructions = (bodyEl.querySelector('#siInstr')?.value || '').trim();
    const pasted = (bodyEl.querySelector('#siPaste')?.value || '').trim();
    busy = true;
    renderProgress('Reading content\u2026');
    let text = pasted;
    try {
      if (chosenFile) text = await extractText(chosenFile);
    } catch (err) {
      busy = false; renderForm();
      alertModal('Could not read that file.\n\n' + (err.message || ''), { title: 'IMPORT' });
      return;
    }
    text = (text || '').trim();
    if (!text) {
      busy = false; renderForm();
      alertModal('There was no readable text to import.', { title: 'IMPORT' });
      return;
    }
    // Hand the work to a background job and close the modal. The import keeps
    // running and shows its progress at the top of the section.
    busy = false; finish();
    startSectionImport(ch, text, instructions);
  }

  renderForm();
}

// Kick off a detached section-import job and surface its progress at the top of
// the importing section. The modal has already closed; the job runs on its own.
function startSectionImport(ch, text, instructions) {
  const job = {
    chapterId: ch.id, total: 0, pct: 0, working: true,
    added: 0, stage: 'Starting\u2026', status: 'building', error: ''
  };
  sectionImportJobs.set(ch.id, job);
  // Make the importing section active so its progress strip is visible.
  if (db.ui.activeChapter !== ch.id) { db.ui.activeChapter = ch.id; save(); }
  if (currentRoute() === 'sections') renderSections();
  else location.hash = '#sections';
  runSectionImportJob(ch, text, instructions, job);
}

// Slice the source text and outline each slice into hops via the same AI task the
// project importer uses, filing every hop into `ch`. Drives the job's progress
// state and repaints the section's strip / list as it goes.
async function runSectionImportJob(ch, text, instructions, job) {
  const proj = projectsCache.find(p => p.id === activeProjectId);
  const slices = sliceText(text, IMPORT_SLICE);
  job.total = slices.length;
  if (!slices.length) {
    job.status = 'done'; job.working = false; job.pct = 100;
    job.stage = 'Nothing to import';
    paintSectionImport(ch.id); scheduleSectionImportCleanup(ch.id);
    return;
  }
  try {
    for (let i = 0; i < slices.length; i++) {
      // Mark "working" before the (slow) AI call so the shimmer signals progress
      // even while the bar width hasn't moved.
      job.working = true;
      job.pct = Math.round((i / slices.length) * 100);
      job.stage = 'Reading pass ' + (i + 1) + ' of ' + slices.length +
        '  \u00b7  ' + job.added + ' hop' + (job.added === 1 ? '' : 's') + ' so far';
      paintSectionImport(ch.id);
      let res = null;
      try {
        res = await aiInvoke({
          task: 'import_outline', text: slices[i], instructions,
          type: proj?.type || '', genre: proj?.genre || '',
          sectionsSoFar: [ch.title].filter(Boolean)
        });
      } catch (_) { res = null; }   // skip a failed slice, keep going
      const hops = res && Array.isArray(res.hops) ? res.hops : [];
      let addedThisSlice = 0;
      hops.forEach(h => {
        const body = (h && h.body || '').trim();
        const title = (h && h.title || '').trim();
        if (!body && !title) return;
        db.chunks.push({
          id: uid(), chapterId: ch.id, title: title || 'Untitled', body,
          orderInChapter: chunksOf(ch.id).length,
          narrativeOrder: db.chunks.length,
          chronoOrder: db.chunks.length,
          chronoLabel: '',
          characterIds: [], locationIds: [], tagIds: []
        });
        job.added++; addedThisSlice++;
      });
      if (addedThisSlice) {
        save();
        // Show the new hops live if the user is watching this section.
        if (db.ui.activeChapter === ch.id && currentRoute() === 'sections') renderChunkList(ch);
      }
      job.working = false;
      job.pct = Math.round(((i + 1) / slices.length) * 100);
      paintSectionImport(ch.id);
    }
    if (job.added) recordWritingActivity();
    job.status = 'done'; job.working = false; job.pct = 100;
    job.stage = job.added
      ? 'Import complete \u2014 ' + job.added + ' hop' + (job.added === 1 ? '' : 's') + ' added'
      : 'No hops could be built \u2014 try adjusting your instructions';
    paintSectionImport(ch.id);
    scheduleSectionImportCleanup(ch.id);
  } catch (err) {
    job.status = 'error'; job.working = false;
    job.error = (err && err.message) ? err.message : 'Import failed';
    paintSectionImport(ch.id);
  }
}

// Progress strip markup for the section-import job. Reuses the project-tile
// upload bar styles (shimmer while working, determinate fill between passes).
function sectionImportProgressHTML(job) {
  if (job.status === 'error') {
    return `<div class="pc-up-bar"><div class="pc-up-fill pc-up-fill-err" style="width:100%"></div></div>
      <div class="pc-up-stage">${esc(job.error || 'Import failed')}</div>
      <button class="add-btn si-dismiss" data-secdismiss="${job.chapterId}">DISMISS</button>`;
  }
  return `<div class="pc-up-bar ${job.working ? 'is-working' : ''}"><div class="pc-up-fill" style="width:${job.pct}%"></div></div>
    <div class="pc-up-stage">${esc(job.stage)}</div>`;
}

// Lightweight repaint of just the active section's import strip.
function paintSectionImport(chapterId) {
  if (currentRoute() !== 'sections' || db.ui.activeChapter !== chapterId) return;
  const job = sectionImportJobs.get(chapterId);
  if (!job) return;
  const el = document.querySelector('[data-secimport="' + chapterId + '"]');
  if (!el) { renderChunkPane(); return; }   // strip not built yet (e.g. empty list)
  el.innerHTML = sectionImportProgressHTML(job);
  wireSectionImportDismiss(el, chapterId);
}

function wireSectionImportDismiss(strip, chapterId) {
  const dz = strip.querySelector('[data-secdismiss]');
  if (dz) dz.addEventListener('click', () => { sectionImportJobs.delete(chapterId); renderChunkPane(); });
}

// Once a job finishes cleanly, fade the strip out after a beat so a completed
// import doesn't linger. Errors stay put until the user dismisses them.
function scheduleSectionImportCleanup(chapterId) {
  setTimeout(() => {
    const j = sectionImportJobs.get(chapterId);
    if (!j || j.status !== 'done') return;
    sectionImportJobs.delete(chapterId);
    if (currentRoute() === 'sections' && db.ui.activeChapter === chapterId) renderChunkPane();
  }, 4500);
}

/* ================= PLANNING =================
   A workspace for long-form, unstructured docs (outlines, lore dumps, raw
   exposition, idea drafts). Each doc is a free-text note stored in
   `db.docs` / the planning_docs table. From an open doc you can GENERATE:
   - Sections + Hops: reuses the import_outline engine (same as IMPORT), but
     creates sections from the AI's grouping rather than filing into one.
   - Events: reuses the detect_events engine, reading the doc as one source. */

let activePlanId = null;            // currently-open doc id
const planGenJobs = new Map();      // docId -> { docId, total, pct, working, sections, hops, stage, status, error }

function planDocs() {
  return (db.docs || []).slice().sort((a, b) =>
    (a.position ?? 0) - (b.position ?? 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
}
function planWordCount(d) {
  const w = (d.body || '').trim();
  return w ? w.split(/\s+/).length : 0;
}

const IC_GEN_STAR = '<svg class="aifn-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="M18.5 15l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6Z"/></svg>';

function renderPlanning() {
  const wrap = document.getElementById('planningWrap');
  if (!wrap) return;
  const docs = planDocs();
  if (!docs.length) {
    activePlanId = null;
    wrap.innerHTML = `<div class="planning-empty">No planning docs yet.<br>Click <b>+ DOC</b> to start an outline, lore dump, or any long-form notes &mdash; then turn it into Sections, Hops, or Events.</div>`;
    return;
  }
  if (!activePlanId || !docs.some(d => d.id === activePlanId)) activePlanId = docs[0].id;
  const doc = docs.find(d => d.id === activePlanId);
  wrap.innerHTML = `
    <aside class="plan-list" id="planList">
      ${docs.map(d => `
        <button class="plan-item ${d.id === activePlanId ? 'on' : ''}" data-id="${d.id}">
          <span class="plan-item-title">${esc(d.title) || 'Untitled doc'}</span>
          <span class="plan-item-meta">${planWordCount(d)} words</span>
        </button>`).join('')}
    </aside>
    <div class="plan-editor" id="planEditor">
      <div class="plan-editor-head">
        <input class="plan-title-input" id="planTitleInput" placeholder="Untitled doc" value="${esc(doc.title)}" />
        <div class="plan-editor-actions">
          <details class="detect-tool" id="planGenMenu">
            <summary class="add-btn">${IC_GEN_STAR} GENERATE \u25be</summary>
            <div class="detect-tool-menu">
              <button id="planGenSections">SECTIONS + HOPS</button>
              <button id="planGenEvents">EVENTS</button>
            </div>
          </details>
          <button class="icon-btn" id="planDeleteBtn" title="Delete doc">\u2715</button>
        </div>
      </div>
      <div class="plan-genstrip" id="planGenStrip" data-plangen="${doc.id}"></div>
      <textarea class="plan-body-input" id="planBodyInput" placeholder="Write your outline, lore, exposition, raw ideas\u2026 then GENERATE to break it apart.">${esc(doc.body)}</textarea>
    </div>`;

  wrap.querySelectorAll('.plan-item').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.id === activePlanId) return;
    activePlanId = b.dataset.id; renderPlanning();
  }));

  const titleInput = wrap.querySelector('#planTitleInput');
  titleInput.addEventListener('input', () => {
    doc.title = titleInput.value; doc.updatedAt = Date.now();
    const item = wrap.querySelector(`.plan-item.on .plan-item-title`);
    if (item) item.textContent = titleInput.value || 'Untitled doc';
    save();
  });

  const bodyInput = wrap.querySelector('#planBodyInput');
  bodyInput.addEventListener('input', () => {
    doc.body = bodyInput.value; doc.updatedAt = Date.now();
    const meta = wrap.querySelector(`.plan-item.on .plan-item-meta`);
    if (meta) meta.textContent = planWordCount(doc) + ' words';
    save();
  });

  wrap.querySelector('#planDeleteBtn').addEventListener('click', () => deletePlanDoc(doc));
  wrap.querySelector('#planGenSections').addEventListener('click', () => {
    wrap.querySelector('#planGenMenu')?.removeAttribute('open');
    openPlanGenerateModal(doc);
  });
  wrap.querySelector('#planGenEvents').addEventListener('click', () => {
    wrap.querySelector('#planGenMenu')?.removeAttribute('open');
    planGenerateEvents(doc);
  });

  paintPlanGen(doc.id);
}

document.getElementById('addDocBtn')?.addEventListener('click', () => {
  if (!activeProjectId) { alertModal('Open a project first.', { title: 'ADD DOC' }); return; }
  docEditModal();
});

// New doc creation via a lightweight modal (title + body only), modeled on the
// add-hop / idea-edit modals. No inline editor on create — the doc lands in the
// list and opens in the planning editor after save.
function docEditModal() {
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  overlay.innerHTML = `
    <div class="ui-modal doc-edit-modal" role="dialog" aria-modal="true">
      <button class="ui-modal-x" data-act="cancel" aria-label="Close" title="Close">&times;</button>
      <div class="ui-modal-title">NEW DOC</div>
      <div class="ie-field">
        <span class="ie-label">TITLE</span>
        <input class="ie-name" type="text" maxlength="160" placeholder="Doc title\u2026" />
      </div>
      <div class="ie-field doc-body-field">
        <span class="ie-label">BODY</span>
        <textarea class="ie-body" placeholder="Outline, lore dump, raw exposition\u2026"></textarea>
      </div>
      <div class="ui-modal-actions">
        <span class="ie-spacer"></span>
        <button class="ui-modal-btn" data-act="cancel">Cancel</button>
        <button class="ui-modal-btn solid" data-act="save">Add</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const nameInput = overlay.querySelector('.ie-name');
  const bodyInput = overlay.querySelector('.ie-body');
  const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('[data-act="cancel"]').forEach(b => b.addEventListener('click', close));

  overlay.querySelector('[data-act="save"]').addEventListener('click', () => {
    const title = nameInput.value.trim();
    const body = bodyInput.value;
    if (!title && !body.trim()) { close(); return; }
    db.docs = db.docs || [];
    const doc = { id: uid(), title, body, position: 0, ts: Date.now(), updatedAt: Date.now() };
    db.docs.unshift(doc);
    db.docs.forEach((d, i) => d.position = i);
    activePlanId = doc.id;
    recordWritingActivity();
    save();
    close();
    if (currentRoute() !== 'planning') location.hash = '#planning';
    else renderPlanning();
  });

  setTimeout(() => nameInput.focus(), 0);
}

async function deletePlanDoc(doc) {
  if (!await confirmModal('Delete this planning doc? This cannot be undone.', { title: 'DELETE DOC' })) return;
  db.docs = (db.docs || []).filter(d => d.id !== doc.id);
  db.docs.forEach((d, i) => d.position = i);
  if (activePlanId === doc.id) activePlanId = db.docs[0]?.id || null;
  planGenJobs.delete(doc.id);
  save();
  renderPlanning();
}

/* ---- Planning -> Sections + Hops (background job, reuses import_outline) ---- */
// Collect optional grouping instructions, then hand off to a detached job whose
// progress strip lives in the doc editor. The doc text is sliced and outlined
// one slice at a time; sections are created from the AI's grouping and each hop
// is filed into its section in the loaded project (db + save).
function openPlanGenerateModal(doc) {
  const text = (doc.body || '').trim();
  if (!text) { alertModal('This doc is empty \u2014 write something first.', { title: 'GENERATE' }); return; }
  if (planGenJobs.has(doc.id)) { alertModal('A generation is already running for this doc. Let it finish first.', { title: 'GENERATE' }); return; }
  let busy = false;
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  overlay.innerHTML = `
    <div class="ui-modal import-modal" role="dialog" aria-modal="true">
      <div class="ui-modal-title">TURN INTO SECTIONS + HOPS</div>
      <div class="im-body">
        <div class="ui-modal-msg">RABBIT HOLE will read <b>${esc(doc.title) || 'this doc'}</b> and break it into Sections and Hops, filing them into your project. Tell it how to group and title them, or leave blank to use natural structure.</div>
        <label class="im-field"><span class="im-label">HOW SHOULD IT BREAK THINGS OUT? (optional)</span>
          <textarea class="ui-modal-input im-instr" id="pgInstr" rows="3" placeholder="e.g. One SECTION per act; each scene is its own HOP titled with a short summary. Or: make each bullet a HOP."></textarea>
        </label>
        <div class="ui-modal-actions">
          <button class="ui-modal-btn" data-act="cancel">Cancel</button>
          <button class="ui-modal-btn solid" data-act="ok">GENERATE</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const finish = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
  function onKey(e) { if (e.key === 'Escape' && !busy) { e.preventDefault(); finish(); } }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay && !busy) finish(); });
  overlay.querySelector('[data-act="cancel"]').addEventListener('click', finish);
  overlay.querySelector('[data-act="ok"]').addEventListener('click', () => {
    const instructions = (overlay.querySelector('#pgInstr')?.value || '').trim();
    busy = true; finish();
    startPlanGen(doc, instructions);
  });
}

function startPlanGen(doc, instructions) {
  const job = { docId: doc.id, total: 0, pct: 0, working: true, sections: 0, hops: 0, stage: 'Starting\u2026', status: 'building', error: '' };
  planGenJobs.set(doc.id, job);
  if (currentRoute() !== 'planning') { activePlanId = doc.id; location.hash = '#planning'; }
  else { activePlanId = doc.id; renderPlanning(); }
  runPlanGenJob(doc, instructions, job);
}

async function runPlanGenJob(doc, instructions, job) {
  const proj = projectsCache.find(p => p.id === activeProjectId);
  const slices = sliceText(doc.body || '', IMPORT_SLICE);
  job.total = slices.length;
  if (!slices.length) {
    job.status = 'done'; job.working = false; job.pct = 100; job.stage = 'Nothing to generate';
    paintPlanGen(doc.id); schedulePlanGenCleanup(doc.id); return;
  }
  // Map section title -> chapter id, seeded with any sections already in the project
  // so the AI can extend existing structure instead of duplicating it.
  const sectionByTitle = new Map();
  db.chapters.forEach(ch => sectionByTitle.set((ch.title || '').trim().toLowerCase(), ch.id));
  const ensureSection = title => {
    const t = (title || '').trim() || 'Imported';
    const key = t.toLowerCase();
    if (!sectionByTitle.has(key)) {
      const id = uid();
      db.chapters.push({ id, title: t, order: db.chapters.length, color: CHAPTER_PALETTE[db.chapters.length % CHAPTER_PALETTE.length] });
      sectionByTitle.set(key, id);
      job.sections++;
    }
    return sectionByTitle.get(key);
  };
  try {
    for (let i = 0; i < slices.length; i++) {
      job.working = true;
      job.pct = Math.round((i / slices.length) * 100);
      job.stage = 'Reading pass ' + (i + 1) + ' of ' + slices.length + '  \u00b7  ' +
        job.sections + ' section' + (job.sections === 1 ? '' : 's') + ', ' +
        job.hops + ' hop' + (job.hops === 1 ? '' : 's') + ' so far';
      paintPlanGen(doc.id);
      let res = null;
      try {
        res = await aiInvoke({
          task: 'import_outline', text: slices[i], instructions,
          type: proj?.type || '', genre: proj?.genre || '',
          sectionsSoFar: db.chapters.map(c => c.title).filter(Boolean)
        });
      } catch (_) { res = null; }
      const hops = res && Array.isArray(res.hops) ? res.hops : [];
      let addedThisSlice = 0;
      hops.forEach(h => {
        const body = (h && h.body || '').trim();
        const title = (h && h.title || '').trim();
        if (!body && !title) return;
        const chId = ensureSection(h.section);
        db.chunks.push({
          id: uid(), chapterId: chId, title: title || 'Untitled', body,
          orderInChapter: chunksOf(chId).length,
          narrativeOrder: db.chunks.length,
          chronoOrder: db.chunks.length,
          chronoLabel: '',
          characterIds: [], locationIds: [], tagIds: []
        });
        job.hops++; addedThisSlice++;
      });
      if (addedThisSlice) save();
      job.working = false;
      job.pct = Math.round(((i + 1) / slices.length) * 100);
      paintPlanGen(doc.id);
    }
    if (job.hops) recordWritingActivity();
    job.status = 'done'; job.working = false; job.pct = 100;
    job.stage = job.hops
      ? 'Done \u2014 ' + job.sections + ' section' + (job.sections === 1 ? '' : 's') + ', ' + job.hops + ' hop' + (job.hops === 1 ? '' : 's') + ' added to your project'
      : 'No hops could be built \u2014 try adjusting your instructions';
    paintPlanGen(doc.id);
    schedulePlanGenCleanup(doc.id);
  } catch (err) {
    job.status = 'error'; job.working = false;
    job.error = (err && err.message) ? err.message : 'Generation failed';
    paintPlanGen(doc.id);
  }
}

function planGenProgressHTML(job) {
  if (job.status === 'error') {
    return `<div class="pc-up-bar"><div class="pc-up-fill pc-up-fill-err" style="width:100%"></div></div>
      <div class="pc-up-stage">${esc(job.error || 'Generation failed')}</div>
      <button class="add-btn pg-dismiss" data-pgdismiss="${job.docId}">DISMISS</button>`;
  }
  const cta = job.status === 'done' && job.hops
    ? `<button class="add-btn pg-goto" data-pggoto="${job.docId}">VIEW SECTIONS \u2192</button>` : '';
  return `<div class="pc-up-bar ${job.working ? 'is-working' : ''}"><div class="pc-up-fill" style="width:${job.pct}%"></div></div>
    <div class="pc-up-stage">${esc(job.stage)}</div>${cta}`;
}

function paintPlanGen(docId) {
  if (currentRoute() !== 'planning' || activePlanId !== docId) return;
  const el = document.querySelector('[data-plangen="' + docId + '"]');
  if (!el) return;
  const job = planGenJobs.get(docId);
  if (!job) { el.innerHTML = ''; return; }
  el.innerHTML = planGenProgressHTML(job);
  const dz = el.querySelector('[data-pgdismiss]');
  if (dz) dz.addEventListener('click', () => { planGenJobs.delete(docId); paintPlanGen(docId); });
  const goto = el.querySelector('[data-pggoto]');
  if (goto) goto.addEventListener('click', () => { location.hash = '#sections'; });
}

function schedulePlanGenCleanup(docId) {
  setTimeout(() => {
    const j = planGenJobs.get(docId);
    if (!j || j.status !== 'done') return;
    planGenJobs.delete(docId);
    paintPlanGen(docId);
  }, 9000);
}

/* ---- Planning -> Events (reuses detect_events, reading the doc as one source) ---- */
async function planGenerateEvents(doc) {
  const text = (doc.body || '').trim();
  if (!text) { alertModal('This doc is empty \u2014 write something first.', { title: 'DETECT EVENTS' }); return; }
  const menu = document.getElementById('planGenMenu');
  const btn = menu ? menu.querySelector('summary') : null;
  const original = btn ? aiBtnStart(btn, IC_GEN_STAR, 'SCANNING\u2026') : null;
  try {
    const hops = [{ id: null, title: doc.title || 'Planning doc', section: 'Planning', body: text }];
    const existing = (db.events || []).map(e => ({ title: e.title, when: e.dateLabel || '' }));
    const characters = (db.characters || []).map(c => ({ name: c.name, aliases: c.aliases || [] }));
    const locations = (db.locations || []).map(l => ({ name: l.name, aliases: l.aliases || [] }));
    const { events: found = [] } = await aiInvoke({ task: 'detect_events', hops, existing, characters, locations });
    if (btn) aiBtnDone(btn, original);
    if (!found.length) { alertModal('No events were detected in this doc.', { title: 'DETECT EVENTS' }); return; }

    const have = new Set((db.events || []).filter(e => !e.dismissed).map(e => evNormTitle(e.title)));
    const dismissedKeys = new Set((db.events || []).filter(e => e.dismissed).map(e => evNormTitle(e.title)));
    const seen = new Set();
    const annotated = found.map(e => {
      const key = evNormTitle(e.title);
      const dup = !!key && (have.has(key) || seen.has(key));
      if (key) seen.add(key);
      return { ...e, _dup: dup, _dismissed: !!key && dismissedKeys.has(key) };
    });
    const visible = annotated.filter(e => !e._dismissed);
    const newCount = visible.filter(e => !e._dup).length;
    const dupCount = visible.length - newCount;
    if (newCount === 0) { alertModal('Every event found is already on your timeline or was dismissed.', { title: 'DETECT EVENTS' }); return; }

    const resolveNames = (names, coll) => {
      if (!Array.isArray(names) || !names.length) return [];
      const ents = db[coll] || [];
      const ids = [];
      names.forEach(nm => {
        const key = (nm || '').trim().toLowerCase();
        if (!key) return;
        const ent = ents.find(e =>
          (e.name || '').trim().toLowerCase() === key ||
          (Array.isArray(e.aliases) && e.aliases.some(a => (a || '').trim().toLowerCase() === key)));
        if (ent && !ids.includes(ent.id)) ids.push(ent.id);
      });
      return ids;
    };

    const review = await eventReviewModal(visible, { dupCount });
    if (!review) return;
    const { chosen = [], dismissed = [] } = review;
    if (!chosen.length && !dismissed.length) return;
    db.events = db.events || [];
    let pos = eventsSorted().length;
    const mkEvent = (ev, isDismissed) => ({
      id: uid(), hopId: null,
      title: (ev.title || '').slice(0, 200),
      description: ev.description || '',
      dateLabel: ev.when || '',
      chronoPos: isDismissed ? 0 : pos++,
      characterIds: resolveNames(ev.characters, 'characters'),
      locationIds: resolveNames(ev.locations, 'locations'),
      timelineIds: (!isDismissed && activeTimelineId()) ? [activeTimelineId()] : [],
      dismissed: isDismissed
    });
    chosen.forEach(ev => db.events.push(mkEvent(ev, false)));
    dismissed.forEach(ev => db.events.push(mkEvent(ev, true)));
    save();
    alertModal(chosen.length + ' event' + (chosen.length === 1 ? '' : 's') + ' added to your timeline.', { title: 'EVENTS' });
  } catch (err) {
    if (btn) aiBtnDone(btn, original);
    alertModal('Event detection failed.\n\n' + (err.message || ''), { title: 'DETECT EVENTS' });
  }
}

// The project-creation upload step. Resolves with a `db`-shaped data object to
// seed the new project, or null to start blank (skip / cancel / failure).
// New-project modal: project settings + a START FRESH / IMPORT toggle in one
// surface. Choosing IMPORT reveals the upload box and grouping prompt; the
// primary button becomes CREATE AND BUILD. Resolves with either
// { name, type, genre, accent, seedData:null } for a fresh project, or
// { name, type, genre, accent, importFile, instructions } for an import —
// createProjectFlow then builds the import in the background on the tile.
function newProjectModal() {
  return new Promise(resolve => {
    let chosenAccent = DEFAULT_ACCENT;
    let mode = 'fresh';            // 'fresh' | 'import'
    let chosenFile = null;
    let npName = 'Untitled', npType = 'Book', npGenre = '';
    const typeOpts = PROJECT_TYPES.map(t =>
      `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    const genreOpts = `<option value="">— none —</option>` +
      GENRES.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
    const swatches = PROJECT_ACCENTS.map(a =>
      `<button type="button" class="ps-swatch" data-accent="${esc(a.value)}" style="--sw:${esc(a.value)}" title="${esc(a.name)}" aria-label="${esc(a.name)}"></button>`).join('');

    const overlay = document.createElement('div');
    overlay.className = 'ui-modal-overlay';
    overlay.innerHTML = `
      <div class="ui-modal import-modal" role="dialog" aria-modal="true">
        <div class="ui-modal-title">NEW PROJECT</div>
        <div class="im-body" id="npBody"></div>
      </div>`;
    document.body.appendChild(overlay);
    const bodyEl = overlay.querySelector('#npBody');
    applyProjectAccent(chosenAccent);

    const restoreAccent = () => applyProjectAccent(projectsCache.find(p => p.id === activeProjectId)?.accent);
    const finish = val => { document.removeEventListener('keydown', onKey); if (!val) restoreAccent(); overlay.remove(); resolve(val); };
    function syncForm() {
      const n = bodyEl.querySelector('#psName'); if (n) npName = n.value;
      const t = bodyEl.querySelector('#psType'); if (t) npType = t.value;
      const g = bodyEl.querySelector('#psGenre'); if (g) npGenre = g.value;
    }

    function updateOk() {
      const ok = bodyEl.querySelector('#npOk');
      if (!ok) return;
      const nameOk = !!bodyEl.querySelector('#psName').value.trim();
      if (mode === 'import') { ok.textContent = 'CREATE AND BUILD'; ok.disabled = !nameOk || !chosenFile; }
      else { ok.textContent = 'CREATE'; ok.disabled = !nameOk; }
    }

    function setFile(f) {
      const nameEl = bodyEl.querySelector('#imFileName');
      if (!f) return;
      if (!IMPORT_SUPPORTED.test(f.name || '')) {
        nameEl.textContent = 'Unsupported file — use PDF, TXT, or MD.';
        nameEl.classList.add('bad'); chosenFile = null; updateOk(); return;
      }
      chosenFile = f; nameEl.classList.remove('bad');
      nameEl.textContent = f.name + ' · ' + fmtBytes(f.size);
      updateOk();
    }

    function renderForm() {
      bodyEl.innerHTML = `
        <label class="ps-field"><span class="ps-label">NAME</span>
          <input class="ui-modal-input" id="psName" type="text" />
        </label>
        <label class="ps-field"><span class="ps-label">TYPE</span>
          <select class="ui-modal-input" id="psType">${typeOpts}</select>
        </label>
        <label class="ps-field"><span class="ps-label">GENRE</span>
          <select class="ui-modal-input" id="psGenre">${genreOpts}</select>
        </label>
        <div class="ps-field"><span class="ps-label">THEME COLOR</span>
          <div class="ps-swatches" id="psSwatches">${swatches}</div>
        </div>
        <div class="ps-field"><span class="ps-label">START</span>
          <div class="np-mode" id="npMode">
            <button type="button" class="np-mode-btn ${mode === 'fresh' ? 'on' : ''}" data-mode="fresh">START FRESH</button>
            <button type="button" class="np-mode-btn ${mode === 'import' ? 'on' : ''}" data-mode="import">IMPORT</button>
          </div>
        </div>
        <div class="np-import" id="npImport" ${mode === 'import' ? '' : 'hidden'}>
          <label class="im-drop" id="imDrop">
            <input type="file" id="imFile" accept="${IMPORT_ACCEPT}" hidden />
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M5 20h14"/></svg>
            <span class="im-drop-tx">Drag &amp; drop a PDF, TXT, or Markdown file, or <b>browse</b></span>
            <span class="im-drop-file" id="imFileName"></span>
          </label>
          <label class="im-field"><span class="im-label">ANY RECOMMENDATIONS AROUND GROUPING SECTIONS OR HOPS?</span>
            <textarea class="ui-modal-input im-instr" id="imInstr" rows="3" placeholder="e.g. It's a journal — make every daily entry a HOP with the date as the title, and make Sections the month titled MM/YY."></textarea>
          </label>
        </div>
        <div class="ui-modal-actions">
          <button class="ui-modal-btn" data-act="cancel">Cancel</button>
          <button class="ui-modal-btn solid" id="npOk" data-act="ok">Create</button>
        </div>`;

      const nameEl = bodyEl.querySelector('#psName');
      nameEl.value = npName;
      bodyEl.querySelector('#psType').value = npType;
      bodyEl.querySelector('#psGenre').value = npGenre;
      bodyEl.querySelectorAll('.ps-swatch').forEach(s => s.classList.toggle('active', s.dataset.accent === chosenAccent));
      applyProjectAccent(chosenAccent);

      nameEl.addEventListener('input', updateOk);
      bodyEl.querySelector('#psSwatches').addEventListener('click', e => {
        const sw = e.target.closest('.ps-swatch'); if (!sw) return;
        chosenAccent = sw.dataset.accent;
        bodyEl.querySelectorAll('.ps-swatch').forEach(s => s.classList.toggle('active', s === sw));
        applyProjectAccent(chosenAccent);
      });
      bodyEl.querySelector('#npMode').addEventListener('click', e => {
        const b = e.target.closest('.np-mode-btn'); if (!b) return;
        mode = b.dataset.mode;
        bodyEl.querySelectorAll('.np-mode-btn').forEach(x => x.classList.toggle('on', x === b));
        bodyEl.querySelector('#npImport').hidden = mode !== 'import';
        updateOk();
      });

      const fileInput = bodyEl.querySelector('#imFile');
      const drop = bodyEl.querySelector('#imDrop');
      fileInput.addEventListener('change', () => setFile(fileInput.files[0]));
      ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
      ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
      drop.addEventListener('drop', e => { if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });

      bodyEl.querySelector('[data-act="cancel"]').addEventListener('click', () => finish(null));
      bodyEl.querySelector('#npOk').addEventListener('click', onOk);
      updateOk();
      nameEl.focus(); nameEl.select();
    }

    function onOk() {
      syncForm();
      if (!npName.trim()) { bodyEl.querySelector('#psName').focus(); return; }
      // IMPORT: hand the raw file off so the build runs in the background on the
      // project tile (the project row is created immediately by createProjectFlow).
      if (mode === 'import' && chosenFile) {
        finish({
          name: npName.trim(), type: npType, genre: npGenre, accent: chosenAccent,
          importFile: chosenFile, instructions: bodyEl.querySelector('#imInstr').value.trim()
        });
      } else {
        finish({ name: npName.trim(), type: npType, genre: npGenre, accent: chosenAccent, seedData: null });
      }
    }

    overlay.addEventListener('mousedown', e => { if (e.target === overlay) finish(null); });
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); finish(null); } }
    document.addEventListener('keydown', onKey);
    renderForm();
  });
}

async function createProjectFlow() {
  const res = await newProjectModal();
  if (!res) return;
  // IMPORT: create the project row now (tile appears immediately) and build it
  // in the background so the modal can be dismissed without aborting, with
  // progress and cancel on the project tile.
  if (res.importFile) { await startBackgroundImportBuild(res); return; }
  await flushPersist();
  const proj = await createProjectRow(res.name, res.type, res.genre, res.accent);
  await seedProjectContent(proj.id, null);
  const projects = await fetchProjects();
  renderProjectSelector(projects, proj.id);
  await loadProject(proj.id);
  localStorage.setItem(activeKey(), proj.id);
  renderHeaderMeta();
  go('sections');
}

async function editProjectFlow(id) {
  const cur = projectsCache.find(p => p.id === id);
  if (!cur) return;
  const res = await projectSettingsModal({
    title: 'EDIT PROJECT', name: cur.name, type: cur.type || 'Book', genre: cur.genre || '', accent: cur.accent || '', okText: 'Save'
  });
  if (!res) return;
  await sb.from('projects').update({ name: res.name, type: res.type, genre: res.genre || null, accent: res.accent || null }).eq('id', id);
  const projects = await fetchProjects();
  renderProjectSelector(projects, activeProjectId);
  // Re-sync to the active project's accent (the modal may have live-previewed
  // another project's color while editing it).
  applyProjectAccent(projectsCache.find(p => p.id === activeProjectId)?.accent);
  if (currentRoute() === 'home') renderHome();
}

async function deleteProjectFlow(id) {
  if (!await confirmModal('Delete this project and ALL its content? This cannot be undone.')) return;
  await flushPersist();
  await sb.from('projects').delete().eq('id', id);
  let projects = await fetchProjects();
  if (!projects.length) {
    const proj = await createProjectRow('My Book');
    await seedProjectContent(proj.id, null);
    projects = await fetchProjects();
  }
  if (id === activeProjectId) {
    const next = projects[0];
    await loadProject(next.id);
    localStorage.setItem(activeKey(), next.id);
  }
  renderProjectSelector(projects, activeProjectId);
  renderHeaderMeta();
  if (currentRoute() === 'home') renderHome();
}

document.getElementById('projectSelect').addEventListener('change', e => openProject(e.target.value));

document.getElementById('suggestRefreshBtn').addEventListener('click', () => { suggestedChunks = null; fetchSuggestedChunks(); });

document.getElementById('signOutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
});

document.getElementById('communityRefreshBtn').addEventListener('click', renderCommunity);
document.getElementById('saveUsernameBtn').addEventListener('click', saveUsername);
document.getElementById('cancelUsernameBtn').addEventListener('click', closeUsernameEditor);
document.getElementById('editUsernameBtn').addEventListener('click', async () => {
  const ok = await confirmModal(
    'Changing your username will NOT update it on hops, comments, or posts you have already shared - those keep your current handle. New activity will use the new name. Continue?',
    { title: 'CHANGE USERNAME', okText: 'Change it', danger: false });
  if (ok) openUsernameEditor();
});
document.getElementById('manageFluffleBtn').addEventListener('click', manageFluffleModal);
document.getElementById('aiTier')?.addEventListener('click', e => {
  const opt = e.target.closest('.ai-tier-opt');
  if (opt) setAiTier(opt.dataset.tier);
});
document.getElementById('replayWelcomeBtn')?.addEventListener('click', () => { closeAccount(); showWelcomeModal(); });
document.getElementById('usernameInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); saveUsername(); }
  else if (e.key === 'Escape') { e.preventDefault(); closeUsernameEditor(); }
});

async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) showApp(session); else showAuth();
  sb.auth.onAuthStateChange((_evt, sess) => {
    if (sess) showApp(sess); else showAuth();
  });
}

/* ---------------- PRACTICE ---------------- */
// PRACTICE is a single writing game: spin for a word, write for 20 minutes
// without stopping, and the hop auto-files itself to the warren when the timer
// ends. Finished hops live in the global `practice_hops` table (per-user, not
// per-project), so they survive switching books and can be copied into a real
// project later via USE AS FOUNDATION.
let practiceHops = [];
let practiceLoaded = false;
let practiceSearch = '';
let practiceInited = false;

const PRACTICE_WORDS = [
  'THRESHOLD', 'SALT', 'DEBT', 'MIRROR', 'HUNGER', 'EMBER', 'TIDE', 'VOW',
  'RUST', 'HOLLOW', 'SIGNAL', 'FEVER', 'LEDGER', 'DRIFT', 'OMEN', 'STATIC',
  'MARROW', 'CINDER', 'FRACTURE', 'LANTERN', 'UNDERTOW', 'RELIC', 'PULSE',
  'VERGE', 'HUSK', 'TREMOR', 'RATION', 'RESIDUE', 'GLASS', 'ASH', 'ORBIT',
  'TETHER', 'SCAR', 'HALO', 'VAULT', 'CURFEW', 'SPLINTER', 'NECTAR', 'FALLOW',
  'BEACON', 'MONSOON', 'GRAVITY', 'KEROSENE', 'THORN',
];

// Short dictionary glosses shown once a word lands, for a spark of direction.
const PRACTICE_DEFS = {
  THRESHOLD: 'n. a doorway or sill; the point at which something begins or changes.',
  SALT: 'n. a crystalline mineral used to season and preserve; fig. wit or sting.',
  DEBT: 'n. something owed; a state of obligation to repay.',
  MIRROR: 'n. a reflective surface; v. to reflect or imitate.',
  HUNGER: 'n. a craving or urgent need — for food, or for anything.',
  EMBER: 'n. a small glowing piece of coal or wood in a dying fire.',
  TIDE: 'n. the rise and fall of the sea; a powerful current or trend.',
  VOW: 'n. a solemn promise or binding pledge.',
  RUST: 'n. the reddish coating iron forms in damp air; slow decay.',
  HOLLOW: 'adj. having an empty space inside; n. a small valley.',
  SIGNAL: 'n. a sign or impulse conveying information; v. to indicate.',
  FEVER: 'n. an abnormally high body temperature; intense excitement.',
  LEDGER: 'n. a book recording debits and credits; a running account.',
  DRIFT: 'v. to be carried slowly by a current; n. a gradual shift.',
  OMEN: 'n. a sign believed to foretell good or evil.',
  STATIC: 'adj. lacking movement; n. atmospheric noise or interference.',
  MARROW: 'n. the soft tissue inside bones; the essential core of a thing.',
  CINDER: 'n. a small piece of partly burned coal or wood.',
  FRACTURE: 'n. a break or crack; v. to break apart.',
  LANTERN: 'n. a portable case enclosing a light.',
  UNDERTOW: 'n. a current beneath the surface pulling away from shore.',
  RELIC: 'n. an object surviving from the past; a treasured remnant.',
  PULSE: 'n. the rhythmic beat of blood through the arteries; a throb.',
  VERGE: 'n. an edge or border; the brink of something.',
  HUSK: 'n. the dry outer covering of a seed; an empty shell.',
  TREMOR: 'n. an involuntary shaking; a small earthquake.',
  RATION: 'n. a fixed allowance; v. to limit the supply of.',
  RESIDUE: 'n. what remains after a process; a trace left behind.',
  GLASS: 'n. a hard, brittle, transparent substance; a vessel for drinking.',
  ASH: 'n. the powdery residue left after burning.',
  ORBIT: 'n. the curved path of one body around another; a sphere of influence.',
  TETHER: 'n. a rope fastening something; the limit of one\u2019s reach.',
  SCAR: 'n. a mark left by a healed wound; a lasting trace of harm.',
  HALO: 'n. a ring of light around a head or celestial body.',
  VAULT: 'n. an arched roof or secure chamber; v. to leap over.',
  CURFEW: 'n. a rule requiring people to stay indoors after a set hour.',
  SPLINTER: 'n. a thin, sharp fragment of wood; v. to break into pieces.',
  NECTAR: 'n. the sweet fluid of flowers; any delicious drink.',
  FALLOW: 'adj. (of land) plowed but left unsown; dormant, resting.',
  BEACON: 'n. a fire or light used as a signal or guide.',
  MONSOON: 'n. a seasonal wind bringing heavy rains.',
  GRAVITY: 'n. the force pulling bodies together; seriousness, weight.',
  KEROSENE: 'n. a thin, combustible oil used as fuel.',
  THORN: 'n. a sharp woody spine on a stem; a persistent source of pain.',
};

// Opening lines for the FIRST LINE game — original prompts to write onward from.
const PRACTICE_FIRST_LINES = [
  'The last train had already gone when she found the ticket was for yesterday.',
  'Nobody in the house would admit to turning off the lights.',
  'He had kept the letter sealed for three years, and tonight he finally opened it.',
  'They told us the road ended at the river, but the river had moved.',
  'The phone rang once at 3 a.m., and that was somehow worse than twice.',
  'My grandmother left me the house, the debts, and a key that fit nothing.',
  'On the morning the statues went missing, no one thought to look up.',
  'She practiced saying goodbye in the mirror until the word stopped meaning anything.',
  'The map was perfect except for the town that should not have been there.',
  'It was the kind of quiet that arrives only after something has been decided.',
  'He counted the exits first, the way his father had taught him.',
  'The garden had grown over the gate, sealing us in with whatever we had buried.',
  'We agreed never to speak of the third night, so of course it was all I thought about.',
  'The new neighbors moved in at midnight and unpacked nothing.',
  'There were forty-one names on the list, and mine had been crossed out and rewritten.',
  'The clock in the station had been stopped at 8:14 for as long as anyone remembered.',
  'She inherited her mother is fear of the ocean and her father is need to test it.',
  'The dog came home without the boy, and stood at the door, and waited.',
  'Every photograph in the album had the same stranger standing just behind us.',
  'I was three steps onto the bridge when it began to remember my weight.',
  'They handed me the uniform and told me the previous wearer had simply not come back.',
  'The town held one festival a year, and attendance was not optional.',
  'He woke to find the furniture rearranged and the front door locked from outside.',
  'The radio only worked after dark, and it only played warnings.',
];

const PRACTICE_TOTAL = 20 * 60;   // 20 minutes, in seconds
const PR_ROW_H = 64;              // reel row height, must match CSS .pr-reel-window/.pr-reel-row
const PR_SESSION_KEY = 'rh.practice.session.v1';

// ---- game state ----
let prGame = 'word';             // word | line | three — which practice game is active
let prState = 'idle';            // idle | spinning | armed | writing | done
let prWord = '';                 // word game: the spun word
let prPrompt = '';               // line/three games: the opening line or the three words joined
let prTitle = '';                // backlog title to file under
let prStartEpoch = 0;
let prTimerId = null;
let prLastFinished = null;       // last entry we saved, for READ THIS HOP

const prRand = a => a[Math.floor(Math.random() * a.length)];

// Per-user record of words the spinner has already surfaced, so a given user
// never gets the same spun word twice. Backed by localStorage (covers words
// that were rerolled away without writing) and seeded from already-filed hops.
function prSeenKey() { return 'rh_pr_seen_words_' + (currentUser ? currentUser.id : 'anon'); }
function prSeenStored() {
  try { return new Set(JSON.parse(localStorage.getItem(prSeenKey()) || '[]')); }
  catch (e) { return new Set(); }
}
function prSeenSet() {
  const set = prSeenStored();
  if (Array.isArray(practiceHops)) {
    for (const h of practiceHops) { if (h && h.word) set.add(h.word); }
  }
  return set;
}
function prMarkSeen(word) {
  if (!word) return;
  const set = prSeenStored();
  set.add(word);
  try { localStorage.setItem(prSeenKey(), JSON.stringify([...set])); } catch (e) {}
}
// Pick a word the user has not seen yet. Once the pool is exhausted, clear the
// stored set and start a fresh cycle so the spinner keeps working.
function prPickWord() {
  const seen = prSeenSet();
  let pool = PRACTICE_WORDS.filter(w => !seen.has(w));
  if (!pool.length) {
    try { localStorage.removeItem(prSeenKey()); } catch (e) {}
    pool = PRACTICE_WORDS.slice();
  }
  return prRand(pool);
}
function practiceWordCount(s) {
  const m = (s || '').trim().match(/\S+/g);
  return m ? m.length : 0;
}
function prMMSS(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function prFmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function prEl(id) { return document.getElementById(id); }
function prShowDef(word) {
  const el = prEl('prReelDef');
  if (!el) return;
  const def = PRACTICE_DEFS[word];
  if (!def) { el.hidden = true; return; }
  el.innerHTML = `<span class="pr-def-word">${esc(word.toLowerCase())}</span> <span class="pr-def-text">${esc(def)}</span>`;
  el.hidden = false;
}
function prHideDef() { const el = prEl('prReelDef'); if (el) el.hidden = true; }
function prSetState(s) {
  prState = s;
  const arena = prEl('prArena');
  if (arena) arena.dataset.pstate = s;
}

async function loadPracticeHops() {
  if (!currentUser) return;
  const { data, error } = await sb.from('practice_hops')
    .select('id, title, body, prompt, word, seconds, created_at, updated_at')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });
  if (!error) { practiceHops = data || []; practiceLoaded = true; }
}

function practiceInit() {
  if (practiceInited) return;
  practiceInited = true;
  prEl('prSpinBtn')?.addEventListener('click', () => prSpin());
  prEl('prReroll')?.addEventListener('click', () => prReroll());
  prEl('prLineBtn')?.addEventListener('click', () => prDrawLine());
  prEl('prLineReroll')?.addEventListener('click', () => prRerollLine());
  prEl('prThreeBtn')?.addEventListener('click', () => prDealThree());
  prEl('prThreeReroll')?.addEventListener('click', () => prRerollThree());
  prEl('prTabs')?.addEventListener('click', e => {
    const tab = e.target.closest('.pr-tab');
    if (tab) prSetGame(tab.dataset.game);
  });
  prEl('prEndBtn')?.addEventListener('click', () => prFinish(true));
  prEl('prAgainBtn')?.addEventListener('click', () => prReset());
  prEl('prReadBtn')?.addEventListener('click', () => {
    if (prLastFinished) {
      const hop = practiceHops.find(h => h.id === prLastFinished.id) || prLastFinished;
      prReset();
      prOpenEntry(hop.id);
    }
  });
  const ed = prEl('prEditor');
  ed?.addEventListener('input', prUpdateCounts);
  const si = prEl('prSearch');
  si?.addEventListener('input', () => { practiceSearch = si.value; renderPracticeList(); });
}

async function renderPractice() {
  practiceInit();
  if (!practiceLoaded) {
    prEl('prPlist').innerHTML = '<div class="pr-loading">Loading your backlog…</div>';
    await loadPracticeHops();
  }
  // Restore an in-progress session if the user left mid-write and came back.
  if (prState === 'idle') prTryResume();
  renderPracticeList();
}

// ---- the reel ----
// RE-SPIN abandons the current word; if the user has started writing, confirm
// first so a misclick can't wipe an in-progress session.
async function prReroll() {
  if (prState === 'spinning') return;
  if (prState === 'writing' && (prEl('prEditor')?.value || '').trim()) {
    const ok = await confirmModal('Re-spin a new word? This discards your current writing without saving.', { title: 'RE-SPIN' });
    if (!ok) return;
  }
  clearInterval(prTimerId);
  prTimerId = null;
  prClearSession();
  prSpin();
}

function prSpin() {
  if (prState === 'spinning') return;
  clearInterval(prTimerId);
  prTimerId = null;
  prSetState('spinning');
  const reel = prEl('prReel');
  const target = prPickWord();
  prMarkSeen(target);
  prEl('prReroll').hidden = true;
  prEl('prSpinBtn').disabled = true;
  prHideDef();
  // Build a tall strip of random words ending on the target.
  const seq = [];
  for (let i = 0; i < 30; i++) seq.push(prRand(PRACTICE_WORDS));
  seq.push(target);
  reel.style.transition = 'none';
  reel.style.transform = 'translateY(0)';
  reel.innerHTML = seq.map((w, i) =>
    `<div class="pr-reel-row${i === seq.length - 1 ? ' landed' : ''}">${esc(w)}</div>`
  ).join('');
  const dist = (seq.length - 1) * PR_ROW_H;
  requestAnimationFrame(() => {
    reel.style.transition = 'transform 2.9s cubic-bezier(.1,.62,.12,1)';
    reel.style.transform = `translateY(-${dist}px)`;
  });
  const onEnd = () => {
    reel.removeEventListener('transitionend', onEnd);
    prLand(target);
  };
  reel.addEventListener('transitionend', onEnd);
}

function prLand(word) {
  const reel = prEl('prReel');
  reel.style.transition = 'none';
  reel.style.transform = 'translateY(0)';
  reel.innerHTML = `<div class="pr-reel-row landed">${esc(word)}</div>`;
  prArm(word);
}

// Shared: arm the editor + timer once a game has produced its prompt. Each game
// supplies the editor heading and (optionally) text to seed the editor with.
function prBeginWriting({ kindHTML, note, seedText, caretAtEnd }) {
  prSetState('armed');
  const ed = prEl('prEditor');
  ed.disabled = false;
  ed.value = seedText || '';
  prEl('prEdKind').innerHTML = kindHTML;
  ed.placeholder = "Begin. Keep your hand moving — don't stop to think.";
  prEl('prEndBtn').disabled = false;
  const noteEl = prEl('prEdNote');
  if (noteEl) noteEl.textContent = note || 'Keep your hand moving. It auto-files when the timer ends.';
  prUpdateCounts();
  prRenderClock(PRACTICE_TOTAL, 'READY');
  prStartTimer();
  setTimeout(() => {
    ed.focus();
    if (caretAtEnd) { const n = ed.value.length; ed.setSelectionRange(n, n); }
  }, 80);
}

// ---- GAME 1: WORD SPIN ----
function prArm(word) {
  prWord = word;
  prPrompt = '';
  prTitle = word;
  prShowDef(word);
  prEl('prReroll').hidden = false;
  prEl('prSpinBtn').disabled = true;
  prBeginWriting({
    kindHTML: `PRACTICE HOP <span class="pr-muted">· write about</span> "${esc(word)}"`,
  });
}

// ---- GAME 2: FIRST LINE ----
async function prRerollLine() {
  if (prState === 'writing' && (prEl('prEditor')?.value || '').trim()) {
    const ok = await confirmModal('Draw a new opening line? This discards your current writing without saving.', { title: 'DRAW ANOTHER' });
    if (!ok) return;
  }
  clearInterval(prTimerId); prTimerId = null; prClearSession();
  prDrawLine();
}
function prDrawLine() {
  if (prState === 'spinning') return;
  clearInterval(prTimerId); prTimerId = null;
  const line = prRand(PRACTICE_FIRST_LINES);
  const card = prEl('prLineCard');
  if (card) { card.textContent = '“' + line + '”'; card.classList.remove('empty'); }
  prEl('prLineBtn').disabled = true;
  prEl('prLineReroll').hidden = false;
  prWord = '';
  prPrompt = line;
  prTitle = prTitleFromLine(line);
  prBeginWriting({
    kindHTML: `FIRST LINE <span class="pr-muted">· carry it forward</span>`,
    note: 'Continue straight from the line. It auto-files when the timer ends.',
    seedText: line + ' ',
    caretAtEnd: true,
  });
}
function prTitleFromLine(line) {
  const words = line.replace(/[“”"]/g, '').trim().split(/\s+/).slice(0, 6).join(' ');
  return words + (line.split(/\s+/).length > 6 ? '…' : '');
}

// ---- GAME 3: THREE WORDS ----
async function prRerollThree() {
  if (prState === 'writing' && (prEl('prEditor')?.value || '').trim()) {
    const ok = await confirmModal('Deal three new words? This discards your current writing without saving.', { title: 'RE-DEAL' });
    if (!ok) return;
  }
  clearInterval(prTimerId); prTimerId = null; prClearSession();
  prDealThree();
}
function prDealThree() {
  if (prState === 'spinning') return;
  clearInterval(prTimerId); prTimerId = null;
  // Three distinct words.
  const pool = PRACTICE_WORDS.slice();
  const picks = [];
  while (picks.length < 3 && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(i, 1)[0]);
  }
  const wrap = prEl('prThreeWrap');
  if (wrap) wrap.innerHTML = picks.map(w => `<span class="pr-threechip">${esc(w)}</span>`).join('');
  prEl('prThreeBtn').disabled = true;
  prEl('prThreeReroll').hidden = false;
  prWord = '';
  prPrompt = picks.join(' · ');
  prTitle = picks.join(' · ');
  prBeginWriting({
    kindHTML: `THREE WORDS <span class="pr-muted">· work all three in</span>`,
    note: 'Weave in all three. It auto-files when the timer ends.',
  });
}

// Switch games from the tab bar. Mid-write with text → confirm a discard first.
async function prSetGame(game) {
  if (!game || game === prGame) return;
  if (prState === 'spinning') return;   // let an in-flight spin land first
  if ((prState === 'writing' || prState === 'armed') && (prEl('prEditor')?.value || '').trim()) {
    const ok = await confirmModal('Switch games? This discards your current writing without saving.', { title: 'SWITCH GAME' });
    if (!ok) return;
  }
  prGame = game;
  const arena = prEl('prArena');
  if (arena) arena.dataset.pgame = game;
  prEl('prTabs')?.querySelectorAll('.pr-tab').forEach(t => t.classList.toggle('active', t.dataset.game === game));
  prReset();
}

// ---- the timer ----
function prStartTimer(resumeEpoch) {
  prSetState('writing');
  prStartEpoch = resumeEpoch || Date.now();
  prSaveSession();
  clearInterval(prTimerId);
  prTimerId = setInterval(prTick, 250);
  prTick();
}

function prRemaining() {
  return Math.max(0, PRACTICE_TOTAL - Math.floor((Date.now() - prStartEpoch) / 1000));
}

function prRenderClock(r, lbl) {
  const clock = prEl('prClock');
  if (clock) clock.textContent = prMMSS(r);
  const lblEl = prEl('prClockLbl');
  if (lblEl) lblEl.textContent = lbl;
  const frac = r / PRACTICE_TOTAL;
  const C = 2 * Math.PI * 74;
  const prog = prEl('prProg');
  if (prog) {
    prog.style.strokeDasharray = String(C);
    prog.style.strokeDashoffset = String(C * (1 - frac));
  }
  const fill = prEl('prEdFill');
  if (fill) fill.style.width = ((1 - frac) * 100) + '%';
  prEl('prDial')?.classList.toggle('warn', prState === 'writing' && r <= 60 && r > 0);
}

function prTick() {
  const r = prRemaining();
  prRenderClock(r, 'WRITING');
  if (r <= 0) { prFinish(false); return; }
  if (r % 5 === 0) prSaveSession();
}

function prUpdateCounts() {
  const t = prEl('prEditor')?.value || '';
  prEl('prWc').textContent = practiceWordCount(t);
  prEl('prCc').textContent = t.length;
}

// ---- finishing & saving ----
async function prFinish(early) {
  if (prState !== 'writing') return;
  clearInterval(prTimerId);
  prTimerId = null;
  const text = (prEl('prEditor').value || '').trim();
  const elapsed = early ? Math.min(PRACTICE_TOTAL, PRACTICE_TOTAL - prRemaining()) : PRACTICE_TOTAL;
  // Resolve what to file under, per game.
  const saveWord = prGame === 'word' ? prWord : null;
  const savePrompt = prGame === 'word' ? null : prPrompt;
  const saveTitle = prTitle || prWord || 'Practice hop';
  prSetState('done');
  prRenderClock(0, 'DONE');
  if (!early) prBuzz();   // only the natural timer end gets the flash + buzzer
  prClearSession();

  const words = practiceWordCount(text);
  const seed = prGame === 'word' ? `on <b>${esc(saveWord)}</b>`
    : prGame === 'line' ? 'from your opening line'
    : `weaving <b>${esc(savePrompt)}</b>`;
  prEl('prDoneSum').innerHTML =
    `<b>${words}</b> ${words === 1 ? 'word' : 'words'} ${seed} in ${prMMSS(elapsed)}. Filed to your backlog below.`;
  const again = prEl('prAgainBtn');
  if (again) again.textContent = prGame === 'word' ? 'SPIN AGAIN' : prGame === 'line' ? 'NEW LINE' : 'DEAL AGAIN';

  // Persist to Supabase; optimistic local prepend so the backlog updates instantly.
  const nowIso = new Date().toISOString();
  const optimistic = {
    id: 'local-' + Date.now(), user_id: currentUser?.id,
    title: saveTitle, body: text, prompt: savePrompt, word: saveWord, seconds: elapsed,
    created_at: nowIso, updated_at: nowIso,
  };
  practiceHops.unshift(optimistic);
  prLastFinished = optimistic;
  renderPracticeList();
  try {
    const { data, error } = await sb.from('practice_hops').insert({
      user_id: currentUser.id, title: saveTitle, body: text,
      prompt: savePrompt, word: saveWord, seconds: elapsed,
    }).select().single();
    if (error) throw error;
    const i = practiceHops.findIndex(h => h.id === optimistic.id);
    if (i >= 0) practiceHops[i] = data;
    prLastFinished = data;
    recordWritingActivity();
    renderPracticeList();
  } catch (e) {
    // Leave the optimistic copy in place but flag the failure.
    alertModal('Saved locally, but the warren did not confirm: ' + (e.message || 'request failed'), { title: 'PRACTICE' });
  }
}

// Reset every game's starter pane back to its idle prompt-less state.
function prResetStarters() {
  // word
  prHideDef();
  prEl('prReroll').hidden = true;
  const spin = prEl('prSpinBtn');
  if (spin) { spin.disabled = false; spin.hidden = false; }
  const reel = prEl('prReel');
  if (reel) {
    reel.style.transition = 'none';
    reel.style.transform = 'translateY(0)';
    reel.innerHTML = '<div class="pr-reel-row idle">SPIN TO BEGIN</div>';
  }
  // line
  prEl('prLineReroll').hidden = true;
  const lb = prEl('prLineBtn'); if (lb) lb.disabled = false;
  const card = prEl('prLineCard');
  if (card) { card.textContent = 'Draw a line, then keep writing from it.'; card.classList.add('empty'); }
  // three
  prEl('prThreeReroll').hidden = true;
  const tb = prEl('prThreeBtn'); if (tb) tb.disabled = false;
  const wrap = prEl('prThreeWrap');
  if (wrap) wrap.innerHTML = '<span class="pr-threechip empty">—</span><span class="pr-threechip empty">—</span><span class="pr-threechip empty">—</span>';
}

function prReset() {
  clearInterval(prTimerId);
  prTimerId = null;
  prWord = '';
  prPrompt = '';
  prTitle = '';
  prStartEpoch = 0;
  prSetState('idle');
  prClearSession();
  prResetStarters();
  const ed = prEl('prEditor');
  ed.value = ''; ed.disabled = true;
  ed.placeholder = prGame === 'word' ? 'Spin a word to begin.'
    : prGame === 'line' ? 'Draw a line to begin.' : 'Deal three words to begin.';
  prEl('prEdKind').textContent = 'PRACTICE HOP';
  prEl('prEndBtn').disabled = true;
  const note = prEl('prEdNote');
  if (note) note.textContent = 'Start your twenty minutes above.';
  prUpdateCounts();
  prRenderClock(PRACTICE_TOTAL, 'READY');
}

// ---- buzzer ----
function prBuzz() {
  const buzz = prEl('prBuzz');
  if (buzz) {
    buzz.classList.add('go');
    setTimeout(() => buzz.classList.remove('go'), 1500);
  }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.22, 0.44].forEach(off => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 320;
      o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + off;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.start(t); o.stop(t + 0.18);
    });
  } catch (_) {}
}

// ---- session persistence (survives a full page reload) ----
function prSaveSession() {
  if (prState !== 'writing') return;
  try {
    localStorage.setItem(PR_SESSION_KEY, JSON.stringify({
      game: prGame, word: prWord, prompt: prPrompt, title: prTitle,
      startEpoch: prStartEpoch, text: prEl('prEditor')?.value || '',
    }));
  } catch (_) {}
}
function prClearSession() {
  try { localStorage.removeItem(PR_SESSION_KEY); } catch (_) {}
}
function prTryResume() {
  let raw = null;
  try { raw = localStorage.getItem(PR_SESSION_KEY); } catch (_) {}
  if (!raw) return;
  let s; try { s = JSON.parse(raw); } catch (_) { return; }
  if (!s || !s.startEpoch) { prClearSession(); return; }
  const game = s.game || 'word';
  // A resumable session may belong to any game — only word-game sessions need a word.
  if (game === 'word' && !s.word) { prClearSession(); return; }
  prGame = game;
  prWord = s.word || '';
  prPrompt = s.prompt || '';
  prTitle = s.title || '';
  const arena = prEl('prArena');
  if (arena) arena.dataset.pgame = game;
  prEl('prTabs')?.querySelectorAll('.pr-tab').forEach(t => t.classList.toggle('active', t.dataset.game === game));

  let kindHTML = 'PRACTICE HOP';
  if (game === 'word') {
    prShowDef(s.word);
    prEl('prReroll').hidden = false;
    prEl('prSpinBtn').disabled = true;
    const reel = prEl('prReel');
    reel.style.transition = 'none'; reel.style.transform = 'translateY(0)';
    reel.innerHTML = `<div class="pr-reel-row landed">${esc(s.word)}</div>`;
    kindHTML = `PRACTICE HOP <span class="pr-muted">· write about</span> "${esc(s.word)}"`;
  } else if (game === 'line') {
    prEl('prLineReroll').hidden = false;
    prEl('prLineBtn').disabled = true;
    const card = prEl('prLineCard');
    if (card) { card.textContent = '“' + (s.prompt || '') + '”'; card.classList.remove('empty'); }
    kindHTML = `FIRST LINE <span class="pr-muted">· carry it forward</span>`;
  } else {
    prEl('prThreeReroll').hidden = false;
    prEl('prThreeBtn').disabled = true;
    const wrap = prEl('prThreeWrap');
    if (wrap) wrap.innerHTML = (s.prompt || '').split(' · ').map(w => `<span class="pr-threechip">${esc(w)}</span>`).join('');
    kindHTML = `THREE WORDS <span class="pr-muted">· work all three in</span>`;
  }
  const ed = prEl('prEditor');
  ed.disabled = false;
  ed.value = s.text || '';
  prEl('prEdKind').innerHTML = kindHTML;
  prEl('prEndBtn').disabled = false;
  prUpdateCounts();
  const elapsed = Math.floor((Date.now() - s.startEpoch) / 1000);
  if (elapsed >= PRACTICE_TOTAL) {
    // Timer expired while away — finalize immediately.
    prSetState('writing');
    prStartEpoch = s.startEpoch;
    prFinish(false);
  } else {
    prStartTimer(s.startEpoch);
  }
}

// ---- backlog ----
function renderPracticeList() {
  const list = prEl('prPlist');
  const empty = prEl('prNoResults');
  const count = prEl('prBlCount');
  if (!list) return;
  if (count) count.textContent = practiceHops.length ? `${practiceHops.length} ${practiceHops.length === 1 ? 'hop' : 'hops'}` : '';
  const q = practiceSearch.trim().toLowerCase();
  const hops = q
    ? practiceHops.filter(h =>
        (h.word || '').toLowerCase().includes(q) ||
        (h.body || '').toLowerCase().includes(q) ||
        (h.title || '').toLowerCase().includes(q))
    : practiceHops;
  if (!practiceHops.length) {
    list.innerHTML = '<div class="pr-blempty">No hops yet. Spin a word and write your first.</div>';
    if (empty) empty.hidden = true;
    return;
  }
  if (!hops.length) {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  list.innerHTML = hops.map(prEntryHTML).join('');
  list.querySelectorAll('.pr-pentry').forEach(entry => {
    const id = entry.dataset.id;
    entry.querySelector('.pr-pe-toggle')?.addEventListener('click', () => prToggleEntry(id));
    entry.querySelector('[data-act="foundation"]')?.addEventListener('click', e => {
      e.stopPropagation();
      const hop = practiceHops.find(h => h.id === id);
      if (hop) practiceUseAsFoundation(hop);
    });
    entry.querySelector('[data-act="delete"]')?.addEventListener('click', e => {
      e.stopPropagation();
      const hop = practiceHops.find(h => h.id === id);
      if (hop) practiceDeleteHop(hop);
    });
  });
}

function prEntryHTML(h) {
  const text = (h.body || '');
  const words = practiceWordCount(text);
  const heading = h.word || h.title || 'UNTITLED';
  // Word-game hops show the word as the heading; line/three games carry their
  // prompt separately, so surface it as a sub-line.
  const prompt = (!h.word && h.prompt) ? h.prompt : '';
  const durBit = h.seconds ? `<span class="pr-dot"></span><span>${esc(prMMSS(h.seconds))}</span>` : '';
  // Roughly two lines worth of text — only longer hops need the clamp + toggle.
  const needsClamp = text.replace(/\s+/g, ' ').trim().length > 140;
  return `
    <article class="pr-pentry" data-id="${esc(h.id)}">
      <div class="pr-pe-word">${esc(heading)}</div>
      ${prompt ? `<div class="pr-pe-prompt">${esc(prompt)}</div>` : ''}
      <div class="pr-pe-meta">
        <span>${esc(prFmtDate(h.created_at))}</span>
        ${durBit}
        <span class="pr-dot"></span><span>${words} ${words === 1 ? 'word' : 'words'}</span>
      </div>
      <div class="pr-pe-text${needsClamp ? ' clamp' : ''}">${esc(text)}</div>
      <div class="pr-pe-actions">
        ${needsClamp ? '<button class="pr-pe-toggle" type="button">READ FULL HOP →</button>' : ''}
        <button class="pr-pe-mini" data-act="foundation" type="button" title="Copy into a project as a starting point">USE AS FOUNDATION</button>
        <button class="pr-pe-mini danger" data-act="delete" type="button">DELETE</button>
      </div>
    </article>`;
}

function prToggleEntry(id) {
  const entry = prEl('prPlist')?.querySelector(`.pr-pentry[data-id="${CSS.escape(id)}"]`);
  if (!entry) return;
  const open = entry.classList.toggle('open');
  const toggle = entry.querySelector('.pr-pe-toggle');
  if (toggle) toggle.textContent = open ? 'COLLAPSE ↑' : 'READ FULL HOP →';
}
function prOpenEntry(id) {
  const entry = prEl('prPlist')?.querySelector(`.pr-pentry[data-id="${CSS.escape(id)}"]`);
  if (!entry || entry.classList.contains('open')) { if (entry) entry.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  prToggleEntry(id);
  entry.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function practiceDeleteHop(hop) {
  const ok = await confirmModal('Delete this practice hop? This cannot be undone.', { title: 'DELETE PRACTICE HOP' });
  if (!ok) return;
  if (!String(hop.id).startsWith('local-')) {
    const { error } = await sb.from('practice_hops').delete().eq('id', hop.id);
    if (error) { alertModal('Could not delete: ' + error.message, { title: 'PRACTICE' }); return; }
  }
  practiceHops = practiceHops.filter(h => h.id !== hop.id);
  renderPracticeList();
}

// Freeform practice hop: no game, no timer — just a title (optional) and the
// writing. Reachable from the + PRACTICE HOP header button on the practice view.
function addPracticeHopFlow() {
  if (!currentUser) return;
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  const durOpts = [0, 10, 20, 30, 40, 50, 60];
  const durBtns = durOpts.map(m =>
    `<button class="pr-ff-dur${m === 0 ? ' active' : ''}" data-mins="${m}">${m === 0 ? 'OFF' : m + 'm'}</button>`
  ).join('');
  overlay.innerHTML = `
    <div class="ui-modal pr-freeform" role="dialog" aria-modal="true">
      <button class="ui-modal-x" data-act="close" aria-label="Close">✕</button>
      <div class="ui-modal-title">ADD PRACTICE HOP</div>
      <div class="ui-modal-msg">A freeform hop. Give it a title if you like, then write.</div>
      <input type="text" class="pr-ff-title" id="prFfTitle" placeholder="Title (optional)" maxlength="120" autocomplete="off" />
      <div class="pr-ff-timer">
        <span class="pr-ff-timer-lbl">TIMER</span>
        <div class="pr-ff-durs" id="prFfDurs">${durBtns}</div>
        <span class="pr-ff-clock" id="prFfClock" hidden>00:00</span>
      </div>
      <textarea class="pr-ff-body" id="prFfBody" placeholder="Write your hop…" spellcheck="true"></textarea>
      <div class="pr-ff-counts"><b id="prFfWc">0</b> words</div>
      <div class="ui-modal-actions">
        <button class="ui-modal-btn" data-act="cancel">Cancel</button>
        <button class="ui-modal-btn solid" data-act="save">Save hop</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const titleEl = overlay.querySelector('#prFfTitle');
  const bodyEl = overlay.querySelector('#prFfBody');
  const wcEl = overlay.querySelector('#prFfWc');
  const dursEl = overlay.querySelector('#prFfDurs');
  const clockEl = overlay.querySelector('#prFfClock');
  const saveBtn = overlay.querySelector('[data-act="save"]');

  let mins = 0;          // selected duration; 0 = OFF
  let running = false;   // countdown active
  let tick = null;       // interval handle
  let endEpoch = 0;      // ms timestamp when timer hits 0
  let startEpoch = 0;    // ms when the run began

  const clearTick = () => { if (tick) { clearInterval(tick); tick = null; } };
  const close = () => { clearTick(); document.removeEventListener('keydown', onKey); overlay.remove(); };
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="close"]').addEventListener('click', close);
  overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
  bodyEl.addEventListener('input', () => { wcEl.textContent = practiceWordCount(bodyEl.value); });

  // Pick a duration (only before a run has started).
  dursEl.addEventListener('click', e => {
    if (running) return;
    const btn = e.target.closest('.pr-ff-dur');
    if (!btn) return;
    mins = parseInt(btn.dataset.mins, 10) || 0;
    dursEl.querySelectorAll('.pr-ff-dur').forEach(b => b.classList.toggle('active', b === btn));
    saveBtn.textContent = mins > 0 ? 'Start' : 'Save hop';
  });

  function paintClock(remainMs) {
    const s = Math.max(0, Math.round(remainMs / 1000));
    clockEl.textContent = prMMSS(s);
  }

  function startTimer() {
    running = true;
    startEpoch = Date.now();
    endEpoch = startEpoch + mins * 60000;
    dursEl.classList.add('locked');
    clockEl.hidden = false;
    paintClock(endEpoch - startEpoch);
    saveBtn.textContent = 'Save now';
    bodyEl.focus();
    tick = setInterval(() => {
      const left = endEpoch - Date.now();
      paintClock(left);
      if (left <= 0) { clearTick(); commitHop(true); }
    }, 250);
  }

  async function commitHop(fromTimer) {
    const body = (bodyEl.value || '').trim();
    if (!body) {
      if (fromTimer) { running = false; clockEl.hidden = true; dursEl.classList.remove('locked'); saveBtn.textContent = mins > 0 ? 'Start' : 'Save hop'; }
      bodyEl.focus();
      return;
    }
    const title = (titleEl.value || '').trim() || 'Freeform hop';
    const seconds = running ? Math.max(0, Math.round((Date.now() - startEpoch) / 1000)) : 0;
    clearTick();
    close();
    if (!practiceLoaded) await loadPracticeHops();
    const nowIso = new Date().toISOString();
    const optimistic = {
      id: 'local-' + Date.now(), user_id: currentUser.id,
      title, body, prompt: null, word: null, seconds,
      created_at: nowIso, updated_at: nowIso,
    };
    practiceHops.unshift(optimistic);
    renderPracticeList();
    try {
      const { data, error } = await sb.from('practice_hops').insert({
        user_id: currentUser.id, title, body, prompt: null, word: null, seconds,
      }).select().single();
      if (error) throw error;
      const i = practiceHops.findIndex(h => h.id === optimistic.id);
      if (i >= 0) practiceHops[i] = data;
      recordWritingActivity();
      renderPracticeList();
    } catch (e) {
      alertModal('Saved locally, but the warren did not confirm: ' + (e.message || 'request failed'), { title: 'PRACTICE' });
    }
  }

  saveBtn.addEventListener('click', () => {
    if (mins > 0 && !running) { startTimer(); return; }
    commitHop(false);
  });
  setTimeout(() => bodyEl.focus(), 60);
}

// Copy a practice hop into a real project as a new hop, then open it in the
// section editor so it can grow into something structured.
function practiceUseAsFoundation(hop) {
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  const projects = projectsCache.filter(p => !uploadJobs.has(p.id));
  const projectBtns = projects.map(p =>
    `<button class="practice-proj-btn" data-id="${esc(p.id)}">${esc(p.name)}${p.id === activeProjectId ? ' <span class="practice-proj-cur">· open</span>' : ''}</button>`
  ).join('');
  overlay.innerHTML = `
    <div class="ui-modal practice-foundation" role="dialog" aria-modal="true">
      <button class="ui-modal-x" data-act="close" aria-label="Close">✕</button>
      <div class="ui-modal-title">USE AS FOUNDATION</div>
      <div class="ui-modal-msg">Copy "${esc(hop.title || 'this practice hop')}" into a project as a new hop you can build on.</div>
      <div class="practice-proj-list">${projectBtns || '<div class="practice-proj-empty">No projects yet.</div>'}</div>
      <div class="ui-modal-actions">
        <button class="ui-modal-btn" data-act="new">+ New project…</button>
        <button class="ui-modal-btn" data-act="cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { document.removeEventListener('keydown', onKey); overlay.remove(); };
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="close"]').addEventListener('click', close);
  overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
  overlay.querySelectorAll('.practice-proj-btn').forEach(btn => {
    btn.addEventListener('click', async () => { close(); await practiceCopyInto(hop, btn.dataset.id, false); });
  });
  overlay.querySelector('[data-act="new"]').addEventListener('click', async () => {
    const name = await promptModal('Name your new project', hop.title || 'Untitled', { title: 'NEW PROJECT', okText: 'Create' });
    if (name === null) return;
    close();
    await practiceCopyInto(hop, null, true, (name || '').trim() || 'Untitled');
  });
}

async function practiceCopyInto(hop, projectId, isNew, newName) {
  try {
    if (isNew) {
      const proj = await createProjectRow(newName || hop.title || 'Untitled');
      await seedProjectContent(proj.id, null);   // sets db + activeProjectId to the new project
      await fetchProjects();
      applyProjectAccent(proj.accent);
      localStorage.setItem(activeKey(), proj.id);
      renderHeaderMeta();
    } else if (projectId !== activeProjectId) {
      const proj = projectsCache.find(p => p.id === projectId);
      if (proj) applyProjectAccent(proj.accent);
      showProjectLoading(proj && proj.name);
      try {
        await flushPersist();
        await loadProject(projectId);
        localStorage.setItem(activeKey(), projectId);
        renderHeaderMeta();
      } finally { hideProjectLoading(); }
    }
    if (!db.chapters.length) {
      db.chapters.push({ id: uid(), title: 'Chapter 1', order: 0, color: CHAPTER_PALETTE[0] });
      db.ui.activeChapter = db.chapters[0].id;
    }
    const chap = db.chapters.find(x => x.id === db.ui.activeChapter) || db.chapters[0];
    const id = uid();
    db.chunks.push({
      id, chapterId: chap.id,
      title: hop.title || 'Practice draft', body: hop.body || '',
      orderInChapter: chunksOf(chap.id).length,
      narrativeOrder: db.chunks.length,
      chronoOrder: db.chunks.length,
      chronoLabel: '',
      characterIds: [], locationIds: [], tagIds: [],
    });
    save();
    go('sections');
    openChunkModal(id);
  } catch (e) {
    alertModal('Could not copy into a project: ' + (e.message || 'request failed'), { title: 'PRACTICE' });
  }
}

/* ---------------- AI SIDECAR ---------------- */
const aiSidecar = document.getElementById('aiSidecar');
const aiOverlay = document.getElementById('aiOverlay');
const aiLog     = document.getElementById('aiLog');
const aiInput   = document.getElementById('aiInput');
const aiForm    = document.getElementById('aiForm');
const aiSendBtn = document.getElementById('aiSend');
const aiToggle  = document.getElementById('aiToggle');
let aiMessages = [];
let aiBusy = false;

/* Apply the iOS safe-area insets to the AI panel's header and input row.
   env() resolves correctly on the full-width .app-header but to 0 inside the
   fixed, transformed .ai-sidecar, so we read the header's resolved top inset
   (and a full-width bottom probe) and set concrete px padding inline. In mobile
   Safari both insets are 0, so nothing changes there. */
function syncSafeAreaVars() {
  const header = document.querySelector('.app-header');
  const topPx = header ? parseFloat(getComputedStyle(header).paddingTop) || 0 : 0;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px);';
  document.body.appendChild(probe);
  const botPx = parseFloat(getComputedStyle(probe).paddingBottom) || 0;
  probe.remove();
  document.documentElement.style.setProperty('--rh-safe-top', topPx + 'px');
  document.documentElement.style.setProperty('--rh-safe-bottom', botPx + 'px');
}

/* Pin the AI panel to the *visual* viewport. A full-height fixed panel
   (top:0/bottom:0) is sized to the layout viewport, so when the keyboard
   opens iOS scrolls the whole webview up and the header slides under the
   status bar. Tracking visualViewport keeps the panel exactly as tall as the
   visible area and pinned to its top, so the header always clears the notch
   and the input row stays above the keyboard. No-op on desktop/mobile Safari
   where offsetTop is 0 and height equals the window. */
/* With the page scroll locked (see openAI), the panel stays pinned at top:0
   below the notch. All we do here is lift the panel's bottom edge above the
   on-screen keyboard so the input row stays visible. keyboardHeight is the
   slice of the layout viewport the keyboard now covers. 0 on desktop/mobile
   Safari and whenever no keyboard is up, so the panel is full height. */
function sizeAISidecar() {
  const vv = window.visualViewport;
  if (!vv || !aiSidecar) return;
  const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  aiSidecar.style.bottom = kb + 'px';
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', sizeAISidecar);
  window.visualViewport.addEventListener('scroll', sizeAISidecar);
}

/* In the Capacitor iOS app the WebView is set to resize:"none", so the keyboard
   overlays the page and visualViewport doesn't report its height. The Keyboard
   plugin's own events give the exact keyboard height — lift the panel's bottom
   to it so the input row bounces up and stays visible above the keypad. The
   header stays pinned (top:0) and the scrollable .ai-log body compresses. */
(function wireAIKeyboard() {
  const KB = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Keyboard;
  if (!KB) return;
  KB.addListener('keyboardWillShow', (info) => {
    if (aiSidecar) aiSidecar.style.bottom = (info && info.keyboardHeight ? info.keyboardHeight : 0) + 'px';
  });
  KB.addListener('keyboardWillHide', () => {
    if (aiSidecar) aiSidecar.style.bottom = '';
  });
})();
window.addEventListener('resize', syncSafeAreaVars);
window.addEventListener('orientationchange', syncSafeAreaVars);
syncSafeAreaVars();

let _aiScrollY = 0;
function openAI() {
  /* Lock the page scroll. Otherwise, when the keyboard opens iOS scrolls the
     whole webview up to reveal the focused input, dragging the fixed panel's
     header under the status bar. Pinning the body keeps everything still so the
     header holds its place and we only lift the panel bottom (sizeAISidecar). */
  _aiScrollY = window.scrollY || window.pageYOffset || 0;
  document.body.style.position = 'fixed';
  document.body.style.top = (-_aiScrollY) + 'px';
  document.body.style.left = '0';
  document.body.style.right = '0';
  aiOverlay.hidden = false; aiSidecar.hidden = false;
  syncSafeAreaVars();
  sizeAISidecar();
  requestAnimationFrame(() => { aiSidecar.classList.add('open'); aiOverlay.classList.add('show'); });
  aiToggle.classList.add('active');
  /* No auto-focus: focusing the input here pops the keyboard right after the
     slide finishes, which jerks the panel upward. Let the user tap to type. */
}
function closeAI() {
  aiSidecar.classList.remove('open'); aiOverlay.classList.remove('show');
  aiToggle.classList.remove('active');
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  window.scrollTo(0, _aiScrollY);
  setTimeout(() => {
    aiSidecar.hidden = true; aiOverlay.hidden = true;
    aiSidecar.style.top = ''; aiSidecar.style.height = ''; aiSidecar.style.bottom = '';
  }, 220);
}
function toggleAI() { aiSidecar.classList.contains('open') ? closeAI() : openAI(); }

function renderAILog() {
  if (!aiMessages.length) {
    aiLog.innerHTML = `<div class="ai-empty">Ask about your story — plot holes, character arcs,<br>continuity, pacing, or what to write next.</div>`;
    return;
  }
  aiLog.innerHTML = aiMessages.map(m => `
    <div class="ai-msg ${m.role}${m.pending ? ' pending' : ''}">
      <span class="who">${m.role === 'user' ? 'you' : 'assistant'}</span>
      <div class="bubble">${esc(m.content)}</div>
    </div>`).join('');
  aiLog.scrollTop = aiLog.scrollHeight;
}

// Lightweight grounding so the model knows the current book.
function aiContext() {
  const proj = projectsCache.find(p => p.id === activeProjectId);
  return {
    project: proj ? proj.name : null,
    type: proj ? (proj.type || '') : '',
    genre: proj ? (proj.genre || '') : '',
    chapters: db.chapters.map(c => c.title),
    characters: db.characters.map(c => ({ name: c.name, summary: c.summary || '' })),
  };
}

async function sendAI(text) {
  text = (text || '').trim();
  if (aiBusy || !text) return;
  aiBusy = true; aiSendBtn.disabled = true;
  aiMessages.push({ role: 'user', content: text });
  aiMessages.push({ role: 'assistant', content: 'thinking…', pending: true });
  renderAILog();
  try {
    const payload = aiMessages.filter(m => !m.pending && !m.error).map(m => ({ role: m.role, content: m.content }));
    const data = await aiInvoke({ messages: payload, context: aiContext() });
    aiMessages = aiMessages.filter(m => !m.pending);
    aiMessages.push({ role: 'assistant', content: data.reply || 'No response.' });
  } catch (e) {
    aiMessages = aiMessages.filter(m => !m.pending);
    aiMessages.push({ role: 'assistant', content: 'Error: ' + (e.message || 'request failed'), error: true });
  } finally {
    aiBusy = false; aiSendBtn.disabled = false;
    renderAILog();
  }
}

aiToggle.addEventListener('click', toggleAI);

/* Tap the message body to dismiss the keyboard while keeping the panel open.
   With resize:"none" the keypad won't collapse on its own; blurring the input
   on a tap in the log area gives an easy way to put it away. (Tapping the
   overlay scrim closes the whole panel via its own handler below.) */
if (aiLog) aiLog.addEventListener('click', () => { if (document.activeElement === aiInput) aiInput.blur(); });

/* ---------------- ACCOUNT MENU ---------------- */
const profileBtn = document.getElementById('profileBtn');
const accountMenu = document.getElementById('accountMenu');
function openAccount() {
  closeUsernameEditor();
  accountMenu.hidden = false;
  profileBtn.classList.add('active');
  profileBtn.setAttribute('aria-expanded', 'true');
}
function closeAccount() {
  accountMenu.hidden = true;
  profileBtn.classList.remove('active');
  profileBtn.setAttribute('aria-expanded', 'false');
}
profileBtn.addEventListener('click', e => {
  e.stopPropagation();
  accountMenu.hidden ? openAccount() : closeAccount();
});
document.addEventListener('click', e => {
  if (!accountMenu.hidden && !accountMenu.contains(e.target) && e.target !== profileBtn) closeAccount();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !accountMenu.hidden) closeAccount(); });

/* ---------------- NOTIFICATIONS ---------------- */
// Derived client-side from community activity: anyone in your Fluffle posting,
// and anyone liking or commenting on your posts. Unread = newer than the
// profiles.notifications_seen_at watermark, which is bumped when the panel opens.
const NOTIF_ICON = {
  like: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 20.5S3.5 15 3.5 9.2A4.2 4.2 0 0 1 12 7.4 4.2 4.2 0 0 1 20.5 9.2C20.5 15 12 20.5 12 20.5Z"/></svg>',
  comment: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2z"/></svg>',
  post: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="15" rx="2"/><line x1="12" y1="9" x2="12" y2="15"/><line x1="9" y1="12" x2="15" y2="12"/></svg>',
};
let notifItems = [];
let panelSeenAt = null;

const notifBtn = document.getElementById('notifBtn');
const notifPanel = document.getElementById('notifPanel');

function notifSeenAt() { return (currentProfile && currentProfile.notifications_seen_at) || null; }
function notifUnreadCount() {
  const seen = notifSeenAt();
  const t = seen ? new Date(seen).getTime() : 0;
  return notifItems.filter(n => new Date(n.ts).getTime() > t).length;
}
function updateNotifBadge() {
  const badge = document.getElementById('notifBadge');
  if (!badge) return;
  const n = notifUnreadCount();
  badge.textContent = n > 9 ? '9+' : String(n);
  badge.hidden = n === 0;
}

async function loadNotifications() {
  if (!currentUser) return;
  const { data: myPosts } = await sb.from('community_posts')
    .select('id, hop_title').eq('user_id', currentUser.id);
  const myPostIds = (myPosts || []).map(p => p.id);
  const titleById = new Map((myPosts || []).map(p => [p.id, p.hop_title || '']));
  const fluffleIds = [...myFluffle];

  const none = Promise.resolve({ data: [] });
  const [likesRes, commentsRes, fluffleRes] = await Promise.all([
    myPostIds.length ? sb.from('community_likes').select('post_id, user_id, created_at')
      .in('post_id', myPostIds).neq('user_id', currentUser.id)
      .order('created_at', { ascending: false }).limit(40) : none,
    myPostIds.length ? sb.from('community_comments').select('post_id, user_id, username, body, created_at')
      .in('post_id', myPostIds).neq('user_id', currentUser.id)
      .order('created_at', { ascending: false }).limit(40) : none,
    fluffleIds.length ? sb.from('community_posts').select('id, user_id, username, hop_title, created_at')
      .in('user_id', fluffleIds).neq('user_id', currentUser.id)
      .order('created_at', { ascending: false }).limit(40) : none,
  ]);
  const likes = likesRes.data || [], comments = commentsRes.data || [], fposts = fluffleRes.data || [];

  // community_likes has no username column, so resolve the likers' handles.
  const likerIds = [...new Set(likes.map(l => l.user_id))].filter(id => !(fluffleNames.get(id) || '').trim());
  const nameMap = new Map();
  if (likerIds.length) {
    const { data } = await sb.rpc('usernames_for_ids', { ids: likerIds });
    (data || []).forEach(r => nameMap.set(r.id, r.username || ''));
  }
  const handle = id => nameMap.get(id) || fluffleNames.get(id) || 'someone';

  const items = [];
  likes.forEach(l => items.push({ kind: 'like', ts: l.created_at, postId: l.post_id, actor: handle(l.user_id), title: titleById.get(l.post_id) || '' }));
  comments.forEach(c => items.push({ kind: 'comment', ts: c.created_at, postId: c.post_id, actor: c.username || handle(c.user_id), title: titleById.get(c.post_id) || '' }));
  fposts.forEach(p => items.push({ kind: 'post', ts: p.created_at, postId: p.id, actor: p.username || handle(p.user_id), title: p.hop_title || '' }));

  items.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  notifItems = items.slice(0, 50);
  updateNotifBadge();
  if (!notifPanel.hidden) renderNotifPanel();
}

const NOTIF_VERB = { like: 'liked your hop', comment: 'commented on your hop', post: 'posted a new hop' };
function renderNotifPanel() {
  const list = document.getElementById('notifList');
  if (!list) return;
  if (!notifItems.length) {
    list.innerHTML = '<div class="notif-empty">No notifications yet.</div>';
    return;
  }
  const seenT = panelSeenAt ? new Date(panelSeenAt).getTime() : 0;
  list.innerHTML = notifItems.map(n => {
    const unread = new Date(n.ts).getTime() > seenT;
    return `<button class="notif-item ${unread ? 'unread' : ''}" data-post="${esc(n.postId)}">
      <span class="notif-ic">${NOTIF_ICON[n.kind]}</span>
      <span class="notif-body">
        <span class="notif-text"><b>@${esc(n.actor)}</b> ${NOTIF_VERB[n.kind]}</span>
        ${n.title ? `<span class="notif-hop">${esc(n.title)}</span>` : ''}
        <span class="notif-time">${timeAgo(n.ts)}</span>
      </span>
    </button>`;
  }).join('');
  list.querySelectorAll('.notif-item').forEach(b =>
    b.addEventListener('click', () => openNotifPost(b.dataset.post)));
}

async function openNotifPost(postId) {
  closeNotifications();
  const [{ data: post, error }, { data: comments }] = await Promise.all([
    sb.from('community_posts').select('*').eq('id', postId).single(),
    sb.from('community_comments').select('*').eq('post_id', postId).order('created_at', { ascending: true }),
  ]);
  if (error || !post) { alertModal('That hop is no longer available.', { title: 'NOTIFICATIONS' }); return; }
  post.comments = comments || [];
  viewHopModal(post);
}

async function markNotificationsSeen() {
  if (!currentUser) return;
  const now = new Date().toISOString();
  if (currentProfile) currentProfile.notifications_seen_at = now;
  updateNotifBadge();
  await sb.from('profiles').update({ notifications_seen_at: now }).eq('id', currentUser.id);
}

function openNotifications() {
  panelSeenAt = notifSeenAt();        // freeze watermark so unread rows stay highlighted while open
  notifPanel.hidden = false;
  notifBtn.classList.add('active');
  notifBtn.setAttribute('aria-expanded', 'true');
  renderNotifPanel();
  loadNotifications();
  markNotificationsSeen();
}
function closeNotifications() {
  notifPanel.hidden = true;
  notifBtn.classList.remove('active');
  notifBtn.setAttribute('aria-expanded', 'false');
}
notifBtn.addEventListener('click', e => {
  e.stopPropagation();
  notifPanel.hidden ? openNotifications() : closeNotifications();
});
document.addEventListener('click', e => {
  if (!notifPanel.hidden && !notifPanel.contains(e.target) && e.target !== notifBtn && !notifBtn.contains(e.target)) closeNotifications();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !notifPanel.hidden) closeNotifications(); });

document.getElementById('aiClose').addEventListener('click', closeAI);
document.getElementById('aiClear').addEventListener('click', () => { aiMessages = []; renderAILog(); aiInput.focus(); });
aiOverlay.addEventListener('click', closeAI);
aiForm.addEventListener('submit', e => {
  e.preventDefault();
  const t = aiInput.value;
  aiInput.value = ''; aiInput.style.height = 'auto';
  sendAI(t);
});
aiInput.addEventListener('input', () => {
  aiInput.style.height = 'auto';
  aiInput.style.height = Math.min(aiInput.scrollHeight, 140) + 'px';
});
aiInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); aiForm.requestSubmit(); }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && aiSidecar.classList.contains('open')) closeAI();
});
renderAILog();

/* ---------------- boot ---------------- */
initAuth();
