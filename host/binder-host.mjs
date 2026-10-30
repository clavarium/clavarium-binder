/* THE KEEPER: the side that holds the binder and answers. An application that
 * runs Binder (or `binder serve`) keeps one store, and reads the asks of each
 * agent's folder; a person's changes come straight from the application's page.
 *
 *   const k = keeper(storeDir, { sides: () => [{ dir, who }] });
 *   k.pump();                     answer what was asked since (every second or so)
 *   k.act(op, args, who)          a person's change, from the page: { ok, text, data }
 *   k.due()                       records whose due time came: tell their owners
 *   k.store.onChange(fn)          every change, as the log says it
 *
 * WHO ASKS IS SAID BY THE FOLDER. The application gives each folder its who
 * ({ id, kind: "agent", name }); what an ask says of itself is never believed.
 *
 * An ask too old is answered "too late", never done: the command that sent it
 * gave up waiting and said nothing was changed.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openStore, Refused, oneLine } from '../server/store.mjs';
import { lines } from '../server/binder.mjs';
import { TEMPLATES } from '../server/templates.mjs';

export { openStore, Refused, TEMPLATES };
/* Older than this, an ask is not done: its command stopped waiting (WAIT_MS) a while ago. */
export const TOO_LATE_MS = 60_000;

const day = (iso) => String(iso ?? '').slice(0, 10);
const owners = (r) => (r.owners.length ? ` @${r.owners.join(' @')}` : '');
const due = (r) => (r.due ? ` (due ${r.due}${r.remindBefore ? `, remind ${r.remindBefore}d before` : ''})` : '');
/* The first line of a description, as read: without its Markdown marks. */
export const firstLine = (text) => String(text ?? '').split('\n').map((l) => l.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '').trim()).find(Boolean) ?? '';

/* A PRIORITIES MATRIX, as an agent fills it: which fields place a card, on what scale, and who
   carries it -- told where it reads the binder, and again when a card it wrote is not placed. */
export const isMatrix = (l) => ['urgence', 'importance'].every((id) => (l?.fields ?? []).some((f) => f.id === id && f.type === 'number'));
const MATRIX_FIELDS = [
    ['urgence', 'how soon it must be done (100: now)'],
    ['importance', 'how much it matters (100: essential)'],
    ['charge', 'the effort it takes (100: a lot)'],
    ['delegabilite', "the share of the second person on the card, its reinforcement (0: none; 100: they do it all); with nobody second yet, how much someone could take"],
];
const ownerIds = (records) => [...new Set(records.flatMap((r) => r.owners ?? []))];
export function matrixGuide(l, ids = [], people = []) {
    const has = (id) => l.fields.some((f) => f.id === id);
    return ['This binder is a priorities matrix: give every card these numbers, 0 to 100 --',
        ...MATRIX_FIELDS.filter(([id]) => has(id)).map(([id, what]) => `  ${id}: ${what}`),
        `  binder edit ID --field urgence=80 --field importance=70${has('charge') ? ' --field charge=40' : ''}${has('delegabilite') ? ' --field delegabilite=20' : ''}`,
        ...ownerGuide(ids, people),
        'Its urgency may instead rise on its own up to its due date: binder edit ID --due DATE --urgency-from DATE.'].join('\n');
}
/* Who may carry a card, by id: the person you work for first, then yourself ("me"), the other
   conversations, nobody. Without a roster, the ids already on the binder. */
