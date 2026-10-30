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
    'kind-message', 'kind-file', 'kind-asset', 'kind-branch', 'kind-commit', 'kind-link', 'kind-record', 'kind-mail', 'kind-event', 'what', 'name', 'type', 'saved', 'edited', 'by', 'mine', 'all',
    'delete-list', 'delete-list-sure', 'archive-list', 'no-records', 'none-archived', 'none-mine', 'search', 'description', 'edit', 'more', 'approve', 'add', 'ok',
    'add-what', 'owner', 'attachment', 'tools', 'cover', 'agent-lists', 'agent-columns', 'agent-fields', 'remind-before', 'no-remind', 'days',
    'op-add', 'op-edit', 'op-move', 'op-note', 'op-edit-note', 'op-remove-note', 'op-attach', 'op-detach', 'op-archive', 'op-restore', 'op-delete',
    'matrix', 'to-place', 'q-do', 'q-plan', 'q-delegate', 'q-later', 'legend-size', 'legend-colour', 'recurrent', 'retype', 'retype-hint', 'retype-apply', 'no-repeat', 'repeat-free', 'open-card', 'fullscreen', 'fullscreen-exit',
    'legend-me', 'legend-none', 'delegability', 'shortcuts', 'mx-all', 'mx-mine', 'mx-deleg', 'all-hidden', 'urgency', 'urgency-hand', 'urgency-auto', 'urgency-from', 'auto', 'mx-move', 'mx-moved', 'mx-moved-hand', 'undo', 'my-share', 'nobody-yet', 'delegable-to', 'late', 'due-soon', 'to-handle', 'pick-point', 'lvl-low', 'lvl-mid', 'lvl-high', 'q-do-why', 'q-plan-why', 'q-delegate-why', 'q-later-why']);
const KINDS = ['message', 'file', 'asset', 'branch', 'commit', 'link', 'record', 'mail', 'event'];
const ICON = { message: '💬', file: '📄', asset: '🗄', branch: '⑂', commit: '◉', link: '🔗', record: '▣', mail: '📧', event: '📅' };
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

/* THE MATRIX reads four number fields by their id: urgency (x) and importance
 * (y) place a card, effort (charge) sizes it, delegability tints it. A list
 * offers the matrix only once it carries the two axes. */
export const MATRIX_AXES = { x: 'urgence', y: 'importance', size: 'charge', tint: 'delegabilite' };
export const canMatrix = (l) => ['urgence', 'importance'].every((id) => (l.fields ?? []).some((f) => f.id === id && f.type === 'number'));
/* A field's value as a 0..100 score, or null when it is not a number. */
export function score(r, id) {
    const v = r.fields?.[id];
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}
/* ITS URGENCY AS A MATRIX READS IT (#168): automatic -- 0 on its start date (urgencyFrom),
   100 at its due date, rising as the days pass, recomputed at each look -- when it has both;
   else the one set by hand. */
const when0 = (s) => Date.parse(String(s).replace(' ', 'T'));
export function urgencyOf(r, now = Date.now()) {
    if (r?.urgencyFrom && r?.due) {
        const from = when0(r.urgencyFrom); const to = when0(r.due);
        if (Number.isFinite(from) && Number.isFinite(to)) {
            if (now >= to) return 100;
            if (to <= from || now <= from) return 0;
            return Math.round(((now - from) / (to - from)) * 100);
        }
    }
    return score(r, MATRIX_AXES.x);
}
export const urgencyAuto = (r) => Boolean(r?.urgencyFrom && r?.due);
/* ITS PATH ON THE MATRIX (#167): the places a card stood, oldest first, rebuilt from its
   history (each change of its scores is kept there, with the first ones), ending where it
   stands now. A place is kept only once both axes are known, and only when it moved. */
export function trailOf(history, r) {
    const { x: X, y: Y } = MATRIX_AXES;
    const pts = []; let px = null; let py = null;
    const push = (x, y) => { const last = pts.at(-1); if (x !== null && y !== null && (!last || last.x !== x || last.y !== y)) pts.push({ x, y }); };
    for (const e of history ?? []) {
        const f = e?.change?.fields;
        if (!f || typeof f !== 'object') continue;
        if (Object.hasOwn(f, X)) px = f[X] === null ? null : score({ fields: f }, X);
        if (Object.hasOwn(f, Y)) py = f[Y] === null ? null : score({ fields: f }, Y);
        push(px, py);
    }
    push(urgencyOf(r), score(r, Y));
    return pts;
}
/* THE NAMES ON THE MATRIX, PLACED (point-feature labelling, as on a map): the points never
   move; each name tries places around its own point -- its side, the other, the diagonals,
   above, below -- then the same a little further out, where a hairline leads back to it. The
   first place inside the square that touches no point, no name already placed, no word of
   the square and whose line crosses none of them is kept; the bigger points choose first.
   A name with no room anywhere tries again narrower (its narrow size, on more lines).
   In pixels, y downwards: dots [{ x, y, r, w, h, left, narrow: { w, h } }] (centre, radius, its
   name's size, whether it would rather sit on the left), area { w, h }, walls [{ left, top, right, bottom }].
   Each answer: { x, y } (the name's top-left corner), lead (a line to draw), narrow, or null (no room). */
export function placeNames(dots, area, walls = [], { pad = 2, step = 12, rings = 6 } = {}) {
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const grow = (r, p) => ({ left: r.left - p, top: r.top - p, right: r.right + p, bottom: r.bottom + p });
    const rect = (x, y, w, h) => ({ left: x, top: y, right: x + w, bottom: y + h });
    /* A segment against a box (Liang-Barsky): does the line pass through it? */
    const cross = (x1, y1, x2, y2, b) => {
        let t0 = 0; let t1 = 1; const dx = x2 - x1; const dy = y2 - y1;
        for (const [p, q] of [[-dx, x1 - b.left], [dx, b.right - x1], [-dy, y1 - b.top], [dy, b.bottom - y1]]) {
            if (p === 0) { if (q < 0) return false; continue; }
            const t = q / p;
            if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
        }
        return true;
    };
    /* Two lines that cross (not merely touch at an end). */
    const meet = (x1, y1, x2, y2, [x3, y3, x4, y4]) => {
        const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
        if (d === 0) return false;
        const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d; const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
        return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
    };
    const near = (r, px, py) => ({ x: Math.max(r.left, Math.min(px, r.right)), y: Math.max(r.top, Math.min(py, r.bottom)) });
    const points = dots.map((d) => grow(rect(d.x - d.r, d.y - d.r, 2 * d.r, 2 * d.r), pad));
    /* One greedy pass in a given order; the passes in several orders are compared, and the one
       that leaves the fewest names out, then has them nearest their points, is kept. */
    const run = (order) => {
        const taken = [...walls]; const out = dots.map(() => null); const lines = []; let missing = 0; let total = 0;
        for (const i of order) {
            const d = dots[i]; let best = null;
            const sides = d.left ? ['W', 'E'] : ['E', 'W'];
            const diag = d.left ? ['NW', 'SW', 'NE', 'SE'] : ['NE', 'SE', 'NW', 'SW'];
            for (const narrow of [false, true]) {
                if (narrow && !d.narrow) continue;
                const { w, h } = narrow ? d.narrow : d;
                for (let k = 0; k < rings; k++) {
                    const g = d.r + 5 + k * step; const c = g * 0.72; const lift = h / 2 + 1;
                    /* Beside it (centred, then slid up or down), on the diagonals, then above and below
                       (centred, then flush with the point on either side). */
                    const at = { E: [d.x + g, d.y - h / 2], E1: [d.x + g, d.y - h / 2 - lift], E2: [d.x + g, d.y - h / 2 + lift],
                        W: [d.x - g - w, d.y - h / 2], W1: [d.x - g - w, d.y - h / 2 - lift], W2: [d.x - g - w, d.y - h / 2 + lift],
                        NE: [d.x + c, d.y - c - h], SE: [d.x + c, d.y + c], NW: [d.x - c - w, d.y - c - h], SW: [d.x - c - w, d.y + c],
                        N: [d.x - w / 2, d.y - g - h], N1: [d.x - d.r, d.y - g - h], N2: [d.x + d.r - w, d.y - g - h],
                        S: [d.x - w / 2, d.y + g], S1: [d.x - d.r, d.y + g], S2: [d.x + d.r - w, d.y + g] };
                    const tries = [...sides.flatMap((x) => [x, `${x}1`, `${x}2`]), ...diag, 'N', 'S', 'N1', 'S1', 'N2', 'S2'];
                    tries.forEach((s, n) => {
                        const [x, y] = at[s]; const r = rect(x, y, w, h);
                        if (r.left < pad || r.top < pad || r.right > area.w - pad || r.bottom > area.h - pad) return;
                        const box = grow(r, pad);
                        if (points.some((p) => hit(box, p)) || taken.some((t) => hit(box, t))) return;
                        /* Nearer is better; narrower, or a line crossing another, costs; a line through a point or a name is never drawn. */
                        /* A name nearer another point than its own reads as that one's: never there. */
                        const gap = (j) => { const q = near(r, dots[j].x, dots[j].y); return Math.hypot(q.x - dots[j].x, q.y - dots[j].y) - dots[j].r; };
                        const own = gap(i);
                        if (dots.some((_, j) => j !== i && gap(j) < own - 2)) return;
                        let cost = k * 12 + n * 0.4 + (narrow ? 10 : 0);
                        if (k > 0) {
                            const e = near(r, d.x, d.y);
                            if (points.some((p, j) => j !== i && cross(d.x, d.y, e.x, e.y, p))) return;
                            if (taken.some((t) => cross(d.x, d.y, e.x, e.y, t))) return;
                            if (lines.some((l) => meet(d.x, d.y, e.x, e.y, l))) cost += 90;
                            cost += Math.hypot(e.x - d.x, e.y - d.y) * 0.3;
                        }
                        if (!best || cost < best.cost) best = { cost, box, x, y, lead: k > 0, narrow, line: k > 0 ? [d.x, d.y, near(r, d.x, d.y)] : null };
                    });
                }
            }
            if (best) { taken.push(best.box); total += best.cost; if (best.line) { const [x0, y0, e] = best.line; lines.push([x0, y0, e.x, e.y]); } out[i] = { x: best.x, y: best.y, lead: best.lead, narrow: best.narrow }; } else missing++;
        }
        return { out, score: missing * 1000 + total };
    };
    const ids = dots.map((_, i) => i);
    const crowd = dots.map((d) => dots.filter((e) => Math.hypot(e.x - d.x, e.y - d.y) < 70).length);
    const orders = [(a, b) => dots[b].r - dots[a].r, (a, b) => crowd[b] - crowd[a] || dots[b].r - dots[a].r, (a, b) => dots[a].x - dots[b].x,
        (a, b) => dots[b].x - dots[a].x, (a, b) => dots[a].y - dots[b].y, (a, b) => dots[b].y - dots[a].y, (a, b) => crowd[a] - crowd[b]];
    /* And a few shuffles, from a fixed seed so the same cards always land the same way. */
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const shuffles = Array.from({ length: 80 }, () => { const o = [...ids]; for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } return o; });
    let best = null;
    for (const order of [...orders.map((by) => [...ids].sort(by)), ...shuffles]) { const r = run(order); if (!best || r.score < best.score) best = r; if (best.score === 0) break; }
    return best.out;
}
/* Changed in the last three days: a card wears a quiet halo, "something new". */
/* PAST ITS DUE (#181): a due day is over at its end; a due time, at that time. A card done is never late. */
const dueEnd = (r) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(r?.due ?? ''));
    if (!m) return null;
    return { end: m[4] ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : new Date(+m[1], +m[2] - 1, +m[3] + 1).getTime(), start: new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0)).getTime() };
};
export function lateOf(r, doneState = null, now = Date.now()) {
    if (!r?.due || r.archived || (doneState && r.state === doneState)) return false;
    const d = dueEnd(r); return d !== null && now >= d.end;
}
/* CALLING (#181): from its reminder (so many days before its due) -- or, with none, from its due --
   a card calls; past its due it is late as well. */
