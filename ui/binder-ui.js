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
    'states', 'fields', 'access', 'read', 'write', 'none', 'save', 'empty', 'nobody', 'archived', 'show-archived', 'gate', 'done', 'add-state', 'add-field',
    'kind-message', 'kind-file', 'kind-asset', 'kind-branch', 'kind-link', 'kind-record', 'what', 'name', 'type', 'saved', 'edited', 'by', 'mine', 'all',
    'delete-list', 'delete-list-sure', 'archive-list', 'no-records', 'search']);
const KINDS = ['message', 'file', 'asset', 'branch', 'link', 'record'];
const ICON = { message: '💬', file: '📄', asset: '🗄', branch: '⑂', link: '🔗', record: '▣' };
const TYPES = ['text', 'number', 'date', 'link', 'photo'];

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

export function mount(root, { call, words = {}, lang = 'en', people = () => [], picture = () => null, openAttached = null } = {}) {
    const w = (k) => words[k] ?? k;
    const ui = { lists: [], at: null, data: null, view: null, record: null, mode: 'list', archived: false, mine: false, error: '' };
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
            onclick: () => { ui.at = l.id; ui.view = null; ui.mode = 'list'; ui.record = null; void refresh(); } }, l.title, h('small', {}, String(l.count))))),
        h('button', { type: 'button', class: 'binder-new-list', onclick: () => { ui.mode = 'new-list'; paint(); } }, `+ ${w('new-list')}`));

    function bar(l) {
        const view = ui.view ?? l.view;
        return h('div', { class: 'binder-bar' },
            h('h2', {}, l.title),
            h('div', { class: 'binder-seg', role: 'group' }, ['list', 'columns', 'cards'].map((v) => h('button', { type: 'button', 'aria-pressed': String(v === view), 'data-view': v, onclick: () => { ui.view = v; paint(); } }, w(v)))),
            h('button', { type: 'button', class: 'binder-chip', 'aria-pressed': String(ui.mine), onclick: () => { ui.mine = !ui.mine; void refresh(); } }, w('mine')),
            h('button', { type: 'button', class: 'binder-chip', 'aria-pressed': String(ui.archived), onclick: () => { ui.archived = !ui.archived; void refresh(); } }, w('archived')),
            l.access === 'write' && l.grants ? h('button', { type: 'button', class: 'binder-ghost', 'data-act': 'settings', onclick: () => { ui.mode = 'settings'; paint(); } }, w('settings')) : null,
            l.access === 'write' && !ui.archived ? h('button', { type: 'button', class: 'binder-primary', 'data-act': 'new-item', onclick: () => { ui.mode = 'new-item'; paint(); } }, `+ ${w('new-item')}`) : null);
    }

    const gateOf = (l) => l.states.findIndex((s) => s.gate);
    const doneOf = (l) => l.states.find((s) => s.done) ?? l.states.at(-1);
    /* The box of a row: approval where the list has a gate (a person's), else done. */
    function tick(l, r) {
        const g = gateOf(l);
        const on = g >= 0 ? !!r.approved : r.state === doneOf(l).id;
        return h('button', { type: 'button', class: 'binder-tick', role: 'checkbox', 'aria-checked': String(on), title: g >= 0 ? w('approved') : w('done'), disabled: l.access !== 'write' || !l.grants && g >= 0,
            onclick: (e) => { e.stopPropagation(); void soft(g >= 0 ? ask('approve', { id: r.id, yes: !on }) : ask('move', { id: r.id, state: on ? l.states[0].id : doneOf(l).id })).then(refresh); } }, on ? '✓' : '');
    }
    const pill = (l, r) => { const st = l.states.find((s) => s.id === r.state); return h('span', { class: 'binder-pill', 'data-state': r.state, 'data-done': st?.done ? '' : null, 'data-gate': st?.gate ? '' : null }, st?.name ?? r.state); };
    const meta = (l, r) => h('span', { class: 'binder-meta' },
        r.owners.length ? r.owners.map(nameOf).join(', ') : null,
        r.due ? h('span', {}, `⏰ ${r.due}`) : null,
        r.attached.length ? h('span', {}, `📎 ${r.attached.length}`) : null,
        r.notes.length ? h('span', {}, `✎ ${r.notes.length}`) : null);
    const open = (r) => { void soft(ask('get', { id: r.id }).then((d) => { ui.record = d; ui.mode = 'record'; paint(); })); };

    function asList(l, records) {
        return h('div', { class: 'binder-rows' }, records.map((r) => h('div', { class: 'binder-row', 'data-record': r.id, tabindex: '0', onclick: () => open(r), onkeydown: (e) => { if (e.key === 'Enter') open(r); } },
            tick(l, r), h('div', { class: 'binder-what' }, h('b', {}, r.title), meta(l, r)), pill(l, r))));
    }
    function asColumns(l, records) {
        return h('div', { class: 'binder-cols' }, l.states.map((s) => {
            const here = records.filter((r) => r.state === s.id);
            return h('section', { class: 'binder-col', 'data-state': s.id }, h('h3', {}, s.name, h('span', {}, String(here.length))),
                here.map((r) => h('div', { class: 'binder-card', 'data-record': r.id, tabindex: '0', onclick: () => open(r), onkeydown: (e) => { if (e.key === 'Enter') open(r); } }, h('b', {}, r.title), meta(l, r))));
        }));
    }
    function asCards(l, records) {
        const photo = l.fields.find((f) => f.type === 'photo');
        return h('div', { class: 'binder-grid' }, records.map((r) => {
            const src = photo && r.fields[photo.id] ? picture(r.fields[photo.id]) : null;
            return h('div', { class: 'binder-card binder-face', 'data-record': r.id, tabindex: '0', onclick: () => open(r), onkeydown: (e) => { if (e.key === 'Enter') open(r); } },
                src ? h('img', { src, alt: r.title, loading: 'lazy' }) : h('div', { class: 'binder-initial', 'aria-hidden': 'true' }, r.title.slice(0, 1).toUpperCase()),
                h('b', {}, r.title), pill(l, r));
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

    function record() {
        const { record: r, list: l, history } = ui.record;
        const can = l.access === 'write';
        const field = (f) => {
            const v = r.fields[f.id] ?? '';
            const input = h('input', { type: f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text', value: String(v), disabled: !can, 'aria-label': f.name, 'data-field': f.id });
            input.addEventListener('change', () => void soft(ask('edit', { id: r.id, fields: { [f.id]: input.value } })).then(refresh));
            const src = f.type === 'photo' && v ? picture(v) : null;
            return h('div', { class: 'binder-field' }, h('span', {}, f.name), src ? h('img', { src, alt: f.name, class: 'binder-photo' }) : null, input);
        };
        const title = h('input', { type: 'text', class: 'binder-title', value: r.title, disabled: !can, 'aria-label': w('title') });
        title.addEventListener('change', () => void soft(ask('edit', { id: r.id, title: title.value })).then(refresh));
        const due = h('input', { type: 'text', value: r.due ?? '', placeholder: '2026-11-04 09:00', disabled: !can, 'aria-label': w('due') });
        due.addEventListener('change', () => void soft(ask('edit', { id: r.id, due: due.value.trim() })).then(refresh));
        const owners = h('div', { class: 'binder-owners', role: 'group', 'aria-label': w('owners') }, people().map((p) => h('button', { type: 'button', class: 'binder-chip', 'data-owner': p.id,
            'aria-pressed': String(r.owners.includes(p.id)), disabled: !can,
            onclick: () => void soft(ask('edit', { id: r.id, owners: r.owners.includes(p.id) ? r.owners.filter((x) => x !== p.id) : [...r.owners, p.id] })).then(refresh) }, p.name)));
        const note = h('textarea', { rows: '2', placeholder: w('add-note'), 'aria-label': w('add-note'), maxlength: '2000' });
        const kind = h('select', { 'aria-label': w('attach') }, KINDS.map((k) => h('option', { value: k }, w(`kind-${k}`))));
        const ref = h('input', { type: 'text', placeholder: w('what'), 'aria-label': w('what') });
        const sure = h('span', { class: 'binder-sure', hidden: true }, w('delete-sure'),
            h('button', { type: 'button', class: 'binder-danger', 'data-act': 'delete-yes', onclick: () => void soft(ask('delete', { id: r.id })).then(() => { ui.record = null; ui.mode = 'list'; return refresh(); }) }, w('delete')),
            h('button', { type: 'button', class: 'binder-ghost', onclick: () => { sure.hidden = true; } }, w('cancel')));
        return h('div', { class: 'binder-page binder-record', 'data-record': r.id },
            h('div', { class: 'binder-bar' }, h('button', { type: 'button', class: 'binder-ghost', 'data-act': 'back', onclick: () => { ui.record = null; ui.mode = 'list'; void refresh(); } }, `‹ ${l.title}`),
                h('span', { class: 'binder-dim' }, `#${r.id}`)),
            title,
            h('div', { class: 'binder-seg binder-states', role: 'group', 'aria-label': w('state') }, l.states.map((s) => h('button', { type: 'button', 'aria-pressed': String(s.id === r.state), 'data-state': s.id, disabled: !can,
                onclick: () => void soft(ask('move', { id: r.id, state: s.id })).then(refresh) }, s.name))),
            gateOf(l) >= 0 ? h('label', { class: 'binder-approve' }, tick(l, r), w('approved')) : null,
            h('div', { class: 'binder-two' },
                h('div', { class: 'binder-col-main' },
                    h('section', { class: 'binder-box' }, h('h3', {}, w('attached'), h('span', {}, String(r.attached.length))),
                        r.attached.map((a) => h('div', { class: 'binder-att', 'data-kind': a.kind },
                            h('span', { class: 'binder-ic', 'aria-hidden': 'true' }, ICON[a.kind] ?? '•'),
                            h('button', { type: 'button', class: 'binder-link', onclick: () => { if (a.kind === 'record') open({ id: a.ref }); else if (a.kind === 'link') window.open(a.ref, '_blank', 'noopener'); else openAttached?.(a); } },
                                a.title || (a.kind === 'record' ? `#${a.ref}` : a.ref), h('small', {}, w(`kind-${a.kind}`))),
                            can ? h('button', { type: 'button', class: 'binder-x', 'aria-label': w('delete'), onclick: () => void soft(ask('detach', { id: r.id, what: a.id })).then(refresh) }, '×') : null)),
                        can ? h('div', { class: 'binder-form' }, kind, ref, h('button', { type: 'button', class: 'binder-ghost', 'data-act': 'attach',
                            onclick: () => { if (ref.value.trim()) void soft(ask('attach', { id: r.id, kind: kind.value, ref: ref.value })).then(refresh); } }, w('attach'))) : null),
                    h('section', { class: 'binder-box' }, h('h3', {}, w('notes')),
                        r.notes.map((n) => h('div', { class: 'binder-note' }, h('p', {}, n.text), h('small', {}, `${n.by.name} · ${n.at.slice(0, 10)}${n.edited ? ` · ${w('edited')}` : ''}`))),
                        can ? h('div', { class: 'binder-form' }, note, h('button', { type: 'button', class: 'binder-ghost', 'data-act': 'note',
                            onclick: () => { if (note.value.trim()) void soft(ask('note', { id: r.id, text: note.value })).then(refresh); } }, w('add-note'))) : null)),
                h('div', { class: 'binder-col-side' },
                    h('section', { class: 'binder-box' },
                        h('div', { class: 'binder-field' }, h('span', {}, w('owners')), people().length ? owners : h('span', { class: 'binder-dim' }, r.owners.map(nameOf).join(', ') || w('nobody'))),
                        h('div', { class: 'binder-field' }, h('span', {}, w('due')), due),
                        l.fields.map(field)),
                    h('details', { class: 'binder-box binder-history' }, h('summary', {}, `${w('history')} · ${history.length}`),
                        history.slice().reverse().map((x) => h('div', { class: 'binder-log' }, h('time', {}, x.at.slice(0, 16).replace('T', ' ')), `${x.by.name} · ${x.op}`))),
                    can ? h('div', { class: 'binder-actions' },
                        h('button', { type: 'button', class: 'binder-ghost', 'data-act': 'archive', onclick: () => void soft(ask('archive', { id: r.id, restore: !!r.archived })).then(() => { ui.record = null; ui.mode = 'list'; return refresh(); }) }, r.archived ? w('restore') : w('archive')),
                        l.grants ? h('button', { type: 'button', class: 'binder-ghost', 'data-act': 'delete', onclick: () => { sure.hidden = false; } }, w('delete')) : null, sure) : null)));
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

    void refresh();
    return { refresh, destroy() { alive = false; box.remove(); }, get state() { return { at: ui.at, mode: ui.mode } } };
}