export function ownerGuide(ids = [], people = []) {
    const persons = people.filter((p) => p.kind === 'person');
    const agents = people.filter((p) => p.kind === 'agent').map((p) => p.id);
    if (!persons.length) return [`Who carries it (its owner): a person's id for theirs, "me" for yours, "none" for nobody${ids.length ? ` (ids on this binder: ${ids.join(', ')})` : ''}: binder edit ID --owner ...`];
    const mine = persons.filter((p) => p.me);
    return ['Who carries it (its owner) -- give every card one, it colours its point: binder edit ID --owner ...',
        ...(mine.length ? mine : persons.slice(0, 1)).map((p) => `  the person you work for: --owner ${p.id} (${p.name})`),
        ...persons.filter((p) => !(mine.length ? mine : persons.slice(0, 1)).includes(p)).slice(0, 6).map((p) => `  another person: --owner ${p.id} (${p.name})`),
        '  yourself, this conversation: --owner me',
        `  another conversation: --owner conversation:NAME${agents.length ? ` (${agents.slice(0, 6).join(', ')}${agents.length > 6 ? ', ...' : ''})` : ''}`,
        '  someone outside, by name: --owner "Sébastien" (a name is kept as it is written)',
        '  nobody yet: --owner none',
        '  two people on one card: the first carries it, the second comes in as reinforcement: --owner <who carries it>,<the reinforcement>',
        '    delegabilite is the reinforcement\'s share of the work (0: none, 100: they do it all) -- the same meaning whoever carries it',
        '    with a reinforcement named it is 5 at least: a second person with no share would not be on the card',
        '  the person sees on their matrix only what they carry or come in on; a card of nobody\'s waits below it',
        '  everyone who may carry one: binder people'];
}
/* What a card on a matrix still lacks to be placed and read: said after it is written. */
export function matrixMissing(l, r) {
    if (!isMatrix(l)) return '';
    const lack = ['urgence', 'importance'].filter((id) => r.fields?.[id] === undefined && !(id === 'urgence' && r.urgencyFrom && r.due));
    const out = [];
    if (lack.length) out.push(`Not on the matrix yet: it needs ${lack.join(' and ')} (0 to 100): binder edit ${r.id} ${lack.map((id) => `--field ${id}=..`).join(' ')}. "binder show ${l.id}" says what each means.`);
    if (!(r.owners ?? []).length) out.push(`Nobody carries it: binder edit ${r.id} --owner <the person's id> (theirs), me (yours), or leave it. "binder people" gives the ids.`);
    return out.join('\n');
}

