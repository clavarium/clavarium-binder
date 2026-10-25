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

/* ---- what an agent reads: plain lines ---- */
export function say(op, data, list) {
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
                    out.push(`  #${r.id} ${r.title}${owners(r)}${due(r)}${r.attached.length ? ` [${r.attached.length} attached]` : ''}`);
                    if (r.description) out.push(`      ${firstLine(r.description).slice(0, 120)}`);
                }
            }
            if (l.states.some((x) => x.gate)) out.push('Past a gate, only what a person approved.');
            return out.join('\n');
        }
        case 'get': {
            const { record: r, list: l, history } = data;
            const st = l.states.find((x) => x.id === r.state);
            const out = [`#${r.id} ${r.title}`, `  list: ${l.title}; state: ${st?.name ?? r.state}${r.approved ? ' (approved)' : ''}${r.archived ? '; archived' : ''}${owners(r) ? `; owners:${owners(r)}` : ''}${due(r)}`];
            if (r.description) out.push('Description:', ...r.description.split('\n').map((x) => (x ? `  ${x}` : '')));
            else out.push('No description yet: give one (what it is and why, 1-3 lines for a person) with binder edit ID --description "...".');
            for (const f of l.fields) if (r.fields[f.id] !== undefined) out.push(`  ${f.name}: ${r.fields[f.id]}${r.cover === `field:${f.id}` ? ' (cover)' : ''}`);
            if (r.notes.length) { out.push('Notes:'); for (const n of r.notes) out.push(`  ${day(n.at)} ${n.by.name}: ${n.text.replace(/\n/g, '\n    ')}${n.edited ? ' (edited)' : ''}`); }
            if (r.attached.length) { out.push('Attached:'); for (const a of r.attached) out.push(`  ${a.kind} ${a.kind === 'record' ? `#${a.ref}` : a.ref}${a.title ? ` "${a.title}"` : ''}${r.cover === a.id ? ' (cover)' : ''}`); }
            out.push(`History: ${history.length} change${history.length === 1 ? '' : 's'}, the last ${history.length ? `${day(history.at(-1).at)} by ${history.at(-1).by.name}` : 'none'}.`);
            return out.join('\n');
        }
        case 'search': return data.length === 0 ? 'Nothing found.' : data.map((r) => `#${r.id} ${r.title} (${list(r.list)})`).join('\n');
        case 'add': return `Added #${data.id}: ${data.title}.`;
        case 'edit': return `Changed #${data.id}.`;
        case 'move': return `#${data.id} is now ${data.stateName}.`;
        case 'note': return 'Noted.';
        case 'attach': return 'Attached.';
        case 'detach': return 'Taken off.';
        case 'archive': return data.archived ? `Archived #${data.id}.` : `Restored #${data.id}.`;
        case 'settings': case 'edit-settings': return `Lists an agent may make: ${data.agentLists}.`;
        case 'create-list': return `Made the list ${data.title} [${data.id}], yours to change: binder add ${data.id} "title".`;
        default: return 'Done.';
    }
}

export function keeper(dir, { sides = () => [], now = () => Date.now() } = {}) {
    const store = openStore(dir, { now });
    const titleOf = (id) => store.lists({ id: 'keeper', kind: 'person' }).find((l) => l.id === id)?.title ?? id;
    /* ONE ASK, as `who`: { ok, text, data }. An agent's "me" is its own id. */
    const perform = (op, a = {}, who) => {
        try {
            const me = (list) => (Array.isArray(list) ? list.map((x) => (x === 'me' ? who.id : x)) : list);
            let data;
            switch (op) {
                case 'lists': data = store.lists(who); break;
                case 'show': data = store.list(a.list, who, { state: a.state, mine: a.mine, archived: a.archived, text: a.text }); break;
                case 'get': data = store.record(a.id, who); break;
                case 'search': data = store.search(a.text, who); break;
                case 'add': data = store.add(a.list, { title: a.title, description: a.description, state: a.state, fields: a.fields, owners: me(a.owners), due: a.due, remindBefore: a.remindBefore, note: a.note }, who); break;
                case 'edit': data = store.edit(a.id, { title: a.title, description: a.description, fields: a.fields, owners: me(a.owners), due: a.due, remindBefore: a.remindBefore, cover: a.cover }, who); break;
                case 'move': { const r = store.move(a.id, a.state, who); data = { ...r, stateName: store.record(r.id, who).list.states.find((x) => x.id === r.state)?.name }; break; }
                case 'note': data = store.note(a.id, a.text, who); break;
                case 'attach': data = store.attach(a.id, { kind: a.kind, ref: a.ref, title: a.title }, who); break;
                case 'detach': data = store.detach(a.id, a.what, who); break;
                case 'archive': data = store.archive(a.id, !a.restore, who); break;
                /* A person's, from the page. */
                case 'approve': data = store.approve(a.id, a.yes !== false, who); break;
                case 'delete': data = store.delete(a.id, who); break;
                case 'edit-note': data = store.editNote(a.id, a.note, a.text, who); break;
                case 'create-list': data = store.createList({ template: a.template, title: a.title, lang: a.lang }, who); break;
                case 'edit-list': data = store.editList(a.list, { title: a.title, view: a.view, states: a.states, fields: a.fields }, who); break;
                case 'grant': data = store.grant(a.list, a.to, a.access ?? null, who); break;
                case 'archive-list': data = store.archiveList(a.list, a.archived !== false, who); break;
                case 'delete-list': data = store.deleteList(a.list, who); break;
                case 'settings': data = store.settings(who); break;
                case 'edit-settings': data = store.editSettings({ agentLists: a.agentLists }, who); break;
                case 'templates': data = Object.fromEntries(Object.entries(TEMPLATES).map(([k, t]) => [k, t.name])); break;
                default: return { ok: false, text: `there is no ${oneLine(op, 40)}` };
            }
            return { ok: true, text: say(op, data, titleOf), data };
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
                const answer = late ? { ok: false, text: 'too late: this ask waited too long and was not done' }
                    : perform(oneLine(q.op, 40), q.args && typeof q.args === 'object' ? q.args : {}, side.who);
                mkdirSync(side.dir, { recursive: true });
                appendFileSync(join(side.dir, 'answers.jsonl'), `${JSON.stringify({ ask: q.id, at: new Date(now()).toISOString(), ok: answer.ok, text: answer.text })}\n`);
                answered.add(q.id); n++;
            }
        }
        return n;
    };
    return { store, pump, act: perform, due: () => store.due() };
}
