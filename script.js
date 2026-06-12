/* ===================================================================
   RABBIT HOLE — book workbench
   Vanilla SPA. Data layer is isolated so it can move to Supabase later.
   =================================================================== */

/* ---------------- DATA LAYER (localStorage) ---------------- */
const STORE_KEY = 'exile_db_v1';

const uid = () => crypto.randomUUID();

const CHAPTER_PALETTE = ['#e0a96d', '#6da9e0', '#9ad06b', '#d06b9a', '#c9a227', '#6bd0c0', '#b58be0', '#e07a5f'];

const PROJECT_TYPES = ['Book', 'Movie', 'Play', 'Show', 'Short Story', 'Other'];
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
    labels: [],
    ui: { activeChapter: chId, activeChar: null, activeLoc: null, activeLabel: null }
  };
}

// Bring older saved data up to the current shape. Idempotent + defensive.
function migrate(d) {
  d.labels = d.labels || [];
  d.locations = d.locations || [];
  d.ui = d.ui || {};
  (d.chunks || []).forEach(c => { if (!Array.isArray(c.labelIds)) c.labelIds = []; });
  (d.chunks || []).forEach(c => { if (!Array.isArray(c.locationIds)) c.locationIds = []; });
  (d.ideas || []).forEach(i => {
    if (!Array.isArray(i.labelIds)) {
      i.labelIds = [];
      if (Array.isArray(i.labels)) {
        i.labels.forEach(name => {
          const lab = ensureLabelIn(d, name);
          if (lab && !i.labelIds.includes(lab.id)) i.labelIds.push(lab.id);
        });
      }
    }
    delete i.labels; // replaced by labelIds
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

// Pull any legacy localStorage data so it can become the user's first project.
function importableLocalData() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) { console.warn('local import read failed', e); }
  return null;
}

function save() {
  renderHeaderMeta();
  schedulePersist();
}

function chapterColor(chId) {
  const ch = db.chapters.find(c => c.id === chId);
  if (ch && ch.color) return ch.color;
  const idx = db.chapters.findIndex(c => c.id === chId);
  return CHAPTER_PALETTE[(idx < 0 ? 0 : idx) % CHAPTER_PALETTE.length];
}

/* ---------------- LABELS ---------------- */
function ensureLabelIn(d, rawName) {
  // Labels are canonically uppercase so the same word never splits by case.
  const name = String(rawName || '').trim().toUpperCase();
  if (!name) return null;
  let lab = d.labels.find(l => l.name.toUpperCase() === name);
  if (!lab) {
    lab = { id: uid(), name, color: CHAPTER_PALETTE[d.labels.length % CHAPTER_PALETTE.length] };
    d.labels.push(lab);
  }
  return lab;
}
const ensureLabel = (name) => ensureLabelIn(db, name);
const getLabel = (id) => db.labels.find(l => l.id === id);
const labelName = (id) => getLabel(id)?.name || '';
const labelColor = (id) => getLabel(id)?.color || 'var(--muted)';

function labelIdsFromString(str) {
  return [...new Set(
    String(str || '').split(',').map(s => s.trim()).filter(Boolean)
      .map(n => ensureLabel(n)?.id).filter(Boolean)
  )];
}

// Reusable chip editor for any entity holding a `labelIds` array.
function labelEditorHTML(selectedIds) {
  const chips = db.labels.map(l =>
    `<span class="lbl-chip ${selectedIds.includes(l.id) ? 'on' : ''}" data-lbl="${l.id}" style="--lc:${l.color}">${esc(l.name)}</span>`
  ).join('') || `<span class="ci-count">no labels yet</span>`;
  return `
    <div class="label-editor">
      <div class="label-chips">${chips}</div>
      <input class="new-label-input" placeholder="+ new label, Enter to add" />
    </div>`;
}

function wireLabelEditor(container, target) {
  container.querySelectorAll('.lbl-chip[data-lbl]').forEach(chip => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.lbl;
      const i = target.labelIds.indexOf(id);
      if (i >= 0) target.labelIds.splice(i, 1); else target.labelIds.push(id);
      chip.classList.toggle('on');
      save();
    });
  });
  const input = container.querySelector('.new-label-input');
  if (input) input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!input.value.trim()) return;
    const lab = ensureLabel(input.value);
    if (lab && !target.labelIds.includes(lab.id)) target.labelIds.push(lab.id);
    save();
    // rebuild this editor in place (new chip appears, focus retained)
    const wrap = document.createElement('div');
    wrap.innerHTML = labelEditorHTML(target.labelIds);
    const fresh = wrap.firstElementChild;
    container.replaceWith(fresh);
    wireLabelEditor(fresh, target);
    fresh.querySelector('.new-label-input').focus();
  });
}

/* ---------------- ROUTING ---------------- */
const ROUTES = ['home', 'sections', 'timelines', 'characters', 'locations', 'labels', 'ideas'];

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
  if (r === 'home') renderHome();
  if (r === 'sections') renderSections();
  if (r === 'timelines') renderTimelines();
  if (r === 'characters') renderCharacters();
  if (r === 'locations') renderLocations();
  if (r === 'labels') renderLabels();
  if (r === 'ideas') renderIdeas();
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
}

window.addEventListener('hashchange', route);

/* ---------------- DRAWER ---------------- */
const drawer = document.getElementById('drawer');
const overlay = document.getElementById('drawerOverlay');
function openDrawer() { drawer.classList.add('open'); overlay.classList.add('show'); }
function closeDrawer() { drawer.classList.remove('open'); overlay.classList.remove('show'); }
document.getElementById('drawerToggle').addEventListener('click', openDrawer);
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
  db.chunks.push({
    id, chapterId, title: '', body: '',
    orderInChapter: chunksOf(chapterId).length,
    narrativeOrder: db.chunks.length,
    chronoOrder: db.chunks.length,
    chronoLabel: '', characterIds: [], locationIds: [], labelIds: []
  });
  save(); recordWritingActivity();
  openChunkModal(id);
}
document.getElementById('addHopBtn').addEventListener('click', addHopGlobal);

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
// which timeline rows are expanded to reveal tags/characters/locations + text
const expandedTimeline = new Set();

function chunksOf(chapterId) {
  return db.chunks
    .filter(c => c.chapterId === chapterId)
    .sort((a, b) => (a.orderInChapter ?? 0) - (b.orderInChapter ?? 0));
}

// Archived chunks are hidden everywhere unless the SHOW ARCHIVED toggle is on.
function isVisibleChunk(c) { return !!db.ui.showArchived || !c.archived; }

// Sync every SHOW/HIDE ARCHIVED toggle button to the shared ui state.
function updateArchiveToggles() {
  const on = !!db.ui.showArchived;
  document.querySelectorAll('[data-arch]').forEach(btn => {
    btn.textContent = on ? 'HIDE ARCHIVED' : 'SHOW ARCHIVED';
    btn.classList.toggle('on', on);
  });
}

