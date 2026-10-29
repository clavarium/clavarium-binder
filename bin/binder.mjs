#!/usr/bin/env node
/* THE COMMAND: Binder's verbs for any agent or script that can run a command.
 * It asks through the same folder as the MCP server (server/binder.mjs), and
 * prints the keeper's answer. `binder serve` IS a keeper: the binder and its
 * page, for use without an application.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ask, findFolder, FOLDER, VERSION } from '../server/binder.mjs';

export const HELP = `binder: the lists you were given, and their records.

  binder                               your lists
  binder show LIST [--state S] [--mine] [--archived] [--changed-since YYYY-MM-DD] [--quiet-for DAYS]
                                       the records of a list, by state
  binder get ID                        one record: fields, notes, what is attached, its history
  binder search "text"                 in every list you can see
  binder people                        who may carry a record (--owner ID): the person you work for, others, conversations
  binder add LIST "title" [--description "text"] [--state S] [--due DATE] [--remind-before DAYS] [--owner me] [--note "text"] [--field name=value]
  binder edit ID [--title "t"] [--description "text"] [--due DATE|none] [--remind-before DAYS|none] [--repeat on|DAYS|none] [--urgency-from DATE|none] [--owner me|ID|me,ID|NAME|none] [--field name=value]
         [--cover PICTURE|none]          the picture the card is shown by: one attached (its ref), or a photo field
  binder move ID STATE [--next DATE]   past a gate, only what a person approved; a recurrent record reopens on done
  binder note ID "text"                a short note: a decision, a fact, a result
  binder note ID --delete N            take back note N of yours (its number in binder get)
  binder attach ID KIND REF ["title"]  KIND: message, file, asset, branch, commit, link, record, mail, event
                                       attach the sources a card stands on, generously; never copy their text into it
  binder detach ID WHAT
  binder archive ID | binder restore ID
  binder new TEMPLATE ["title"]        a list of your own, when none you were given fits
                                       TEMPLATE: batches, development, customers, people, priorities, roadmap, simple
  binder retype LIST TEMPLATE          give an existing list another type (its view + fields), keeping every record (a person only)
  binder field LIST add NOM [TYPE]     add a field to a list (TYPE: text, number, date, link, photo; text by default)
  binder field LIST remove NOM         remove a field (a person only)
  binder serve [--store DIR] [--port N] [--side FOLDER=NAME]
                                       keep a binder yourself, with its page (no application)

ID: a record's number, 12 or #12. DATE: 2026-11-04, or "2026-11-04 09:00".
--remind-before DAYS reminds the owners that many days before the due time (e.g. 1, 3, 7); none removes it.
--urgency-from DATE makes its urgency automatic: rising from that date to its due date (a matrix shows it); none: set by hand.
A description is for a person: short and clear, what it is and why, 1 to 3 lines
(Markdown-ish: "- " lists, **bold**, links). --description "" removes it.
You never approve: a person ticks what may go on. Talking with them stays in the chat.
The folder used is --dir FOLDER, else $BINDER_DIR, else the nearest ${FOLDER} folder from here up.
binder ${VERSION}`;

const VERBS = ['lists', 'people', 'show', 'get', 'search', 'add', 'edit', 'move', 'note', 'attach', 'detach', 'archive', 'restore', 'new', 'retype', 'archive-list', 'restore-list', 'columns', 'field'];

/* A command line, read: [op, args] or a refusal. */
export function read(argv) {
    const args = [...argv];
    const flags = {}; const fields = {}; const words = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--mine' || a === '--archived') { flags[a.slice(2)] = true; continue; }
        if (a === '--field') { const v = args[++i] ?? ''; const at = v.indexOf('='); if (at < 1) return { refused: '--field takes name=value' }; fields[v.slice(0, at)] = v.slice(at + 1); continue; }
        if (a.startsWith('--')) { if (args[i + 1] === undefined) return { refused: `${a} needs a value` }; flags[a.slice(2)] = args[++i]; continue; }
        words.push(a);
    }
    const [verb = 'lists', ...rest] = words;
    if (!VERBS.includes(verb)) return { refused: `Unknown: ${verb}. Run "binder --help".` };
    const owners = flags.owner === undefined ? undefined : flags.owner === 'none' ? [] : String(flags.owner).split(',').map((x) => x.trim()).filter(Boolean);
    const due = flags.due === 'none' ? '' : flags.due;
    const remind = flags['remind-before'] === undefined ? {} : { remindBefore: flags['remind-before'] === 'none' ? '' : flags['remind-before'] };
    const has = Object.keys(fields).length ? { fields } : {};
    switch (verb) {
        case 'lists': return ['lists', {}];
        case 'people': return ['people', {}];
        case 'show': return rest[0] ? ['show', { list: rest[0], state: flags.state, mine: !!flags.mine, archived: !!flags.archived, changedSince: flags['changed-since'], quietFor: flags['quiet-for'] }] : { refused: 'say which list: binder show LIST' };
        case 'get': return rest[0] ? ['get', { id: rest[0] }] : { refused: 'say which record: binder get ID' };
        case 'search': return rest.length ? ['search', { text: rest.join(' ') }] : { refused: 'say what to look for' };
        case 'add': return rest.length >= 2 ? ['add', { list: rest[0], title: rest.slice(1).join(' '), state: flags.state, due, owners, note: flags.note, description: flags.description, ...remind, ...has }] : { refused: 'binder add LIST "title"' };
        case 'edit': return rest[0] ? ['edit', { id: rest[0], title: flags.title, description: flags.description, due, owners, ...remind, ...(flags.repeat === undefined ? {} : { repeat: flags.repeat }), ...(flags.cover === undefined ? {} : { cover: flags.cover === 'none' ? '' : flags.cover }), ...(flags['urgency-from'] === undefined ? {} : { urgencyFrom: flags['urgency-from'] === 'none' ? '' : flags['urgency-from'] }), ...has }] : { refused: 'say which record: binder edit ID' };
        case 'move': return rest.length === 2 ? ['move', { id: rest[0], state: rest[1], next: flags.next }] : { refused: 'binder move ID STATE' };
        case 'note':
            /* A note of one's own taken back, by its number as "binder get" shows it (a double, a mistake). */
            if (flags.delete !== undefined) return rest[0] ? ['edit-note', { id: rest[0], note: flags.delete, text: '' }] : { refused: 'binder note ID --delete N' };
            return rest.length >= 2 ? ['note', { id: rest[0], text: rest.slice(1).join(' ') }] : { refused: 'binder note ID "text"' };
        case 'attach': return rest.length >= 3 ? ['attach', { id: rest[0], kind: rest[1], ref: rest[2], title: rest.slice(3).join(' ') }] : { refused: 'binder attach ID KIND REF ["title"]' };
        case 'detach': return rest.length === 2 ? ['detach', { id: rest[0], what: rest[1] }] : { refused: 'binder detach ID WHAT' };
        case 'archive': return rest[0] ? ['archive', { id: rest[0], restore: false }] : { refused: 'binder archive ID' };
        case 'restore': return rest[0] ? ['archive', { id: rest[0], restore: true }] : { refused: 'binder restore ID' };
        case 'new': return rest[0] ? ['create-list', { template: rest[0], title: rest.slice(1).join(' ') || undefined }] : { refused: 'binder new TEMPLATE ["title"]' };
        case 'retype': return rest[0] && rest[1] ? ['retype', { list: rest[0], template: rest[1], ...(flags.lang ? { lang: flags.lang } : {}) }] : { refused: 'binder retype LIST TEMPLATE  (a person only; keeps every record)' };
        case 'archive-list': case 'restore-list': return rest[0] ? ['archive-list', { list: rest[0], archived: verb === 'archive-list' }] : { refused: `binder ${verb} LIST` };
        case 'columns': {
            const [list, action, ...more] = rest;
            if (!list || !action) return { refused: 'binder columns LIST add "Name" [--after STATE|--before STATE] | binder columns LIST rename "Old" "New"' };
            if (action === 'add') return more.length ? ['columns', { list, add: more.join(' '), ...(flags.after ? { after: flags.after } : {}), ...(flags.before ? { before: flags.before } : {}) }] : { refused: 'binder columns LIST add "Name"' };
            if (action === 'rename') return more.length >= 2 ? ['columns', { list, rename: { from: more[0], to: more.slice(1).join(' ') } }] : { refused: 'binder columns LIST rename "Old" "New"' };
            return { refused: 'binder columns LIST add "Name" | rename "Old" "New"' };
        }
        case 'field': {
            const TYPES = ['text', 'number', 'date', 'link', 'photo'];
            const [list, action, ...more] = rest;
            if (!list || !action) return { refused: `binder field LIST add NOM [TYPE] | binder field LIST remove NOM  (TYPE: ${TYPES.join(', ')})` };
            if (action === 'add') {
                if (!more.length) return { refused: `binder field LIST add NOM [TYPE]  (TYPE: ${TYPES.join(', ')}, text by default)` };
                const last = more[more.length - 1];
                const type = TYPES.includes(last) ? last : 'text';
                const name = (TYPES.includes(last) ? more.slice(0, -1) : more).join(' ');
                return name ? ['field', { list, add: { name, type } }] : { refused: 'binder field LIST add NOM [TYPE]' };
            }
            if (action === 'remove') return more.length ? ['field', { list, remove: more.join(' ') }] : { refused: 'binder field LIST remove NOM' };
            return { refused: 'binder field LIST add NOM [TYPE] | binder field LIST remove NOM' };
        }
        default: return { refused: 'not understood' };
    }
}