export function callingOf(r, doneState = null, now = Date.now()) {
    if (!r?.due || r.archived || (doneState && r.state === doneState)) return false;
    const d = dueEnd(r); if (d === null) return false;
    const before = Number(r.remindBefore) > 0 ? Number(r.remindBefore) * 864e5 : 0;
    return now >= (before ? d.start - before : d.start);
}
const fresh = (r) => { const t = Date.parse(r.changed ?? ''); return Number.isFinite(t) && Date.now() - t < 3 * 864e5; };

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
    const ui = { lists: [], at: start?.list ?? null, data: null, view: null, record: null, mode: 'list', archived: false, mine: false, error: '', open: null, more: false, draft: {}, focus: false, settings: null, templates: null, from: null };
    const box = h('div', { class: 'binder' });
    root.replaceChildren(box);
    let alive = true;
    const nameOf = (id) => people().find((p) => p.id === id)?.name ?? id;
    /* Small line icons (a person, a clock, a bell) in place of emojis: drawn by CSS, in the text's colour. */
    const ico = (name) => h('span', { class: `binder-i binder-i-${name}`, 'aria-hidden': 'true' });
    /* A card's SITUATION on a matrix list: a small square with its point and its quarter named,
       and its four numbers as gauges -- instead of a line of numbers that says little.
       compact: the side panel's form (a smaller square, thin bars). */
    function situation(l, r, { compact = false } = {}) {
        if (!canMatrix(l)) return null;
        const { x: X, y: Y, size: SIZE, tint: TINT } = MATRIX_AXES;
        const u = urgencyOf(r); const i = score(r, Y);
        if (u === null || i === null) return null;
        const c = score(r, SIZE); const d = score(r, TINT);
        const me = (people() || []).find((p) => p.me)?.id ?? null;
        const os = (r.owners ?? []).filter((o) => typeof o === 'string');
        const mine = os[0] === me; const other = os.length > 1 ? (mine ? os[1] : os[0]) : null;
        const helper = os.length > 1 ? os[1] : null;
        const others = (people() || []).map((p) => p.id).filter((id) => id !== me);
        const colorOf = (id) => (id === me ? 'var(--bm-me)' : id ? `var(--bm-${(Math.max(0, others.indexOf(id)) % 6) + 1})` : 'var(--bm-none)');
        const q = i >= 50 ? (u >= 50 ? 'q-do' : 'q-plan') : (u >= 50 ? 'q-delegate' : 'q-later');
        const level = (v) => w(v >= 67 ? 'lvl-high' : v >= 34 ? 'lvl-mid' : 'lvl-low');
        const cell = (k) => h('span', { class: `binder-sit-q${k === q ? ' on' : ''}`, 'data-q': k }, compact ? '' : w(k));
        const dot = h('span', { class: 'binder-sit-dot' });
        dot.style?.setProperty('left', `${u}%`); dot.style?.setProperty('bottom', `${i}%`); dot.style?.setProperty('--c', colorOf(os[0] ?? null));
        const square = h('div', { class: 'binder-sit-square', role: 'img', 'aria-label': `${w(q)} · ${fieldName(l, X)} ${u} · ${fieldName(l, Y)} ${i}` },
            cell('q-plan'), cell('q-do'), cell('q-later'), cell('q-delegate'), dot);
        const where = h('div', { class: 'binder-sit-where' }, h('b', {}, w(q)), compact ? null : document.createTextNode(` · ${w(`${q}-why`)}`));
        const bar = (label, v, { word, fill, part, partColor, note } = {}) => {
            const track = h('span', { class: 'binder-sit-track', role: 'img', 'aria-label': `${label} ${v} / 100` });
            const f = h('span', { class: 'binder-sit-fill' }); f.style?.setProperty('width', `${v}%`); if (fill) f.style?.setProperty('background', fill);
            track.append(f);
            if (part) { const pf = h('span', { class: 'binder-sit-part' }); pf.style?.setProperty('width', `${part}%`); pf.style?.setProperty('--pc', partColor); track.append(pf); }
            return h('div', { class: 'binder-sit-row' }, h('span', { class: 'binder-sit-label' }, label), track,
                h('span', { class: 'binder-sit-num' }, String(v), word && !compact ? h('small', {}, ` ${word}`) : null), note ? h('span', { class: 'binder-sit-note' }, note) : null);
        };
        const rows = [bar(fieldName(l, X), u, { word: `${level(u)}${urgencyAuto(r) ? ` · ${w('auto')}` : ''}` }), bar(fieldName(l, Y), i, { word: level(i) })];
        /* Its effort: mine solid, the other's share hatched in their colour. */
        if (c !== null) {
            const share = d === null || !other ? null : Math.round(c * s100(d) / 100);
            rows.push(bar(fieldName(l, SIZE), c, { fill: 'var(--bm-me)', ...(share ? { part: share, partColor: colorOf(other) } : {}) }));
        }
        if (d !== null && (mine || helper === me)) {
            const who = helper ? nameOf(helper).replace(/^[a-z]+:/, '') : null;
            rows.push(bar(fieldName(l, TINT), d, { fill: helper ? colorOf(helper) : 'var(--bm-none)', note: who ? who : w('nobody-yet') }));
        }
        return h('div', { class: `binder-sit${compact ? ' compact' : ''}` }, h('div', { class: 'binder-sit-map' }, square, where), h('div', { class: 'binder-sit-bars' }, rows));
    }
    const ask = async (op, args) => { const r = await call(op, args); if (!r.ok) { ui.error = r.text; paint(); throw new Error(r.text); } ui.error = ''; return r.data; };
    const soft = (p) => p.catch(() => {});

    async function load() {
        ui.lists = (await ask('lists', {})).filter((l) => !l.archived);
        if (!ui.lists.some((l) => l.id === ui.at)) ui.at = ui.lists[0]?.id ?? null;
        ui.data = ui.at ? await ask('show', { list: ui.at, archived: ui.archived, mine: ui.mine }) : null;
        if (ui.record) { try { ui.record = await ask('get', { id: ui.record.record.id }); } catch { ui.record = null; ui.mode = 'list'; } }
    }
    /* Read again and drawn; says whether the reading came through (a page retries one that did not). */
    async function refresh() { if (!alive) return false; const ok = await load().then(() => true, () => false); paint(); return ok; }

    /* ---- the parts ---- */
    /* THE BINDERS, as binders: tabs with a binder's mark, the one shown joined to it below;
     * on a narrow screen, one picker ("Binder: Batches ▾"). One binder alone: its title says it. */
    const pick = (id) => { ui.at = id; ui.view = null; ui.mode = 'list'; ui.record = null; ui.open = null; ui.from = null; void refresh(); };
    const mark = () => h('span', { class: 'binder-mark', 'aria-hidden': 'true' });
    /* Drag a tab to reorder the binders (a person's order, kept on the server). Works with a
       finger (press and hold) and with a mouse; a plain tap/click still opens the binder. */
    function tabsDnd(tabsEl) {
        if (ui.lists.length < 2) return tabsEl;
        let d = null; let swallow = false;
        const tabs = () => [...tabsEl.querySelectorAll('[role="tab"]')];
        const clear = () => {
            if (!d) return;
            clearTimeout(d.hold); d.clone?.remove(); d.tab?.classList.remove('binder-drag-src');
            for (const t of tabs()) t.removeAttribute('data-over');
            try { tabsEl.releasePointerCapture(d.id); } catch { /* gone */ }
            d = null;
        };
        const start = (e) => {
            const r = d.tab.getBoundingClientRect();
            d.offX = e.clientX - r.left; d.offY = e.clientY - r.top; d.moved = true;
            try { tabsEl.setPointerCapture(d.id); } catch { /* ok */ }
            const clone = d.tab.cloneNode(true); clone.className = `${d.tab.className} binder-drag-clone`; clone.style.width = `${r.width}px`;
            document.body.append(clone); d.clone = clone; d.tab.classList.add('binder-drag-src');
        };
        const over = (e) => {
            d.clone.style.left = `${e.clientX - d.offX}px`; d.clone.style.top = `${e.clientY - d.offY}px`;
            let before = null;
            for (const t of tabs()) { if (t === d.tab) continue; const b = t.getBoundingClientRect(); if (e.clientX < b.left + b.width / 2) { before = t; break; } }
            for (const t of tabs()) t.removeAttribute('data-over');
            if (before) before.setAttribute('data-over', '');
            d.before = before ? before.dataset.list : null;
        };
        tabsEl.addEventListener('click', (e) => { if (swallow) { e.stopPropagation(); e.preventDefault(); swallow = false; } }, true);
        tabsEl.addEventListener('pointerdown', (e) => {
            const tab = e.target instanceof Element ? e.target.closest('[role="tab"]') : null;
            if (!tab) return;
            d = { tab, list: tab.dataset.list, x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, ready: e.pointerType === 'mouse', clone: null, hold: null, before: null };
            if (e.pointerType !== 'mouse') d.hold = setTimeout(() => { if (d) d.ready = true; }, 220);
        });
        tabsEl.addEventListener('pointermove', (e) => {
            if (!d || e.pointerId !== d.id) return;
            const far = Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10;
            if (!d.moved) {
                if (!d.ready) { if (far) clear(); return; } // a finger that moved first is a scroll
                if (!far && e.pointerType === 'mouse') return;
                start(e);
            }
            e.preventDefault(); over(e);
        });
        const up = (e) => {
            if (!d || e.pointerId !== d.id) return;
            if (d.moved) {
                swallow = true;
                const ids = ui.lists.map((l) => l.id).filter((x) => x !== d.list);
                const at = d.before ? ids.indexOf(d.before) : ids.length;
                ids.splice(at < 0 ? ids.length : at, 0, d.list);
                const same = ids.length === ui.lists.length && ids.every((x, i) => x === ui.lists[i].id);
                clear();
                if (!same) void soft(ask('order-lists', { order: ids })).then(refresh);
            } else clear();
        };
        tabsEl.addEventListener('pointerup', up);
        tabsEl.addEventListener('pointercancel', () => { if (d?.moved) swallow = true; clear(); });
        return tabsEl;
    }
    const top = () => h('div', { class: 'binder-top', 'data-one': ui.lists.length === 1 ? '' : null },
        tabsDnd(h('div', { class: 'binder-tabs', role: 'tablist', 'aria-label': w('lists') }, ui.lists.map((l) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(l.id === ui.at), 'data-list': l.id,
            onclick: () => pick(l.id) }, mark(), h('span', { class: 'binder-tab-name' }, l.title), h('small', {}, String(l.count)))))),
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
            h('div', { class: 'binder-seg', role: 'group' }, [...['list', 'columns', 'cards'], ...(canMatrix(l) ? ['matrix'] : [])].map((v) => h('button', { type: 'button', 'aria-pressed': String(v === view), 'data-view': v, onclick: () => { ui.view = v; paint(); } }, w(v)))),
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
    const lead = (r) => (r.due && r.remindBefore ? h('span', { class: 'binder-lead', title: w('remind-before') }, ico('bell'), `−${r.remindBefore} ${w('days')}`) : null);
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
        r.due ? h('span', { class: late(l, r) ? 'binder-late' : null }, ico('clock'), when(r.due)) : null,
        lead(r),
        r.repeat ? h('span', { class: 'binder-repeat', title: w('recurrent') }, `↻${typeof r.repeat === 'number' ? ` ${r.repeat} ${w('days')}` : ''}`) : null,
        r.attached.length ? h('span', {}, `📎 ${r.attached.length}`) : null,
        r.notes.length ? h('span', {}, `✎ ${r.notes.length}`) : null);
    const sub = (r) => (r.description ? h('span', { class: 'binder-sub' }, firstLine(r.description)) : null);
    /* Its number, so a person can name it: small and faint, before the title. */
    const num = (r) => h('span', { class: 'binder-num' }, `#${r.id}`);
    /* The fields set, on one line: "Naissance 12 avril 1931 · Saint-Aubin". */
    /* The facts a situation strip does not already show (on a matrix list: its text, date, link fields). */
    const otherFacts = (l, r) => { const f = facts(l, r, lang).filter((x) => !Object.values(MATRIX_AXES).includes(x.id)); return f.length ? h('span', { class: 'binder-facts' }, f.map((x) => x.text).join(' · ')) : null; };
    const factLine = (l, r, cls = 'binder-facts') => { const f = facts(l, r, lang); return f.length ? h('span', { class: cls }, f.map((x) => x.text).join(' · ')) : null; };
    const leave = () => { ui.open = null; ui.more = false; ui.draft = {}; };
    const open = (r) => { void soft(ask('get', { id: r.id }).then((d) => { leave(); ui.from = null; ui.record = d; ui.mode = 'record'; paint(); })); };
    /* Its "‹": the page's own Back when it takes it, else one level up. */
    const up = () => { if (!onBack?.(here())) back(); };

    /* A quick per-card archive for the person (write access): no menu, no opening the card.
       Under the archived filter the same button restores. The drag and the card's own click
       leave a button alone, and it stops its click from opening the card. */
    const quickArchive = (l, r) => (l.access === 'write' ? h('button', { type: 'button', class: 'binder-arch', 'data-act': 'archive',
        title: w('archive'), 'aria-label': `${w('archive')}: #${r.n} ${r.title}`,
        onclick: (e) => { e.stopPropagation(); void soft(ask('archive', { id: r.id, restore: !!r.archived })).then(refresh); } }, r.archived ? '↺' : '⤓') : null);
    function asList(l, records) {
        return h('div', { class: 'binder-rows' }, records.map((r) => h('div', { class: 'binder-row', 'data-record': r.id, tabindex: '0', onclick: () => open(r), onkeydown: (e) => { if (e.key === 'Enter') open(r); } },
            tick(l, r), h('div', { class: 'binder-what' }, h('b', {}, num(r), ' ', r.title), factLine(l, r), sub(r), meta(l, r)), pill(l, r) ?? h('span'), quickArchive(l, r))));
    }
    /* Drag a card from one column to another to change its state. Works with a finger (press and hold)
       and with a mouse; a plain tap/click still opens the card. The server still guards a gate. */
    function columnsDnd(colsEl, l) {
        if (l.access !== 'write') return colsEl;
        let d = null; let swallow = false;
        const clear = () => {
            if (!d) return;
            clearTimeout(d.hold); d.clone?.remove();
            d.card?.classList.remove('binder-drag-src');
            for (const c of colsEl.querySelectorAll('.binder-col[data-over]')) c.removeAttribute('data-over');
            try { colsEl.releasePointerCapture(d.id); } catch { /* gone */ }
            d = null;
        };
        const start = (e) => {
            const r = d.card.getBoundingClientRect();
            d.offX = e.clientX - r.left; d.offY = e.clientY - r.top; d.moved = true;
            try { colsEl.setPointerCapture(d.id); } catch { /* ok */ }
            const clone = d.card.cloneNode(true); clone.className = 'binder-card binder-drag-clone'; clone.style.width = `${r.width}px`;
            document.body.append(clone); d.clone = clone; d.card.classList.add('binder-drag-src');
        };
        const over = (e) => {
            d.clone.style.left = `${e.clientX - d.offX}px`; d.clone.style.top = `${e.clientY - d.offY}px`;
            d.clone.style.visibility = 'hidden';
            const under = document.elementFromPoint?.(e.clientX, e.clientY);
            d.clone.style.visibility = '';
            const col = under instanceof Element ? under.closest('.binder-col') : null;
            for (const c of colsEl.querySelectorAll('.binder-col[data-over]')) if (c !== col) c.removeAttribute('data-over');
            if (col && col.dataset.state !== d.from) col.setAttribute('data-over', '');
        };
        colsEl.addEventListener('click', (e) => { if (swallow) { e.stopPropagation(); e.preventDefault(); swallow = false; } }, true);
        colsEl.addEventListener('pointerdown', (e) => {
            const card = e.target instanceof Element ? e.target.closest('.binder-card') : null;
            if (!card || e.target.closest('button, a, input, select, label, .binder-pill, .binder-state')) return;
            const col = card.closest('.binder-col');
            d = { card, record: card.dataset.record, from: col?.dataset.state, x: e.clientX, y: e.clientY, id: e.pointerId, moved: false, ready: e.pointerType === 'mouse', clone: null, hold: null };
            if (e.pointerType !== 'mouse') d.hold = setTimeout(() => { if (d) d.ready = true; }, 180);
        });
        colsEl.addEventListener('pointermove', (e) => {
            if (!d || e.pointerId !== d.id) return;
            const far = Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10;
            if (!d.moved) {
                if (!d.ready) { if (far) clear(); return; } // a finger that moved first is a scroll
                if (!far && e.pointerType === 'mouse') return;
                start(e);
            }
            e.preventDefault(); over(e);
        });
        const up = (e) => {
            if (!d || e.pointerId !== d.id) return;
            if (d.moved) {
                const target = colsEl.querySelector('.binder-col[data-over]');
                const state = target?.dataset.state; const record = d.record; swallow = true; clear();
                if (state && record) void soft(ask('move', { id: record, state })).then(refresh);
            } else clear();
        };
        colsEl.addEventListener('pointerup', up);
        colsEl.addEventListener('pointercancel', () => { if (d?.moved) swallow = true; clear(); });
        return colsEl;
    }
    function asColumns(l, records) {
        return columnsDnd(h('div', { class: 'binder-cols' }, l.states.map((s) => {
            const here = records.filter((r) => r.state === s.id);
            return h('section', { class: 'binder-col', 'data-state': s.id }, h('h3', {}, sn(s), h('span', {}, String(here.length))),
                here.map((r) => h('div', { class: 'binder-card', 'data-record': r.id, tabindex: '0', onclick: () => open(r), onkeydown: (e) => { if (e.key === 'Enter') open(r); } }, h('b', {}, num(r), ' ', r.title), factLine(l, r), sub(r), meta(l, r), quickArchive(l, r))));
        })), l);
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
                h('b', {}, num(r), ' ', r.title), src ? null : sub(r), factLine(l, r, 'binder-facts binder-facts-small'), pill(l, r), quickArchive(l, r));
        }));
    }
    /* THE MATRIX: urgency across, importance up; effort sizes the bubble,
       delegability tints it (dark = keep, light = hand off), a halo marks what
       changed lately. A card with both axes is a bubble that opens on a tap; the
       rest wait below, "to place". Clicking a bubble opens the card to score it. */
    const fieldName = (l, id) => l.fields.find((f) => f.id === id)?.name ?? id;
    /* Set by the matrix each time it is drawn: leaves its fullscreen cover (Escape calls it). */
    let matrixLeave = null; let matrixTrailClear = null; let matrixSideClear = null;
    /* The matrix's own view state, kept across repaints (and reset when the binder changes):
       which owner categories are hidden, and whether the delegability arcs show. */
    let mxFor = null; let mxHide = new Set(); let mxRings = true; let mxMove = false; let mxNote = null; let mxFs = false; let mxFocus = 'all'; let mxLate = false; let mxTexts = true; let mxHideOthers = false; let mxMeOnly = false;
    const s100 = (v) => Math.max(0, Math.min(100, Number(v) || 0));
    /* THE MATRIX: urgency across (→), importance up (↑); a point's HUE says who owns it
       (gold = me, one colour per person, grey = nobody), its SIZE says the charge, and a thin
       neutral ARC on my own points says how delegable each is. The legend is clickable: a tap
       hides/shows a category (or the arcs); quick chips cadrent moi / délégué. A point opens a
       short card with a tail; the rest wait below, "to place". */
    function asMatrix(l, records) {
        const done = l.states.find((s) => s.done);
        const placed = []; const rest = [];
        for (const r of records) (urgencyOf(r) !== null && score(r, MATRIX_AXES.y) !== null ? placed : rest).push(r);
        const X = MATRIX_AXES.x; const Y = MATRIX_AXES.y; const SIZE = MATRIX_AXES.size; const TINT = MATRIX_AXES.tint;
        const stName = (r) => l.states.find((s) => s.id === r.state)?.name ?? r.state;
        const snippet = (t) => { const s = String(t).replace(/\s+/g, ' ').trim(); return s.length > 160 ? `${s.slice(0, 159)}…` : s; };
        /* Who owns a card: me when I am among its owners, else the first other person, else nobody.
           Colour per category: me gold, each person a stable palette slot, nobody neutral grey. */
        const meId = (people() || []).find((p) => p.me)?.id ?? null;
        /* Who it is with: mine, else its first other owner -- a person or a conversation (an
           agent it was handed to is delegated too) -- else nobody. */
        /* Who carries it: its first owner (me, a person, a conversation), else nobody. */
        const asCat = (id) => (meId && id === meId ? 'me' : id);
        const ownerCat = (r) => { const os = (r.owners ?? []).filter((id) => typeof id === 'string'); return os.length ? asCat(os[0]) : 'none'; };
        /* The other one on a card (#177), its second owner: who could take part of mine, or where
           I come in on someone else's. Its arc wears their colour and runs over their share; on one
           of mine with nobody named yet, the arc is grey and dashed -- a wish, still all mine. */
        const helperOf = (r) => { const os = (r.owners ?? []).filter((id) => typeof id === 'string'); return os.length > 1 ? asCat(os[1]) : null; };
        /* Every card with someone on it is a point, in the colour of who carries it -- what I handed
           to someone stays in sight. (Seeing only mine is a tap away: "Mine" in the legend.) A card
           of nobody's is no point: it waits below, to be given to someone. */
        const unowned = meId ? placed.filter((r) => ownerCat(r) === 'none') : [];
        if (meId) { const someone = placed.filter((r) => ownerCat(r) !== 'none'); placed.length = 0; placed.push(...someone); }
        const present = new Set([...placed.map(ownerCat), ...placed.map(helperOf).filter(Boolean)]);
        /* Each delegate its own colour, in the order people() gives them, then any other owner seen. */
        const known = (people() || []).map((p) => p.id);
        const delegates = [...known.filter((id) => id !== meId && present.has(id)), ...[...present].filter((c) => c !== 'me' && c !== 'none' && !known.includes(c))];
        const personIndex = new Map(delegates.map((id, i) => [id, i]));
        const colorOf = (cat) => (cat === 'me' ? 'var(--bm-me)' : cat === 'none' ? 'var(--bm-none)' : `var(--bm-${(personIndex.get(cat) ?? 0) % 6 + 1})`);
        const labelFor = (cat) => (cat === 'me' ? w('legend-me') : cat === 'none' ? w('legend-none') : nameOf(cat).replace(/^[a-z]+:/, ''));
        const cats = [...(present.has('me') ? ['me'] : []), ...delegates, ...(present.has('none') ? ['none'] : [])];
        const anyGauge = placed.some((r) => (ownerCat(r) === 'me' || helperOf(r)) && s100(score(r, TINT)) > 0 && score(r, TINT) !== null);
        /* Fresh binder: hide "nobody" by default (the least useful) — but only when there is
           something else to show, so a list where nobody is assigned is not an empty plot. */
        /* First seen: what concerns me -- mine, and theirs where I come in (by their arc). The rest a
           tap away (the legend, "All"). With nothing of mine, all is shown but nobody's. */
        if (mxFor !== l.id) { mxFor = l.id; mxHide = new Set(!meId && present.has('none') && present.size > 1 ? ['none'] : []); mxRings = true; }
        const MINR = 0.6; const MAXR = 2.2;
        const dot = (r) => {
            const x = urgencyOf(r); const y = score(r, Y);
            const c = score(r, SIZE); const d = score(r, TINT);
            const cat = ownerCat(r); const mine = cat === 'me';
            const helper = helperOf(r);
            /* Theirs where I come in always shows my arc: at least 5 %, even with my share unsaid. */
            const dd = helper === 'me' && !mine ? Math.max(5, d ?? 0) : d;
            const hasGauge = (mine || helper !== null) && dd !== null && dd > 0;
            /* Its size is its whole charge, the same for everyone who looks at it. Inside, a disc in
               the carrier's colour is what they do; the ring around it, in the reinforcement's colour,
               is the reinforcement's share -- by AREA: the disc's radius is the whole radius times
               the square root of what the carrier keeps. A ring stays 2.5 px at least, to be seen. */
            const share = c === null || dd === null ? null : mine && helper ? Math.round(c * (100 - s100(dd)) / 100) : helper === 'me' ? Math.round(c * s100(dd) / 100) : null;
            const dia = MINR + (s100(c ?? 20) / 100) * (MAXR - MINR);
            const keep = hasGauge ? Math.min(Math.sqrt(1 - s100(dd) / 100), 1 - 2.5 / (dia * 8)) : 1;
            const facts = [`${fieldName(l, X)} ${x}${urgencyAuto(r) ? ` (${w('auto')})` : ''}`, `${fieldName(l, Y)} ${y}`];
            if (c !== null) facts.push(`${fieldName(l, SIZE)} ${c}${share !== null ? ` · ${w('my-share')} ${share}` : ''}`);
            if (d !== null) facts.push(`${fieldName(l, TINT)} ${d}${hasGauge ? ` → ${helper ? labelFor(helper) : w('nobody-yet')}` : ''}`);
            const late = lateOf(r, done?.id); const calling = callingOf(r, done?.id);
            if (calling) facts.push(`${w(late ? 'late' : 'due-soon')} (${String(r.due).slice(0, 16)})`);
            const gauge = h('button', { type: 'button', class: `binder-dot${hasGauge ? ` has-gauge${helper ? '' : ' gauge-wish'}` : ''}`, 'data-helper': helper, 'data-record': r.id, 'data-fresh': fresh(r) ? '' : null,
                'data-done': done && r.state === done.id ? '' : null, 'aria-haspopup': 'true',
                'aria-label': `${r.title} — ${facts.join(' · ')}`,
                onclick: (e) => {
                    e.stopPropagation();
                    const wrap = e.currentTarget.closest('.binder-dot-wrap');
                    const was = wrap?.classList?.contains?.('open');
                    for (const o of document.querySelectorAll?.('.binder-dot-wrap.open') ?? []) o.classList.remove('open');
                    if (wrap && !was) { wrap.classList?.add?.('open'); pick(r, card); void showTrail(r); } else { clearTrail(); pick(null); }
                },
                /* A mouse over a point: its summary in the panel, for a moment; the one picked comes back after. */
                onpointerenter: (e) => { if (e.pointerType === 'mouse') peek(card); },
                onpointerleave: (e) => { if (e.pointerType === 'mouse') peek(null); } }, h('span', { class: 'binder-dot-fill' }));
            /* "Only me": my part in gold, everyone else's in one neutral grey -- places and sizes kept. */
            const paint = (k) => (mxMeOnly && k !== 'me' ? 'var(--bm-others, var(--bm-none))' : colorOf(k));
            gauge.style?.setProperty('--c', paint(cat));
            if (hasGauge) { gauge.style?.setProperty('--pct', String(Math.round(s100(dd)))); gauge.style?.setProperty('--k', `${(keep * 100).toFixed(1)}%`); }
            if (hasGauge && helper) gauge.style?.setProperty('--arc', paint(helper));
            const label = h('span', { class: 'binder-dot-label', lang, 'aria-hidden': 'true' }, r.title);
            const whoDot = h('span', { class: 'binder-who-dot' }); whoDot.style?.setProperty('background', colorOf(cat));
            const card = h('div', { class: 'binder-dot-card' },
                h('div', { class: 'binder-pop-head' }, h('span', { class: 'binder-pop-id' }, `#${r.n}`), h('span', { class: 'binder-pop-t' }, r.title)),
                h('div', { class: 'binder-pop-who' }, whoDot, document.createTextNode(`${labelFor(cat)} · ${stName(r)}`)),
                situation(l, r, { compact: true }) ?? h('div', { class: 'binder-pop-facts' }, facts.join(' · ')),
                calling ? h('div', { class: 'binder-pop-facts' }, `${w(late ? 'late' : 'due-soon')} (${String(r.due).slice(0, 16)})`) : null,
                r.description ? h('p', { class: 'binder-pop-desc' }, snippet(r.description)) : null,
                h('button', { type: 'button', class: 'binder-pop-open', onclick: () => open(r) }, w('open-card')));
            /* Late: a soft halo further out than the arc, that calls a few times then stays; a "!" beside. */
            const wrap = h('div', { class: `binder-dot-wrap${calling ? ' binder-calling' : ''}${late ? ' binder-late' : ''}`, 'data-record': r.id, 'data-side': x >= 72 ? 'left' : null },
                calling ? h('span', { class: 'binder-halo', 'aria-hidden': 'true' }) : null, gauge, late ? h('span', { class: 'binder-late-mark', 'aria-hidden': 'true' }, '!') : null, label);
            wrap.style?.setProperty('left', `${x}%`);
            wrap.style?.setProperty('bottom', `${y}%`);
            wrap.style?.setProperty('--dot', `${dia.toFixed(2)}rem`);
            wrap.style?.setProperty('--r', `${(dia / 2).toFixed(3)}rem`);
            return wrap;
        };
        /* THE SIDE PANEL: a point's summary beside the square (below it on a phone), never over the
           points or their path. A mouse over a point shows it for a moment; a tap keeps it. */
        const side = h('aside', { class: 'binder-side', 'aria-live': 'polite' });
        const hint = () => h('p', { class: 'binder-side-hint' }, w('pick-point'));
        let picked = null;
        const pick = (r, el) => { picked = r ? el : null; side.replaceChildren(picked ?? hint()); side.classList?.toggle?.('binder-side-on', Boolean(picked)); };
        const peek = (el) => { side.replaceChildren(el ?? picked ?? hint()); side.classList?.toggle?.('binder-side-on', Boolean(el ?? picked)); };
        pick(null);
        matrixSideClear = () => pick(null);
        const quad = (k, cls) => h('div', { class: `binder-quad ${cls}` }, h('span', {}, w(k)));
        const plot = h('div', { class: 'binder-plot', role: 'group', 'aria-label': `${fieldName(l, X)} · ${fieldName(l, Y)}` },
            quad('q-plan', 'binder-q-tl'), quad('q-do', 'binder-q-tr'), quad('q-later', 'binder-q-bl'), quad('q-delegate', 'binder-q-br'),
            h('div', { class: 'binder-mid-x' }), h('div', { class: 'binder-mid-y' }),
            h('div', { class: 'binder-axis binder-axis-x' }, `${fieldName(l, X)} →`),
            h('div', { class: 'binder-axis binder-axis-y' }, h('span', {}, `${fieldName(l, Y)} →`)),
            h('div', { class: 'binder-plot-empty' }, w('all-hidden')));
        /* Tapped, a card shows its path (#167): faint arrows from where it stood to where it
           stands, the older the fainter. Drawn on the page only, the layer made on first use. */
        const SVG = 'http://www.w3.org/2000/svg';
        let trail = null; let trailFor = null;
        const clearTrail = () => { trailFor = null; trail?.replaceChildren(); };
        const showTrail = async (r) => {
            trailFor = r.id;
            const got = await ask('get', { id: r.id }).catch(() => null);
            if (trailFor !== r.id || !got || !document.createElementNS) return;
            const pts = trailOf(got.history, r);
            const el = (tag, attrs) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };
            if (!trail) {
                trail = el('svg', { class: 'binder-trail', viewBox: '0 0 100 100', 'aria-hidden': 'true' });
                plot.insertBefore(trail, plot.querySelector?.('.binder-dot-wrap') ?? null);
            }
            const head = el('marker', { id: 'binder-trail-head', viewBox: '0 0 6 6', refX: 5, refY: 3, markerWidth: 2.2, markerHeight: 2.2, markerUnits: 'userSpaceOnUse', orient: 'auto' });
            head.append(el('path', { d: 'M0,0 L6,3 L0,6 z' }));
            const defs = el('defs', {}); defs.append(head);
            const kids = [defs]; const n = pts.length;
            for (let i = 1; i < n; i++) {
                const a = { x: pts[i - 1].x, y: 100 - pts[i - 1].y }; const b = { x: pts[i].x, y: 100 - pts[i].y };
                const len = Math.hypot(b.x - a.x, b.y - a.y);
                if (len < 0.5) continue;
                /* Stop short of the point it reaches, so the head is seen, not hidden under it. */
                const ux = (b.x - a.x) / len; const uy = (b.y - a.y) / len; const cut = Math.min(3.2, len / 2); const back = Math.min(1, len / 4);
                kids.push(el('line', { x1: a.x + ux * back, y1: a.y + uy * back, x2: b.x - ux * cut, y2: b.y - uy * cut, 'marker-end': 'url(#binder-trail-head)', opacity: (0.3 + 0.5 * (i / (n - 1))).toFixed(2) }));
            }
            for (let i = 0; i < n - 1; i++) kids.push(el('circle', { cx: pts[i].x, cy: 100 - pts[i].y, r: 0.7, opacity: (0.3 + 0.4 * (i / Math.max(1, n - 1))).toFixed(2) }));
            trail.replaceChildren(...kids);
        };
        matrixTrailClear = clearTrail;
        let dotEls = [];
        const renderDots = () => {
            for (const n of dotEls) n.remove();
            dotEls = [];
            /* The legend filters by colour (#177): a person shown brings along my cards they could
               take (mine faded, their arc plain); a person hidden takes their arc off mine. */
            const helped = (r) => { const hp = helperOf(r); return hp !== null && !mxHide.has(hp); };
            /* "Mine": what I carry only; else a card is shown when its carrier, or its helper, is. */
            /* "I carry" / "Reinforcing": the rest faded -- or, if the person chose so in the legend, hidden. */
            const outOfFocus = (r) => (mxFocus === 'carry' ? ownerCat(r) !== 'me' : mxFocus === 'help' ? helperOf(r) !== 'me' : false);
            const shown = placed.filter((r) => (!mxHide.has(ownerCat(r)) || helped(r)) && (!mxLate || callingOf(r, done?.id)) && !(mxHideOthers && outOfFocus(r)));
            /* More than three calling: the halos stay still, or the whole square would blink. */
            plot.classList?.toggle?.('binder-late-many', shown.filter((r) => callingOf(r, done?.id)).length > 3);
            plot.classList?.toggle?.('binder-is-empty', shown.length === 0);
            plot.classList?.toggle?.('binder-gauges-off', !mxRings);
            plot.classList?.toggle?.('binder-names-off', !mxTexts);
            for (const r of shown) {
                const el = dot(r); dotEls.push(el); plot.append(el);
                const hp = helperOf(r);
                /* "I carry" / "Reinforcing": what is not so is faded, never hidden -- I am in on all. */
                const off = outOfFocus(r);
                if (off || mxHide.has(ownerCat(r))) el.classList?.add?.('binder-faint');
                else if (hp !== null && mxHide.has(hp)) el.classList?.add?.('binder-arc-off');
            }
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => placeLabels());
        };
        /* The names, placed around their points by placeNames (above): measured on the page once
           drawn, and again when the square changes size. A name set a little away from its point
           gets a hairline back to it; one with no room anywhere is left to its summary. */
        let leaders = null;
        const placeLabels = () => {
            if (!plot.isConnected || !plot.getBoundingClientRect) return;
            const area = plot.getBoundingClientRect();
            const rel = (b) => ({ left: b.left - area.left, top: b.top - area.top, right: b.right - area.left, bottom: b.bottom - area.top });
            const items = dotEls.map((wrap) => ({ point: wrap.querySelector('.binder-dot'), label: wrap.querySelector('.binder-dot-label'), left: wrap.dataset?.side === 'left' })).filter((d) => d.point && d.label);
            for (const d of items) { d.label.classList.remove('binder-name-hidden', 'left', 'narrow'); d.label.style.transform = 'none'; }
            const size = (e) => { const b = e.getBoundingClientRect(); return { w: Math.ceil(b.width), h: Math.ceil(b.height) }; };
            const dots = items.map((d) => {
                const p = d.point.getBoundingClientRect(); const wide = size(d.label);
                d.label.classList.add('narrow'); const narrow = size(d.label); d.label.classList.remove('narrow');
                /* A point with an arc reaches 6px further (its ring). */
                return { x: p.left - area.left + p.width / 2, y: p.top - area.top + p.height / 2, r: p.width / 2 + (d.point.closest('.binder-calling') ? 5 : 0), ...wide, narrow: narrow.w < wide.w ? narrow : null, left: d.left };
            });
            const walls = [...plot.querySelectorAll('.binder-quad span')].map((e) => rel(e.getBoundingClientRect()));
            const spots = placeNames(dots, { w: area.width, h: area.height }, walls);
            const SVGNS = 'http://www.w3.org/2000/svg';
            if (!leaders && document.createElementNS) { leaders = document.createElementNS(SVGNS, 'svg'); leaders.setAttribute('class', 'binder-leaders'); leaders.setAttribute('aria-hidden', 'true'); plot.insertBefore(leaders, plot.querySelector('.binder-dot-wrap')); }
            const lines = [];
            items.forEach((d, i) => {
                const s = spots[i]; const o = dots[i];
                if (!s) { d.label.classList.add('binder-name-hidden'); return; }
                const sz = s.narrow ? o.narrow : o;
                d.label.classList.toggle('narrow', s.narrow);
                d.label.style.transform = `translate(${(s.x - o.x).toFixed(1)}px, ${(s.y - o.y).toFixed(1)}px)`;
                d.label.classList.toggle('left', s.x + sz.w / 2 < o.x);
                if (s.lead && leaders) {
                    const ex = Math.max(s.x, Math.min(o.x, s.x + sz.w)); const ey = Math.max(s.y, Math.min(o.y, s.y + sz.h));
                    const len = Math.hypot(ex - o.x, ey - o.y) || 1;
                    const ln = document.createElementNS(SVGNS, 'line');
                    const from = o.r + 1.5; const back = 2;
                    for (const [k, v] of Object.entries({ x1: o.x + (ex - o.x) / len * from, y1: o.y + (ey - o.y) / len * from, x2: ex - (ex - o.x) / len * back, y2: ey - (ey - o.y) / len * back })) ln.setAttribute(k, v.toFixed(1));
                    ln.setAttribute('data-record', d.point.getAttribute('data-record'));
                    if (d.point.closest?.('.binder-dot-wrap')?.classList?.contains?.('binder-faint')) ln.setAttribute('class', 'binder-faint');
                    lines.push(ln);
                }
            });
            leaders?.replaceChildren(...lines);
        };
        if (typeof ResizeObserver === 'function') { let was = 0; new ResizeObserver(([e]) => { const now = Math.round(e.contentRect.width); if (now !== was) { was = now; requestAnimationFrame(() => placeLabels()); } }).observe(plot); }
        /* The legend, built from the categories actually present, each a show/hide toggle; then
           (where any exists) the delegability arcs toggle, and the size key. */
        const legBtns = new Map();
        const legend = h('div', { class: 'binder-legend' });
        const sync = () => { for (const [cat, b] of legBtns) b.setAttribute('aria-pressed', String(!mxHide.has(cat))); if (ringBtn) ringBtn.setAttribute('aria-pressed', String(mxRings)); textBtn.setAttribute('aria-pressed', String(mxTexts)); meOnlyBtn?.setAttribute('aria-pressed', String(mxMeOnly)); for (const [cat, b] of legBtns) b.classList?.toggle?.('binder-leg-grey', mxMeOnly && cat !== 'me'); hideBtn.setAttribute('aria-pressed', String(mxHideOthers)); hideBtn.hidden = mxFocus === 'all'; for (const [f, b] of focusBtns) b.setAttribute('aria-pressed', String(f === mxFocus)); renderDots(); };
        for (const cat of cats) {
            const sw = h('span', { class: 'binder-leg-sw' }); sw.style?.setProperty('background', colorOf(cat));
            const b = h('button', { type: 'button', class: 'binder-leg' }, sw, document.createTextNode(labelFor(cat)));
            b.addEventListener('click', () => { if (mxHide.has(cat)) mxHide.delete(cat); else mxHide.add(cat); sync(); });
            legBtns.set(cat, b); legend.append(b);
        }
        let ringBtn = null;
        if (anyGauge) {
            legend.append(h('span', { class: 'binder-leg-sep' }));
            ringBtn = h('button', { type: 'button', class: 'binder-leg' }, h('span', { class: 'binder-ring-glyph' }), document.createTextNode(w('delegability')));
            ringBtn.addEventListener('click', () => { mxRings = !mxRings; sync(); });
            legend.append(ringBtn);
        }
        /* The names on or off: the square alone, to read the points. */
        legend.append(h('span', { class: 'binder-leg-sep' }));
        const textBtn = h('button', { type: 'button', class: 'binder-leg binder-leg-texts', 'aria-pressed': String(mxTexts) }, h('span', { class: 'binder-texts-glyph', 'aria-hidden': 'true' }, 'Aa'), document.createTextNode(w('mx-texts')));
        textBtn.addEventListener('click', () => { mxTexts = !mxTexts; sync(); });
        legend.append(textBtn);
        /* "Only me": what is mine in gold, the rest in one grey; with "I carry" the discs read, with
           "Reinforcing" the rings. Only where I am among the points. */
        const meOnlyBtn = meId ? h('button', { type: 'button', class: 'binder-leg binder-leg-meonly', 'aria-pressed': String(mxMeOnly) }, h('span', { class: 'binder-meonly-glyph', 'aria-hidden': 'true' }), document.createTextNode(w('mx-me-only'))) : null;
        meOnlyBtn?.addEventListener('click', () => { mxMeOnly = !mxMeOnly; sync(); });
        if (meOnlyBtn) legend.append(meOnlyBtn);
        /* With "I carry" or "Reinforcing": the others faded (the default), or hidden. */
        const hideBtn = h('button', { type: 'button', class: 'binder-leg binder-leg-hide', 'aria-pressed': String(mxHideOthers) }, h('span', { class: 'binder-hide-glyph', 'aria-hidden': 'true' }, '◌'), document.createTextNode(w('mx-hide-others')));
        hideBtn.hidden = mxFocus === 'all';
        hideBtn.addEventListener('click', () => { mxHideOthers = !mxHideOthers; sync(); });
        legend.append(hideBtn);
        /* Late ones (#181): counted; a tap shows only them, again shows all. */
        const lateCount = placed.filter((r) => callingOf(r, done?.id)).length;
        let lateBtn = null;
        if (lateCount) {
            legend.append(h('span', { class: 'binder-leg-sep' }));
            /* A filter, not a show/hide: never struck through; marked while it narrows the square. */
            lateBtn = h('button', { type: 'button', class: 'binder-leg binder-leg-late', 'data-on': mxLate ? 'true' : null }, h('span', { class: 'binder-late-glyph', 'aria-hidden': 'true' }), document.createTextNode(`${w('to-handle')} · ${lateCount}`));
            lateBtn.addEventListener('click', () => { mxLate = !mxLate; if (mxLate) lateBtn.setAttribute('data-on', 'true'); else lateBtn.removeAttribute?.('data-on'); renderDots(); });
            legend.append(lateBtn);
        } else mxLate = false;
        legend.append(h('span', { class: 'binder-size-key' }, h('span', { class: 'binder-sz binder-sz1' }), h('span', { class: 'binder-sz binder-sz2' }), h('span', { class: 'binder-sz binder-sz3' }), document.createTextNode(` ${w('legend-size')}`)));
        /* What to bring forward: all, what I carry, where I am the reinforcement. The rest is
           faded, never hidden -- I am in on every card, and the square says so. */
        const focusBtns = new Map();
        const focusChip = (key, focus) => { const b = h('button', { type: 'button', class: 'binder-chip', 'data-focus': focus, 'aria-pressed': String(mxFocus === focus) }, w(key)); b.addEventListener('click', () => { mxFocus = focus; if (focus === 'all') mxHide = new Set(); sync(); }); focusBtns.set(focus, b); return b; };
        const chips = h('div', { class: 'binder-mx-chips', role: 'group', 'aria-label': w('shortcuts') }, h('span', { class: 'binder-mx-lab' }, w('shortcuts')),
            focusChip('mx-all', 'all'), ...(meId ? [focusChip('mx-carry', 'carry'), focusChip('mx-help', 'help')] : []));
        /* Fullscreen, for reading on a tablet: the real Fullscreen API where it is granted, and in
           every case a CSS cover (position:fixed) so the button always works. Escape or the button
           leaves it (the key is caught below, next to the one that closes a menu). */
        const fsBtn = h('button', { type: 'button', class: 'binder-ghost binder-small binder-fs', 'aria-pressed': 'false', 'aria-label': w('fullscreen'), title: w('fullscreen') }, '⛶');
        /* MOVING (#174): a mode, so a point never moves by accident. In it a point is taken and
           set down -- by finger, pen or mouse -- and its urgency and importance follow it. The
           page is kept still under the finger, the point grows and its values show above it.
           Saved on release; "Undo" stays a few seconds. A tap still opens its summary. */
        const moveBtn = l.access === 'write' ? h('button', { type: 'button', class: 'binder-ghost binder-small binder-move-btn', 'aria-pressed': String(mxMove) }, `✥ ${w('mx-move')}`) : null;
        const note = h('div', { class: 'binder-move-note', role: 'status', 'aria-live': 'polite' });
        note.hidden = true;
        let noteTimer = null;
        /* The note outlives a repaint (a save brings one): kept with its end time. */
        const say = (text, undo, until = Date.now() + 7000) => {
            clearTimeout(noteTimer);
            mxNote = { text, undo, until };
            note.replaceChildren(h('span', {}, text), undo ? h('button', { type: 'button', class: 'binder-ghost binder-small', onclick: () => { note.hidden = true; mxNote = null; undo(); } }, w('undo')) : null);
            note.hidden = false;
            noteTimer = setTimeout(() => { note.hidden = true; mxNote = null; }, Math.max(0, until - Date.now()));
        };
        const setMove = (on) => { mxMove = on; moveBtn?.setAttribute('aria-pressed', String(on)); plot.classList?.toggle?.('binder-moving', on); if (!on) { note.hidden = true; mxNote = null; } };
        moveBtn?.addEventListener('click', () => setMove(!mxMove));
        /* Redraw one point where its record now stands, its name placed again. */
        const redraw = (r) => { const i = dotEls.findIndex((e) => e.getAttribute('data-record') === r.id); if (i < 0) return; const el = dot(r); dotEls[i].replaceWith(el); dotEls[i] = el; placeLabels(); };
        const put = async (r, to, back) => {
            const before = { fields: { ...r.fields }, urgencyFrom: r.urgencyFrom ?? null };
            const wasAuto = urgencyAuto(r);
            r.fields = { ...r.fields, [X]: to.x, [Y]: to.y }; if (wasAuto) r.urgencyFrom = null;
            redraw(r);
            try { await ask('edit', { id: r.id, fields: { [X]: to.x, [Y]: to.y }, ...(wasAuto ? { urgencyFrom: 'none' } : {}) }); } catch { Object.assign(r, before); redraw(r); return; }
            if (back) return;
            say(`${w(wasAuto ? 'mx-moved-hand' : 'mx-moved')} ${fieldName(l, X)} ${to.x} · ${fieldName(l, Y)} ${to.y}`, async () => {
                r.fields = before.fields; r.urgencyFrom = before.urgencyFrom; redraw(r);
                await soft(ask('edit', { id: r.id, fields: { [X]: before.fields[X] ?? null, [Y]: before.fields[Y] ?? null }, ...(wasAuto ? { urgencyFrom: before.urgencyFrom } : {}) }));
            });
        };
        let drag = null; let swallow = false;
        plot.addEventListener('pointerdown', (e) => {
            if (!mxMove) return;
            const pt = e.target.closest?.('.binder-dot'); if (!pt) return;
            const r = placed.find((x) => x.id === pt.getAttribute('data-record')); if (!r) return;
            drag = { r, wrap: pt.closest('.binder-dot-wrap'), id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, at: null };
            try { pt.setPointerCapture(e.pointerId); } catch { /* the plot still hears it */ }
        });
        plot.addEventListener('pointermove', (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
            e.preventDefault();
            const a = plot.getBoundingClientRect();
            const x = Math.round(Math.max(0, Math.min(100, ((e.clientX - a.left) / a.width) * 100)));
            const y = Math.round(Math.max(0, Math.min(100, ((a.bottom - e.clientY) / a.height) * 100)));
            if (!drag.moved) { drag.moved = true; drag.wrap.classList.add('binder-dragging'); for (const o of plot.querySelectorAll('.binder-dot-wrap.open')) o.classList.remove('open'); clearTrail(); }
            drag.at = { x, y };
            drag.wrap.style.setProperty('left', `${x}%`); drag.wrap.style.setProperty('bottom', `${y}%`);
            drag.wrap.setAttribute('data-reading', `${fieldName(l, X)} ${x} · ${fieldName(l, Y)} ${y}`);
        });
        const drop = (e) => {
            if (!drag || e.pointerId !== drag.id) return;
            const d = drag; drag = null;
            d.wrap.classList.remove('binder-dragging'); d.wrap.removeAttribute('data-reading');
            if (!d.moved || !d.at) return;
            swallow = true; setTimeout(() => { swallow = false; }, 0);
            if (e.type === 'pointercancel') { redraw(d.r); return; }
            void put(d.r, d.at);
        };
        plot.addEventListener('pointerup', drop); plot.addEventListener('pointercancel', drop);
        plot.addEventListener('click', (e) => { if (swallow) { e.stopPropagation(); e.preventDefault(); swallow = false; } }, true);
        const bar = h('div', { class: 'binder-matrix-bar' }, chips, h('span', { class: 'binder-mx-spacer' }), moveBtn, fsBtn);
        const unplaced = rest.length ? h('div', { class: 'binder-unplaced' },
            h('h3', {}, `${w('to-place')} (${rest.length})`),
            h('div', { class: 'binder-unplaced-row' }, rest.map((r) => h('button', { type: 'button', class: 'binder-chip binder-unplaced-chip', 'data-record': r.id, onclick: () => open(r) }, `#${r.n} ${r.title}`)))) : null;
        const nobodys = unowned.length ? h('div', { class: 'binder-unplaced' },
            h('h3', {}, `${w('legend-none')} (${unowned.length})`),
            h('div', { class: 'binder-unplaced-row' }, unowned.map((r) => h('button', { type: 'button', class: 'binder-chip binder-unplaced-chip', 'data-record': r.id, onclick: () => open(r) }, `#${r.n} ${r.title}`)))) : null;
        /* One block, centred: the square with its legend under it, the panel beside (on a phone,
           the panel right under the square, before the legend). */
        const root = h('div', { class: 'binder-matrix' }, bar, note, h('div', { class: 'binder-stage' }, plot, side, legend), unplaced, nobodys);
        setMove(mxMove);
        if (mxNote && mxNote.until > Date.now()) say(mxNote.text, mxNote.undo, mxNote.until);
        const setFs = () => { const on = root.classList?.contains?.('binder-matrix-max') ?? false; fsBtn.textContent = on ? '⤢' : '⛶'; fsBtn.title = on ? w('fullscreen-exit') : w('fullscreen'); fsBtn.setAttribute('aria-pressed', String(on)); if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => placeLabels()); };
        const enter = () => { mxFs = true; root.classList?.add?.('binder-matrix-max'); setFs(); try { root.requestFullscreen?.().catch(() => {}); } catch { /* not granted: the cover stands in */ } };
        const leave = () => { mxFs = false; root.classList?.remove?.('binder-matrix-max'); setFs(); try { if (document.fullscreenElement === root) document.exitFullscreen?.(); } catch { /* already out */ } };
        fsBtn.addEventListener('click', () => ((root.classList?.contains?.('binder-matrix-max') ?? false) ? leave() : enter()));
        root.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && root.classList.contains('binder-matrix-max')) { mxFs = false; root.classList.remove('binder-matrix-max'); setFs(); } });
        /* Kept across a repaint (a save while moving points): the cover only, the real API asks a gesture. */
        if (mxFs) { root.classList?.add?.('binder-matrix-max'); setFs(); }
        matrixLeave = leave;
        sync();
        return root;
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
        const whoParts = [names ? h('span', {}, ico('person'), names) : null, r.due ? h('span', { class: late(l, r) ? 'binder-late' : null }, ico('clock'), when(r.due)) : null, lead(r)].filter(Boolean);
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
            /* Recurrence: not recurrent, every so many days, or recurrent with no fixed rhythm.
               On (any rhythm) the card never closes -- a move to done reopens it at the next. */
            const repeat = h('select', { class: 'binder-remind', 'aria-label': w('recurrent'),
                onchange: () => void soft(ask('edit', { id: r.id, repeat: repeat.value })).then(refresh) },
                h('option', { value: '', selected: !r.repeat ? true : null }, w('no-repeat')),
                [7, 14, 30].map((n) => h('option', { value: String(n), selected: r.repeat === n ? true : null }, `↻ ${n} ${w('days')}`)),
                h('option', { value: 'on', selected: r.repeat === true ? true : null }, `↻ ${w('repeat-free')}`));
            /* Its urgency (#168), on a list with a matrix and once it has a due date: set by hand,
               or rising on its own from a start date to the due date. Automatic starts today;
               its start can be moved. */
            const urgency = canMatrix(l) && r.due ? (() => {
                const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); };
                const from = h('input', { type: 'date', value: r.urgencyFrom?.slice(0, 10) ?? '', 'aria-label': w('urgency-from') });
                from.hidden = !r.urgencyFrom;
                from.addEventListener('change', () => { if (from.value) void soft(ask('edit', { id: r.id, urgencyFrom: from.value })).then(refresh); });
                const mode = h('select', { class: 'binder-remind', 'aria-label': w('urgency'),
                    onchange: () => void soft(ask('edit', { id: r.id, urgencyFrom: mode.value === 'auto' ? (from.value || today()) : 'none' })).then(refresh) },
                    h('option', { value: 'hand', selected: !r.urgencyFrom ? true : null }, w('urgency-hand')),
                    h('option', { value: 'auto', selected: r.urgencyFrom ? true : null }, w('urgency-auto')));
                return h('div', { class: 'binder-form binder-remind-row' }, h('span', { class: 'binder-dim' }, w('urgency')), mode, from);
            })() : null;
            whoEdit = h('div', { class: 'binder-who-edit' },
                people().length ? h('div', { class: 'binder-owners', role: 'group', 'aria-label': w('owners') }, people().map((p) => h('button', { type: 'button', class: 'binder-chip', 'data-owner': p.id,
                    'aria-pressed': String(r.owners.includes(p.id)),
                    onclick: () => void soft(ask('edit', { id: r.id, owners: r.owners.includes(p.id) ? r.owners.filter((x) => x !== p.id) : [...r.owners, p.id] })).then(refresh) }, p.name))) : null,
                h('div', { class: 'binder-form' }, day, hour,
                    h('button', { type: 'button', class: 'binder-primary binder-small', 'data-act': 'save-due', onclick: () => done(ask('edit', { id: r.id, due: day.value ? (hour.value ? `${day.value} ${hour.value}` : day.value) : '' })) }, w('ok'))),
                remind ? h('div', { class: 'binder-form binder-remind-row' }, h('span', { class: 'binder-dim' }, w('remind-before')), remind) : null,
                h('div', { class: 'binder-form binder-remind-row' }, h('span', { class: 'binder-dim' }, w('recurrent')), repeat),
                urgency);
        }

        /* What is attached: an icon and a name; a tap opens it. */
        const openIt = (a) => { if (a.kind === 'record') open({ id: a.ref }); else if (a.kind === 'link') window.open(a.ref, '_blank', 'noopener'); else openAttached?.(a); };
        const nameOfIt = (a) => a.title || (a.kind === 'record' ? ui.data?.records?.find((x) => x.id === a.ref)?.title ?? `#${a.ref}` : a.kind === 'file' ? a.ref.split('/').filter(Boolean).at(-1) ?? a.ref : a.ref);
        let attachForm = null;
        if (can && ui.open === 'attach') {
            const kind = h('select', { 'aria-label': w('attach') }, KINDS.map((k) => h('option', { value: k }, w(`kind-${k}`))));
            /* Another card: picked by its title among this binder's cards, not a number typed (#180). */
            const others = (ui.data?.records ?? []).filter((x) => x.id !== r.id);
            const pickId = `binder-cards-${r.id}`;
            const pick = h('datalist', { id: pickId }, others.map((x) => h('option', { value: `#${x.n} ${x.title}` })));
            const ref = h('input', { type: 'text', placeholder: w('what'), 'aria-label': w('what') });
            const follow = () => { if (kind.value === 'record') ref.setAttribute('list', pickId); else ref.removeAttribute?.('list'); };
            kind.addEventListener('change', follow);
            later(() => ref.focus());
            const refOf = () => (kind.value === 'record' ? (/^#?(\d+)/.exec(ref.value.trim())?.[1] ?? ref.value.trim()) : ref.value);
            attachForm = h('div', { class: 'binder-form' }, kind, ref, pick,
                h('button', { type: 'button', class: 'binder-primary binder-small', 'data-act': 'attach', onclick: () => { if (ref.value.trim()) done(ask('attach', { id: r.id, kind: kind.value, ref: refOf() })); } }, w('attach')),
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
            h('header', { class: 'binder-head' }, title, situation(l, r) ? otherFacts(l, r) : factLine(l, r), situation(l, r),
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
        try { const r = await call('templates', {}); ui.templates = r?.ok ? r.data : null; } catch { ui.templates = null; }
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
        function agentColumns() {
            const c = h('input', { type: 'checkbox', ...(ui.settings.agentColumns ? { checked: true } : {}), 'data-setting': 'agentColumns' });
            c.addEventListener('change', () => void soft(ask('edit-settings', { agentColumns: c.checked })).then((got) => { if (got) ui.settings = got; paint(); }));
            return h('label', { class: 'binder-toggle' }, c, h('span', {}, w('agent-columns')));
        }
        function agentFields() {
            const c = h('input', { type: 'checkbox', ...(ui.settings.agentFields ? { checked: true } : {}), 'data-setting': 'agentFields' });
            c.addEventListener('change', () => void soft(ask('edit-settings', { agentFields: c.checked })).then((got) => { if (got) ui.settings = got; paint(); }));
            return h('label', { class: 'binder-toggle' }, c, h('span', {}, w('agent-fields')));
        }
        /* Give the list another type's shape (its view and fields) in one step,
           keeping every record -- e.g. make it a priorities matrix. Applies at once
           and leaves the settings, so a stale save cannot undo the added fields. */
        const convert = () => {
            if (!ui.templates) return null;
            const sel = h('select', { 'aria-label': w('retype') }, h('option', { value: '' }, '—'),
                ...Object.entries(ui.templates).map(([k, n]) => h('option', { value: k }, n[lang] ?? n.en)));
            const go = () => { const t = sel.value; if (!t) return; void soft(ask('retype', { list: l.id, template: t, lang })).then(() => { ui.mode = 'list'; ui.view = null; return refresh(); }); };
            return h('section', { class: 'binder-box' }, h('h3', {}, w('retype')),
                h('p', { class: 'binder-dim binder-small' }, w('retype-hint')),
                h('div', { class: 'binder-row binder-edit' }, sel, h('button', { type: 'button', class: 'binder-ghost', 'data-act': 'retype', onclick: go }, w('retype-apply'))));
        };
        return h('div', { class: 'binder-page binder-settings' },
            h('div', { class: 'binder-crumb' }, backButton(l.title)),
            h('section', { class: 'binder-box' }, h('h3', {}, w('title')), title),
            h('section', { class: 'binder-box' }, h('h3', {}, w('states')), stateRows),
            h('section', { class: 'binder-box' }, h('h3', {}, w('fields')), fieldRows),
            convert(),
            grants.length ? h('section', { class: 'binder-box' }, h('h3', {}, w('access')), grants) : null,
            ui.settings ? h('section', { class: 'binder-box' }, h('h3', {}, w('agent-lists')), agentLists()) : null,
            ui.settings ? h('section', { class: 'binder-box' }, h('h3', {}, w('agent-columns')), agentColumns()) : null,
            ui.settings ? h('section', { class: 'binder-box' }, h('h3', {}, w('agent-fields')), agentFields()) : null,
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
                    : view === 'columns' ? asColumns(l, records) : view === 'cards' ? asCards(l, records)
                        : view === 'matrix' && canMatrix(l) ? asMatrix(l, records) : asList(l, records));
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
    const closeDots = () => { for (const o of document.querySelectorAll('.binder-dot-wrap.open')) o.classList.remove('open'); matrixTrailClear?.(); matrixSideClear?.(); };
    const away = (e) => { if (menus.includes(ui.open) && !e.target?.closest?.('.binder-pop')) { ui.open = null; paint(); } if (!e.target?.closest?.('.binder-dot-wrap, .binder-side')) closeDots(); };
    const escape = (e) => { if (e.key === 'Escape') { if (menus.includes(ui.open)) { ui.open = null; paint(); } closeDots(); matrixLeave?.(); } };
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