function renderSections() {
  const list = document.getElementById('chapterList');
  list.innerHTML = db.chapters
    .sort((a, b) => a.order - b.order)
    .map(ch => `
      <div class="chapter-item ${ch.id === db.ui.activeChapter ? 'active' : ''}" data-id="${ch.id}">
        <span class="ci-dot" style="background:${chapterColor(ch.id)}"></span>
        <span class="ci-title">${esc(ch.title)}</span>
        <span class="ci-count">${chunksOf(ch.id).filter(isVisibleChunk).length}</span>
      </div>`).join('');
  list.querySelectorAll('.chapter-item').forEach(el => {
    el.addEventListener('click', () => { db.ui.activeChapter = el.dataset.id; save(); renderSections(); });
  });
  renderChunkPane();
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
      <button class="add-btn solid" id="addChunkBtn">+ HOP</button>
      <button class="icon-btn" id="delChapBtn" title="Delete chapter">✕</button>
    </div>`;

  const body = chunks.length
    ? chunks.map(renderChunkCard).join('')
    : `<div class="pane-empty">No hops yet. Add one above.</div>`;

  pane.innerHTML = head + body;

  document.getElementById('chapTitle').addEventListener('input', e => {
    ch.title = e.target.value; save();
    const item = document.querySelector(`.chapter-item[data-id="${ch.id}"] .ci-title`);
    if (item) item.textContent = ch.title;
  });
  document.getElementById('chapColor').addEventListener('input', e => {
    ch.color = e.target.value; save();
    const dot = document.querySelector(`.chapter-item[data-id="${ch.id}"] .ci-dot`);
    if (dot) dot.style.background = ch.color;
  });
  document.getElementById('addChunkBtn').addEventListener('click', () => {
    const id = uid();
    db.chunks.push({
      id, chapterId: ch.id, title: '', body: '',
      orderInChapter: chunksOf(ch.id).length,
      narrativeOrder: db.chunks.length,
      chronoOrder: db.chunks.length,
      chronoLabel: '',
      characterIds: [],
      locationIds: [],
      labelIds: []
    });
    save(); renderSections();
    recordWritingActivity();
    openChunkModal(id);
  });
  document.getElementById('delChapBtn').addEventListener('click', async () => {
    if (!await confirmModal('Delete this chapter and its hops?')) return;
    db.chunks = db.chunks.filter(c => c.chapterId !== ch.id);
    db.chapters = db.chapters.filter(c => c.id !== ch.id);
    db.ui.activeChapter = db.chapters[0]?.id || null;
    save(); renderSections();
  });

  pane.querySelectorAll('.chunk-card').forEach(card => wireChunkCard(card));
  enableChunkDragReorder(pane, ch.id);
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

function entityChipsHTML(K, chunk) {
  const coll = db[K.coll];
  if (!coll.length) return `<span class="ci-count">no ${K.noun}s yet — add them in ${K.NOUNS}</span>`;
  return coll.map(ent => {
    const { on, auto } = chunkEntityPresence(K, chunk, ent);
    return `<span class="char-chip ${on ? 'on' : ''} ${auto ? 'auto' : ''}" data-ent="${ent.id}" style="--cc:${ent.color || 'var(--accent)'}"${auto ? ' title="Auto-detected in this scene\u2019s text"' : ''}>${esc(ent.name)}${auto ? '<span class="chip-auto">auto</span>' : ''}</span>`;
  }).join('');
}

// Toggling a chip flips the explicit link. A mention-only ("auto") chip stays on
// after toggling off (it's still in the text) — that's what the references
// workbench dismiss is for. Re-render in place so the auto/linked state stays honest.
function wireEntityChips(container, K, chunk) {
  container.querySelectorAll('.char-chip[data-ent]').forEach(chip => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.ent;
      if (!Array.isArray(chunk[K.link])) chunk[K.link] = [];
      const arr = chunk[K.link];
      const i = arr.indexOf(id);
      if (i >= 0) arr.splice(i, 1); else arr.push(id);
      save();
      const fresh = container.cloneNode(false);
      fresh.innerHTML = entityChipsHTML(K, chunk);
      container.replaceWith(fresh);
      wireEntityChips(fresh, K, chunk);
    });
  });
}

// Ask the model which existing tags fit this scene and what new tags to add,
// then let the author confirm before applying.
async function generateChunkTags(chunk, btn) {
  if (!(chunk.body || '').trim()) { alertModal('Write some content first.', { title: 'DETECT TAGS' }); return; }
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = '✨ THINKING…';
  try {
    const result = await aiInvoke({
      task: 'suggest_tags',
      chunk: { title: chunk.title, body: chunk.body },
      existing: db.labels.map(l => l.name)
    });
    btn.disabled = false; btn.textContent = original;
    const assign = (result.assign || []).filter(Boolean);
    const suggest = (result.suggest || []).filter(Boolean);
    if (!assign.length && !suggest.length) { alertModal('No tags suggested for this scene.', { title: 'DETECT TAGS' }); return; }
    const chosen = await tagReviewModal(assign, suggest);
    if (!chosen || !chosen.length) return;
    if (!Array.isArray(chunk.labelIds)) chunk.labelIds = [];
    chosen.forEach(name => {
      const lab = ensureLabel(name);
      if (lab && !chunk.labelIds.includes(lab.id)) chunk.labelIds.push(lab.id);
    });
    save(); renderSections();
    if (modalChunkId === chunk.id) {
      const lw = document.getElementById('chunkModalLabels');
      if (lw) { lw.innerHTML = labelEditorHTML(chunk.labelIds || []); const le = lw.querySelector('.label-editor'); if (le) wireLabelEditor(le, chunk); }
    }
  } catch (err) {
    btn.disabled = false; btn.textContent = original;
    alertModal('Tag generation failed.\n\n' + (err.message || ''), { title: 'DETECT TAGS' });
  }
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
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = '✨ SCANNING…';
  try {
    const result = await aiInvoke({
      task: K.detectTask,
      chunks: [{ title: chunk.title, body: chunk.body }],
      existing: db[K.coll].map(e => e.name)
    });
    btn.disabled = false; btn.textContent = original;
    const found = (result[K.resultKey] || []).filter(f => f && f.name);
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
    btn.disabled = false; btn.textContent = original;
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
  if (az && modalChunkId === chunk.id) az.textContent = '✨ VIEW ANALYSIS';
  rerenderActiveView();
}

// Entry from a hop card / edit modal. If we already saved an analysis for this
// hop, show it instantly; otherwise generate, persist, then show.
async function analyzeChunk(chunk, btn) {
  if (hasAnalysis(chunk.analysis)) { analysisResultModal(chunk); return; }
  if (!(chunk.body || '').trim()) { alertModal('Write some content first.', { title: 'ANALYZE' }); return; }
  const original = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '✨ READING…'; }
  try {
    const out = await runChunkAnalysis(chunk);
    if (btn) { btn.disabled = false; btn.textContent = original; }
    if (!hasAnalysis(out)) { alertModal('No analysis came back for this hop.', { title: 'ANALYZE' }); return; }
    chunk.analysis = { ...out, ts: Date.now() };
    save();
    refreshAnalyzeButtons(chunk);
    analysisResultModal(chunk);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = original; }
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
  const renderBody = () => {
    const a = chunk.analysis || {};
    const strengths = a.strengths || [], suggestions = a.suggestions || [];
    const stamp = a.ts ? `<div class="analysis-stamp">Saved ${new Date(a.ts).toLocaleString()}</div>` : '';
    body.innerHTML =
      (strengths.length ? `<div class="analysis-group"><div class="analysis-head">WHAT'S WORKING</div><ul class="analysis-list">${list(strengths, 'good')}</ul></div>` : '') +
      (suggestions.length ? `<div class="analysis-group"><div class="analysis-head">GENTLE NUDGES</div><ul class="analysis-list">${list(suggestions, 'nudge')}</ul></div>` : '') +
      stamp;
  };
  renderBody();
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="close"]').addEventListener('click', close);
  reBtn.addEventListener('click', async () => {
    if (!(chunk.body || '').trim()) { alertModal('Write some content first.', { title: 'REANALYZE' }); return; }
    const orig = reBtn.textContent;
    reBtn.disabled = true; reBtn.textContent = '✨ READING…';
    try {
      const out = await runChunkAnalysis(chunk);
      if (!hasAnalysis(out)) { alertModal('No analysis came back for this hop.', { title: 'REANALYZE' }); return; }
      chunk.analysis = { ...out, ts: Date.now() };
      save();
      renderBody();
    } catch (err) {
      alertModal('Analysis failed.\n\n' + (err.message || ''), { title: 'REANALYZE' });
    } finally {
      reBtn.disabled = false; reBtn.textContent = orig;
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
  const expanded = expandedChunks.has(c.id);
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
  <div class="chunk-card collapsed ${expanded ? 'is-expanded' : ''} ${c.archived ? 'archived' : ''}" data-id="${c.id}" draggable="true">
    <div class="chunk-display" data-f="open">
      <span class="chunk-grip" data-f="grip" title="Drag to reorder">⠿</span>
      <span class="chunk-chevron">${expanded ? '▾' : '▸'}</span>
      <span class="chunk-disp-title">${esc(c.title) || '<em>Untitled hop</em>'}</span>
      ${c.archived ? '<span class="arch-badge">ARCHIVED</span>' : ''}
      <span class="chunk-disp-meta">${meta}</span>
      <span class="chunk-disp-actions">
        <button class="add-btn hop-act" data-f="analyze" title="AI: analyze this hop">${hasAnalysis(c.analysis) ? '✨ VIEW ANALYSIS' : '✨ ANALYZE'}</button>
        <button class="add-btn hop-act" data-f="archive">${c.archived ? 'UNARCHIVE' : 'ARCHIVE'}</button>
        <button class="add-btn hop-act" data-f="edit">EDIT</button>
        <button class="icon-btn hop-act" data-f="del" title="Delete hop">✕</button>
        <details class="hop-kebab">
          <summary title="Options">⋮</summary>
          <div class="hop-menu">
            <button class="add-btn" data-f="analyze">${hasAnalysis(c.analysis) ? '✨ VIEW ANALYSIS' : '✨ ANALYZE'}</button>
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
    .map(e => ({ name: e.name, color: e.color || '' }));
}

// One row ("CHARACTERS  Ada, Mara") — the shared, canonical way to show a
// chunk's characters/locations, each name tinted with its own entity color.
function csTextRow(label, ents) {
  if (!ents.length) return '';
  const inner = ents.map(e =>
    `<span style="color:${e.color || 'var(--accent)'}">${esc(e.name)}</span>`).join(', ');
  return `<div class="cs-row"><span class="cs-label">${label}</span>`
    + `<span class="cs-vals"><span class="cs-text">${inner}</span></span></div>`;
}

// Compact characters + locations line shown anywhere a chunk is surfaced
// outside the Sections editor: timeline cards, reference rows, tag breakdown.
function chunkCharLocLine(c) {
  const chars = chunkEntities(ENTITY_KINDS.character, c);
  const locs = chunkEntities(ENTITY_KINDS.location, c);
  if (!chars.length && !locs.length) return '';
  return `<div class="chunk-charloc">${csTextRow('CHARACTERS', chars)}${csTextRow('LOCATIONS', locs)}</div>`;
}

// Header shown at the top of an expanded chunk: current tags, characters, and
// locations attached to this scene (explicit links plus auto-detected mentions).
// Tags are chips; characters and locations are plain accent-colored text.
function chunkSummaryHeader(c) {
  const tags = (c.labelIds || []).map(id =>
    `<span class="tag" style="--lc:${labelColor(id)}">${esc(labelName(id))}</span>`).join('');
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
    if (e.target.closest('[data-f="edit"]')) { e.stopPropagation(); openChunkModal(id); return; }
    if (e.target.closest('[data-f="analyze"]')) {
      e.stopPropagation(); analyzeChunk(c, e.target.closest('[data-f="analyze"]')); return;
    }
    if (expandedChunks.has(id)) expandedChunks.delete(id); else expandedChunks.add(id);
    renderSections();
  });
}