/* ---- what an agent reads: plain lines ---- */
export function say(op, data, list, people = []) {
    switch (op) {
        case 'lists': return data.length === 0 ? 'You were given no list.'
            : ['Your lists:', ...data.map((l) => `  ${l.title} [${l.id}]: ${l.count} record${l.count === 1 ? '' : 's'}, ${l.access === 'write' ? 'you may change it' : 'read only'}`),
                'See one: binder show LIST'].join('\n');
        case 'show': {
            const { list: l, records } = data;
            const out = [`${l.title} [${l.id}]${l.access === 'write' ? '' : ' (read only)'}: ${records.length} record${records.length === 1 ? '' : 's'}`];
            for (const st of l.states) {
                const here = records.filter((r) => r.state === st.id);
                if (!here.length) continue;
                out.push(`${st.name}${st.gate ? ' (a person approves)' : ''}:`);
                for (const r of here) {
                    out.push(`  #${r.id} ${r.title}${owners(r)}${due(r)}${r.repeat ? ` ↻${typeof r.repeat === 'number' ? ` ${r.repeat}d` : ''}` : ''}${r.attached.length ? ` [${r.attached.length} attached]` : ''}`);
                    if (r.description) out.push(`      ${firstLine(r.description).slice(0, 120)}`);
                }
            }
            if (l.states.some((x) => x.gate)) out.push('Past a gate, only what a person approved.');
            if (isMatrix(l)) out.push(matrixGuide(l, ownerIds(records), people));
            return out.join('\n');
        }
        case 'get': {
            const { record: r, list: l, history } = data;
            const st = l.states.find((x) => x.id === r.state);
            const out = [`#${r.id} ${r.title}`, `  list: ${l.title}; state: ${st?.name ?? r.state}${r.approved ? ' (approved)' : ''}${r.archived ? '; archived' : ''}${owners(r) ? `; owners:${owners(r)}` : ''}${due(r)}`];
            if (r.repeat) out.push(`  recurrent ↻: ${typeof r.repeat === 'number' ? `every ${r.repeat} days` : 'no fixed rhythm'} (a move to done reopens it, shifting its due)`);
            if (r.urgencyFrom) out.push(`  urgency: automatic, rising from ${r.urgencyFrom} to its due date${r.due ? '' : ' (no due date yet: none until one is set)'}; --urgency-from none sets it by hand`);
            if (r.description) out.push('Description:', ...r.description.split('\n').map((x) => (x ? `  ${x}` : '')));
            else out.push('No description yet: give one (what it is and why, 1-3 lines for a person) with binder edit ID --description "...".');
            if (!r.attached.length) out.push('Nothing attached yet: attach the sources it stands on (the message that asked, a mail, a file, a commit, a link) with binder attach ID KIND REF "title" -- rather than their text in the card.');
            for (const f of l.fields) if (r.fields[f.id] !== undefined) out.push(`  ${f.name}: ${r.fields[f.id]}${r.cover === `field:${f.id}` ? ' (cover)' : ''}`);
            { const lacks = matrixMissing(l, r); if (lacks) out.push(lacks); }
            if (r.notes.length) { out.push('Notes:'); r.notes.forEach((n, i) => out.push(`  ${i + 1}. ${day(n.at)} ${n.by.name}: ${n.text.replace(/\n/g, '\n    ')}${n.edited ? ' (edited)' : ''}`)); }
            if (r.attached.length) { out.push('Attached:'); for (const a of r.attached) out.push(`  ${a.kind} ${a.kind === 'record' ? `#${a.ref}` : a.ref}${a.title ? ` "${a.title}"` : ''}${r.cover === a.id ? ' (cover)' : ''}`); }
            out.push(`History: ${history.length} change${history.length === 1 ? '' : 's'}, the last ${history.length ? `${day(history.at(-1).at)} by ${history.at(-1).by.name}` : 'none'}.`);
            return out.join('\n');
        }
        case 'search': return data.length === 0 ? 'Nothing found.' : data.map((r) => `#${r.id} ${r.title} (${list(r.list)})`).join('\n');
        case 'add': return `Added #${data.id}: ${data.title}.`;
        case 'edit': return `Changed #${data.id}.`;
        case 'move': return `#${data.id} is now ${data.stateName}.`;
        case 'note': return 'Noted.';
        case 'edit-note': return 'The note is changed.';
        case 'attach': return 'Attached.';
        case 'detach': return 'Taken off.';
        case 'archive': return data.archived ? `Archived #${data.id}.` : `Restored #${data.id}.`;
        case 'settings': case 'edit-settings': return `Lists an agent may make: ${data.agentLists}. Columns an agent may change: ${data.agentColumns ? 'yes' : 'no'}. Fields/type an agent may change: ${data.agentFields ? 'yes' : 'no'}.`;
        case 'edit-list': case 'columns': return `The columns are set: ${(data.states ?? []).map((x) => x.name).join(', ')}.`;
        case 'field': return `The fields are set: ${(data.fields ?? []).map((x) => x.name).join(', ') || 'none'}.`;
        case 'retype': return `${data.title} is now a ${data.template} list (view: ${data.view}); its fields: ${data.fields.map((f) => f.name).join(', ') || 'none'}.`;
        case 'create-list': return `Made the list ${data.title} [${data.id}], yours to change: binder add ${data.id} "title".`;
        case 'archive-list': return data.archived ? `Archived the list ${data.title} [${data.id}]. A person can restore or delete it.` : `Restored the list ${data.title} [${data.id}].`;
        case 'order-lists': return 'The order of the binders is set.';
        case 'people': return data.length ? ['Who may carry a card (binder edit ID --owner ID):', ...data.map((p) => `  ${p.id}  ${p.name}${p.me ? ' -- the person you work for' : p.you ? ' -- yourself ("me")' : ''}`), '  me  yourself; none  nobody; or a name, for someone outside ("Sébastien")'].join('\n')
            : 'No roster here: "me" for yourself, "none" for nobody, or an id already on a card.';
        default: return 'Done.';
    }
}

export function keeper(dir, { sides = () => [], now = () => Date.now(), people = () => [] } = {}) {
    const store = openStore(dir, { now });
    const titleOf = (id) => store.lists({ id: 'keeper', kind: 'person' }).find((l) => l.id === id)?.title ?? id;
    /* ONE ASK, as `who`: { ok, text, data }. An agent's "me" is its own id. */
    const perform = (op, a = {}, who) => {
        try {
            const me = (list) => (Array.isArray(list) ? list.map((x) => (x === 'me' ? who.id : x)) : list);
            let data;
            switch (op) {
                case 'lists': data = store.lists(who); break;
                case 'show': data = store.list(a.list, who, { state: a.state, mine: a.mine, archived: a.archived, text: a.text, changedSince: a.changedSince, quietFor: a.quietFor }); break;
                case 'get': data = store.record(a.id, who); break;
                case 'search': data = store.search(a.text, who); break;
                case 'add': data = store.add(a.list, { title: a.title, description: a.description, state: a.state, fields: a.fields, owners: me(a.owners), due: a.due, remindBefore: a.remindBefore, note: a.note }, who); break;
                case 'edit': data = store.edit(a.id, { title: a.title, description: a.description, fields: a.fields, owners: me(a.owners), due: a.due, remindBefore: a.remindBefore, repeat: a.repeat, cover: a.cover, urgencyFrom: a.urgencyFrom }, who); break;
                case 'move': { const r = store.move(a.id, a.state, who, { next: a.next }); data = { ...r, stateName: store.record(r.id, who).list.states.find((x) => x.id === r.state)?.name }; break; }
                case 'note': data = store.note(a.id, a.text, who); break;
                case 'attach': data = store.attach(a.id, { kind: a.kind, ref: a.ref, title: a.title }, who); break;
                case 'detach': data = store.detach(a.id, a.what, who); break;
                case 'archive': data = store.archive(a.id, !a.restore, who); break;
                /* A person's, from the page. */
                case 'approve': data = store.approve(a.id, a.yes !== false, who); break;
                case 'delete': data = store.delete(a.id, who); break;
                case 'edit-note': {
                    /* A note by its number, as "get" shows it, or by its id. */
                    const n = /^\d+$/.test(String(a.note ?? '')) ? store.record(a.id, who).record.notes[Number(a.note) - 1]?.id ?? `-${a.note}` : a.note;
                    data = store.editNote(a.id, n, a.text, who); break;
                }
                case 'create-list': data = store.createList({ template: a.template, title: a.title, lang: a.lang }, who); break;
                case 'edit-list': data = store.editList(a.list, { title: a.title, view: a.view, states: a.states, fields: a.fields }, who); break;
                case 'retype': data = store.retype(a.list, { template: a.template, lang: a.lang }, who); break;
                case 'columns': {
                    /* Add or rename a column, keeping every other column (its id, its gate, its "done") as it is,
                       then edit the list with the whole set -- so the gate is never worked around. */
                    const match = (ref) => (x) => x.id === ref || String(x.name ?? x.title ?? '').toLowerCase() === String(ref ?? '').toLowerCase();
                    const l = store.lists(who).find(match(a.list));
                    if (!l) throw new Refused(`no list ${oneLine(a.list, 100) || '(none given)'}`);
                    const states = l.states.map((x) => ({ id: x.id, name: x.name, ...(x.gate ? { gate: true } : {}), ...(x.done ? { done: true } : {}) }));
                    if (a.rename) { const c = states.find(match(a.rename.from)); if (!c) throw new Refused(`no column "${a.rename.from}"`); c.name = oneLine(a.rename.to, 60); }
                    if (a.add) {
                        const name = oneLine(a.add, 60); if (!name) throw new Refused('a column needs a name');
                        let at = states.length;
                        if (a.after !== undefined) { const i = states.findIndex(match(a.after)); if (i >= 0) at = i + 1; }
                        else if (a.before !== undefined) { const i = states.findIndex(match(a.before)); if (i >= 0) at = i; }
                        states.splice(at, 0, { name });
                    }
                    data = store.editList(a.list, { states }, who);
                    break;
                }
                case 'field': {
                    /* Add or remove a field, keeping every other field, then edit the list with the whole set
                       (so the store's rules -- a person's, or an agent's when allowed -- apply to the change). */
                    const match = (ref) => (x) => x.id === ref || String(x.name ?? x.title ?? '').toLowerCase() === String(ref ?? '').toLowerCase();
                    const l = store.lists(who).find(match(a.list));
                    if (!l) throw new Refused(`no list ${oneLine(a.list, 100) || '(none given)'}`);
                    const fields = l.fields.map((x) => ({ id: x.id, name: x.name, type: x.type }));
                    if (a.add) { const name = oneLine(a.add.name, 60); if (!name) throw new Refused('a field needs a name'); fields.push({ name, type: a.add.type }); }
                    if (a.remove) { const i = fields.findIndex(match(a.remove)); if (i < 0) throw new Refused(`no field "${a.remove}"`); fields.splice(i, 1); }
                    data = store.editList(a.list, { fields }, who);
                    break;
                }
                case 'grant': data = store.grant(a.list, a.to, a.access ?? null, who); break;
                case 'archive-list': data = store.archiveList(a.list, a.archived !== false, who); break;
                case 'order-lists': data = store.orderLists(a.order, who); break;
                case 'delete-list': data = store.deleteList(a.list, who); break;
                case 'settings': data = store.settings(who); break;
                case 'edit-settings': data = store.editSettings({ agentLists: a.agentLists, agentColumns: a.agentColumns, agentFields: a.agentFields }, who); break;
                case 'people': data = people().map((p) => (p.id === who.id ? { ...p, you: true } : p)); break;
                case 'templates': data = Object.fromEntries(Object.entries(TEMPLATES).map(([k, t]) => [k, t.name])); break;
                default: return { ok: false, text: `there is no ${oneLine(op, 40)}` };
            }
            /* A card written on a matrix but not placed (or carried by nobody): said at once. */
            let more = '';
            if ((op === 'add' || op === 'edit') && data?.id) { try { const d = store.record(data.id, who); more = matrixMissing(d.list, d.record); } catch { /* said without it */ } }
            return { ok: true, text: [say(op, data, titleOf, op === 'show' ? people().filter((p) => p.id !== who.id) : []), more].filter(Boolean).join('\n'), data };
        } catch (error) {
            if (error instanceof Refused) return { ok: false, text: error.message };
            throw error;
        }
    };
    /* What each folder asked and was not answered yet. Answered asks are known by the answers file. */
    const pump = () => {
        let n = 0;
        for (const side of sides()) {
            const answered = new Set(lines(join(side.dir, 'answers.jsonl')).map((a) => a.ask));
            for (const q of lines(join(side.dir, 'asks.jsonl'))) {
                if (typeof q.id !== 'string' || answered.has(q.id)) continue;
                const late = !(now() - Date.parse(q.at) < TOO_LATE_MS);
                /* One ask that breaks is answered so, and never holds up the ones after it (nor the other
                   folders): a stuck queue looked like "nobody keeps this binder". */
                let answer;
                try {
                    answer = late ? { ok: false, text: 'too late: this ask waited too long and was not done' }
                        : perform(oneLine(q.op, 40), q.args && typeof q.args === 'object' ? q.args : {}, side.who);
                } catch (error) { answer = { ok: false, text: `this could not be done (${oneLine(error?.message ?? error, 160)}); nothing was changed` }; }
                mkdirSync(side.dir, { recursive: true });
                appendFileSync(join(side.dir, 'answers.jsonl'), `${JSON.stringify({ ask: q.id, at: new Date(now()).toISOString(), ok: answer.ok, text: answer.text })}\n`);
                answered.add(q.id); n++;
            }
        }
        return n;
    };
    return { store, pump, act: perform, due: () => store.due() };
}
