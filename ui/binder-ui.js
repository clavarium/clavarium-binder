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
 *       place: { list, card },                 where it opens (an address kept by the page, after a reload)
 *       onPlace: (place) => void,              where it is now, each time a person goes elsewhere in it
 *       onBack: (place) => boolean,            its "‹" pressed: true when the page takes it (its own Back), else it goes up itself
 *   });
 *   b.refresh();   something changed: read again
 *   b.open(id, { from });   a record shown whole, in its list (resolves false when it is not in a list shown);
 *                           `from`: what its "‹" names (where the person came from, on the page)
 *   b.go(place);   shown there, said to no one (the page's Back): { list, card } (no card: the list)
 *   b.back();      one level up (a card, a binder's settings: its list); false when at the top
 *   b.place;       { list, card, page: 'list' | 'card' | 'settings', from }
 *   b.destroy();
 *
 * Built element by element: nothing a record holds is ever read as HTML.
 */

export const KEYS = Object.freeze(['lists', 'binder', 'new-list', 'new-item', 'no-lists', 'template', 'create', 'cancel', 'title', 'list', 'columns', 'cards', 'back',
    'state', 'owners', 'due', 'notes', 'add-note', 'attached', 'attach', 'history', 'archive', 'restore', 'delete', 'delete-sure', 'approved', 'settings',
    'states', 'fields', 'access', 'read', 'write', 'none', 'save', 'empty', 'archived', 'show-archived', 'gate', 'done', 'add-state', 'add-field',
    'kind-message', 'kind-file', 'kind-asset', 'kind-branch', 'kind-link', 'kind-record', 'what', 'name', 'type', 'saved', 'edited', 'by', 'mine', 'all',
    'delete-list', 'delete-list-sure', 'archive-list', 'no-records', 'none-archived', 'none-mine', 'search', 'description', 'edit', 'more', 'approve', 'add', 'ok',
    'add-what', 'owner', 'attachment', 'tools', 'cover', 'agent-lists', 'remind-before', 'no-remind', 'days',
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
 * "* "), a list item that starts with [ ] or [x] (a box, ticked or not), **bold**,
 * links ([text](https://...) or a bare http(s) address).
 * Nothing else is understood: whatever else it holds stays text.
 *   [{ type: 'p', lines: [parts] }, { type: 'list', items: [parts], checks: [null | { on, line }] }]
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
    for (const [at, raw] of String(text ?? '').replace(/\r/g, '').split('\n').entries()) {
        const line = raw.trim();
        const item = /^[-*]\s+(.*)$/.exec(line);
        if (!line) { para = null; list = null; } else if (item) {
            para = null;
            if (!list) out.push(list = { type: 'list', items: [], checks: [] });
            const box = /^\[([ xX])\]\s+(.*)$/.exec(item[1]);
            list.items.push(inline(box ? box[2] : item[1]));
            list.checks.push(box ? { on: box[1] !== ' ', line: at } : null);
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

/* A description's box ticked or unticked: the same text, that one line changed. */
export function toggled(text, line) {
    const lines = String(text ?? '').replace(/\r/g, '').split('\n');
    lines[line] = lines[line].replace(/^(\s*[-*]\s+)\[([ xX])\]/, (_, lead, mark) => `${lead}[${mark === ' ' ? 'x' : ' '}]`);
    return lines.join('\n');
}
/* A description drawn: text nodes, <strong>, and <a> whose address starts with http(s)://.
   `tick(text)`: given, its boxes can be ticked (the whole new text, to save); else they are only shown. */
export function rich(text, tick = null) {
    const parts = (ps) => ps.map((x) => (x.bold !== undefined ? h('strong', {}, x.bold)
        : x.link && /^https?:\/\//i.test(x.link) ? h('a', { href: x.link, target: '_blank', rel: 'noopener noreferrer' }, x.text) : x.text ?? ''));
    const item = (it, check) => {
        if (!check) return h('li', {}, parts(it));
        const box = h('input', { type: 'checkbox', class: 'binder-check-item', ...(check.on ? { checked: true } : {}), ...(tick ? {} : { disabled: true }),
            onchange: () => tick?.(toggled(text, check.line)) });
        return h('li', { class: 'binder-task', 'data-done': check.on ? 'true' : null }, h('label', {}, box, h('span', {}, parts(it))));
    };
    return h('div', { class: 'binder-rich' }, blocks(text).map((b) => (b.type === 'list'
        ? h('ul', b.checks.some(Boolean) ? { class: 'binder-tasks' } : {}, b.items.map((it, i) => item(it, b.checks[i])))
        : h('p', {}, b.lines.flatMap((l, i) => (i ? [h('br'), ...parts(l)] : parts(l)))))));
}

export function mount(root, { call, words = {}, lang = 'en', people = () => [], picture = () => null, openAttached = null, place: start = null, onPlace = null, onBack = null } = {}) {
    const w = (k) => words[k] ?? k;
    /* A state's name as shown: a template's own name in the page's words (a list made in another language keeps its data). */
    const sn = (st) => (st ? words[`state:${st.name}`] ?? st.name : '');
    /* open: what of a record is being changed ('states', 'who', 'description', 'attach'); draft: what was typed, kept across a repaint. */
    const ui = { lists: [], at: start?.list ?? null, data: null, view: null, record: null, mode: 'list', archived: false, mine: false, error: '', open: null, more: false, draft: {}, focus: false, settings: null, from: null };
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
    /* THE BINDERS, as binders: tabs with a binder's mark, the one shown joined to it below;
     * on a narrow screen, one picker ("Binder: Batches ▾"). One binder alone: its title says it. */
    const pick = (id) => { ui.at = id; ui.view = null; ui.mode = 'list'; ui.record = null; ui.open = null; ui.from = null; void refresh(); };
    const mark = () => h('span', { class: 'binder-mark', 'aria-hidden': 'true' });
    const top = () => h('div', { class: 'binder-top', 'data-one': ui.lists.length === 1 ? '' : null },
        h('div', { class: 'binder-tabs', role: 'tablist', 'aria-label': w('lists') }, ui.lists.map((l) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(l.id === ui.at), 'data-list': l.id,
            onclick: () => pick(l.id) }, mark(), h('span', { class: 'binder-tab-name' }, l.title), h('small', {}, String(l.count))))),
        h('label', { class: 'binder-picker' }, mark(), h('span', { class: 'binder-picker-word' }, w('binder')),
            h('select', { 'aria-label': w('binder'), onchange: (e) => pick(e.target.value) }, ui.lists.map((l) => h('option', { value: l.id, selected: l.id === ui.at }, `${l.title} (${l.count})`)))),
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
            l.access === 'write' && l.grants ? item(null, w('settings'), 'settings', () => { ui.open = null; ui.mode = 'settings'; paint(); void readSettings(); }) : null) : null;
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
    /* The lead reminder, where one is set: a quiet "−7 j" beside the due date. */
    const lead = (r) => (r.due && r.remindBefore ? h('span', { class: 'binder-lead', title: w('remind-before') }, `🔔 −${r.remindBefore} ${w('days')}`) : null);
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
    const pill = (l, r) => { if (!stateShown(l, r)) return null; const st = l.states.find((s) => s.id === r.state); return h('span', { class: 'binder-pill', 'data-state': r.state, 'data-done': st?.done ? '' : null, 'data-gate': st?.gate ? '' : null }, st ? sn(st) : r.state); };
    const meta = (l, r) => h('span', { class: 'binder-meta' },
        r.owners.length ? r.owners.map(nameOf).join(', ') : null,
        r.due ? h('span', { class: late(l, r) ? 'binder-late' : null }, `⏰ ${when(r.due)}`) : null,
        lead(r),
        r.attached.length ? h('span', {}, `📎 ${r.attached.length}`) : null,
        r.notes.length ? h('span', {}, `✎ ${r.notes.length}`) : null);
    const sub = (r) => (r.description ? h('span', { class: 'binder-sub' }, firstLine(r.description)) : null);
    /* The fields set, on one line: "Naissance 12 avril 1931 · Saint-Aubin". */
    const factLine = (l, r, cls = 'binder-facts') => { const f = facts(l, r, lang); return f.length ? h('span', { class: cls }, f.map((x) => x.text).join(' · ')) : null; };
    const leave = () => { ui.open = null; ui.more = false; ui.draft = {}; };
    const open = (r) => { void soft(ask('get', { id: r.id }).then((d) => { leave(); ui.from = null; ui.record = d; ui.mode = 'record'; paint(); })); };
    /* Its "‹": the page's own Back when it takes it, else one level up. */
    const up = () => { if (!onBack?.(here())) back(); };

    function asList(l, records) {
        return h('div', { class: 'binder-rows' }, records.map((r) => h('div', { class: 'binder-row', 'data-record': r.id, tabindex: '0', onclick: () => open(r), onkeydown: (e) => { if (e.key === 'Enter') open(r); } },
            tick(l, r), h('div', { class: 'binder-what' }, h('b', {}, r.title), factLine(l, r), sub(r), meta(l, r)), pill(l, r) ?? h('span'))));
    }
    function asColumns(l, records) {
        return h('div', { class: 'binder-cols' }, l.states.map((s) => {
            const here = records.filter((r) => r.state === s.id);
            return h('section', { class: 'binder-col', 'data-state': s.id }, h('h3', {}, sn(s), h('span', {}, String(here.length))),
                here.map((r) => h('div', { class: 'binder-card', 'data-record': r.id, tabindex: '0', onclick: () => open(r), onkeydown: (e) => { if (e.key === 'Enter') open(r); } }, h('b', {}, r.title), factLine(l, r), sub(r), meta(l, r))));
        }));
    }
    /* A card without a picture: a band of a soft colour of its own (from its title), not a large letter alone. */
    const band = (t) => {
        let x = 2166136261; for (const c of String(t)) x = Math.imul(x ^ c.codePointAt(0), 16777619) >>> 0;
        const hue = [212, 262, 330, 18, 42, 152, 186, 292][x % 8];
        const el = h('div', { class: 'binder-band', 'aria-hidden': 'true' }, h('span', { class: 'binder-initial' }, String(t).slice(0, 1).toUpperCase()));
        el.style?.setProperty('--binder-tint', `hsl(${hue} 46% 52%)`); /* set through the style object: allowed where inline styles are not */
        return el;
    };
    function asCards(l, records) {
        return h('div', { class: 'binder-grid' }, records.map((r) => {
            const src = imageOf(l, r, picture);
            return h('div', { class: 'binder-card binder-face', 'data-record': r.id, tabindex: '0', onclick: () => open(r), onkeydown: (e) => { if (e.key === 'Enter') open(r); } },
                src ? h('img', { src, alt: r.title, loading: 'lazy' })
                    : band(r.title),
                h('b', {}, r.title), src ? null : sub(r), factLine(l, r, 'binder-facts binder-facts-small'), pill(l, r));
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
            'aria-haspopup': 'menu', 'aria-expanded': String(ui.open === 'states'), 'aria-label': `${w('state')}: ${st ? sn(st) : r.state}`, disabled: !can,
            onclick: () => set(ui.open === 'states' ? null : 'states') }, st ? sn(st) : r.state, can ? h('span', { class: 'binder-caret', 'aria-hidden': 'true' }, '▾') : null);
        const menu = ui.open === 'states' ? h('div', { class: 'binder-menu', role: 'menu' }, l.states.map((s) => h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(s.id === r.state), 'data-state': s.id,
            onclick: () => done(ask('move', { id: r.id, state: s.id })) }, h('span', { class: 'binder-check', 'aria-hidden': 'true' }, s.id === r.state ? '✓' : ''), sn(s)))) : null;
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
            about = r.description ? h('div', { class: 'binder-desc' }, rich(r.description, can ? (text) => done(ask('edit', { id: r.id, description: text })) : null),
                can ? h('button', { type: 'button', class: 'binder-text-btn', 'data-act': 'edit-description', onclick: () => set('description') }, w('edit')) : null) : null;
        }

        /* Who and when, on one line: only what is set. */
        const names = r.owners.map(nameOf).join(', ');
        const whoParts = [names ? h('span', {}, `👤 ${names}`) : null, r.due ? h('span', { class: late(l, r) ? 'binder-late' : null }, `⏰ ${when(r.due)}`) : null, lead(r)].filter(Boolean);
        const whoLine = whoParts.length ? h(can ? 'button' : 'div', { type: can ? 'button' : null, class: 'binder-who', 'data-act': 'who', 'aria-expanded': can ? String(ui.open === 'who') : null, onclick: can ? () => set(ui.open === 'who' ? null : 'who') : null },
            whoParts.flatMap((x, i) => (i ? [h('span', { class: 'binder-dot', 'aria-hidden': 'true' }, '·'), x] : [x]))) : null;
        let whoEdit = null;
        if (ui.open === 'who') {
            const day = h('input', { type: 'date', value: r.due?.slice(0, 10) ?? '', 'aria-label': w('due') });
            const hour = h('input', { type: 'time', value: r.due?.slice(11) ?? '', 'aria-label': w('due') });
            /* The lead reminder, offered only once a date is set: none, or a few days before. */
            const remind = r.due ? h('select', { class: 'binder-remind', 'aria-label': w('remind-before'),
                onchange: () => void soft(ask('edit', { id: r.id, remindBefore: remind.value ? Number(remind.value) : 0 })).then(refresh) },
                h('option', { value: '' }, w('no-remind')),
                [1, 3, 7].map((n) => h('option', { value: String(n), selected: r.remindBefore === n ? true : null }, `−${n} ${w('days')}`))) : null;
            whoEdit = h('div', { class: 'binder-who-edit' },
                people().length ? h('div', { class: 'binder-owners', role: 'group', 'aria-label': w('owners') }, people().map((p) => h('button', { type: 'button', class: 'binder-chip', 'data-owner': p.id,
                    'aria-pressed': String(r.owners.includes(p.id)),
                    onclick: () => void soft(ask('edit', { id: r.id, owners: r.owners.includes(p.id) ? r.owners.filter((x) => x !== p.id) : [...r.owners, p.id] })).then(refresh) }, p.name))) : null,
                h('div', { class: 'binder-form' }, day, hour,
                    h('button', { type: 'button', class: 'binder-primary binder-small', 'data-act': 'save-due', onclick: () => done(ask('edit', { id: r.id, due: day.value ? (hour.value ? `${day.value} ${hour.value}` : day.value) : '' })) }, w('ok'))),
                remind ? h('div', { class: 'binder-form binder-remind-row' }, h('span', { class: 'binder-dim' }, w('remind-before')), remind) : null);
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
        const del = (a) => (can ? h('button', { type: 'button', class: 'binder-x', 'aria-label': `${w('delete')} ${nameOfIt(a)}`, onclick: () => void soft(ask('detach', { id: r.id, what: a.id })).then(refresh) }, '×') : null);
        /* Pictures attached are SEEN, not opened one by one: a gallery of previews. The rest stay a list. */
        const shots = r.attached.filter((a) => a.kind === 'file' && isPicture(a.ref) && picture(a.ref));
        const rest = r.attached.filter((a) => !shots.includes(a));
        const gallery = shots.length ? h('div', { class: 'binder-shots' }, shots.map((a) => h('figure', { class: 'binder-shot' },
            h('button', { type: 'button', class: 'binder-shot-open', title: a.ref, onclick: () => openIt(a) }, h('img', { src: picture(a.ref), alt: nameOfIt(a), loading: 'lazy' })),
            h('figcaption', {}, star(a.id), h('span', { class: 'binder-att-name' }, nameOfIt(a)), del(a))))) : null;
        const attached = r.attached.length || attachForm ? h('section', { class: 'binder-sec' }, h('h3', {}, w('attached')),
            gallery,
            rest.length ? h('ul', { class: 'binder-atts' }, rest.map((a) => h('li', { class: 'binder-att', 'data-kind': a.kind },
                h('button', { type: 'button', class: 'binder-link', title: `${w(`kind-${a.kind}`)} · ${a.kind === 'record' ? `#${a.ref}` : a.ref}`, onclick: () => openIt(a) },
                    thumb(a), h('span', { class: 'binder-att-name' }, nameOfIt(a))),
                del(a)))) : null,
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
        const stateName = (id) => { const st = l.states.find((s) => s.id === id); return st ? sn(st) : id; };
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
            /* Where it is, kept in sight: the way back (to its binder, or where the person came from), its binder, its number. */
            h('div', { class: 'binder-crumb' }, backButton(ui.from ?? l.title),
                h('span', { class: 'binder-dim binder-where' }, `${ui.from ? `${l.title} · ` : ''}#${r.id}${r.archived ? ` · ${w('archived')}` : ''}`)),
            hero,
            h('header', { class: 'binder-head' }, title, factLine(l, r),
                stateShown(l, r) || approve ? h('div', { class: 'binder-status' }, stateShown(l, r) ? h('div', { class: 'binder-state-wrap binder-pop' }, pillOf, menu) : null, approve) : null),
            about,
            whoLine || whoEdit ? h('div', { class: 'binder-who-wrap' }, whoLine, whoEdit) : null,
            attached, addRow, notes, more);
    }

    /* The way back, a fingertip high: "‹ Batches". */
    const backButton = (text) => h('button', { type: 'button', class: 'binder-back', 'data-act': 'back', 'aria-label': `${w('back')}: ${text}`, onclick: up },
        h('span', { class: 'binder-back-arrow', 'aria-hidden': 'true' }, '‹'), h('span', { class: 'binder-back-text' }, text));

    /* The store's settings, read when its page opens; asked quietly (a keeper without them shows none). */
    async function readSettings() {
        try { const r = await call('settings', {}); ui.settings = r?.ok ? r.data : null; } catch { ui.settings = null; }
        if (ui.mode === 'settings') paint();
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
        function agentLists() {
            const n = h('input', { type: 'number', min: '0', max: '50', step: '1', inputmode: 'numeric', value: String(ui.settings.agentLists), 'aria-label': w('agent-lists'), 'data-setting': 'agentLists' });
            n.addEventListener('change', () => void soft(ask('edit-settings', { agentLists: n.value })).then((got) => { if (got) ui.settings = got; paint(); }));
            return n;
        }
        return h('div', { class: 'binder-page binder-settings' },
            h('div', { class: 'binder-crumb' }, backButton(l.title)),
            h('section', { class: 'binder-box' }, h('h3', {}, w('title')), title),
            h('section', { class: 'binder-box' }, h('h3', {}, w('states')), stateRows),
            h('section', { class: 'binder-box' }, h('h3', {}, w('fields')), fieldRows),
            grants.length ? h('section', { class: 'binder-box' }, h('h3', {}, w('access')), grants) : null,
            ui.settings ? h('section', { class: 'binder-box' }, h('h3', {}, w('agent-lists')), agentLists()) : null,
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
                /* Empty: say why when a filter hides everything, not a bare "nothing here". */
                const emptyWhy = ui.archived ? w('none-archived') : ui.mine ? w('none-mine') : w('no-records');
                parts.push(records.length === 0 ? h('p', { class: 'binder-empty' }, emptyWhy)
                    : view === 'columns' ? asColumns(l, records) : view === 'cards' ? asCards(l, records) : asList(l, records));
            }
        }
        const s = scroller(); const was = s ? s.scrollTop : 0;
        box.replaceChildren(...parts);
        tell(s, was);
    }

    /* WHERE IT IS, said to the page when a person went elsewhere (a card, a binder, its
     * settings), and only then: the page keeps it (its Back, its address). Going to a card
     * puts it in sight from its top; back on the list, the list is where it was. */
    const here = () => ({ list: ui.at, card: ui.mode === 'record' && ui.record ? ui.record.record.id : null, page: ui.mode === 'record' && ui.record ? 'card' : ui.mode === 'settings' ? 'settings' : 'list', from: ui.mode === 'record' ? ui.from : null });
    const keyOf = (p) => `${p.list}|${p.page}|${p.card ?? ''}`;
    let told = null;
    function tell(s, scrolled) {
        const p = here(); const key = keyOf(p);
        const was = told; told = key;
        const from = was?.split('|')[1];
        if (s && from === 'list' && p.page !== 'list') {
            listTop = scrolled;
            /* Its top in sight: the box that scrolls, moved by what is above the view. */
            const above = box.getBoundingClientRect().top - (s === document.scrollingElement ? 0 : s.getBoundingClientRect().top);
            if (above < 0) s.scrollTop += above;
        } else if (s && from && from !== 'list' && p.page === 'list' && listTop !== null) { s.scrollTop = listTop; listTop = null; }
        if (key !== was && was !== null && !quiet) onPlace?.(p);
    }
    let listTop = null; let quiet = false;
    /* What scrolls it: the nearest box that scrolls, else the page. */
    function scroller() {
        if (typeof getComputedStyle !== 'function' || !box.isConnected) return null;
        for (let e = box.parentElement; e; e = e.parentElement) { const o = getComputedStyle(e).overflowY; if (o === 'auto' || o === 'scroll') return e; }
        return document.scrollingElement ?? null;
    }

    /* A menu closes on a tap elsewhere, or Escape. */
    const menus = ['states', 'tools'];
    const away = (e) => { if (menus.includes(ui.open) && !e.target?.closest?.('.binder-pop')) { ui.open = null; paint(); } };
    const escape = (e) => { if (e.key === 'Escape' && menus.includes(ui.open)) { ui.open = null; paint(); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    /* Where it opens: the page's place (a reload), else its first binder. Said to the page once drawn. */
    void (async () => {
        await refresh();
        if (start?.card && alive) { quiet = true; try { await openRecord(start.card); } finally { quiet = false; } }
        if (alive) onPlace?.(here());
    })();
    /* One record opened, from elsewhere on the page (a list beside a chat): its list, then it. */
    async function openRecord(id, { from = null } = {}) {
        if (!alive) return false;
        try {
            /* Asked quietly: a record not found says nothing on the screen. */
            const got = await call('get', { id: String(id ?? '') });
            if (!got?.ok) return false;
            const d = got.data;
            if (!ui.lists.some((l) => l.id === d.list.id)) await load();
            if (!ui.lists.some((l) => l.id === d.list.id)) return false;
            if (ui.at !== d.list.id) { ui.at = d.list.id; ui.view = null; ui.data = await ask('show', { list: ui.at, archived: ui.archived, mine: ui.mine }); }
            leave(); ui.from = from ?? null; ui.record = d; ui.mode = 'record'; paint();
            return true;
        } catch { return false; }
    }
    /* One level up: a card or a binder's settings, its list. */
    function back() {
        if (ui.mode !== 'record' && ui.mode !== 'settings') return false;
        leave(); ui.from = null; ui.record = null; ui.mode = 'list'; void refresh();
        return true;
    }
    /* Shown where the page says (its Back), said to no one: the page knows. */
    async function go(p = {}) {
        if (!alive) return false;
        quiet = true;
        try {
            if (p.card) return await openRecord(p.card);
            if (p.list && ui.lists.some((l) => l.id === p.list) && p.list !== ui.at) { ui.at = p.list; ui.view = null; }
            if (ui.mode !== 'list' || ui.record) { leave(); ui.from = null; ui.record = null; ui.mode = 'list'; }
            await refresh();
            return true;
        } finally { quiet = false; }
    }
    return { refresh, open: openRecord, go, back, get place() { return here(); }, destroy() { alive = false; document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape); box.remove(); }, get state() { return { at: ui.at, mode: ui.mode } } };
}