// Close any open hop kebab menu when tapping outside of it.
document.addEventListener('click', e => {
  document.querySelectorAll('.hop-kebab[open]').forEach(d => {
    if (!d.contains(e.target)) d.removeAttribute('open');
  });
});

document.getElementById('addChapterBtn').addEventListener('click', () => {
  const id = uid();
  const color = CHAPTER_PALETTE[db.chapters.length % CHAPTER_PALETTE.length];
  db.chapters.push({ id, title: `Chapter ${db.chapters.length + 1}`, order: db.chapters.length, color });
  db.ui.activeChapter = id;
  save(); renderSections();
});

// SHOW/HIDE ARCHIVED: shared toggle across sections, timelines, characters, labels.
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

function renderTimelines() {
  // populate character filter
  const sel = document.getElementById('timelineCharFilter');
  const prev = sel.value;
  sel.innerHTML = `<option value="">— all —</option>` +
    db.characters.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  sel.value = prev;
  sel.onchange = renderTimelines;
  const filterChar = sel.value;

  // populate label filter
  const lsel = document.getElementById('timelineLabelFilter');
  const lprev = lsel.value;
  lsel.innerHTML = `<option value="">— all —</option>` +
    db.labels.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');
  lsel.value = lprev;
  lsel.onchange = renderTimelines;
  const filterLabel = lsel.value;

  drawTrack('narrativeTrack', 'narrativeOrder', filterChar, filterLabel);
  drawTrack('chronoTrack', 'chronoOrder', filterChar, filterLabel);
}

function drawTrack(elId, orderKey, filterChar, filterLabel) {
  const track = document.getElementById(elId);
  const ordered = [...db.chunks].filter(isVisibleChunk).sort((a, b) => (a[orderKey] ?? 0) - (b[orderKey] ?? 0));
  if (!ordered.length) { track.innerHTML = `<div class="pane-empty">No hops yet.</div>`; return; }

  // Filter by presence (explicit link OR live mention), matching what's displayed.
  const charEnt = filterChar ? db.characters.find(x => x.id === filterChar) : null;

  track.innerHTML = ordered.map((c, i) => {
    const hideChar = charEnt && !chunkEntityPresence(ENTITY_KINDS.character, c, charEnt).on;
    const hideLabel = filterLabel && !(c.labelIds || []).includes(filterLabel);
    const dim = (hideChar || hideLabel) ? 'dim' : '';
    const arch = c.archived ? 'archived' : '';
    const label = orderKey === 'chronoOrder' && c.chronoLabel ? ` · ${esc(c.chronoLabel)}` : '';
    const color = chapterColor(c.chapterId);
    const open = expandedTimeline.has(c.id);
    return `
    <div class="tl-card ${dim} ${arch} ${open ? 'is-expanded' : ''}" data-id="${c.id}" draggable="true" style="border-left:3px solid ${color}">
      <div class="tl-row">
        <span class="tl-grip" title="Drag to reorder">⠿</span>
        <span class="tl-idx">${i + 1}</span>
        <button class="tl-chevron" data-f="toggle" title="${open ? 'Collapse' : 'Expand'}">${open ? '▾' : '▸'}</button>
        <span class="tl-name">${esc(c.title)}</span>
        ${c.archived ? '<span class="arch-badge">ARCHIVED</span>' : ''}
        <span class="tl-chap" style="color:${color}">${esc(chapterTitle(c.chapterId))}${label}</span>
      </div>
      ${open ? `
      <div class="tl-detail">
        ${chunkSummaryHeader(c)}
        <div class="tl-body">${c.body ? highlightNames(c.body, entityHighlightTerms()) : '<span class="muted">(no content yet)</span>'}</div>
      </div>` : ''}
    </div>`;
  }).join('');

  track.querySelectorAll('.tl-card').forEach(card => {
    const id = card.dataset.id;
    card.querySelector('.tl-row').addEventListener('click', e => {
      if (e.target.closest('[data-f="grip"]') || e.target.classList.contains('tl-grip')) return;
      if (e.target.closest('[data-f="toggle"]')) {
        e.stopPropagation();
        if (expandedTimeline.has(id)) expandedTimeline.delete(id); else expandedTimeline.add(id);
        renderTimelines();
        return;
      }
      openChunkModal(id);
    });
  });

  enableDragReorder(track, orderKey);
}

/* ---- drag-and-drop reorder within a track ---- */
function clearDropMarkers(track) {
  track.querySelectorAll('.tl-card').forEach(c => c.classList.remove('drop-before', 'drop-after'));
}

function dragAfterElement(track, y) {
  const cards = [...track.querySelectorAll('.tl-card:not(.dragging)')];
  return cards.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: -Infinity, element: null }).element;
}

function enableDragReorder(track, orderKey) {
  let draggingId = null;

  track.querySelectorAll('.tl-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      draggingId = card.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggingId);
      requestAnimationFrame(() => card.classList.add('dragging'));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      clearDropMarkers(track);
      draggingId = null;
    });
  });

  // assigned (not addEventListener) so re-renders don't stack duplicate handlers
  track.ondragover = e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    clearDropMarkers(track);
    const after = dragAfterElement(track, e.clientY);
    if (after) after.classList.add('drop-before');
    else {
      const cards = track.querySelectorAll('.tl-card:not(.dragging)');
      if (cards.length) cards[cards.length - 1].classList.add('drop-after');
    }
  };
  track.ondrop = e => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || draggingId;
    const after = dragAfterElement(track, e.clientY);
    clearDropMarkers(track);
    if (id) reorderChunk(orderKey, id, after ? after.dataset.id : null);
  };
}

/* ---- chunk edit modal (opened from timeline cards) ---- */
let modalChunkId = null;

function openChunkModal(chunkId) {
  const c = db.chunks.find(x => x.id === chunkId);
  if (!c) return;
  modalChunkId = chunkId;

  document.getElementById('chunkModalTitle').value = c.title;
  document.getElementById('chunkModalBody').value = c.body;
  document.getElementById('chunkModalChrono').value = c.chronoLabel || '';
  document.getElementById('chunkModalArchive').textContent = c.archived ? 'UNARCHIVE' : 'ARCHIVE';
  document.getElementById('chunkModalChapter').textContent = chapterTitle(c.chapterId);
  document.getElementById('chunkModalChapter').style.color = chapterColor(c.chapterId);
  const projEl = document.getElementById('chunkModalProject');
  if (projEl) projEl.textContent = projectsCache.find(p => p.id === activeProjectId)?.name || '';

  const sel = document.getElementById('chunkModalChapterSel');
  sel.innerHTML = db.chapters.map(ch =>
    `<option value="${ch.id}" ${ch.id === c.chapterId ? 'selected' : ''}>${esc(ch.title)}</option>`).join('');

  const charChips = document.getElementById('chunkModalChars');
  charChips.innerHTML = entityChipsHTML(ENTITY_KINDS.character, c);
  wireEntityChips(charChips, ENTITY_KINDS.character, c);

  const locChips = document.getElementById('chunkModalLocs');
  locChips.innerHTML = entityChipsHTML(ENTITY_KINDS.location, c);
  wireEntityChips(locChips, ENTITY_KINDS.location, c);

  const labelsWrap = document.getElementById('chunkModalLabels');
  labelsWrap.innerHTML = labelEditorHTML(c.labelIds || []);
  const le = labelsWrap.querySelector('.label-editor');
  if (le) wireLabelEditor(le, c);

  const gt = document.getElementById('chunkModalGenTags');
  gt.onclick = () => generateChunkTags(c, gt);

  const dc = document.getElementById('chunkDetectChars');
  dc.onclick = () => detectChunkEntities(ENTITY_KINDS.character, c, dc);
  const dl = document.getElementById('chunkDetectLocs');
  dl.onclick = () => detectChunkEntities(ENTITY_KINDS.location, c, dl);

  const sv = document.getElementById('chunkModalSave');
  sv.onclick = () => {
    save();
    const prev = sv.textContent;
    sv.textContent = '✓ SAVED';
    sv.disabled = true;
    setTimeout(() => { sv.textContent = prev; sv.disabled = false; }, 1200);
  };

  const az = document.getElementById('chunkModalAnalyze');
  if (az) {
    az.textContent = hasAnalysis(c.analysis) ? '✨ VIEW ANALYSIS' : '✨ ANALYZE';
    az.onclick = () => {
      // Analyze the live editor text, not the last-saved body.
      c.title = document.getElementById('chunkModalTitle').value;
      c.body = document.getElementById('chunkModalBody').value;
      analyzeChunk(c, az);
    };
  }

  document.getElementById('chunkModalOverlay').hidden = false;
}

