#!/usr/bin/env node
/* THE ASKING SIDE OF BINDER: how an agent, or a script, reads and changes the
 * lists it was given. One file, no dependency.
 *
 *   a command    `binder`, `binder show LIST`, `binder add LIST "title"`...
 *                (bin/binder.mjs imports this file)
 *   MCP          `node binder.mjs [--dir FOLDER]`: the same verbs as tools,
 *                over standard input and output (JSON-RPC 2.0, one message per line)
 *
 * IT ASKS, IT NEVER WRITES THE BINDER. The binder is held by its keeper (binder
 * serve, or the application that runs Binder), out of the agent's reach: what
 * an agent could write, it could rewrite. Here, the agent's own folder:
 *
 *   asks.jsonl      the agent's: what it asks, one line each
 *   answers.jsonl   the keeper's: the answer to each ask, by its id
 *
 * The keeper says who asks by the folder the ask came from: an agent cannot
 * speak as another one, nor as a person. See docs/protocol.md.
 */
import { appendFileSync, readFileSync, mkdirSync, statSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

export const VERSION = '0.1.23-next.1';
export const FOLDER = '.binder';
/* How long an ask waits for its answer. The keeper answers within a second or two. */
export const WAIT_MS = 20_000;
export const NO_KEEPER = 'No answer: nobody keeps this binder right now (its application, or "binder serve", is not running). Nothing was changed.';

const parsed = (line) => { try { const j = JSON.parse(line); return j && typeof j === 'object' && !Array.isArray(j) ? j : null; } catch { return null; } };
export function lines(file) {
    try { if (lstatSync(file).isSymbolicLink()) return []; return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(parsed).filter(Boolean); } catch { return []; }
}
const isFolder = (path) => { try { return statSync(path).isDirectory(); } catch { return false; } };

/* The folder: `dir`, else $BINDER_DIR, else the nearest .binder from `from` up. */
export function findFolder({ dir, env = process.env, from = process.cwd() } = {}) {
    if (dir) return resolve(from, dir);
    if (env.BINDER_DIR) return resolve(from, env.BINDER_DIR);
    for (let at = resolve(from); ; at = dirname(at)) {
        if (isFolder(join(at, FOLDER))) return join(at, FOLDER);
        if (dirname(at) === at) return null;
    }
}

/* One ask, and its answer: { ok, text, data? }. */
export async function ask(dir, op, args = {}, { wait = WAIT_MS, every = 150 } = {}) {
    mkdirSync(dir, { recursive: true });
    const id = randomUUID();
    appendFileSync(join(dir, 'asks.jsonl'), `${JSON.stringify({ id, at: new Date().toISOString(), op, args })}\n`);
    const until = Date.now() + wait;
    for (;;) {
        const answer = lines(join(dir, 'answers.jsonl')).find((a) => a.ask === id);
        if (answer) return { ok: answer.ok === true, text: String(answer.text ?? ''), ...(answer.data !== undefined ? { data: answer.data } : {}) };
        if (Date.now() >= until) return { ok: false, text: NO_KEEPER, nokeeper: true };
        await new Promise((r) => setTimeout(r, every));
    }
}

/* ---- MCP ---- */
const S = (description) => ({ type: 'string', description });
const DESCRIBE = S('for a person, short and clear: what it is and why, 1 to 3 lines (Markdown-ish: "- " lists, **bold**, links); empty removes it');
export const TOOLS = [
    { name: 'lists', description: 'The lists you were given, with how many records each holds and whether you may change them.', inputSchema: { type: 'object', properties: {} } },
    { name: 'show', description: 'The records of a list, by state. Filter by state, only yours, by activity (changed since a day, or open and quiet for so many days).', inputSchema: { type: 'object', properties: { list: S('its name or id'), state: S('a state of the list'), mine: { type: 'boolean' }, archived: { type: 'boolean' }, changedSince: S('only records changed on or after this day (YYYY-MM-DD): what moved since'), quietFor: { type: 'integer', description: 'only records still open that have not changed in this many days: what has gone quiet' } }, required: ['list'] } },
    { name: 'people', description: 'Who may carry a record (its owner), by id: the person you work for, the other people, the conversations. "me" is yourself.', inputSchema: { type: 'object', properties: {} } },
    { name: 'get', description: 'One record whole: its fields, notes, what is attached, its history.', inputSchema: { type: 'object', properties: { id: S('the record number, as #12 or 12') }, required: ['id'] } },
    { name: 'search', description: 'Records whose title, notes or fields hold a text, in every list you can see.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    { name: 'add', description: 'Add a record to a list (in its first state unless you say), with a short title and a description a person understands at a glance. You cannot add it approved: a person ticks it. On a priorities matrix, give its fields urgence and importance (0-100; also charge, delegabilite) and its owner -- "show" tells what each means.', inputSchema: { type: 'object', properties: { list: S('its name or id'), title: { type: 'string' }, description: DESCRIBE, state: { type: 'string' }, due: S('2026-11-04 or 2026-11-04 09:00'), remindBefore: { type: 'integer', description: 'remind the owners this many days before the due time (e.g. 1, 3, 7)' }, owner: S('who carries it: the person\'s id (see people), "me" for yourself, or a conversation id'), note: { type: 'string' }, fields: { type: 'object', description: '{ field name: value }' } }, required: ['list', 'title'] } },
    { name: 'edit', description: 'Change a record: title, description, fields, owners, due date, lead reminder, recurrence, cover picture (empty to remove it).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, description: DESCRIBE, due: { type: 'string' }, remindBefore: { type: 'integer', description: 'remind the owners this many days before the due time (e.g. 1, 3, 7); 0 removes it' }, repeat: S('make it recurrent (it never closes): "on" (no fixed rhythm), a number of days (e.g. 7, 14), or "none" to clear'), owner: S('who carries it: the person\'s id (see people), "me" for yourself, a conversation id; empty for nobody'), fields: { type: 'object' }, cover: S('the picture the card is shown by, when it has several: a picture attached (its ref) or a photo field; empty to remove it'), urgencyFrom: S('automatic urgency: it rises on its own from this date (2026-11-04) to the due date, as a matrix shows it (needs a due date); "none" for an urgency set by hand') }, required: ['id'] } },
    { name: 'move', description: 'Put a record in another state of its list. Past a gate (an approval), only once a person approved it. A recurrent record moved to a done state does not close: it reopens with its due shifted to the next occurrence (or to "next").', inputSchema: { type: 'object', properties: { id: { type: 'string' }, state: { type: 'string' }, next: S('for a recurrent record rolled over: its next due day (YYYY-MM-DD), instead of the rhythm') }, required: ['id', 'state'] } },
    { name: 'note', description: 'Add a short note to a record: a decision, a fact, a result. Talking with the person stays in the chat.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] } },
    { name: 'attach', description: 'Attach something to a record: a message of the chat, a file, an asset, a branch, a commit, a link, another record, a mail or a calendar event (its Tether ref). Give a title the card shows (a mail\'s subject and date, an event\'s title and time).', inputSchema: { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string', enum: ['message', 'file', 'asset', 'branch', 'commit', 'link', 'record', 'mail', 'event'] }, ref: S('what it is: a path, a URL, repository:branch, repository:sha, a message id, a record number, a Tether mail or event id'), title: S('what the card shows for it: a mail\'s subject + sender + date, an event\'s title + date') }, required: ['id', 'kind', 'ref'] } },
    { name: 'detach', description: 'Take back something attached to a record.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, what: S('what get shows of it: its ref or its id') }, required: ['id', 'what'] } },
    { name: 'new-list', description: 'Make a list from a template (batches, development, customers, people, roadmap, simple) when none you were given fits: it is given to you alone, and the person sees it. Batches: the work you propose; the person ticks what you may start.', inputSchema: { type: 'object', properties: { template: S('batches, development, customers, people, roadmap or simple'), title: S('its name; the template\'s by default') }, required: ['template'] } },
    { name: 'archive-list', description: 'Archive a list you made (it leaves your tabs; a person still sees it and can restore or delete it), or restore it. You cannot delete a list; only a person does. Archived lists do not count against your few-lists limit.', inputSchema: { type: 'object', properties: { list: S('its name or id'), restore: { type: 'boolean' } }, required: ['list'] } },
    { name: 'retype', description: 'Change a list\'s type: apply a template\'s view and add its missing fields (e.g. make a list a "priorities" matrix), keeping every record and what the list already has -- it never removes anything. Allowed only where a person turned on "fields an agent may change".', inputSchema: { type: 'object', properties: { list: S('its name or id'), template: S('batches, development, customers, people, priorities, roadmap or simple'), lang: S('en or fr, for the names of the fields added') }, required: ['list', 'template'] } },
    { name: 'archive', description: 'Archive a record (it leaves the list; found again with archived), or restore it.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, restore: { type: 'boolean' } }, required: ['id'] } },
];
/* A tool's arguments as the keeper reads them. */
export function asked(name, a = {}) {
    const owners = a.owner === undefined ? undefined : a.owner === '' ? [] : [a.owner];
    switch (name) {
        case 'lists': return ['lists', {}];
        case 'people': return ['people', {}];
        case 'show': return ['show', { list: a.list, state: a.state, mine: !!a.mine, archived: !!a.archived, changedSince: a.changedSince, quietFor: a.quietFor }];
        case 'get': return ['get', { id: a.id }];
        case 'search': return ['search', { text: a.text }];
        case 'add': return ['add', { list: a.list, title: a.title, description: a.description, state: a.state, due: a.due, remindBefore: a.remindBefore, owners, note: a.note, fields: a.fields }];
        case 'edit': return ['edit', { id: a.id, title: a.title, description: a.description, due: a.due, remindBefore: a.remindBefore, repeat: a.repeat, owners, fields: a.fields, cover: a.cover, urgencyFrom: a.urgencyFrom }];
        case 'move': return ['move', { id: a.id, state: a.state, next: a.next }];
        case 'note': return ['note', { id: a.id, text: a.text }];
        case 'attach': return ['attach', { id: a.id, kind: a.kind, ref: a.ref, title: a.title }];
        case 'detach': return ['detach', { id: a.id, what: a.what }];
        case 'archive': return ['archive', { id: a.id, restore: !!a.restore }];
        case 'new-list': return ['create-list', { template: a.template, title: a.title }];
        case 'archive-list': return ['archive-list', { list: a.list, archived: !a.restore }];
        case 'retype': return ['retype', { list: a.list, template: a.template, lang: a.lang }];
        default: return null;
    }
}
export function serve(dir, { input = process.stdin, output = process.stdout, wait } = {}) {
    const reply = (id, result, error) => output.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) })}\n`);
    const rl = createInterface({ input });
    rl.on('line', async (line) => {
        const m = parsed(line);
        if (!m || m.id === undefined) return;
        if (m.method === 'initialize') return reply(m.id, { protocolVersion: m.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'binder', version: VERSION } });
        if (m.method === 'tools/list') return reply(m.id, { tools: TOOLS });
        if (m.method === 'ping') return reply(m.id, {});
        if (m.method === 'tools/call') {
            const { name, arguments: a = {} } = m.params ?? {};
            const what = asked(name, a);
            if (!what) return reply(m.id, undefined, { code: -32601, message: `no tool ${name}` });
            const r = await ask(dir, what[0], what[1], wait ? { wait } : {});
            return reply(m.id, { content: [{ type: 'text', text: r.ok ? r.text : `Not done: ${r.text}` }], ...(r.ok ? {} : { isError: true }) });
        }
        return reply(m.id, undefined, { code: -32601, message: `no method ${m.method}` });
    });
    return rl;
}

const HERE = fileURLToPath(import.meta.url);
const main = (() => { try { return realpathSync(process.argv[1] ?? '') === realpathSync(HERE); } catch { return false; } })();
if (main) {
    const at = process.argv.indexOf('--dir');
    const dir = findFolder({ dir: at >= 0 ? process.argv[at + 1] : undefined });
    if (!dir) { process.stderr.write(`No ${FOLDER} folder: give --dir FOLDER.\n`); process.exit(2); }
    serve(dir);
}
