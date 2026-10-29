/* THE STORE: the binder itself, as its keeper holds it. Lists of records,
 * kept by people and by agents, each with an id.
 *
 * ONE WRITER. Only the keeper writes the store (binder serve, or the
 * application that runs Binder): an agent asks, through its own folder
 * (server/binder.mjs), and never touches what is kept. What an agent can
 * write, it could rewrite; so it writes nothing here.
 *
 *   state.json   what every list and record is NOW, rewritten whole (by a rename) after each change
 *   log.jsonl    every change, one per line: who, what, when -- the history
 *
 * A record deleted is deleted: its lines in the log are emptied down to who and
 * when, and one line says it was deleted, and by whom.
 *
 * WHO is { id, kind, name }: kind "person" or "agent". A person may do
 * anything. An agent reads or writes a list only where it was given access, and
 * never approves: a record reaches a gate state (or one after it) only once a
 * person approved it. An agent may make a list from a template (as many as a
 * person set, 5 unless they said): it is given that list alone, to change, and
 * a person sees it as any.
 *
 * SETTINGS: the store's own, a person's alone to change, in the history too.
 *   agentLists   lists an agent may have made and not archived (0 to 50; 0: none)
 */
import { readFileSync, writeFileSync, appendFileSync, renameSync, mkdirSync, existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { seed, TEMPLATES, VIEWS, FIELD_TYPES } from './templates.mjs';

export const TITLE_MAX = 200;
/* Lists an agent may have made and not archived: 5 until a person sets it (settings.agentLists), 0 to 50. */
export const AGENT_LISTS_DEFAULT = 5;
export const AGENT_LISTS_TOP = 50;
/* Whether an agent may change a list's columns (its states): true until a person turns it off
   (settings.agentColumns). Even on, an agent never touches the gate -- the person's approval
   boundary -- nor removes a column: it only adds and renames, so a gate can never be worked around. */
export const AGENT_COLUMNS_DEFAULT = true;
/* The default, by its former name. */
export const AGENT_LISTS_MAX = AGENT_LISTS_DEFAULT;
export const NOTE_MAX = 2000;
/* A record's description: a few lines for a person, what it is and why (Markdown-ish: paragraphs, "- " lists, **bold**, links). */
export const DESCRIPTION_MAX = 4000;
export const FIELD_MAX = 1000;
export const REF_MAX = 1000;
export const LISTS_MAX = 200;
export const RECORDS_MAX = 5000;
export const NOTES_MAX = 500;
export const ATTACHED_MAX = 200;
export const STATES_MAX = 12;
export const FIELDS_MAX = 20;
export const OWNERS_MAX = 10;
export const ATTACH_KINDS = ['message', 'file', 'asset', 'branch', 'commit', 'link', 'record', 'mail', 'event'];
/* A file attached that is a picture, by its name (the screen has the same rule). */
export const isPicture = (ref) => /\.(jpe?g|png|webp|gif)$/i.test(String(ref ?? '').split(/[?#]/)[0]);

const NOT_SHOWN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁩﻿]/gu;
export const oneLine = (text, max) => String(text ?? '').replace(/\r/g, '').replace(NOT_SHOWN, '').replace(/\s+/g, ' ').trim().slice(0, max);
export const block = (text, max) => String(text ?? '').replace(/\r/g, '').replace(NOT_SHOWN, '').replace(/[ \t]+\n/g, '\n').trim().slice(0, max);
const key = (text) => oneLine(text, 40).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export class Refused extends Error {}
const no = (why) => { throw new Refused(why); };

/* An agent changing a list's columns (its states) may ADD new ones and RENAME existing ones, but
   never remove a column, never add/remove/move the gate, and never move an existing column across
   the gate. So the gate -- the person's approval boundary -- can never be worked around. Throws
   (Refused) when a proposed set of states would break any of that. `have` is the list's states now. */
function agentColumnsOk(have, proposed) {
    if (!Array.isArray(proposed) || proposed.length < 1) no('say the columns');
    const idOf = (st) => oneLine(st?.id, 40) || key(oneLine(st?.name, 60)) || 'state';
    const propIds = proposed.map(idOf);
    const propSet = new Set(propIds);
    for (const st of have) if (!propSet.has(st.id)) no('an agent adds or renames columns, it does not remove one -- ask a person');
    proposed.forEach((st, i) => {
        const existing = have.find((h) => h.id === propIds[i]);
        if (existing) { if (!!st?.gate !== !!existing.gate || !!st?.done !== !!existing.done) no('an agent does not change a column\'s gate or its "done" -- ask a person'); }
        else if (st?.gate || st?.done) no('an agent does not add a gate or a "done" column -- ask a person');
    });
    const gate = have.find((x) => x.gate);
    if (gate) {
        const gatePos = propIds.indexOf(gate.id);
        const haveGatePos = have.findIndex((x) => x.id === gate.id);
        for (const st of have) {
            if (st.id === gate.id) continue;
            const wasBefore = have.findIndex((x) => x.id === st.id) < haveGatePos;
            if (wasBefore !== (propIds.indexOf(st.id) < gatePos)) no('an agent does not move a column across the gate -- ask a person');
        }
    }
}

/* A due date: "2026-11-04" or "2026-11-04 09:00", kept as written (the keeper's clock reads it). */
const DUE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/;
export const dueAt = (due) => { const t = Date.parse(due.length === 10 ? `${due}T09:00:00` : due.replace(' ', 'T')); return Number.isFinite(t) ? t : null; };

const isPerson = (who) => who?.kind === 'person';
const whoOf = (who) => {
    if (!who || typeof who !== 'object') no('nobody said who they are');
    const w = { id: oneLine(who.id, 100), kind: who.kind === 'person' ? 'person' : 'agent', name: oneLine(who.name, 80) || oneLine(who.id, 80) };
    if (!w.id) no('nobody said who they are');
    return w;
};

const empty = () => ({ v: 1, next: 1, lists: {}, records: {} });

export function openStore(dir, { now = () => Date.now() } = {}) {
    mkdirSync(dir, { recursive: true });
    const STATE = join(dir, 'state.json');
    const LOG = join(dir, 'log.jsonl');
    const read = () => {
        try { if (lstatSync(STATE).isSymbolicLink()) return empty(); } catch { return empty(); }
        try { const s = JSON.parse(readFileSync(STATE, 'utf8')); return s && s.v === 1 ? s : empty(); } catch { return empty(); }
    };
    let s = read();
    const save = () => { const tmp = `${STATE}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(s)); renameSync(tmp, STATE); };
    const stamp = () => new Date(now()).toISOString();
    const listeners = new Set();
    const log = (by, op, what) => {
        const line = { at: stamp(), by, op, ...what };
        appendFileSync(LOG, `${JSON.stringify(line)}\n`);
        for (const fn of listeners) { try { fn(line); } catch { /* a listener's fault is its own */ } }
        return line;
    };
    const logLines = () => { try { return readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

    /* ---- reading, as `who` may ---- */
    const access = (list, who) => (isPerson(who) ? 'write' : list.access?.[who.id] ?? null);
    const listOf = (given, who, need = 'read') => {
        const g = oneLine(given, 100);
        const list = s.lists[g] ?? Object.values(s.lists).find((l) => l.title.toLowerCase() === g.toLowerCase() && !l.archived);
        if (!list || !access(list, who)) no(`no list ${g || '(none given)'} that you can see`);
        if (need === 'write' && access(list, who) !== 'write') no(`you can read the list ${list.title}, not change it`);
        return list;
    };
    const recordOf = (given, who, need = 'read') => {
        const id = String(given ?? '').replace(/^#/, '').trim();
        const r = s.records[id];
        if (!r) no(`no record #${id || '?'}`);
        const list = s.lists[r.list];
        if (!list || !access(list, who)) no(`no record #${id}`);
        if (need === 'write' && access(list, who) !== 'write') no(`you can read the list ${list.title}, not change it`);
        return { r, list };
    };
    const stateOf = (list, given) => {
        const g = oneLine(given, 60);
        const st = list.states.find((x) => x.id === g) ?? list.states.find((x) => x.name.toLowerCase() === g.toLowerCase());
        if (!st) no(`the list ${list.title} has no state "${g}" (it has: ${list.states.map((x) => x.name).join(', ')})`);
        return st;
    };
    const gateIndex = (list) => list.states.findIndex((x) => x.gate);
    const past = (list, stateId) => { const g = gateIndex(list); return g >= 0 && list.states.findIndex((x) => x.id === stateId) >= g; };

    /* What a list looks like to `who`. */
    const shownList = (l, who) => ({ id: l.id, title: l.title, template: l.template, view: l.view, states: l.states, fields: l.fields, access: access(l, who),
        ...(isPerson(who) ? { grants: l.access ?? {} } : {}), ...(l.archived ? { archived: true } : {}),
        count: Object.values(s.records).filter((r) => r.list === l.id && !r.archived).length });

    /* Whether a record's title, description or notes hold `q` (lower case). */
    /* The store's settings, as they are now (a store from before them has the defaults). */
    const settingsNow = () => ({ agentLists: Number.isInteger(s.settings?.agentLists) ? s.settings.agentLists : AGENT_LISTS_DEFAULT, agentColumns: typeof s.settings?.agentColumns === 'boolean' ? s.settings.agentColumns : AGENT_COLUMNS_DEFAULT });

    const said = (r, q) => r.title.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q) || r.notes.some((n) => n.text.toLowerCase().includes(q));

    const api = {
        dir,
        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        reload() { s = read(); },
        /* Every list `who` can see. */
        lists(who) { const w = whoOf(who); return Object.values(s.lists).filter((l) => access(l, w)).map((l) => shownList(l, w)); },
        list(given, who, { state, mine, archived = false, text, changedSince, quietFor } = {}) {
            const w = whoOf(who);
            const list = listOf(given, w);
            const st = state ? stateOf(list, state) : null;
            const q = oneLine(text, 100).toLowerCase();
            /* By activity: changedSince keeps what moved on or after a day; quietFor
             * keeps what is still open and has not moved in that many days (stale). */
            const sinceT = changedSince ? Date.parse(String(changedSince).length === 10 ? `${changedSince}T00:00:00` : String(changedSince).replace(' ', 'T')) : null;
            const quietMs = Number.isFinite(Number(quietFor)) && Number(quietFor) > 0 ? Number(quietFor) * 86400000 : null;
            const done = list.states.find((x) => x.done);
            const movedAt = (r) => Date.parse(r.changed ?? r.created ?? '');
            const records = Object.values(s.records).filter((r) => r.list === list.id && !!r.archived === !!archived
                && (!st || r.state === st.id) && (!mine || r.owners.includes(w.id))
                && (!q || said(r, q))
                && (sinceT === null || !Number.isFinite(sinceT) || movedAt(r) >= sinceT)
                && (quietMs === null || ((!done || r.state !== done.id) && Date.now() - movedAt(r) >= quietMs)));
            const order = new Map(list.states.map((x, i) => [x.id, i]));
            records.sort((a, b) => (order.get(a.state) - order.get(b.state)) || (a.n - b.n));
            return { list: shownList(list, w), records };
        },
        record(given, who) {
            const w = whoOf(who);
            const { r, list } = recordOf(given, w);
            const history = logLines().filter((x) => x.record === r.id).map(({ at, by, op, change }) => ({ at, by, op, ...(change ? { change } : {}) }));
            return { record: r, list: shownList(list, w), history };
        },
        search(text, who) {
            const w = whoOf(who);
            const q = oneLine(text, 100).toLowerCase();
            if (!q) no('say what to look for');
            return Object.values(s.records).filter((r) => { const l = s.lists[r.list]; return l && !l.archived && access(l, w)
                && (said(r, q) || Object.values(r.fields).some((v) => String(v).toLowerCase().includes(q))); })
                .slice(0, 50);
        },
        /* Records whose moment came, and not said yet. Two kinds, each said once:
         *   { kind: 'due-soon', when, days, record, card, list }  the lead reminder, remindBefore days ahead
         *   { kind: 'due',      when,       record, card, list }  at the due time
         * A changed due (or remindBefore) re-arms the one it changed: the key it is
         * remembered by moves, so its moment is said afresh. */
        due() {
            const t = now();
            const out = [];
            let dirty = false;
            for (const r of Object.values(s.records)) {
                if (!r.due || r.archived) continue;
                const at = dueAt(r.due);
                const list = s.lists[r.list];
                if (at === null || !list || list.archived || list.states.find((x) => x.id === r.state)?.done) continue;
                /* Lead: remindBefore days before the due time, and only while the due is still ahead. */
                if (r.remindBefore) {
                    const key = `${r.due}~${r.remindBefore}`;
                    const lead = at - r.remindBefore * 86_400_000;
                    if (r.toldBefore !== key && lead <= t && t < at) {
                        r.toldBefore = key; dirty = true;
                        out.push({ kind: 'due-soon', when: lead, days: r.remindBefore, record: r, card: r, list });
                    }
                }
                /* At the due time. */
                if (r.told !== r.due && at <= t) {
                    r.told = r.due; dirty = true;
                    out.push({ kind: 'due', when: at, record: r, card: r, list });
                }
            }
            if (dirty) save();
            return out;
        },

        /* ---- lists: a person's; an agent makes one too, from a template, given to itself alone ---- */
        createList({ template = 'simple', title, lang = 'en' } = {}, who) {
            const w = whoOf(who);
            if (Object.keys(s.lists).length >= LISTS_MAX) no(`${LISTS_MAX} lists at most`);
            if (!isPerson(w)) {
                if (!Object.hasOwn(TEMPLATES, String(template))) no(`a list is made from a template: ${Object.keys(TEMPLATES).join(', ')}`);
                const most = settingsNow().agentLists;
                if (most === 0) no('a person set 0 lists an agent may make: use one you were given');
                if (Object.values(s.lists).filter((l) => l.by === w.id && !l.archived).length >= most) no(`${most} lists made by you at most, as a person set: use one of yours`);
            }
            const base = seed(template, lang);
            const name = oneLine(title, TITLE_MAX) || base.title;
            let id = key(name) || 'list';
            for (let i = 2; s.lists[id]; i++) id = `${key(name) || 'list'}-${i}`;
            s.lists[id] = { id, ...base, title: name, access: isPerson(w) ? {} : { [w.id]: 'write' }, created: stamp(), by: w.id };
            save(); log(w, 'create-list', { list: id, change: { title: name, template } });
            return s.lists[id];
        },
        editList(given, { title, view, states, fields } = {}, who) {
            const w = whoOf(who);
            if (!isPerson(w)) {
                /* An agent may change only the columns (states), when a person allows it, and never the gate. */
                if (title !== undefined || view !== undefined || fields !== undefined || states === undefined) no('only a person changes a list (an agent may change its columns)');
                if (!settingsNow().agentColumns) no('a person turned off the columns an agent may change');
            }
            const list = listOf(given, w, 'write');
            if (!isPerson(w)) agentColumnsOk(list.states, states);
            const change = {};
            if (title !== undefined) { const t = oneLine(title, TITLE_MAX); if (!t) no('a list needs a title'); list.title = change.title = t; }
            if (view !== undefined) { if (!VIEWS.includes(view)) no(`a view is one of: ${VIEWS.join(', ')}`); list.view = change.view = view; }
            if (states !== undefined) {
                if (!Array.isArray(states) || states.length < 1 || states.length > STATES_MAX) no(`a list has 1 to ${STATES_MAX} states`);
                const next = []; const seen = new Set();
                for (const st of states) {
                    const name = oneLine(st?.name, 60); if (!name) no('a state needs a name');
                    let id = oneLine(st?.id, 40) || key(name) || 'state';
                    for (let i = 2; seen.has(id); i++) id = `${key(name)}-${i}`;
                    seen.add(id); next.push({ id, name, ...(st.gate ? { gate: true } : {}), ...(st.done ? { done: true } : {}) });
                }
                if (next.filter((x) => x.gate).length > 1) no('one gate at most');
                /* A record in a state that goes moves to the first state. */
                for (const r of Object.values(s.records)) if (r.list === list.id && !seen.has(r.state)) r.state = next[0].id;
                list.states = change.states = next;
            }
            if (fields !== undefined) {
                if (!Array.isArray(fields) || fields.length > FIELDS_MAX) no(`${FIELDS_MAX} fields at most`);
                const seen = new Set();
                list.fields = change.fields = fields.map((f) => {
                    const name = oneLine(f?.name, 60); if (!name) no('a field needs a name');
                    if (!FIELD_TYPES.includes(f.type)) no(`a field is one of: ${FIELD_TYPES.join(', ')}`);
                    let id = oneLine(f?.id, 40) || key(name) || 'field';
                    for (let i = 2; seen.has(id); i++) id = `${key(name)}-${i}`;
                    seen.add(id); return { id, name, type: f.type };
                });
            }
            save(); log(w, 'edit-list', { list: list.id, change });
            return list;
        },
        /* Give an existing list another type's shape, keeping every record: take the
         * template's view and add any of its fields the list does not already have
         * (by id) -- e.g. make a list a "priorities" matrix by adding its four score
         * fields and opening in the matrix. States, fields already there, and record
         * data are left untouched; a person's, like any change to a list's shape. */
        retype(given, { template, lang = 'en' } = {}, who) {
            const w = whoOf(who);
            if (!isPerson(w)) no('only a person changes a list type');
            const list = listOf(given, w, 'write');
            const base = seed(template, lang);
            const have = new Set(list.fields.map((f) => f.id));
            const added = base.fields.filter((f) => !have.has(f.id));
            if (list.fields.length + added.length > FIELDS_MAX) no(`that would pass ${FIELDS_MAX} fields; remove some first`);
            const change = { template, view: base.view };
            list.view = base.view;
            if (added.length) { list.fields = [...list.fields, ...added]; change.fields = list.fields; }
            list.template = template;
            save(); log(w, 'retype', { list: list.id, change });
            return list;
        },
        /* access: "read", "write", or null to take it back. */
        grant(given, whoId, level, who) {
            const w = whoOf(who);
            if (!isPerson(w)) no('only a person gives access');
            const list = listOf(given, w);
            const id = oneLine(whoId, 100); if (!id) no('say to whom');
            if (level !== null && level !== 'read' && level !== 'write') no('access is read, write, or none');
            list.access ??= {};
            if (level === null) delete list.access[id]; else list.access[id] = level;
            save(); log(w, 'grant', { list: list.id, change: { to: id, access: level } });
            return list;
        },
        archiveList(given, archived, who) {
            const w = whoOf(who);
            const list = listOf(given, w, 'write');
            /* A person archives any list; an agent only one it made itself (reversible, unlike delete). */
            if (!isPerson(w) && list.by !== w.id) no('only a person archives a list you did not make');
            if (archived) list.archived = true; else delete list.archived;
            save(); log(w, archived ? 'archive-list' : 'restore-list', { list: list.id });
            return list;
        },
        deleteList(given, who) {
            const w = whoOf(who);
            if (!isPerson(w)) no('only a person deletes a list');
            const list = listOf(given, w);
            for (const r of Object.values(s.records)) if (r.list === list.id) forget(r.id);
            delete s.lists[list.id];
            save(); log(w, 'delete-list', { list: list.id });
            return true;
        },

        /* ---- the store's settings: anyone reads them, a person changes them ---- */
        settings(who) { whoOf(who); return settingsNow(); },
        editSettings({ agentLists, agentColumns } = {}, who) {
            const w = whoOf(who);
            if (!isPerson(w)) no('only a person changes the settings');
            const change = {};
            if (agentLists !== undefined) {
                const n = typeof agentLists === 'string' && agentLists.trim() !== '' ? Number(agentLists) : agentLists;
                if (!Number.isInteger(n) || n < 0 || n > AGENT_LISTS_TOP) no(`lists an agent may make: a whole number from 0 to ${AGENT_LISTS_TOP}`);
                change.agentLists = n;
            }
            if (agentColumns !== undefined) {
                const b = agentColumns === true || agentColumns === 'true' ? true : agentColumns === false || agentColumns === 'false' ? false : no('columns an agent may change: true or false');
                change.agentColumns = b;
            }
            if (!Object.keys(change).length) return settingsNow();
            s.settings = { ...s.settings, ...change };
            save(); log(w, 'edit-settings', { change });
            return settingsNow();
        },

        /* ---- records ---- */
        add(given, { title, description, state, fields, owners, due, remindBefore, note } = {}, who) {
            const w = whoOf(who);
            const list = listOf(given, w, 'write');
            const t = oneLine(title, TITLE_MAX); if (!t) no('a record needs a title');
            if (Object.values(s.records).filter((r) => r.list === list.id).length >= RECORDS_MAX) no(`${RECORDS_MAX} records in a list at most`);
            const st = state ? stateOf(list, state) : list.states[0];
            const approved = isPerson(w) && past(list, st.id);
            if (!approved && past(list, st.id)) no(`only a person approves: add it as ${list.states[0].name}`);
            const id = String(s.next++);
            const d = descriptionOf(description);
            const r = { id, n: Number(id), list: list.id, title: t, ...(d ? { description: d } : {}), state: st.id, fields: {}, owners: [], notes: [], attached: [], created: stamp(), by: w.id, changed: stamp(), ...(approved ? { approved: true } : {}) };
            s.records[id] = r;
            if (fields) setFields(list, r, fields);
            if (owners) r.owners = ownersOf(owners);
            if (due) r.due = dueOf(due);
            if (remindBefore !== undefined && remindBefore !== null && remindBefore !== '') { const b = remindBeforeOf(remindBefore); if (b) r.remindBefore = b; }
            if (note) r.notes.push({ id: randomUUID(), at: stamp(), by: w, text: noteOf(note) });
            save(); log(w, 'add', { record: id, list: list.id, change: { title: t, ...(d ? { description: d } : {}), state: st.id } });
            return r;
        },
        /* COVER: the one picture a card is shown by, when it has several. It is a
         * picture attached (its id; given by id, the start of it, or its ref) or a
         * photo field set ("field:ID"; given by the field's id or name). Empty
         * clears it. Without one, a card is shown by its photo field set, else by
         * its only picture attached. */
        edit(given, { title, description, fields, owners, due, remindBefore, cover, repeat } = {}, who) {
            const w = whoOf(who);
            const { r, list } = recordOf(given, w, 'write');
            const change = {};
            if (repeat !== undefined) { if (repeat === null || repeat === '' || repeat === 'none' || repeat === false || repeat === 0) { delete r.repeat; change.repeat = null; } else r.repeat = change.repeat = repeatOf(repeat); }
            if (title !== undefined) { const t = oneLine(title, TITLE_MAX); if (!t) no('a record needs a title'); r.title = change.title = t; }
            if (description !== undefined) { const d = descriptionOf(description); if (d) r.description = change.description = d; else { delete r.description; change.description = null; } }
            if (fields !== undefined) change.fields = setFields(list, r, fields);
            if (owners !== undefined) r.owners = change.owners = ownersOf(owners);
            if (due !== undefined) { if (due === null || due === '') { delete r.due; change.due = null; } else r.due = change.due = dueOf(due); }
            if (remindBefore !== undefined) { if (remindBefore === null || remindBefore === '' || remindBefore === 0) { delete r.remindBefore; change.remindBefore = null; } else r.remindBefore = change.remindBefore = remindBeforeOf(remindBefore); }
            if (cover !== undefined) { const c = coverOf(list, r, cover); if (c) r.cover = change.cover = c; else { delete r.cover; change.cover = null; } }
            r.changed = stamp();
            save(); log(w, 'edit', { record: r.id, list: list.id, change });
            return r;
        },
        move(given, state, who, { next } = {}) {
            const w = whoOf(who);
            const { r, list } = recordOf(given, w, 'write');
            const st = stateOf(list, state);
            /* A recurrent record never closes: a move to a done state rolls it over --
             * back to the first open state, its due shifted to the next occurrence
             * (by its rhythm, or to --next, or left as is when it has no rhythm). */
            if (st.done && r.repeat) {
                const open = list.states.find((x) => !x.done) ?? list.states[0];
                const from = r.state; r.state = open.id;
                const change = { from, to: open.id, recurred: true };
                if (next !== undefined && next !== null && next !== '') r.due = change.due = dueOf(next);
                else if (typeof r.repeat === 'number') r.due = change.due = addDays(r.due ?? today(), r.repeat);
                delete r.told; delete r.toldBefore;
                r.changed = stamp();
                save(); log(w, 'move', { record: r.id, list: list.id, change });
                return r;
            }
            if (past(list, st.id)) {
                if (isPerson(w)) r.approved = true;
                else if (!r.approved) no(`only a person approves: it stays ${list.states.find((x) => x.id === r.state)?.name}, until they tick it`);
            } else if (isPerson(w) && gateIndex(list) >= 0) delete r.approved;
            const from = r.state; r.state = st.id; r.changed = stamp();
            save(); log(w, 'move', { record: r.id, list: list.id, change: { from, to: st.id } });
            return r;
        },
        /* A person's tick: approved goes to the gate state; taken back goes to the first state. */
        approve(given, yes, who) {
            const w = whoOf(who);
            if (!isPerson(w)) no('only a person approves');
            const { list } = recordOf(given, w, 'write');
            const g = gateIndex(list);
            const target = g >= 0 ? list.states[g] : list.states.find((x) => x.done) ?? list.states.at(-1);
            return api.move(given, yes ? target.id : list.states[0].id, w);
        },
        note(given, text, who) {
            const w = whoOf(who);
            const { r, list } = recordOf(given, w, 'write');
            if (r.notes.length >= NOTES_MAX) no(`${NOTES_MAX} notes on a record at most`);
            const n = { id: randomUUID(), at: stamp(), by: w, text: noteOf(text) };
            r.notes.push(n); r.changed = stamp();
            save(); log(w, 'note', { record: r.id, list: list.id, change: { note: n.id } });
            return n;
        },
        /* A note is changed by whoever wrote it; the record's history says it was. */
        editNote(given, noteId, text, who) {
            const w = whoOf(who);
            const { r, list } = recordOf(given, w, 'write');
            const n = r.notes.find((x) => x.id === noteId || x.id.startsWith(String(noteId ?? '-')));
            if (!n) no('no such note');
            if (n.by.id !== w.id) no('a note is changed by whoever wrote it');
            if (text === null || text === '') r.notes = r.notes.filter((x) => x !== n);
            else { n.text = noteOf(text); n.edited = stamp(); }
            r.changed = stamp();
            save(); log(w, text ? 'edit-note' : 'remove-note', { record: r.id, list: list.id, change: { note: n.id } });
            return r;
        },
        attach(given, { kind, ref, title } = {}, who) {
            const w = whoOf(who);
            const { r, list } = recordOf(given, w, 'write');
            if (!ATTACH_KINDS.includes(kind)) no(`attach one of: ${ATTACH_KINDS.join(', ')}`);
            const what = oneLine(ref, REF_MAX); if (!what) no('say what to attach');
            if (kind === 'record') { const other = recordOf(what, w); if (other.r.id === r.id) no('a record is not attached to itself'); }
            if (kind === 'link' && !/^https?:\/\//i.test(what)) no('a link starts with http:// or https://');
            if (r.attached.length >= ATTACHED_MAX) no(`${ATTACHED_MAX} things attached at most`);
            if (r.attached.some((a) => a.kind === kind && a.ref === what)) no('that is attached already');
            const a = { id: randomUUID(), kind, ref: kind === 'record' ? what.replace(/^#/, '') : what, title: oneLine(title, TITLE_MAX), at: stamp(), by: w.id };
            r.attached.push(a); r.changed = stamp();
            save(); log(w, 'attach', { record: r.id, list: list.id, change: { kind, ref: a.ref } });
            return a;
        },
        detach(given, attachedId, who) {
            const w = whoOf(who);
            const { r, list } = recordOf(given, w, 'write');
            const a = r.attached.find((x) => x.id === attachedId || x.id.startsWith(String(attachedId ?? '-')) || x.ref === attachedId);
            if (!a) no('nothing like that is attached');
            r.attached = r.attached.filter((x) => x !== a); r.changed = stamp();
            if (r.cover === a.id) delete r.cover;
            save(); log(w, 'detach', { record: r.id, list: list.id, change: { kind: a.kind, ref: a.ref } });
            return r;
        },
        archive(given, archived, who) {
            const w = whoOf(who);
            const { r, list } = recordOf(given, w, 'write');
            if (archived) r.archived = true; else delete r.archived;
            r.changed = stamp();
            save(); log(w, archived ? 'archive' : 'restore', { record: r.id, list: list.id });
            return r;
        },
        /* Deleted is deleted: what the log said of it is emptied too. A person's. */
        delete(given, who) {
            const w = whoOf(who);
            if (!isPerson(w)) no('only a person deletes; archive it instead');
            const { r, list } = recordOf(given, w, 'write');
            forget(r.id);
            save(); log(w, 'delete', { record: r.id, list: list.id });
            return true;
        },
    };

    function forget(id) {
        delete s.records[id];
        for (const r of Object.values(s.records)) r.attached = r.attached.filter((a) => !(a.kind === 'record' && a.ref === id));
        if (!existsSync(LOG)) return;
        const kept = logLines().map((x) => (x.record === id ? { at: x.at, by: x.by, op: x.op, record: id, list: x.list } : x));
        const tmp = `${LOG}.${process.pid}.tmp`;
        writeFileSync(tmp, kept.map((x) => `${JSON.stringify(x)}\n`).join(''));
        renameSync(tmp, LOG);
    }
    function setFields(list, r, given) {
        if (!given || typeof given !== 'object' || Array.isArray(given)) no('fields are given as { name: value }');
        const change = {};
        for (const [k, v] of Object.entries(given)) {
            const f = list.fields.find((x) => x.id === k) ?? list.fields.find((x) => x.name.toLowerCase() === String(k).toLowerCase());
            if (!f) no(`the list ${list.title} has no field "${k}"${list.fields.length ? ` (it has: ${list.fields.map((x) => x.name).join(', ')})` : ''}`);
            if (v === null || v === '') { delete r.fields[f.id]; change[f.id] = null; if (r.cover === `field:${f.id}`) delete r.cover; continue; }
            const value = oneLine(v, FIELD_MAX);
            if (f.type === 'number' && !Number.isFinite(Number(value))) no(`${f.name} is a number`);
            if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) no(`${f.name} is a date: 2026-11-04`);
            if (f.type === 'link' && !/^https?:\/\//i.test(value)) no(`${f.name} is a link: https://...`);
            r.fields[f.id] = change[f.id] = f.type === 'number' ? Number(value) : value;
        }
        return change;
    }
    function coverOf(list, r, given) {
        if (given === null || given === '') return '';
        const g = oneLine(given, REF_MAX);
        const a = r.attached.find((x) => x.id === g) ?? r.attached.find((x) => x.ref === g) ?? (g.length >= 4 ? r.attached.find((x) => x.id.startsWith(g)) : undefined);
        if (a) { if (a.kind !== 'file' || !isPicture(a.ref)) no(`the cover is a picture: ${a.ref} is not one`); return a.id; }
        const name = g.replace(/^field:/, '');
        const f = list.fields.find((x) => x.id === name) ?? list.fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (f) { if (f.type !== 'photo') no(`the cover is a picture: ${f.name} is not a photo field`); if (!r.fields[f.id]) no(`${f.name} is empty`); return `field:${f.id}`; }
        return no('the cover is a picture attached (its id, or what it is) or a photo field');
    }
    function ownersOf(given) {
        const list = (Array.isArray(given) ? given : [given]).map((x) => oneLine(x, 100)).filter(Boolean);
        if (list.length > OWNERS_MAX) no(`${OWNERS_MAX} owners at most`);
        return [...new Set(list)];
    }
    function dueOf(given) {
        const d = oneLine(given, 20);
        if (!DUE.test(d) || dueAt(d) === null) no('a due date is 2026-11-04, or 2026-11-04 09:00');
        return d;
    }
    /* A lead time: a whole number of days before the due time (e.g. 1, 3, 7). */
    function remindBeforeOf(given) {
        const n = typeof given === 'number' ? given : Number(String(given).trim());
        if (!Number.isInteger(n) || n < 1 || n > 3650) no('remind before: a whole number of days (e.g. 1, 3, 7)');
        return n;
    }
    /* A recurrence: `true` (recurrent, no fixed rhythm) or a whole number of days
     * (e.g. 7, 14). Empty / none / 0 clears it. */
    function repeatOf(given) {
        if (given === true || given === 'on' || given === 'yes') return true;
        const n = typeof given === 'number' ? given : Number(String(given).trim());
        if (Number.isInteger(n) && n >= 1 && n <= 3650) return n;
        no('recurrence: on (no fixed rhythm), a number of days (e.g. 7, 14), or none');
    }
    const today = () => new Date(now()).toISOString().slice(0, 10);
    /* A due date shifted by n days, keeping its time of day if it had one. Done on
     * the UTC date parts, so no hour or daylight shift moves the day. */
    function addDays(due, n) {
        const date = String(due).slice(0, 10); const time = String(due).length > 10 ? String(due).slice(11) : null;
        const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
        const shifted = d.toISOString().slice(0, 10);
        return time ? `${shifted} ${time}` : shifted;
    }
    function descriptionOf(text) {
        if (text === undefined || text === null) return '';
        if (typeof text !== 'string') no('a description is a text');
        const d = block(text, Infinity).replace(/\n{3,}/g, '\n\n');
        if (d.length > DESCRIPTION_MAX) no(`a description is ${DESCRIPTION_MAX} characters at most (this one is ${d.length})`);
        return d;
    }
    function noteOf(text) { const t = block(text, NOTE_MAX); if (!t) no('a note needs a text'); return t; }

    return api;
}

export { TEMPLATES };