// Re-render the character/location chip row for kind K inside the open hop
// modal — used after per-hop detection links new entities to the hop.
function refreshModalEntityChips(K, c) {
  const id = K === ENTITY_KINDS.character ? 'chunkModalChars' : 'chunkModalLocs';
  const wrap = document.getElementById(id);
  if (!wrap) return;
  wrap.innerHTML = entityChipsHTML(K, c);
  wireEntityChips(wrap, K, c);
}

function closeChunkModal() {
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
  else if (r === 'labels') renderLabels();
  else if (r === 'ideas') renderIdeas();
}

(function wireChunkModal() {
  const cur = () => db.chunks.find(x => x.id === modalChunkId);
  document.getElementById('chunkModalTitle').addEventListener('input', e => { const c = cur(); if (c) { c.title = e.target.value; save(); } });
  document.getElementById('chunkModalBody').addEventListener('input', e => { const c = cur(); if (c) { c.body = e.target.value; save(); } });
  document.getElementById('chunkModalChrono').addEventListener('input', e => { const c = cur(); if (c) { c.chronoLabel = e.target.value; save(); } });
  document.getElementById('chunkModalChapterSel').addEventListener('change', e => {
    const c = cur(); if (!c) return;
    c.chapterId = e.target.value;
    c.orderInChapter = chunksOf(c.chapterId).length;
    save();
    document.getElementById('chunkModalChapter').textContent = chapterTitle(c.chapterId);
    document.getElementById('chunkModalChapter').style.color = chapterColor(c.chapterId);
  });
  document.getElementById('chunkModalArchive').addEventListener('click', e => {
    const c = cur(); if (!c) return;
    c.archived = !c.archived; save();
    e.currentTarget.textContent = c.archived ? 'UNARCHIVE' : 'ARCHIVE';
  });
  document.getElementById('chunkModalClose').addEventListener('click', closeChunkModal);
  document.getElementById('chunkModalOverlay').addEventListener('click', e => {
    if (e.target.id === 'chunkModalOverlay') closeChunkModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !document.getElementById('chunkModalOverlay').hidden) closeChunkModal();
  });
})();

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
    listId: 'charList', paneId: 'charPane', detectId: 'detectCharsBtn', addId: 'addCharBtn',
    detectTask: 'detect_characters', resultKey: 'characters', sumTask: 'char_summary',
    noun: 'character', NOUN: 'CHARACTER', NOUNS: 'CHARACTERS', newName: 'New character'
  },
  location: {
    coll: 'locations', link: 'locationIds', active: 'activeLoc', scannedKey: 'detectScannedLocs',
    listId: 'locList', paneId: 'locPane', detectId: 'detectLocsBtn', addId: 'addLocBtn',
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
  list.innerHTML = coll.length
    ? coll.map(c => `
        <div class="chapter-item ${c.id === db.ui[K.active] ? 'active' : ''}" data-id="${c.id}">
          <span class="ci-dot" style="background:${c.color || 'var(--accent)'}"></span>
          <span class="ci-title">${esc(c.name)}</span>
          <span class="ci-count">${refsFor(K, c).length}</span>
        </div>`).join('')
    : `<div class="pane-empty" style="border:none">No ${K.noun}s yet.</div>`;
  list.querySelectorAll('.chapter-item').forEach(el => {
    el.addEventListener('click', () => {
      if (db.ui[K.active] !== el.dataset.id) expandedRefs.clear();
      db.ui[K.active] = el.dataset.id; save(); renderEntityList(K);
    });
  });
  renderEntityPane(K);
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
  return out;
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
    const tip = o.dismissed ? 'Click to restore this mention' : 'Click to dismiss this mention';
    out += `<span class="occ${o.dismissed ? ' occ-off' : ''}" data-chunk="${chunk.id}" data-occ="${o.ord}" title="${tip}"${tint}>${esc(o.text)}</span>`;
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
  const refRow = (r, off) => {
    const open = expandedRefs.has(r.id);
    return `
      <div class="ref-row ${open ? 'is-open' : ''} ${off ? 'ref-off' : ''}" data-ref="${r.id}">
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
      <input class="chunk-title-input" data-f="name" value="${esc(c.name)}" />
      <button class="add-btn" data-f="merge" title="Merge another ${K.noun} into this one">MERGE</button>
      <button class="icon-btn" data-f="del" title="Delete">✕</button>
    </div>
    <div class="char-block">
      <h3>ALIASES <span style="color:var(--muted);font-weight:400">(comma separated — used to find references)</span></h3>
      <input class="chunk-title-input" data-f="aliases" value="${esc((c.aliases || []).join(', '))}" placeholder="alternate names, nicknames…" />
    </div>
    <div class="char-block">
      <h3>SUMMARY</h3>
      <div class="char-summary">${c.summary ? esc(c.summary) : '<span style="color:var(--muted)">No summary yet.</span>'}</div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="add-btn" data-f="gen" title="AI: summarize from every chunk that references this ${K.noun}">✨ GENERATE</button>
        <button class="add-btn" data-f="editsum">EDIT MANUALLY</button>
      </div>
    </div>
    <div class="char-block">
      <h3>REFERENCES (${refs.length})</h3>
      <div style="color:var(--muted);font-size:11px;margin-bottom:8px">Expand a reference, then click a highlighted mention to dismiss it (click again to restore).</div>
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
  q('[data-f="del"]').addEventListener('click', async () => {
    if (!await confirmModal(`Delete this ${K.noun}?`)) return;
    db.chunks.forEach(ch => { ch[K.link] = (ch[K.link] || []).filter(id => id !== c.id); });
    db[K.coll] = db[K.coll].filter(x => x.id !== c.id);
    db.ui[K.active] = db[K.coll][0]?.id || null;
    save(); renderEntityList(K);
  });
  q('[data-f="merge"]').addEventListener('click', () => openMergeModal(K, c));
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
  pane.querySelectorAll('.occ').forEach(span => {
    span.addEventListener('click', e => {
      e.stopPropagation();
      const key = span.dataset.chunk + ':' + span.dataset.occ;
      c.dismissedRefs = c.dismissedRefs || [];
      const i = c.dismissedRefs.indexOf(key);
      if (i >= 0) c.dismissedRefs.splice(i, 1); else c.dismissedRefs.push(key);
      save(); renderEntityList(K);
    });
  });
  q('[data-f="gen"]').addEventListener('click', e => generateEntitySummary(K, c, e.currentTarget));
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
  const others = db[K.coll].filter(x => x.id !== c.id);
  if (!others.length) { alertModal(`Need at least two ${K.noun}s to merge.`, { title: `MERGE ${K.NOUNS}` }); return; }
  const overlay = document.createElement('div');
  overlay.className = 'ui-modal-overlay';
  overlay.innerHTML = `
    <div class="ui-modal merge-modal">
      <div class="ui-modal-title">MERGE ${K.NOUNS}</div>
      <div class="ui-modal-msg">Fold another ${K.noun} into <strong>${esc(c.name)}</strong>. Their references and notes move over; the unused name becomes an alias.</div>
      <div class="merge-field">
        <label class="merge-label">Merge this ${K.noun} in</label>
        <select class="chunk-title-input" id="mergeOther">
          ${others.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}
        </select>
      </div>
      <div class="merge-field">
        <label class="merge-label">Primary name (kept)</label>
        <div class="merge-names" id="mergeNames"></div>
      </div>
      <div class="ui-modal-actions">
        <button class="ui-modal-btn" data-act="cancel">Cancel</button>
        <button class="ui-modal-btn solid" data-act="merge">Merge</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const otherSel = overlay.querySelector('#mergeOther');
  const namesBox = overlay.querySelector('#mergeNames');
  function renderNames() {
    const other = db[K.coll].find(x => x.id === otherSel.value);
    const opts = [c.name, other ? other.name : ''].filter(Boolean);
    namesBox.innerHTML = opts.map((n, i) => `
      <label class="merge-name-opt">
        <input type="radio" name="mergePrimary" value="${esc(n)}" ${i === 0 ? 'checked' : ''} />
        <span>${esc(n)}</span>
      </label>`).join('');
  }
  renderNames();
  otherSel.addEventListener('change', renderNames);

  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
  overlay.querySelector('[data-act="merge"]').addEventListener('click', async () => {
    const otherId = otherSel.value;
    const primaryName = (overlay.querySelector('input[name="mergePrimary"]:checked') || {}).value || c.name;
    close();
    const other = db[K.coll].find(x => x.id === otherId);
    if (!await confirmModal(`Merge "${other.name}" into "${primaryName}"? This cannot be undone.`, { title: `MERGE ${K.NOUNS}`, okText: 'Merge' })) return;
    mergeEntities(K, c.id, otherId, primaryName);
  });
}

// AI summary — sends every chunk that references the entity to the model.
async function generateEntitySummary(K, c, btn) {
  const refs = refsFor(K, c);
  if (!refs.length) { alertModal(`No chunks reference this ${K.noun} yet.`, { title: 'AI SUMMARY' }); return; }
  const original = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '✨ THINKING…'; }
  try {
    const { reply } = await aiInvoke({
      task: K.sumTask,
      name: c.name,
      aliases: c.aliases || [],
      chunks: refs.map(r => ({ title: r.title, body: r.body }))
    });
    c.summary = reply || ''; save(); renderEntityPane(K);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = original; }
    alertModal('Could not generate summary.\n\n' + (err.message || ''), { title: 'AI SUMMARY' });
  }
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

