/* BINDER'S SCREEN: the lists, their records, a record whole. Binder draws it;
 * the page that holds it (an application, or `binder serve`) gives it a place,
 * its words, and one function to reach the keeper.
 *
 *   const b = mount(element, {
 *       call: (op, args) => Promise<{ ok, text, data }>,   the keeper, as this person
 *       words,                       the dictionary (ui/texts/en.json): what a person reads
 *       lang,                        the language new lists are made in
 *       people: () => [{ id, name, kind }],   who may own a record, or be given a list
 *       picture: (value) => url|null,          a photo field's value, as a picture to show
 *       openAttached: (a) => void,             a thing attached opened by the page (a message, a file...)
 *   });
 *   b.refresh();   something changed: read again
 *   b.destroy();
 *
 * Built element by element: nothing a record holds is ever read as HTML.
 */

export const KEYS = Object.freeze(['lists', 'new-list', 'new-item', 'no-lists', 'template', 'create', 'cancel', 'title', 'list', 'columns', 'cards', 'back',
    'state', 'owners', 'due', 'notes', 'add-note', 'attached', 'attach', 'history', 'archive', 'restore', 'delete', 'delete-sure', 'approved', 'settings',
    'states', 'fields', 'access', 'read', 'write', 'none', 'save', 'empty', 'archived', 'show-archived', 'gate', 'done', 'add-state', 'add-field',
    'kind-message', 'kind-file', 'kind-asset', 'kind-branch', 'kind-link', 'kind-record', 'what', 'name', 'type', 'saved', 'edited', 'by', 'mine', 'all',
    'delete-list', 'delete-list-sure', 'archive-list', 'no-records', 'search', 'description', 'edit', 'more', 'approve', 'add', 'ok',
    'add-what', 'owner', 'attachment', 'tools', 'cover',
    'op-add', 'op-edit', 'op-move', 'op-note', 'op-edit-note', 'op-remove-note', 'op-attach', 'op-detach', 'op-archive', 'op-restore', 'op-delete']);
const KINDS = ['message', 'file', 'asset', 'branch', 'link', 'record'];
const ICON = { message: '💬', file: '📄', asset: '🗄', branch: '⑂', link: '🔗', record: '▣' };
const TYPES = ['text', 'number', 'date', 'link', 'photo'];
const DESCRIPTION_MAX = 4000;

/* WHAT A CARD SHOWS: what is set, and nothing about what is empty. These rules
 * know no template: only a list's states and fields, and a record's values. */