/* Runs one command line. Resolves with { code, out, err }: nothing is printed here. */
export async function run(argv, { env = process.env, cwd = process.cwd(), wait } = {}) {
    const args = [...argv];
    let dir;
    const at = args.indexOf('--dir');
    if (at >= 0) { dir = args[at + 1]; if (!dir) return { code: 64, out: '', err: '--dir needs a folder.\n' }; args.splice(at, 2); }
    if (['--help', '-h', 'help'].includes(args[0])) return { code: 0, out: `${HELP}\n`, err: '' };
    if (args[0] === '--version') return { code: 0, out: `${VERSION}\n`, err: '' };
    const what = read(args);
    if (what.refused) return { code: 64, out: '', err: `${what.refused}\n` };
    const folder = findFolder({ dir, env, from: cwd });
    if (!folder) return { code: 2, out: '', err: `No ${FOLDER} folder here or above. Run it from your work folder, or give --dir FOLDER.\n` };
    const r = await ask(folder, what[0], what[1], wait ? { wait } : {});
    if (r.ok) return { code: 0, out: `${r.text}\n`, err: '' };
    return { code: r.nokeeper ? 3 : 1, out: '', err: `Not done: ${r.text}\n` };
}

const main = (() => { try { return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (main) {
    const argv = process.argv.slice(2);
    if (argv[0] === 'serve') {
        const { serveBinder } = await import('../host/binder-serve.mjs');
        await serveBinder(argv.slice(1));
    } else {
        const r = await run(argv);
        if (r.out) process.stdout.write(r.out);
        if (r.err) process.stderr.write(r.err);
        process.exitCode = r.code;
    }
}