// Scan chunk text, ask the model for named entities of this kind, then let the
// author pick which new ones to add via a review modal.
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

  const original = btn.textContent;
  btn.disabled = true; btn.textContent = '✨ SCANNING…';
  try {
    const result = await aiInvoke({
      task: K.detectTask,
      chunks: chunks.map(c => ({ title: c.title, body: c.body })),
      existing: db[K.coll].map(c => c.name)
    });
    const found = result[K.resultKey] || [];
    btn.disabled = false; btn.textContent = original;
    const nowScanned = new Set([...(db.ui[K.scannedKey] || []), ...chunks.map(c => c.id)]);
    db.ui[K.scannedKey] = [...nowScanned];

    const known = new Set(db[K.coll].flatMap(c => [c.name, ...(c.aliases || [])]).map(s => s.toLowerCase()));
    const candidates = found.filter(c => c.name && !known.has(c.name.toLowerCase()));
    if (!candidates.length) { save(); alertModal(`No new ${K.noun}s found.`, { title: `DETECT ${K.NOUNS}` }); return; }
    const chosen = await entityReviewModal(K, candidates);
    if (!chosen || !chosen.length) { save(); return; }
    chosen.forEach(cand => db[K.coll].push({ id: uid(), name: cand.name, aliases: cand.aliases || [], summary: '', notes: [], color: CHAPTER_PALETTE[db[K.coll].length % CHAPTER_PALETTE.length], dismissedRefs: [] }));
    db.ui[K.active] = db[K.coll][db[K.coll].length - 1].id;
    save(); renderEntityList(K);
  } catch (err) {
    btn.disabled = false; btn.textContent = original;
    alertModal('Detection failed.\n\n' + (err.message || ''), { title: `DETECT ${K.NOUNS}` });
  }
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

function entityReviewModal(K, candidates) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'ui-modal-overlay';
    overlay.innerHTML = `
      <div class="ui-modal detect-modal">
        <div class="ui-modal-title">DETECTED ${K.NOUNS}</div>
        <div class="ui-modal-msg">Select which to add. You can edit names and aliases afterward.</div>
        <div class="detect-list">
          ${candidates.map((c, i) => `
            <label class="detect-row">
              <input type="checkbox" data-i="${i}" checked />
              <span class="detect-name">${esc(c.name)}</span>
              ${(c.aliases && c.aliases.length) ? `<span class="detect-aliases">${esc(c.aliases.join(', '))}</span>` : ''}
            </label>`).join('')}
        </div>
        <div class="ui-modal-actions">
          <button class="ui-modal-btn" data-act="cancel">Cancel</button>
          <button class="ui-modal-btn solid" data-act="add">Add selected</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = val => { overlay.remove(); resolve(val); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => close(null));
    overlay.querySelector('[data-act="add"]').addEventListener('click', () => {
      const picked = [...overlay.querySelectorAll('.detect-row input:checked')].map(inp => candidates[+inp.dataset.i]);
      close(picked);
    });
  });
}

/* =====================================================================
   LABELS
   ===================================================================== */
function labelUsage(id) {
  const chunks = db.chunks.filter(isVisibleChunk).filter(c => (c.labelIds || []).includes(id));
  const ideas = db.ideas.filter(i => (i.labelIds || []).includes(id));
  return { chunks, ideas, count: chunks.length + ideas.length };
}

function renderLabels() {
  const list = document.getElementById('labelList');
  list.innerHTML = db.labels.length
    ? db.labels.map(l => `
        <div class="chapter-item ${l.id === db.ui.activeLabel ? 'active' : ''}" data-id="${l.id}">
          <span class="ci-dot" style="background:${l.color}"></span>
          <span class="ci-title">${esc(l.name)}</span>
          <span class="ci-count">${labelUsage(l.id).count}</span>
        </div>`).join('')
    : `<div class="pane-empty" style="border:none">No labels yet. Add labels to chunks and ideas, or create one here.</div>`;
  list.querySelectorAll('.chapter-item').forEach(el =>
    el.addEventListener('click', () => { db.ui.activeLabel = el.dataset.id; save(); renderLabels(); }));
  renderLabelPane();
}

function renderLabelPane() {
  const pane = document.getElementById('labelPane');
  const l = db.labels.find(x => x.id === db.ui.activeLabel);
  if (!l) { pane.innerHTML = `<div class="pane-empty">Select or add a label.</div>`; return; }

  const { chunks, ideas } = labelUsage(l.id);
  pane.innerHTML = `
    <div class="chunk-card-head">
      <input type="color" class="chap-color" id="labelColor" value="${l.color}" title="Label color" />
      <input class="chunk-title-input" id="labelName" value="${esc(l.name)}" />
      <button class="icon-btn" id="delLabelBtn" title="Delete label">✕</button>
    </div>
    <div class="char-block">
      <h3>SUMMARY <span style="color:var(--muted);font-weight:400">(AI — themes across tagged chunks)</span></h3>
      <div class="char-summary" id="tagSummary">${l.summary ? esc(l.summary) : '<span style="color:var(--muted)">No summary yet.</span>'}</div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="add-btn" id="genTagSummaryBtn">✨ GENERATE</button>
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
          <div class="idea-card"><div class="idea-text">${esc(i.text)}</div></div>`).join('')
          : '<span style="color:var(--muted)">No ideas tagged.</span>'}
      </div>
    </div>`;

  document.getElementById('labelName').addEventListener('input', e => {
    const caret = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase();
    e.target.setSelectionRange(caret, caret);
    l.name = e.target.value; save();
    const t = document.querySelector(`#labelList .chapter-item[data-id="${l.id}"] .ci-title`);
    if (t) t.textContent = l.name;
  });
  document.getElementById('labelColor').addEventListener('input', e => {
    l.color = e.target.value; save();
    const d = document.querySelector(`#labelList .chapter-item[data-id="${l.id}"] .ci-dot`);
    if (d) d.style.background = l.color;
  });
  document.getElementById('delLabelBtn').addEventListener('click', async () => {
    if (!await confirmModal('Delete this label? It will be removed from all hops and ideas.')) return;
    db.chunks.forEach(c => { if (c.labelIds) c.labelIds = c.labelIds.filter(id => id !== l.id); });
    db.ideas.forEach(i => { if (i.labelIds) i.labelIds = i.labelIds.filter(id => id !== l.id); });
    db.labels = db.labels.filter(x => x.id !== l.id);
    db.ui.activeLabel = db.labels[0]?.id || null;
    save(); renderLabels();
  });
  document.getElementById('genTagSummaryBtn').addEventListener('click', e => generateTagSummary(l, e.currentTarget));
  document.getElementById('editTagSummaryBtn').addEventListener('click', async () => {
    const next = await promptModal('Tag summary:', l.summary || '', { title: 'TAG SUMMARY', okText: 'Save' });
    if (next !== null) { l.summary = next; save(); renderLabelPane(); }
  });
  pane.querySelectorAll('[data-chunk-edit]').forEach(btn =>
    btn.addEventListener('click', () => openChunkModal(btn.dataset.chunkEdit)));
}