/* A file that is a picture, by its name: what a screen may put forward. */
export const isPicture = (ref) => /\.(jpe?g|png|webp|gif)$/i.test(String(ref ?? '').split(/[?#]/)[0]);

/* A card's pictures: its photo fields set ("field:ID"), then its files attached
 * that are pictures (their id): [{ key, value }]. */
export function pictures(l, r) {
    const out = [];
    for (const f of l.fields ?? []) if (f.type === 'photo' && r.fields?.[f.id]) out.push({ key: `field:${f.id}`, value: r.fields[f.id] });
    for (const a of r.attached ?? []) if (a.kind === 'file' && isPicture(a.ref)) out.push({ key: a.id, value: a.ref });
    return out;
}
/* The one put forward: the cover a person or an agent chose; else a photo field
 * set (a picture put there on purpose); else the only picture attached; else none. */
export function coverOf(l, r) {
    const all = pictures(l, r);
    const attached = all.filter((p) => !p.key.startsWith('field:'));
    return all.find((p) => p.key === r.cover) ?? all.find((p) => p.key.startsWith('field:')) ?? (attached.length === 1 ? attached[0] : null);
}
/* It, as a picture to show, through the page's `picture` hook; else none. */
export function imageOf(l, r, picture = () => null) {
    const c = coverOf(l, r);
    return c ? picture(c.value) ?? null : null;
}

/* The fields set, as one short line: [{ id, text }]. A date or a number says its
 * field's name ("Naissance : 12 avril 1931": alone, a date or "3" says not what
 * it is); a text or a link says itself. Photos are shown, not said. Empty fields
 * are not there. */
export function facts(l, r, lang = 'en') {
    const out = [];
    const named = (name, text) => `${name}${String(lang).startsWith('fr') ? '\u202f: ' : ': '}${text}`;
    for (const f of l.fields ?? []) {
        const v = r.fields?.[f.id];
        if (v === undefined || v === null || v === '' || f.type === 'photo') continue;
        let text = String(v);
        if (f.type === 'date') {
            const t = Date.parse(`${text.slice(0, 10)}T00:00:00`);
            if (Number.isFinite(t)) { try { text = new Date(t).toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' }); } catch { /* as typed */ } }
            text = named(f.name, text);
        } else if (f.type === 'number') {
            try { text = named(f.name, Number(v).toLocaleString(lang)); } catch { text = named(f.name, text); }
        } else if (f.type === 'link') {
            try { text = new URL(text).host.replace(/^www\./, ''); } catch { /* as typed */ }
        }
        out.push({ id: f.id, text });
    }
    return out;
}

/* Whether a card's state says anything. It says nothing when the card is in the
 * first state and that is the list's only state not done, with no gate: then
 * "open" is what every card is until it is done. Any other state is said. */
export function stateShown(l, r) {
    const open = l.states.filter((s) => !s.done);
    if (open.length !== 1 || l.states.some((s) => s.gate)) return true;
    return r.state !== l.states[0]?.id;
}

/* A DESCRIPTION, READ: a few lines of Markdown-ish text, as blocks a screen can
 * draw element by element. Paragraphs (a blank line between), lists ("- " or
 * "* "), **bold**, links ([text](https://...) or a bare http(s) address).
 * Nothing else is understood: whatever else it holds stays text.
 *   [{ type: 'p', lines: [parts] }, { type: 'list', items: [parts] }]
 *   parts: [{ text }, { bold }, { link, text }]
 */
const INLINE = /\*\*([^*\n]+?)\*\*|\[([^\]\n]{1,300})\]\((https?:\/\/[^\s()<>]+)\)|(https?:\/\/[^\s<>"]+)/gi;
export function inline(text) {
    const out = [];
    let at = 0;
    for (const m of String(text ?? '').matchAll(INLINE)) {
        if (m.index > at) out.push({ text: text.slice(at, m.index) });
        if (m[1] !== undefined) out.push({ bold: m[1] });
        else if (m[2] !== undefined) out.push({ link: m[3], text: m[2] });
        else {
            const tail = /[.,;:!?)\]'»]+$/.exec(m[4])?.[0] ?? '';
            const url = m[4].slice(0, m[4].length - tail.length);
            out.push({ link: url, text: url });
            if (tail) out.push({ text: tail });
        }
        at = m.index + m[0].length;
    }
    if (at < String(text ?? '').length) out.push({ text: text.slice(at) });
    return out;
}
export function blocks(text) {
    const out = [];
    let para = null; let list = null;
    for (const raw of String(text ?? '').replace(/\r/g, '').split('\n')) {
        const line = raw.trim();
        const item = /^[-*]\s+(.*)$/.exec(line);
        if (!line) { para = null; list = null; } else if (item) {
            para = null;
            if (!list) out.push(list = { type: 'list', items: [] });
            list.items.push(inline(item[1]));
        } else {
            list = null;
            if (!para) out.push(para = { type: 'p', lines: [] });
            para.lines.push(inline(line));
        }
    }
    return out;
}
/* Its first line, as plain text: what a list shows under a title. */
export const firstLine = (text) => String(text ?? '').split('\n').map((l) => l.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '').trim()).find(Boolean) ?? '';

function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props ?? {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'text') el.textContent = v;
        else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return el;
}

/* A description drawn: text nodes, <strong>, and <a> whose address starts with http(s)://. */
export function rich(text) {
    const parts = (ps) => ps.map((x) => (x.bold !== undefined ? h('strong', {}, x.bold)
        : x.link && /^https?:\/\//i.test(x.link) ? h('a', { href: x.link, target: '_blank', rel: 'noopener noreferrer' }, x.text) : x.text ?? ''));
    return h('div', { class: 'binder-rich' }, blocks(text).map((b) => (b.type === 'list'
        ? h('ul', {}, b.items.map((it) => h('li', {}, parts(it))))
        : h('p', {}, b.lines.flatMap((l, i) => (i ? [h('br'), ...parts(l)] : parts(l)))))));
}

export function mount(root, { call, words = {}, lang = 'en', people = () => [], picture = () => null, openAttached = null } = {}) {
    const w = (k) => words[k] ?? k;
    /* open: what of a record is being changed ('states', 'who', 'description', 'attach'); draft: what was typed, kept across a repaint. */
    const ui = { lists: [], at: null, data: null, view: null, record: null, mode: 'list', archived: false, mine: false, error: '', open: null, more: false, draft: {}, focus: false };
    const box = h('div', { class: 'binder' });
    root.replaceChildren(box);
    let alive = true;
    const nameOf = (id) => people().find((p) => p.id === id)?.name ?? id;
    const ask = async (op, args) => { const r = await call(op, args); if (!r.ok) { ui.error = r.text; paint(); throw new Error(r.text); } ui.error = ''; return r.data; };
    const soft = (p) => p.catch(() => {});

    async function load() {
        ui.lists = (await ask('lists', {})).filter((l) => !l.archived);
        if (!ui.lists.some((l) => l.id === ui.at)) ui.at = ui.lists[0]?.id ?? null;
        ui.data = ui.at ? await ask('show', { list: ui.at, archived: ui.archived, mine: ui.mine }) : null;
        if (ui.record) { try { ui.record = await ask('get', { id: ui.record.record.id }); } catch { ui.record = null; ui.mode = 'list'; } }
    }
    async function refresh() { if (!alive) return; await soft(load()); paint(); }

    /* ---- the parts ---- */
    const top = () => h('div', { class: 'binder-top' },
        h('div', { class: 'binder-tabs', role: 'tablist' }, ui.lists.map((l) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(l.id === ui.at), 'data-list': l.id,
            onclick: () => { ui.at = l.id; ui.view = null; ui.mode = 'list'; ui.record = null; ui.open = null; void refresh(); } }, l.title, h('small', {}, String(l.count))))),
        h('button', { type: 'button', class: 'binder-new-list', onclick: () => { ui.mode = 'new-list'; paint(); } }, `+ ${w('new-list')}`));

    /* The bar: the title, the views, "+ Card"; the rest behind "…". A filter on is
     * said by a chip that takes it off. */
    function bar(l) {
        const view = ui.view ?? l.view;
        const flip = (k) => { ui[k] = !ui[k]; ui.open = null; void refresh(); };
        const item = (on, text, act, fn) => h('button', { type: 'button', role: on === null ? 'menuitem' : 'menuitemcheckbox', 'aria-checked': on === null ? null : String(on), 'data-act': act, onclick: fn },
            h('span', { class: 'binder-check', 'aria-hidden': 'true' }, on ? '✓' : ''), text);
        const menu = ui.open === 'tools' ? h('div', { class: 'binder-menu binder-menu-end', role: 'menu' },
            item(ui.mine, w('mine'), 'mine', () => flip('mine')),
            item(ui.archived, w('archived'), 'archived', () => flip('archived')),
            l.access === 'write' && l.grants ? item(null, w('settings'), 'settings', () => { ui.open = null; ui.mode = 'settings'; paint(); }) : null) : null;
        const chip = (k) => (ui[k] ? h('button', { type: 'button', class: 'binder-chip', 'aria-pressed': 'true', 'data-act': `off-${k}`, onclick: () => flip(k) }, w(k === 'mine' ? 'mine' : 'archived'), h('span', { 'aria-hidden': 'true' }, ' ×')) : null);
        return h('div', { class: 'binder-bar' },
            h('h2', {}, l.title), chip('mine'), chip('archived'),
            h('div', { class: 'binder-seg', role: 'group' }, ['list', 'columns', 'cards'].map((v) => h('button', { type: 'button', 'aria-pressed': String(v === view), 'data-view': v, onclick: () => { ui.view = v; paint(); } }, w(v)))),
            l.access === 'write' && !ui.archived ? h('button', { type: 'button', class: 'binder-primary', 'data-act': 'new-item', onclick: () => { ui.mode = 'new-item'; paint(); } }, `+ ${w('new-item')}`) : null,
            h('div', { class: 'binder-pop' }, h('button', { type: 'button', class: 'binder-ghost binder-dots', 'data-act': 'tools', 'aria-haspopup': 'menu', 'aria-expanded': String(ui.open === 'tools'), 'aria-label': w('tools'), title: w('tools'),
                onclick: () => { ui.open = ui.open === 'tools' ? null : 'tools'; paint(); } }, '…'), menu));
    }

    /* A due date as a person reads it: "26 oct.", "4 nov. 2027 09:00". */
    const when = (due) => {
        const t = Date.parse(due.length === 10 ? `${due}T00:00:00` : due.replace(' ', 'T'));
        if (!Number.isFinite(t)) return due;
        const d = new Date(t);
        const o = { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) };
        try { return `${d.toLocaleDateString(lang, o)}${due.length > 10 ? ` ${due.slice(11)}` : ''}`; } catch { return due; }
    };
    const late = (l, r) => { const t = Date.parse(r.due.length === 10 ? `${r.due}T23:59:59` : r.due.replace(' ', 'T')); return t < Date.now() && !l.states.find((s) => s.id === r.state)?.done; };
    const stamp = (iso) => { try { return new Date(iso).toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return String(iso).slice(0, 16).replace('T', ' '); } };
    const gateOf = (l) => l.states.findIndex((s) => s.gate);
    const doneOf = (l) => l.states.find((s) => s.done) ?? l.states.at(-1);
    /* The box of a row: approval where the list has a gate (a person's), else done. */
    function tick(l, r) {
        const g = gateOf(l);
        const on = g >= 0 ? !!r.approved : r.state === doneOf(l).id;
        return h('button', { type: 'button', class: 'binder-tick', role: 'checkbox', 'aria-checked': String(on), title: g >= 0 ? w('approved') : w('done'), disabled: l.access !== 'write' || !l.grants && g >= 0,
            onclick: (e) => { e.stopPropagation(); void soft(g >= 0 ? ask('approve', { id: r.id, yes: !on }) : ask('move', { id: r.id, state: on ? l.states[0].id : doneOf(l).id })).then(refresh); } }, on ? '✓' : '');
    }
    const pill = (l, r) => { if (!stateShown(l, r)) return null; const st = l.states.find((s) => s.id === r.state); return h('span', { class: 'binder-pill', 'data-state': r.state, 'data-done': st?.done ? '' : null, 'data-gate': st?.gate ? '' : null }, st?.name ?? r.state); };
    const meta = (l, r) => h('span', { class: 'binder-meta' },
        r.owners.length ? r.owners.map(nameOf).join(', ') : null,
        r.due ? h('span', { class: late(l, r) ? 'binder-late' : null }, `⏰ ${when(r.due)}`) : null,
        r.attached.length ? h('span', {}, `📎 ${r.attached.length}`) : null,
        r.notes.length ? h('span', {}, `✎ ${r.notes.length}`) : null);
    const sub = (r) => (r.description ? h('span', { class: 'binder-sub' }, firstLine(r.description)) : null);
    /* The fields set, on one line: "Naissance 12 avril 1931 · Saint-Aubin". */
    const factLine = (l, r, cls = 'binder-facts') => { const f = facts(l, r, lang); return f.length ? h('span', { class: cls }, f.map((x) => x.text).join(' · ')) : null; };
    const leave = () => { ui.open = null; ui.more = false; ui.draft = {}; };
    const open = (r) => { void soft(ask('get', { id: r.id }).then((d) => { leave(); ui.record = d; ui.mode = 'record'; paint(); window.scrollTo?.(0, 0); })); };

    function asList(l, records) {
        return h('div', { class: 'binder-rows' }, records.map((r) => h('div', { class: 'binder-row', 'data-record': r.id, tabindex: '0', onclick: () => open(r), onkeydown: (e) => { if (e.key === 'Enter') open(r); } },
            tick(l, r), h('div', { class: 'binder-what' }, h('b', {}, r.title), factLine(l, r), sub(r), meta(l, r)), pill(l, r) ?? h('span'))));
    }
    function asColumns(l, records) {
        return h('div', { class: 'binder-cols' }, l.states.map((s) => {
            const here = records.filter((r) => r.state === s.id);
            return h('section', { class: 'binder-col', 'data-state': s.id }, h('h3', {}, s.name, h('span', {}, String(here.length))),
                here.map((r) => h('div', { class: 'binder-card', 'data-record': r.id, tabindex: '0', onclick: () => open(r), onkeydown: (e) => { if (e.key === 'Enter') open(r); } }, h('b', {}, r.title), factLine(l, r), sub(r), meta(l, r))));
        }));
    }
    function asCards(l, records) {
        return h('div', { class: 'binder-grid' }, records.map((r) => {
            const src = imageOf(l, r, picture);
            return h('div', { class: 'binder-card binder-face', 'data-record': r.id, tabindex: '0', onclick: () => open(r), onkeydown: (e) => { if (e.key === 'Enter') open(r); } },
                src ? h('img', { src, alt: r.title, loading: 'lazy' }) : h('div', { class: 'binder-initial', 'aria-hidden': 'true' }, r.title.slice(0, 1).toUpperCase()),
                h('b', {}, r.title), factLine(l, r, 'binder-facts binder-facts-small'), pill(l, r));
        }));
    }

    function newItem(l) {
        const title = h('input', { type: 'text', maxlength: '200', placeholder: w('title'), 'aria-label': w('title') });
        const go = () => { if (!title.value.trim()) return; void soft(ask('add', { list: l.id, title: title.value })).then(() => { ui.mode = 'list'; return refresh(); }); };
        title.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); if (e.key === 'Escape') { ui.mode = 'list'; paint(); } });
        queueMicrotask(() => title.focus());
        return h('div', { class: 'binder-form' }, title,
            h('button', { type: 'button', class: 'binder-primary', onclick: go }, w('create')),
            h('button', { type: 'button', class: 'binder-ghost', onclick: () => { ui.mode = 'list'; paint(); } }, w('cancel')));
    }

    async function newList() {
        const names = await ask('templates', {});
        let chosen = Object.keys(names)[0];
        const title = h('input', { type: 'text', maxlength: '200', placeholder: w('title'), 'aria-label': w('title') });
        const cards = h('div', { class: 'binder-templates' }, Object.entries(names).map(([k, n]) => h('button', { type: 'button', 'data-template': k, 'aria-pressed': String(k === chosen),
            onclick: (e) => { chosen = k; for (const b of cards.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); } }, n[lang] ?? n.en)));
        const go = () => void soft(ask('create-list', { template: chosen, title: title.value, lang })).then((l) => { ui.at = l.id; ui.mode = 'list'; ui.view = null; return refresh(); });
        return h('div', { class: 'binder-page' }, h('h2', {}, w('new-list')), h('p', { class: 'binder-dim' }, w('template')), cards, title,
            h('div', { class: 'binder-actions' }, h('button', { type: 'button', class: 'binder-ghost', onclick: () => { ui.mode = ui.lists.length ? 'list' : 'empty'; paint(); } }, w('cancel')),
                h('button', { type: 'button', class: 'binder-primary', onclick: go }, w('create'))));
    }

    /* A RECORD, WHOLE, read at a glance: its picture, its title, its fields set on
     * one line, its state when it says something, what it is (the description);
     * who and when, when set; what is attached; the notes. What is empty is not
     * shown: one quiet line offers to add it. The rest (fields to change,
     * history, archive, delete) is folded under "more". */
    function record() {
        const { record: r, list: l, history } = ui.record;
        const can = l.access === 'write';
        const st = l.states.find((s) => s.id === r.state);
        const g = gateOf(l);
        const set = (what) => { ui.open = what; ui.focus = !!what; paint(); };
        const done = (p) => void soft(p).then(() => { ui.open = null; return refresh(); });
        const later = (fn) => requestAnimationFrame(() => { if (ui.focus) { ui.focus = false; fn(); } });

        const title = h('textarea', { class: 'binder-title', rows: '1', maxlength: '200', readonly: !can, 'aria-label': w('title'), text: r.title, spellcheck: 'false' });
        const grow = () => { title.style.height = 'auto'; title.style.height = `${title.scrollHeight}px`; };
        title.addEventListener('input', grow);
        title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } if (e.key === 'Escape') { title.value = r.title; title.blur(); } });
        title.addEventListener('change', () => { const t = title.value.replace(/\s+/g, ' ').trim(); if (t && t !== r.title) done(ask('edit', { id: r.id, title: t })); else { title.value = r.title; grow(); } });
        requestAnimationFrame(grow);

        /* The state: one pill; a person changes it from its menu. Past a gate is approving. */
        const pillOf = h('button', { type: 'button', class: 'binder-pill binder-state', 'data-state': r.state, 'data-done': st?.done ? '' : null, 'data-gate': st?.gate ? '' : null,
            'aria-haspopup': 'menu', 'aria-expanded': String(ui.open === 'states'), 'aria-label': `${w('state')}: ${st?.name ?? r.state}`, disabled: !can,
            onclick: () => set(ui.open === 'states' ? null : 'states') }, st?.name ?? r.state, can ? h('span', { class: 'binder-caret', 'aria-hidden': 'true' }, '▾') : null);
        const menu = ui.open === 'states' ? h('div', { class: 'binder-menu', role: 'menu' }, l.states.map((s) => h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(s.id === r.state), 'data-state': s.id,
            onclick: () => done(ask('move', { id: r.id, state: s.id })) }, h('span', { class: 'binder-check', 'aria-hidden': 'true' }, s.id === r.state ? '✓' : ''), s.name))) : null;
        const approve = g >= 0 && can && l.grants && !r.approved
            ? h('button', { type: 'button', class: 'binder-primary binder-small', 'data-act': 'approve', onclick: () => done(ask('approve', { id: r.id, yes: true })) }, `✓ ${w('approve')}`) : null;

        /* Its picture, put forward. */
        const cover = coverOf(l, r);
        const coverSrc = cover ? picture(cover.value) : null;
        const hero = coverSrc ? h('img', { class: 'binder-hero', src: coverSrc, alt: r.title }) : null;
        const all = pictures(l, r);
        /* With several pictures, each says whether it is the one put forward, and can become it. */
        const star = (key) => (can && all.length > 1 ? h('button', { type: 'button', class: 'binder-text-btn binder-star', 'data-act': 'cover', 'aria-pressed': String(cover?.key === key),
            onclick: (e) => { e.preventDefault(); done(ask('edit', { id: r.id, cover: cover?.key === key ? '' : key })); } }, `${cover?.key === key ? '★' : '☆'} ${w('cover')}`) : null);

        /* What it is. */
        let about;
        if (ui.open === 'description') {
            const text = h('textarea', { class: 'binder-desc-edit', rows: '5', maxlength: String(DESCRIPTION_MAX), 'aria-label': w('description'), text: ui.draft.description ?? r.description ?? '' });
            text.addEventListener('input', () => { ui.draft.description = text.value; });
            later(() => { text.focus(); text.setSelectionRange(text.value.length, text.value.length); });
            about = h('div', { class: 'binder-desc-form' }, text, h('div', { class: 'binder-actions' },
                h('button', { type: 'button', class: 'binder-primary binder-small', 'data-act': 'save-description', onclick: () => { delete ui.draft.description; done(ask('edit', { id: r.id, description: text.value })); } }, w('save')),
                h('button', { type: 'button', class: 'binder-text-btn', onclick: () => { delete ui.draft.description; set(null); } }, w('cancel'))));
        } else {
            about = r.description ? h('div', { class: 'binder-desc' }, rich(r.description),
                can ? h('button', { type: 'button', class: 'binder-text-btn', 'data-act': 'edit-description', onclick: () => set('description') }, w('edit')) : null) : null;
        }

        /* Who and when, on one line: only what is set. */
        const names = r.owners.map(nameOf).join(', ');
        const whoParts = [names ? h('span', {}, `👤 ${names}`) : null, r.due ? h('span', { class: late(l, r) ? 'binder-late' : null }, `⏰ ${when(r.due)}`) : null].filter(Boolean);
        const whoLine = whoParts.length ? h(can ? 'button' : 'div', { type: can ? 'button' : null, class: 'binder-who', 'data-act': 'who', 'aria-expanded': can ? String(ui.open === 'who') : null, onclick: can ? () => set(ui.open === 'who' ? null : 'who') : null },
            whoParts.flatMap((x, i) => (i ? [h('span', { class: 'binder-dot', 'aria-hidden': 'true' }, '·'), x] : [x]))) : null;
        let whoEdit = null;
        if (ui.open === 'who') {
            const day = h('input', { type: 'date', value: r.due?.slice(0, 10) ?? '', 'aria-label': w('due') });
            const hour = h('input', { type: 'time', value: r.due?.slice(11) ?? '', 'aria-label': w('due') });
            whoEdit = h('div', { class: 'binder-who-edit' },
                people().length ? h('div', { class: 'binder-owners', role: 'group', 'aria-label': w('owners') }, people().map((p) => h('button', { type: 'button', class: 'binder-chip', 'data-owner': p.id,
                    'aria-pressed': String(r.owners.includes(p.id)),
                    onclick: () => void soft(ask('edit', { id: r.id, owners: r.owners.includes(p.id) ? r.owners.filter((x) => x !== p.id) : [...r.owners, p.id] })).then(refresh) }, p.name))) : null,
                h('div', { class: 'binder-form' }, day, hour,
                    h('button', { type: 'button', class: 'binder-primary binder-small', 'data-act': 'save-due', onclick: () => done(ask('edit', { id: r.id, due: day.value ? (hour.value ? `${day.value} ${hour.value}` : day.value) : '' })) }, w('ok'))));
        }

        /* What is attached: an icon and a name; a tap opens it. */
        const openIt = (a) => { if (a.kind === 'record') open({ id: a.ref }); else if (a.kind === 'link') window.open(a.ref, '_blank', 'noopener'); else openAttached?.(a); };
        const nameOfIt = (a) => a.title || (a.kind === 'record' ? ui.data?.records?.find((x) => x.id === a.ref)?.title ?? `#${a.ref}` : a.kind === 'file' ? a.ref.split('/').filter(Boolean).at(-1) ?? a.ref : a.ref);
        let attachForm = null;
        if (can && ui.open === 'attach') {
            const kind = h('select', { 'aria-label': w('attach') }, KINDS.map((k) => h('option', { value: k }, w(`kind-${k}`))));
            const ref = h('input', { type: 'text', placeholder: w('what'), 'aria-label': w('what') });
            later(() => ref.focus());
            attachForm = h('div', { class: 'binder-form' }, kind, ref,
                h('button', { type: 'button', class: 'binder-primary binder-small', 'data-act': 'attach', onclick: () => { if (ref.value.trim()) done(ask('attach', { id: r.id, kind: kind.value, ref: ref.value })); } }, w('attach')),
                h('button', { type: 'button', class: 'binder-text-btn', onclick: () => set(null) }, w('cancel')));
        }
        const thumb = (a) => { const src = a.kind === 'file' && isPicture(a.ref) ? picture(a.ref) : null; return src ? h('img', { class: 'binder-ic binder-thumb', src, alt: '' }) : h('span', { class: 'binder-ic', 'aria-hidden': 'true' }, ICON[a.kind] ?? '•'); };
        const attached = r.attached.length || attachForm ? h('section', { class: 'binder-sec' }, h('h3', {}, w('attached')),
            r.attached.length ? h('ul', { class: 'binder-atts' }, r.attached.map((a) => h('li', { class: 'binder-att', 'data-kind': a.kind },
                h('button', { type: 'button', class: 'binder-link', title: `${w(`kind-${a.kind}`)} · ${a.kind === 'record' ? `#${a.ref}` : a.ref}`, onclick: () => openIt(a) },
                    thumb(a), h('span', { class: 'binder-att-name' }, nameOfIt(a))),
                a.kind === 'file' && isPicture(a.ref) ? star(a.id) : null,
                can ? h('button', { type: 'button', class: 'binder-x', 'aria-label': `${w('delete')} ${nameOfIt(a)}`, onclick: () => void soft(ask('detach', { id: r.id, what: a.id })).then(refresh) }, '×') : null))) : null,
            attachForm ?? (can ? h('button', { type: 'button', class: 'binder-text-btn', 'data-act': 'show-attach', onclick: () => set('attach') }, `+ ${w('attach')}`) : null)) : null;

        /* What is empty, offered in one quiet line: "+ Ajouter : description · échéance · responsable · pièce jointe · champ". */
        const low = (k) => w(k).toLocaleLowerCase(lang);
        const offers = can ? [
            !r.description && ui.open !== 'description' ? ['description', low('description'), () => set('description')] : null,
            !r.due && ui.open !== 'who' ? ['due', low('due'), () => set('who')] : null,
            !r.owners.length && people().length && ui.open !== 'who' ? ['owner', low('owner'), () => set('who')] : null,
            !r.attached.length && ui.open !== 'attach' ? ['attach', low('attachment'), () => set('attach')] : null,
            l.fields.some((f) => r.fields[f.id] === undefined || r.fields[f.id] === '') ? ['fields', low('fields'), () => { ui.more = true; paint(); requestAnimationFrame(() => root.querySelector?.('.binder-fields input')?.focus()); }] : null,
        ].filter(Boolean) : [];
        const addRow = offers.length ? h('div', { class: 'binder-offer' }, h('span', { class: 'binder-dim' }, `+ ${w('add-what')}`),
            offers.flatMap(([act, text, fn], i) => [i ? h('span', { class: 'binder-dot', 'aria-hidden': 'true' }, '·') : null,
                h('button', { type: 'button', class: 'binder-text-btn', 'data-add': act, onclick: fn }, text)])) : null;

        /* Notes: small dated messages, and a box to add one. */
        const note = h('textarea', { rows: '2', placeholder: w('add-note'), 'aria-label': w('add-note'), maxlength: '2000', text: ui.draft.note ?? '' });
        note.addEventListener('input', () => { ui.draft.note = note.value; });
        const notes = r.notes.length || can ? h('section', { class: 'binder-sec' }, r.notes.length ? h('h3', {}, w('notes')) : null,
            r.notes.map((n) => h('div', { class: 'binder-note', 'data-kind': n.by.kind },
                h('div', { class: 'binder-note-by' }, h('b', {}, n.by.name), ` · ${stamp(n.at)}${n.edited ? ` · ${w('edited')}` : ''}`), h('p', {}, n.text))),
            can ? h('div', { class: 'binder-note-add' }, note, h('button', { type: 'button', class: 'binder-ghost binder-small', 'data-act': 'note',
                onclick: () => { if (note.value.trim()) void soft(ask('note', { id: r.id, text: note.value })).then(() => { delete ui.draft.note; return refresh(); }); } }, w('add'))) : null) : null;

        /* The rest, folded. */
        const field = (f) => {
            const v = r.fields[f.id] ?? '';
            const input = h('input', { type: f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text', value: String(v), disabled: !can, 'aria-label': f.name, 'data-field': f.id });
            input.addEventListener('change', () => void soft(ask('edit', { id: r.id, fields: { [f.id]: input.value } })).then(refresh));
            const src = f.type === 'photo' && v ? picture(v) : null;
            return h('label', { class: 'binder-field' }, h('span', {}, f.name), src ? h('img', { src, alt: f.name, class: 'binder-photo' }) : null, input, f.type === 'photo' && v ? star(`field:${f.id}`) : null);
        };
        const stateName = (id) => l.states.find((s) => s.id === id)?.name ?? id;
        const sure = h('span', { class: 'binder-sure', hidden: true }, w('delete-sure'),
            h('button', { type: 'button', class: 'binder-danger binder-small', 'data-act': 'delete-yes', onclick: () => void soft(ask('delete', { id: r.id })).then(() => { ui.record = null; ui.mode = 'list'; return refresh(); }) }, w('delete')),
            h('button', { type: 'button', class: 'binder-text-btn', onclick: () => { sure.hidden = true; } }, w('cancel')));
        const more = h('details', { class: 'binder-more', open: ui.more, ontoggle: (e) => { ui.more = e.currentTarget.open; } }, h('summary', { 'data-act': 'more' }, `⋯ ${w('more')}`),
            l.fields.length ? h('div', { class: 'binder-fields' }, l.fields.map(field)) : null,
            h('div', { class: 'binder-history' }, h('h3', {}, `${w('history')} · ${history.length}`),
                history.slice().reverse().map((x) => h('div', { class: 'binder-log' }, h('time', {}, stamp(x.at)), `${x.by.name} · ${words[`op-${x.op}`] ?? x.op}${x.op === 'move' && x.change ? ` → ${stateName(x.change.to)}` : ''}`))),
            can ? h('div', { class: 'binder-actions' },
                /* The state said nothing, so it is not shown: closing the card is here. */
                !stateShown(l, r) ? h('button', { type: 'button', class: 'binder-ghost binder-small', 'data-act': 'to-done', onclick: () => done(ask('move', { id: r.id, state: doneOf(l).id })) }, `✓ ${doneOf(l).name}`) : null,
                h('button', { type: 'button', class: 'binder-ghost binder-small', 'data-act': 'archive', onclick: () => void soft(ask('archive', { id: r.id, restore: !!r.archived })).then(() => { ui.record = null; ui.mode = 'list'; return refresh(); }) }, r.archived ? w('restore') : w('archive')),
                l.grants ? h('button', { type: 'button', class: 'binder-ghost binder-small binder-warn', 'data-act': 'delete', onclick: () => { sure.hidden = false; } }, w('delete')) : null, sure) : null);

        return h('div', { class: 'binder-page binder-record', 'data-record': r.id },
            h('div', { class: 'binder-crumb' }, h('button', { type: 'button', class: 'binder-text-btn', 'data-act': 'back', onclick: () => { leave(); ui.record = null; ui.mode = 'list'; void refresh(); } }, `‹ ${l.title}`),
                h('span', { class: 'binder-dim' }, `#${r.id}${r.archived ? ` · ${w('archived')}` : ''}`)),
            hero,
            h('header', { class: 'binder-head' }, title, factLine(l, r),
                stateShown(l, r) || approve ? h('div', { class: 'binder-status' }, stateShown(l, r) ? h('div', { class: 'binder-state-wrap binder-pop' }, pillOf, menu) : null, approve) : null),
            about,
            whoLine || whoEdit ? h('div', { class: 'binder-who-wrap' }, whoLine, whoEdit) : null,
            attached, addRow, notes, more);
    }

    function settings(l) {
        const title = h('input', { type: 'text', value: l.title, 'aria-label': w('title') });
        const states = l.states.map((s) => ({ ...s }));
        const fields = l.fields.map((f) => ({ ...f }));
        const stateRows = h('div', { class: 'binder-rows' });
        const fieldRows = h('div', { class: 'binder-rows' });
        const drawStates = () => stateRows.replaceChildren(...states.map((s, i) => h('div', { class: 'binder-row binder-edit' },
            h('input', { type: 'text', value: s.name, 'aria-label': w('name'), oninput: (e) => { s.name = e.target.value; } }),
            h('label', {}, h('input', { type: 'checkbox', checked: !!s.gate, onchange: (e) => { s.gate = e.target.checked; } }), w('gate')),
            h('label', {}, h('input', { type: 'checkbox', checked: !!s.done, onchange: (e) => { s.done = e.target.checked; } }), w('done')),
            h('button', { type: 'button', class: 'binder-x', 'aria-label': w('delete'), onclick: () => { states.splice(i, 1); drawStates(); } }, '×'))),
        h('button', { type: 'button', class: 'binder-ghost', onclick: () => { states.push({ name: '' }); drawStates(); } }, `+ ${w('add-state')}`));
        const drawFields = () => fieldRows.replaceChildren(...fields.map((f, i) => h('div', { class: 'binder-row binder-edit' },
            h('input', { type: 'text', value: f.name, 'aria-label': w('name'), oninput: (e) => { f.name = e.target.value; } }),
            h('select', { 'aria-label': w('type'), onchange: (e) => { f.type = e.target.value; } }, TYPES.map((t) => h('option', { value: t, selected: t === f.type }, t))),
            h('button', { type: 'button', class: 'binder-x', 'aria-label': w('delete'), onclick: () => { fields.splice(i, 1); drawFields(); } }, '×'))),
        h('button', { type: 'button', class: 'binder-ghost', onclick: () => { fields.push({ name: '', type: 'text' }); drawFields(); } }, `+ ${w('add-field')}`));
        drawStates(); drawFields();
        const grants = people().filter((p) => p.kind !== 'person').map((p) => {
            const sel = h('select', { 'aria-label': p.name, 'data-grant': p.id }, ['none', 'read', 'write'].map((a) => h('option', { value: a, selected: (l.grants[p.id] ?? 'none') === a }, w(a))));
            sel.addEventListener('change', () => void soft(ask('grant', { list: l.id, to: p.id, access: sel.value === 'none' ? null : sel.value })).then(refresh));
            return h('div', { class: 'binder-row' }, h('span', { class: 'binder-what' }, p.name), sel);
        });
        const sure = h('span', { class: 'binder-sure', hidden: true }, w('delete-list-sure'),
            h('button', { type: 'button', class: 'binder-danger', onclick: () => void soft(ask('delete-list', { list: l.id })).then(() => { ui.mode = 'list'; ui.at = null; return refresh(); }) }, w('delete')),
            h('button', { type: 'button', class: 'binder-ghost', onclick: () => { sure.hidden = true; } }, w('cancel')));
        return h('div', { class: 'binder-page binder-settings' },
            h('div', { class: 'binder-bar' }, h('button', { type: 'button', class: 'binder-ghost', onclick: () => { ui.mode = 'list'; paint(); } }, `‹ ${l.title}`)),
            h('section', { class: 'binder-box' }, h('h3', {}, w('title')), title),
            h('section', { class: 'binder-box' }, h('h3', {}, w('states')), stateRows),
            h('section', { class: 'binder-box' }, h('h3', {}, w('fields')), fieldRows),
            grants.length ? h('section', { class: 'binder-box' }, h('h3', {}, w('access')), grants) : null,
            h('div', { class: 'binder-actions' },
                h('button', { type: 'button', class: 'binder-ghost', onclick: () => void soft(ask('archive-list', { list: l.id })).then(() => { ui.mode = 'list'; ui.at = null; return refresh(); }) }, w('archive-list')),
                h('button', { type: 'button', class: 'binder-ghost', onclick: () => { sure.hidden = false; } }, w('delete-list')), sure,
                h('button', { type: 'button', class: 'binder-primary', 'data-act': 'save',
                    onclick: () => void soft(ask('edit-list', { list: l.id, title: title.value, states: states.filter((s) => s.name.trim()), fields: fields.filter((f) => f.name.trim()) })).then(() => { ui.mode = 'list'; return refresh(); }) }, w('save'))));
    }

    async function paint() {
        if (!alive) return;
        const parts = [];
        if (ui.error) parts.push(h('div', { class: 'binder-error', role: 'alert' }, ui.error));
        if (ui.mode === 'new-list') parts.push(await newList().catch(() => h('div')));
        else if (!ui.lists.length) parts.push(h('div', { class: 'binder-empty' }, h('p', {}, w('no-lists')), h('button', { type: 'button', class: 'binder-primary', onclick: () => { ui.mode = 'new-list'; paint(); } }, `+ ${w('new-list')}`)));
        else {
            parts.unshift(top());
            const l = ui.data?.list;
            if (ui.mode === 'record' && ui.record) parts.push(record());
            else if (ui.mode === 'settings' && l) parts.push(settings(l));
            else if (l) {
                const records = ui.data.records;
                const view = ui.view ?? l.view;
                parts.push(bar(l));
                if (ui.mode === 'new-item') parts.push(newItem(l));
                parts.push(records.length === 0 ? h('p', { class: 'binder-empty' }, w('no-records'))
                    : view === 'columns' ? asColumns(l, records) : view === 'cards' ? asCards(l, records) : asList(l, records));
            }
        }
        box.replaceChildren(...parts);
    }

    /* A menu closes on a tap elsewhere, or Escape. */
    const menus = ['states', 'tools'];
    const away = (e) => { if (menus.includes(ui.open) && !e.target?.closest?.('.binder-pop')) { ui.open = null; paint(); } };
    const escape = (e) => { if (e.key === 'Escape' && menus.includes(ui.open)) { ui.open = null; paint(); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    void refresh();
    return { refresh, destroy() { alive = false; document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape); box.remove(); }, get state() { return { at: ui.at, mode: ui.mode } } };
}
