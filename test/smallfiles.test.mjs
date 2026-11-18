/* 18-11: the keeper read every folder's asks and answers whole each second: read once, then only what was added,
   and the files kept small (only what is active, a little past). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, appendFileSync, writeFileSync, existsSync, utimesSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keeper, ROTATE_BYTES, KEEP_MS, OLD_MS } from '../host/binder-host.mjs';
import { lines } from '../server/binder.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'binder-small-'));
const BOT = { id: 'agent:site', kind: 'agent', name: 'Assistant · site' };
const ask = (id, at = new Date(), pad = '') => `${JSON.stringify({ id, at: at.toISOString(), op: 'lists', args: {}, ...(pad ? { pad } : {}) })}\n`;

test('lines: read once, then only what was added; replaced, read again; never a link', () => {
    const dir = tmp(); const f = join(dir, 'a.jsonl');
    appendFileSync(f, '{"n":1}\n{"n":2}\n');
    assert.deepEqual(lines(f).map((x) => x.n), [1, 2]);
    appendFileSync(f, 'junk\n{"n":3}\n{"n":4');
    assert.deepEqual(lines(f).map((x) => x.n), [1, 2, 3]);
    appendFileSync(f, '}\n');
    assert.deepEqual(lines(f).map((x) => x.n), [1, 2, 3, 4]);
    writeFileSync(`${f}.new`, '{"n":9}\n'); renameSync(`${f}.new`, f);
    assert.deepEqual(lines(f).map((x) => x.n), [9]);
    const link = join(dir, 'l.jsonl'); symlinkSync(f, link);
    assert.deepEqual(lines(link), []);
});

test('each ask answered once; past ROTATE_BYTES the answers keep the last hour, the asks are put aside then go; history never answered', () => {
    const side = tmp();
    const k = keeper(tmp(), { sides: () => [{ dir: side, who: BOT }] });
    const old = new Date(Date.now() - KEEP_MS - 60_000);
    let a = ''; let q = '';
    for (let i = 0; a.length <= ROTATE_BYTES; i++) { a += `${JSON.stringify({ ask: `o${i}`, at: old.toISOString(), ok: true, text: 'x'.repeat(400) })}\n`; q += ask(`o${i}`, old, 'y'.repeat(400)); }
    q += ask('ancient', old);
    writeFileSync(join(side, 'answers.jsonl'), a); writeFileSync(join(side, 'asks.jsonl'), q);
    assert.equal(k.pump(), 0, 'all answered or history');
    assert.equal(readFileSync(join(side, 'answers.jsonl'), 'utf8'), '', 'only the last hour kept');
    assert.ok(existsSync(join(side, 'asks.jsonl.old')) && !existsSync(join(side, 'asks.jsonl')));
    appendFileSync(join(side, 'asks.jsonl'), ask('n1'));
    appendFileSync(join(side, 'asks.jsonl.old'), ask('raced'));
    assert.equal(k.pump(), 2);
    assert.equal(k.pump(), 0, 'once');
    const then = new Date(Date.now() - OLD_MS - 1000); utimesSync(join(side, 'asks.jsonl.old'), then, then);
    k.pump();
    assert.ok(!existsSync(join(side, 'asks.jsonl.old')));
    assert.equal(k.pump(), 0, 'nothing answered twice');
    assert.deepEqual(lines(join(side, 'answers.jsonl')).map((x) => x.ask).sort(), ['n1', 'raced']);
});