async function generateTagSummary(l, btn) {
  const chunks = labelUsage(l.id).chunks;
  if (!chunks.length) { alertModal('No hops use this tag yet.', { title: 'TAG SUMMARY' }); return; }
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = '✨ THINKING…';
  try {
    const { reply } = await aiInvoke({
      task: 'tag_summary',
      tagName: l.name,
      chunks: chunks.map(c => ({ title: c.title, body: c.body }))
    });
    l.summary = reply || ''; save(); renderLabelPane();
  } catch (err) {
    btn.disabled = false; btn.textContent = original;
    alertModal('Could not generate summary.\n\n' + (err.message || ''), { title: 'TAG SUMMARY' });
  }
}

document.getElementById('addLabelBtn').addEventListener('click', () => {
  const lab = { id: uid(), name: 'NEW LABEL', color: CHAPTER_PALETTE[db.labels.length % CHAPTER_PALETTE.length] };
  db.labels.push(lab);
  db.ui.activeLabel = lab.id;
  save(); renderLabels();
});

/* =====================================================================
   IDEA BACKLOG
   ===================================================================== */
let ideaFilterLabel = ''; // label id ('' = all)
const editingIdeas = new Set();

function renderIdeas() {
  const filterWrap = document.getElementById('ideaLabelFilter');
  const usedIds = [...new Set(db.ideas.flatMap(i => i.labelIds || []))]
    .filter(id => getLabel(id))
    .sort((a, b) => labelName(a).localeCompare(labelName(b)));
  filterWrap.innerHTML = usedIds.length
    ? `<span class="tag clickable ${ideaFilterLabel === '' ? 'on' : ''}" data-l="">ALL</span>` +
      usedIds.map(id => `<span class="tag clickable ${ideaFilterLabel === id ? 'on' : ''}" data-l="${id}" style="--lc:${labelColor(id)}">${esc(labelName(id))}</span>`).join('')
    : '';
  filterWrap.querySelectorAll('.tag').forEach(t =>
    t.addEventListener('click', () => { ideaFilterLabel = t.dataset.l; renderIdeas(); }));

  const grid = document.getElementById('ideaGrid');
  const shown = db.ideas
    .filter(i => !ideaFilterLabel || (i.labelIds || []).includes(ideaFilterLabel))
    .sort((a, b) => b.ts - a.ts);
  grid.innerHTML = shown.length
    ? shown.map(renderIdeaCard).join('')
    : `<div class="pane-empty">No ideas${ideaFilterLabel ? ' with that label' : ''} yet.</div>`;
  grid.querySelectorAll('.idea-card').forEach(wireIdeaCard);
}

