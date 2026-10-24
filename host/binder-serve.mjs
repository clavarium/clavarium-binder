/* BINDER WITHOUT AN APPLICATION: `binder serve` keeps a binder itself, and
 * shows its page to the person on this machine.
 *
 *   binder serve [--store DIR] [--port N] [--side FOLDER=NAME]... [--lang fr]
 *
 * The store is DIR (default: $BINDER_STORE, else ~/.local/share/clavarium-binder):
 * put it where the agents cannot write -- another user's, or outside what they
 * are given -- since whoever can write the store can rewrite the binder.
 * Each --side is an agent's folder (its .binder) and the name it is shown by;
 * without one, the .binder of the folder it is started from, as "Agent".
 *
 * The page listens on 127.0.0.1 only: who reaches it is the person. Nothing here
 * is meant to face a network; an application that does gives its own door.
 */
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { keeper } from './binder-host.mjs';
import { FOLDER } from '../server/binder.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const UI = resolve(HERE, '../ui');
const PERSON = { id: 'person:you', kind: 'person', name: 'You' };
const BODY_MAX = 256 * 1024;

const PAGE = (lang) => `<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Binder</title><link rel="stylesheet" href="/ui/binder-ui.css">
<style>html,body{margin:0;background:#0f1115}@media (prefers-color-scheme:light){html,body{background:#fff}}body{font:15px/1.4 system-ui,sans-serif;padding:16px;max-width:1200px;margin:auto}</style>
<div id="binder"></div>
<script type="module">
import { mount } from '/ui/binder-ui.js';
const words = await (await fetch('/ui/texts/${lang}.json')).json();
const people = await (await fetch('/api/people')).json();
const call = async (op, args) => (await fetch('/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, args }) })).json();
const b = mount(document.getElementById('binder'), { call, words, lang: '${lang}', people: () => people });
new EventSource('/api/changes').onmessage = () => b.refresh();
</script></html>`;

export function options(argv, { env = process.env, cwd = process.cwd() } = {}) {
    const o = { store: env.BINDER_STORE || join(homedir(), '.local', 'share', 'clavarium-binder'), port: 4180, sides: [], lang: 'en' };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]; const v = argv[i + 1];
        if (a === '--store' && v) { o.store = resolve(cwd, v); i++; }
        else if (a === '--port' && v) { o.port = Number(v); i++; }
        else if (a === '--lang' && v) { o.lang = v === 'fr' ? 'fr' : 'en'; i++; }
        else if (a === '--side' && v) {
            const at = v.lastIndexOf('='); const dir = resolve(cwd, at > 0 ? v.slice(0, at) : v); const name = at > 0 ? v.slice(at + 1) : 'Agent';
            o.sides.push({ dir, who: { id: `agent:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, kind: 'agent', name } }); i++;
        } else throw new Error(`not understood: ${a}`);
    }
    if (!o.sides.length) o.sides.push({ dir: join(cwd, FOLDER), who: { id: 'agent:agent', kind: 'agent', name: 'Agent' } });
    if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new Error('--port takes a number');
    return o;
}

export function start(o, { quiet = false } = {}) {
    for (const s of o.sides) mkdirSync(s.dir, { recursive: true });
    const k = keeper(o.store, { sides: () => o.sides });
    const watchers = new Set();
    k.store.onChange(() => { for (const res of watchers) res.write('data: change\n\n'); });
    const pump = setInterval(() => { try { k.pump(); } catch (error) { if (!quiet) process.stderr.write(`binder: ${error.message}\n`); } }, 500);
    const files = { '/ui/binder-ui.js': 'text/javascript', '/ui/binder-ui.css': 'text/css', '/ui/texts/en.json': 'application/json', '/ui/texts/fr.json': 'application/json' };
    const server = createServer((req, res) => {
        const url = new URL(req.url, 'http://local');
        const send = (code, type, body) => { res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(body); };
        if (req.method === 'GET' && url.pathname === '/') return send(200, 'text/html', PAGE(o.lang));
        if (req.method === 'GET' && files[url.pathname]) return send(200, files[url.pathname], readFileSync(join(UI, url.pathname.slice('/ui/'.length))));
        if (req.method === 'GET' && url.pathname === '/api/people') return send(200, 'application/json', JSON.stringify([PERSON, ...o.sides.map((s) => s.who)]));
        if (req.method === 'GET' && url.pathname === '/api/changes') {
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }); res.write(': on\n\n');
            watchers.add(res); req.on('close', () => watchers.delete(res)); return undefined;
        }
        if (req.method === 'POST' && url.pathname === '/api') {
            /* A page of another site cannot post here: the type it would need is not one a form sends. */
            if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return send(415, 'text/plain', 'json only');
            let body = '';
            req.on('data', (c) => { body += c; if (body.length > BODY_MAX) req.destroy(); });
            req.on('end', () => {
                let q; try { q = JSON.parse(body); } catch { return send(400, 'application/json', JSON.stringify({ ok: false, text: 'not understood' })); }
                const r = k.act(String(q?.op ?? ''), q?.args && typeof q.args === 'object' ? q.args : {}, PERSON);
                return send(200, 'application/json', JSON.stringify(r));
            });
            return undefined;
        }
        return send(404, 'text/plain', 'not here');
    });
    return new Promise((ok) => server.listen(o.port, '127.0.0.1', () => {
        if (!quiet) process.stdout.write(`Binder kept in ${o.store}\nPage: http://127.0.0.1:${server.address().port}/\nAgents: ${o.sides.map((s) => `${s.who.name} (${s.dir})`).join(', ')}\n`);
        ok({ server, keeper: k, port: server.address().port, close: () => { clearInterval(pump); for (const r of watchers) r.end(); server.close(); } });
    }));
}

export async function serveBinder(argv) {
    let o;
    try { o = options(argv); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 64; return; }
    await start(o);
}