function renderIdeaCard(i) {
  if (editingIdeas.has(i.id)) {
    return `
      <div class="idea-card editing" data-id="${i.id}">
        <textarea class="idea-edit-text" data-f="text" rows="3">${esc(i.text)}</textarea>
        ${labelEditorHTML(i.labelIds || [])}
        <div class="idea-foot">
          <button class="add-btn solid" data-f="save">SAVE</button>
          <button class="icon-btn" data-f="del" title="Delete">✕</button>
        </div>
      </div>`;
  }
  const tags = (i.labelIds || []).map(id =>
    `<span class="tag" style="--lc:${labelColor(id)}">${esc(labelName(id))}</span>`).join('');
  return `
    <div class="idea-card" data-id="${i.id}">
      <div class="idea-text">${esc(i.text)}</div>
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
    editingIdeas.delete(id);
    save(); renderIdeas();
  });
  const editBtn = card.querySelector('[data-f="edit"]');
  if (editBtn) editBtn.addEventListener('click', () => { editingIdeas.add(id); renderIdeas(); });

  const saveBtn = card.querySelector('[data-f="save"]');
  if (saveBtn) {
    card.querySelector('[data-f="text"]').addEventListener('input', e => { idea.text = e.target.value; save(); });
    const le = card.querySelector('.label-editor');
    if (le) wireLabelEditor(le, idea);
    saveBtn.addEventListener('click', () => { editingIdeas.delete(id); save(); renderIdeas(); });
  }
}

document.getElementById('addIdeaBtn').addEventListener('click', () => {
  const text = document.getElementById('ideaInput').value.trim();
  if (!text) return;
  const labelIds = labelIdsFromString(document.getElementById('ideaLabels').value);
  db.ideas.push({ id: uid(), text, labelIds, ts: Date.now() });
  document.getElementById('ideaInput').value = '';
  document.getElementById('ideaLabels').value = '';
  save(); renderIdeas();
  recordWritingActivity();
});

document.getElementById('suggestIdeasBtn').addEventListener('click', generateIdeaSuggestions);

// Read every chunk with body text, ask the model for next-chunk ideas, then let
// the author pick which to pin to the backlog.
async function generateIdeaSuggestions() {
  const btn = document.getElementById('suggestIdeasBtn');
  const chunks = db.chunks.filter(c => (c.body || '').trim());
  if (!chunks.length) { alertModal('No hop content to read yet.', { title: 'GENERATE IDEAS' }); return; }
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = '✨ THINKING…';
  try {
    const proj = projectsCache.find(p => p.id === activeProjectId);
    const { ideas } = await aiInvoke({
      task: 'suggest_ideas',
      type: proj?.type || '',
      genre: proj?.genre || '',
      chunks: chunks.map(c => ({ title: c.title, body: c.body }))
    });
    btn.disabled = false; btn.textContent = original;
    if (!ideas || !ideas.length) { alertModal('No ideas came back. Try again.', { title: 'GENERATE IDEAS' }); return; }
    const chosen = await ideaReviewModal(ideas);
    if (!chosen || !chosen.length) return;
    const now = Date.now();
    chosen.forEach((text, i) => db.ideas.push({ id: uid(), text, labelIds: [], ts: now + i }));
    save(); renderIdeas();
    chosen.forEach(() => recordWritingActivity());
  } catch (err) {
    btn.disabled = false; btn.textContent = original;
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

// Single entry point for the ai-chat edge function. Throws on error.
async function aiInvoke(payload) {
  const { data, error } = await sb.functions.invoke('ai-chat', { body: payload });
  if (error) {
    // Surface the function's JSON error body when present.
    let detail = error.message || 'request failed';
    try { const ctx = await error.context?.json?.(); if (ctx?.error) detail = ctx.error; } catch (_) {}
    throw new Error(detail);
  }
  if (data && data.error) throw new Error(data.error);
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

// Name + type + genre editor. Resolves to { name, type, genre } or null on cancel.
function projectSettingsModal({ title = 'PROJECT', name = '', type = '', genre = '', okText = 'Save' } = {}) {
  return new Promise(resolve => {
    const typeOpts = PROJECT_TYPES.map(t =>
      `<option value="${esc(t)}" ${t === type ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const genreOpts = `<option value="" ${!genre ? 'selected' : ''}>— none —</option>` +
      GENRES.map(g => `<option value="${esc(g)}" ${g === genre ? 'selected' : ''}>${esc(g)}</option>`).join('');
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
        <div class="ui-modal-actions">
          <button class="ui-modal-btn" data-act="cancel">Cancel</button>
          <button class="ui-modal-btn solid" data-act="ok">${esc(okText)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const nameEl = overlay.querySelector('#psName');
    nameEl.value = name;
    const done = val => { document.removeEventListener('keydown', onKey); overlay.remove(); resolve(val); };
    const onOk = () => {
      const n = nameEl.value.trim();
      if (!n) { nameEl.focus(); return; }
      done({ name: n, type: overlay.querySelector('#psType').value, genre: overlay.querySelector('#psGenre').value });
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
const authScreen = document.getElementById('authScreen');
const authForm   = document.getElementById('authForm');
const authMsgEl  = document.getElementById('authMsg');
const authSubmit = document.getElementById('authSubmit');
let authMode = 'signin';
let currentUser = null;
let booted = false;

function authMsg(t) { authMsgEl.textContent = t || ''; }

function setAuthMode(m) {
  authMode = m;
  authScreen.classList.remove('mode-sent');
  authScreen.classList.toggle('mode-signup', m === 'signup');
  document.getElementById('tabSignIn').classList.toggle('active', m === 'signin');
  document.getElementById('tabSignUp').classList.toggle('active', m === 'signup');
  authSubmit.textContent = m === 'signup' ? 'CREATE ACCOUNT' : 'SIGN IN';
  authMsg('');
}
function showAuthSent(email) {
  document.getElementById('authSentEmail').textContent = email;
  authScreen.classList.add('mode-sent');
}
document.getElementById('tabSignIn').addEventListener('click', () => setAuthMode('signin'));
document.getElementById('tabSignUp').addEventListener('click', () => setAuthMode('signup'));
document.getElementById('authBackBtn').addEventListener('click', () => setAuthMode('signin'));

function showAuth() {
  currentUser = null;
  activeProjectId = null;
  booted = false;
  db = seed();
  document.body.classList.add('locked');
  authScreen.hidden = false;
}
function showApp(session) {
  currentUser = session.user;
  authScreen.hidden = true;
  document.body.classList.remove('locked');
  const meta = currentUser.user_metadata || {};
  const who = [meta.first_name, meta.last_name].filter(Boolean).join(' ') || currentUser.email;
  const initials = ([meta.first_name, meta.last_name].filter(Boolean).map(s => s[0]).join('')
    || currentUser.email[0]).toUpperCase();
  const userEl = document.getElementById('profileInitials');
  userEl.textContent = initials;
  document.getElementById('profileBtn').title = who + ' · ' + currentUser.email;
  renderSettings();
  bootApp();
}

async function bootApp() {
  if (booted) return;
  booted = true;
  try {
    await ensureProfile();
    await initProjects();
  } catch (e) {
    console.error('boot failed', e);
    document.getElementById('headerMeta').textContent = 'load error';
  }
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

async function createProjectRow(name, type = 'Book', genre = '') {
  const { data, error } = await sb.from('projects')
    .insert({ user_id: currentUser.id, name, type, genre: genre || null, ui: {} }).select().single();
  if (error) throw error;
  return data;
}

// Map the in-memory `db` shape onto a brand-new project, remapping any
// legacy short ids to UUIDs (and rewiring every reference) before persisting.
async function seedProjectContent(projectId, data) {
  const map = new Map();
  const rid = old => { if (!map.has(old)) map.set(old, crypto.randomUUID()); return map.get(old); };
  let d;
  if (data) {
    d = {
      chapters: (data.chapters || []).map(c => ({ ...c, id: rid(c.id) })),
      chunks: (data.chunks || []).map(c => ({
        ...c, id: rid(c.id),
        chapterId: c.chapterId ? rid(c.chapterId) : null,
        labelIds: (c.labelIds || []).map(rid),
        characterIds: (c.characterIds || []).map(rid),
        locationIds: (c.locationIds || []).map(rid)
      })),
      characters: (data.characters || []).map(c => ({ ...c, id: rid(c.id) })),
      locations: (data.locations || []).map(c => ({ ...c, id: rid(c.id) })),
      labels: (data.labels || []).map(l => ({ ...l, id: rid(l.id) })),
      ideas: (data.ideas || []).map(i => ({ ...i, id: rid(i.id), labelIds: (i.labelIds || []).map(rid) })),
      ui: {}
    };
    d.ui = { activeChapter: d.chapters[0]?.id || null, activeChar: null, activeLoc: null, activeLabel: null };
  } else {
    d = seed();
  }
  db = d;
  activeProjectId = projectId;
  await persistProject();
}

async function loadProject(projectId) {
  activeProjectId = projectId;
  const [proj, chapters, chunks, characters, locations, labels, ideas] = await Promise.all([
    sb.from('projects').select('*').eq('id', projectId).single(),
    sb.from('chapters').select('*').eq('project_id', projectId),
    sb.from('chunks').select('*').eq('project_id', projectId),
    sb.from('characters').select('*').eq('project_id', projectId),
    sb.from('locations').select('*').eq('project_id', projectId),
    sb.from('tags').select('*').eq('project_id', projectId),
    sb.from('ideas').select('*').eq('project_id', projectId)
  ]);
  const chunkIds = (chunks.data || []).map(r => r.id);
  const ideaIds = (ideas.data || []).map(r => r.id);
  const [cLabels, cChars, cLocs, iLabels] = await Promise.all([
    chunkIds.length ? sb.from('chunk_labels').select('*').in('chunk_id', chunkIds) : { data: [] },
    chunkIds.length ? sb.from('chunk_chars').select('*').in('chunk_id', chunkIds) : { data: [] },
    chunkIds.length ? sb.from('chunk_locations').select('*').in('chunk_id', chunkIds) : { data: [] },
    ideaIds.length ? sb.from('idea_labels').select('*').in('idea_id', ideaIds) : { data: [] }
  ]);
  const cl = cLabels.data || [], cc = cChars.data || [], clo = cLocs.data || [], il = iLabels.data || [];
  db = {
    chapters: (chapters.data || []).map(r => ({ id: r.id, title: r.title, color: r.color, order: r.position })),
    chunks: (chunks.data || []).map(r => ({
      id: r.id, chapterId: r.chapter_id, title: r.title, body: r.body,
      chronoLabel: r.chrono_label || '', narrativeOrder: r.narrative_pos,
      chronoOrder: r.chrono_pos, orderInChapter: r.order_in_chapter,
      archived: !!r.archived, analysis: r.analysis || null,
      characterIds: cc.filter(j => j.chunk_id === r.id).map(j => j.character_id),
      locationIds: clo.filter(j => j.chunk_id === r.id).map(j => j.location_id),
      labelIds: cl.filter(j => j.chunk_id === r.id).map(j => j.label_id)
    })),
    characters: (characters.data || []).map(r => ({ id: r.id, name: r.name, aliases: r.aliases || [], summary: r.summary || '', notes: r.notes || [], color: r.color || '', dismissedRefs: r.dismissed_refs || [] })),
    locations: (locations.data || []).map(r => ({ id: r.id, name: r.name, aliases: r.aliases || [], summary: r.summary || '', notes: r.notes || [], color: r.color || '', dismissedRefs: r.dismissed_refs || [] })),
    labels: (labels.data || []).map(r => ({ id: r.id, name: (r.name || '').toUpperCase(), color: r.color, summary: r.summary || '' })),
    ideas: (ideas.data || []).map(r => ({ id: r.id, text: r.text, ts: r.ts || Date.parse(r.created_at), labelIds: il.filter(j => j.idea_id === r.id).map(j => j.label_id) })),
    ui: (proj.data && proj.data.ui) || {}
  };
  if (!db.ui.activeChapter) db.ui.activeChapter = db.chapters[0]?.id || null;
  localStorage.setItem(activeKey(), projectId);
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
    const characters = db.characters.map(c => ({ id: c.id, user_id: U, project_id: P, name: c.name, aliases: c.aliases || [], summary: c.summary || '', notes: c.notes || [], color: c.color || null, dismissed_refs: c.dismissedRefs || [] }));
    const locations = (db.locations || []).map(c => ({ id: c.id, user_id: U, project_id: P, name: c.name, aliases: c.aliases || [], summary: c.summary || '', notes: c.notes || [], color: c.color || null, dismissed_refs: c.dismissedRefs || [] }));
    const labels = db.labels.map(l => ({ id: l.id, user_id: U, project_id: P, name: l.name, color: l.color, summary: l.summary || null }));
    const ideas = db.ideas.map(i => ({ id: i.id, user_id: U, project_id: P, text: i.text, ts: i.ts || Date.now() }));

    await upsertSync('chapters', chapters, P);
    await Promise.all([upsertSync('tags', labels, P), upsertSync('characters', characters, P), upsertSync('locations', locations, P)]);
    await Promise.all([upsertSync('chunks', chunks, P), upsertSync('ideas', ideas, P)]);

    const chunkLabels = [], chunkChars = [], chunkLocs = [], ideaLabels = [];
    db.chunks.forEach(c => {
      (c.labelIds || []).forEach(lid => chunkLabels.push({ chunk_id: c.id, label_id: lid, user_id: U }));
      (c.characterIds || []).forEach(chid => chunkChars.push({ chunk_id: c.id, character_id: chid, user_id: U }));
      (c.locationIds || []).forEach(lid => chunkLocs.push({ chunk_id: c.id, location_id: lid, user_id: U }));
    });
    db.ideas.forEach(i => (i.labelIds || []).forEach(lid => ideaLabels.push({ idea_id: i.id, label_id: lid, user_id: U })));
    const chunkIds = db.chunks.map(c => c.id), ideaIds = db.ideas.map(i => i.id);
    await Promise.all([
      clearAndInsert('chunk_labels', 'chunk_id', chunkIds, chunkLabels),
      clearAndInsert('chunk_chars', 'chunk_id', chunkIds, chunkChars),
      clearAndInsert('chunk_locations', 'chunk_id', chunkIds, chunkLocs),
      clearAndInsert('idea_labels', 'idea_id', ideaIds, ideaLabels)
    ]);
    await sb.from('projects').update({ ui: db.ui, updated_at: new Date().toISOString() }).eq('id', P);
  } catch (e) {
    console.error('persist failed', e);
  } finally {
    persisting = false;
    if (dirtyAgain) { dirtyAgain = false; schedulePersist(); }
  }
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
      const noun = n === 1 ? 'add' : 'adds';
      cells.push(`<span class="hm-cell l${lvl}${isToday ? ' today' : ''}" title="${key}: ${n} ${noun}"></span>`);
    }
  }
  const legend = [0, 1, 2, 3, 4].map(l => `<span class="hm-cell l${l}"></span>`).join('');
  el.innerHTML = `
    <div class="heatmap">
      <div class="hm-title">Activity</div>
      <div class="hm-months">${months.join('')}</div>
      <div class="hm-grid">${cells.join('')}</div>
      <div class="hm-legend"><span>Less</span>${legend}<span>More</span></div>
    </div>`;
}

/* ---- HOME: project cards ---- */
function renderHome() {
  renderStreakBar();
  renderHeatmap();
  const grid = document.getElementById('projectGrid');
  if (!grid) return;
  const cards = projectsCache.map(p => {
    const active = p.id === activeProjectId;
    const stamp = p.updated_at || p.created_at;
    const when = stamp ? new Date(stamp).toLocaleDateString(undefined,
      { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    const kind = [p.type, p.genre].filter(Boolean).join(' · ');
    return `
      <div class="project-card ${active ? 'active' : ''}">
        <button class="pc-body" data-open="${p.id}">
          <span class="pc-name">${esc(p.name)}</span>
          ${kind ? `<span class="pc-kind">${esc(kind)}</span>` : ''}
          <span class="pc-meta">${active ? 'open · ' : ''}updated ${esc(when)}</span>
        </button>
        <div class="pc-actions">
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
    el.addEventListener('click', () => openProject(el.dataset.open)));
  grid.querySelectorAll('[data-edit]').forEach(b =>
    b.addEventListener('click', () => editProjectFlow(b.dataset.edit)));
  grid.querySelectorAll('[data-del]').forEach(b =>
    b.addEventListener('click', () => deleteProjectFlow(b.dataset.del)));
  grid.querySelector('#newProjectCard').addEventListener('click', createProjectFlow);
  renderSuggestedChunks();
}

/* ---- suggested next chunks (home page) ---- */
let suggestedChunks = null;     // cached AI result for the active project
let suggestedFor = null;        // project id the cache belongs to
let suggestLoading = false;

function renderSuggestedChunks() {
  const section = document.getElementById('suggestSection');
  if (!section) return;
  // Only meaningful once a project is open (its content lives in `db`).
  if (!activeProjectId) { section.hidden = true; return; }
  section.hidden = false;

  // Drop a stale cache when the active project changed.
  if (suggestedFor !== activeProjectId) { suggestedChunks = null; suggestedFor = activeProjectId; }

  const grid = document.getElementById('suggestGrid');
  const sub = document.getElementById('suggestSub');
  const refresh = document.getElementById('suggestRefreshBtn');
  refresh.disabled = suggestLoading;
  refresh.textContent = suggestLoading ? '✨ THINKING…' : '↻ REFRESH';

  if (suggestLoading) {
    sub.textContent = 'Reading your work so far…';
    grid.innerHTML = `<div class="suggest-empty">Thinking through what comes next…</div>`;
    return;
  }

  if (!suggestedChunks) {
    // Auto-generate the first time there's content to read; otherwise prompt.
    if (db.chunks.some(c => (c.body || '').trim())) { fetchSuggestedChunks(); return; }
    sub.textContent = 'Write a little, then I can suggest where to go next.';
    grid.innerHTML = `<div class="suggest-empty">No suggestions yet — start writing, then hit REFRESH.</div>`;
    return;
  }

  if (!suggestedChunks.length) {
    sub.textContent = 'No suggestions came back. Try refreshing.';
    grid.innerHTML = `<div class="suggest-empty">Nothing came back. Hit REFRESH to try again.</div>`;
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
  let result;
  try {
    const proj = projectsCache.find(p => p.id === reqProject);
    result = await aiInvoke({
      task: 'suggest_chunks',
      type: proj?.type || '',
      genre: proj?.genre || '',
      chapters: db.chapters.map(ch => ch.title).filter(Boolean),
      characters: db.characters.map(c => c.name).filter(Boolean),
      locations: (db.locations || []).map(l => l.name).filter(Boolean),
      chunks: db.chunks.filter(c => (c.body || '').trim()).map(c => ({ title: c.title, body: c.body }))
    });
  } catch (err) {
    suggestLoading = false;
    if (activeProjectId === reqProject) {
      suggestedChunks = [];
      renderSuggestedChunks();
      alertModal('Could not suggest next hops.\n\n' + (err.message || ''), { title: 'SUGGESTED NEXT HOPS' });
    } else {
      renderSuggestedChunks();
    }
    return;
  }
  suggestLoading = false;
  // Discard if the user switched projects while the request was in flight.
  if (activeProjectId !== reqProject) { renderSuggestedChunks(); return; }
  suggestedChunks = Array.isArray(result.chunks) ? result.chunks : [];
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
    labelIds: []
  });
  save();
  recordWritingActivity();
  if (Array.isArray(suggestedChunks)) {
    suggestedChunks = suggestedChunks.filter(x => x !== s);
    renderSuggestedChunks();
  }
  openChunkModal(id);
}

// Park a suggested scene in the Idea Backlog instead of writing it now, so it
// isn't lost when the suggestion list refreshes.
function saveSuggestedAsIdea(s) {
  if (!s) return;
  const title = (s.title || '').trim();
  const desc = (s.description || '').trim();
  const text = title && desc ? `${title} — ${desc}` : (title || desc);
  if (!text) return;
  db.ideas.push({ id: uid(), text, labelIds: [], ts: Date.now() });
  save();
  recordWritingActivity();
  if (Array.isArray(suggestedChunks)) {
    suggestedChunks = suggestedChunks.filter(x => x !== s);
    renderSuggestedChunks();
  }
}

/* ---- project flows ---- */
async function openProject(id) {
  if (id !== activeProjectId) {
    await flushPersist();
    await loadProject(id);
    localStorage.setItem(activeKey(), id);
    document.getElementById('projectSelect').value = id;
    renderHeaderMeta();
  }
  go('sections');
}

async function createProjectFlow() {
  const res = await projectSettingsModal({ title: 'NEW PROJECT', name: 'Untitled', type: 'Book', okText: 'Create' });
  if (!res) return;
  await flushPersist();
  const proj = await createProjectRow(res.name, res.type, res.genre);
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
    title: 'EDIT PROJECT', name: cur.name, type: cur.type || 'Book', genre: cur.genre || '', okText: 'Save'
  });
  if (!res) return;
  await sb.from('projects').update({ name: res.name, type: res.type, genre: res.genre || null }).eq('id', id);
  const projects = await fetchProjects();
  renderProjectSelector(projects, activeProjectId);
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

authForm.addEventListener('submit', async e => {
  e.preventDefault();
  authSubmit.disabled = true;
  authMsg('');
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  try {
    if (authMode === 'signup') {
      const first = document.getElementById('authFirst').value.trim();
      const last = document.getElementById('authLast').value.trim();
      const confirm = document.getElementById('authConfirm').value;
      if (password !== confirm) { authMsg('Passwords do not match.'); return; }
      if (password.length < 6) { authMsg('Password must be at least 6 characters.'); return; }
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: {
          data: { first_name: first, last_name: last },
          emailRedirectTo: window.location.origin
        }
      });
      if (error) { authMsg(error.message); return; }
      if (!data.session) {
        showAuthSent(email);
        return;
      }
      // session present → onAuthStateChange shows the app
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { authMsg(error.message); return; }
    }
  } finally {
    authSubmit.disabled = false;
  }
});

document.getElementById('signOutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
});

async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) showApp(session); else showAuth();
  sb.auth.onAuthStateChange((_evt, sess) => {
    if (sess) showApp(sess); else showAuth();
  });
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

function openAI() {
  aiOverlay.hidden = false; aiSidecar.hidden = false;
  requestAnimationFrame(() => { aiSidecar.classList.add('open'); aiOverlay.classList.add('show'); });
  aiToggle.classList.add('active');
  setTimeout(() => aiInput.focus(), 60);
}
function closeAI() {
  aiSidecar.classList.remove('open'); aiOverlay.classList.remove('show');
  aiToggle.classList.remove('active');
  setTimeout(() => { aiSidecar.hidden = true; aiOverlay.hidden = true; }, 220);
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

/* ---------------- ACCOUNT MENU ---------------- */
const profileBtn = document.getElementById('profileBtn');
const accountMenu = document.getElementById('accountMenu');
function openAccount() {
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
