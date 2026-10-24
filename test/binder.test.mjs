import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, Refused } from '../server/store.mjs';
import { seed } from '../server/templates.mjs';
import { keeper } from '../host/binder-host.mjs';
import { ask } from '../server/binder.mjs';
import { run, read } from '../bin/binder.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'binder-'));
const ME = { id: 'person:owner', kind: 'person', name: 'Owner' };
const BOT = { id: 'agent:site', kind: 'agent', name: 'Assistant · site' };
const OTHER = { id: 'agent:api', kind: 'agent', name: 'Assistant · api' };

test('a template seeds a list in its language; a gate is said', () => {
    const fr = seed('batches', 'fr');
    assert.equal(fr.title, 'Lots');
    assert.deepEqual(fr.states.map((s) => s.name), ['Proposé', 'Validé', 'En cours', 'Pour toi', 'Fait']);
    assert.equal(fr.states[1].gate, true);
    assert.throws(() => seed('nothing'), /no template/);
});

test('an agent sees only the lists it was given, and changes only those it may write', () => {
    const s = openStore(tmp());
    const dev = s.createList({ template: 'development' }, ME);
    const crm = s.createList({ template: 'customers' }, ME);
    assert.throws(() => s.createList({}, BOT), /only a person/);
    assert.deepEqual(s.lists(BOT), []);
    s.grant(dev.id, BOT.id, 'read', ME);
    assert.deepEqual(s.lists(BOT).map((l) => l.id), [dev.id]);
    assert.throws(() => s.add(dev.id, { title: 'x' }, BOT), /not change it/);
    assert.throws(() => s.add(crm.id, { title: 'x' }, BOT), /no list/);
    s.grant(dev.id, BOT.id, 'write', ME);
    const r = s.add(dev.id, { title: 'Search in the news page', owners: [BOT.id] }, BOT);
    assert.equal(r.state, 'todo');
    assert.throws(() => s.record(r.id, OTHER), /no record/);
    assert.equal(s.lists(BOT)[0].grants, undefined, 'an agent does not see who else has access');
});

test('an agent proposes, a person approves; past the gate only what was approved', () => {
    const s = openStore(tmp());
    const l = s.createList({ template: 'batches' }, ME);
    s.grant(l.id, BOT.id, 'write', ME);
    assert.throws(() => s.add(l.id, { title: 'x', state: 'approved' }, BOT), /only a person approves/);
    const r = s.add(l.id, { title: 'Dark mode' }, BOT);
    assert.throws(() => s.move(r.id, 'doing', BOT), /only a person approves/);
    assert.throws(() => s.approve(r.id, true, BOT), /only a person/);
    s.approve(r.id, true, ME);
    assert.equal(s.record(r.id, ME).record.state, 'approved');
    s.move(r.id, 'doing', BOT);
    s.move(r.id, 'done', BOT);
    assert.equal(s.record(r.id, BOT).record.state, 'done');
    s.approve(r.id, false, ME);
    const back = s.record(r.id, ME).record;
    assert.equal(back.state, 'proposed'); assert.equal(back.approved, undefined);
    assert.throws(() => s.move(r.id, 'doing', BOT), /only a person approves/);
});

test('fields, owners, due dates, notes and attachments are checked', () => {
    const s = openStore(tmp());
    const l = s.createList({ template: 'customers' }, ME);
    const r = s.add(l.id, { title: 'Bakery', fields: { Website: 'https://example.com', phone: '0102' } }, ME);
    assert.deepEqual(r.fields, { site: 'https://example.com', phone: '0102' });
    assert.throws(() => s.edit(r.id, { fields: { site: 'example.com' } }, ME), /is a link/);
    assert.throws(() => s.edit(r.id, { fields: { color: 'red' } }, ME), /no field "color"/);
    assert.throws(() => s.edit(r.id, { due: 'tomorrow' }, ME), /due date/);
    s.edit(r.id, { due: '2026-11-04 09:00', owners: ['person:owner', 'person:owner'] }, ME);
    assert.deepEqual(s.record(r.id, ME).record.owners, ['person:owner']);
    s.note(r.id, 'Prefers calls in the morning.', ME);
    assert.throws(() => s.note(r.id, '   ', ME), /needs a text/);
    const other = s.add(l.id, { title: 'Florist' }, ME);
    s.attach(r.id, { kind: 'record', ref: `#${other.id}` }, ME);
    s.attach(r.id, { kind: 'message', ref: 'abc-123', title: 'They want online orders' }, ME);
    assert.throws(() => s.attach(r.id, { kind: 'message', ref: 'abc-123' }, ME), /already/);
    assert.throws(() => s.attach(r.id, { kind: 'record', ref: r.id }, ME), /itself/);
    assert.throws(() => s.attach(r.id, { kind: 'link', ref: 'ftp://x' }, ME), /http/);
    assert.throws(() => s.attach(r.id, { kind: 'pigeon', ref: 'x' }, ME), /attach one of/);
    assert.equal(s.record(r.id, ME).record.attached.length, 2);
});

test('a note is changed only by whoever wrote it, and the history says so', () => {
    const s = openStore(tmp());
    const l = s.createList({ template: 'simple' }, ME);
    s.grant(l.id, BOT.id, 'write', ME);
    const r = s.add(l.id, { title: 'x' }, ME);
    const n = s.note(r.id, 'first', BOT);
    assert.throws(() => s.editNote(r.id, n.id, 'mine now', ME), /whoever wrote it/);
    s.editNote(r.id, n.id, 'second', BOT);
    const got = s.record(r.id, ME);
    assert.equal(got.record.notes[0].text, 'second');
    assert.ok(got.record.notes[0].edited);
    assert.deepEqual(got.history.map((h) => h.op), ['add', 'note', 'edit-note']);
});

test('deleted is deleted: the log keeps who and when, not what', () => {
    const dir = tmp();
    const s = openStore(dir);
    const l = s.createList({ template: 'people' }, ME);
    s.grant(l.id, BOT.id, 'write', ME);
    const r = s.add(l.id, { title: 'Jeanne Secret' }, ME);
    const keep = s.add(l.id, { title: 'Paul' }, ME);
    s.attach(keep.id, { kind: 'record', ref: r.id }, ME);
    assert.throws(() => s.delete(r.id, BOT), /archive it instead/);
    s.delete(r.id, ME);
    const log = readFileSync(join(dir, 'log.jsonl'), 'utf8');
    assert.equal(log.includes('Jeanne Secret'), false);
    assert.match(log, /"op":"delete"/);
    assert.equal(s.record(keep.id, ME).record.attached.length, 0, 'what pointed to it is taken off');
    assert.throws(() => s.record(r.id, ME), /no record/);
});

test('the store survives a restart, and a state.json that does not parse starts empty', () => {
    const dir = tmp();
    const a = openStore(dir);
    const l = a.createList({ template: 'roadmap', title: 'Roadmap 2027' }, ME);
    a.add(l.id, { title: 'Offline mode' }, ME);
    const b = openStore(dir);
    assert.equal(b.list('Roadmap 2027', ME).records[0].title, 'Offline mode');
    writeFileSync(join(dir, 'state.json'), '{not json');
    assert.deepEqual(openStore(dir).lists(ME), []);
});

test('editing a list: states that go send their records to the first state; one gate at most', () => {
    const s = openStore(tmp());
    const l = s.createList({ template: 'development' }, ME);
    const r = s.add(l.id, { title: 'x', state: 'doing' }, ME);
    s.editList(l.id, { states: [{ name: 'Backlog' }, { name: 'Shipped', done: true }] }, ME);
    assert.equal(s.record(r.id, ME).record.state, 'backlog');
    assert.throws(() => s.editList(l.id, { states: [{ name: 'a', gate: true }, { name: 'b', gate: true }] }, ME), /one gate/);
    assert.throws(() => s.editList(l.id, { view: 'pie' }, ME), /a view is/);
    assert.throws(() => s.editList(l.id, { title: 'x' }, BOT), /only a person/);
});

test('due records are said once per due time, not when done', () => {
    let t = Date.parse('2026-11-04T08:00:00');
    const s = openStore(tmp(), { now: () => t });
    const l = s.createList({ template: 'simple' }, ME);
    const r = s.add(l.id, { title: 'Call back', due: '2026-11-04 09:00', owners: [BOT.id] }, ME);
    const done = s.add(l.id, { title: 'old', due: '2026-11-01', state: 'done' }, ME);
    assert.equal(s.due().length, 0);
    t = Date.parse('2026-11-04T09:01:00');
    assert.deepEqual(s.due().map((x) => x.record.id), [r.id]);
    assert.equal(s.due().length, 0);
    s.edit(r.id, { due: '2026-11-05' }, ME);
    t = Date.parse('2026-11-05T10:00:00');
    assert.equal(s.due().length, 1);
    assert.ok(done);
});

test('the keeper answers an agent through its folder, as the folder says who it is', async () => {
    const store = tmp(); const side = tmp();
    const k = keeper(store, { sides: () => [{ dir: side, who: BOT }] });
    const l = k.store.createList({ template: 'development' }, ME);
    k.store.grant(l.id, BOT.id, 'write', ME);
    const timer = setInterval(() => k.pump(), 20);
    try {
        const added = await ask(side, 'add', { list: 'Development', title: 'Search', owners: ['me'] }, { wait: 3000, every: 10 });
        assert.equal(added.ok, true, added.text);
        assert.match(added.text, /Added #1/);
        assert.deepEqual(k.store.record('1', ME).record.owners, [BOT.id]);
        assert.equal(k.store.record('1', ME).record.by, BOT.id);
        const shown = await ask(side, 'show', { list: l.id }, { wait: 3000, every: 10 });
        assert.match(shown.text, /To do:\n {2}#1 Search @agent:site/);
        const refused = await ask(side, 'create-list', { template: 'simple' }, { wait: 3000, every: 10 });
        assert.equal(refused.ok, false);
        assert.match(refused.text, /only a person/);
        const cli = await run(['note', '1', 'it', 'works'], { env: { BINDER_DIR: side }, wait: 3000 });
        assert.equal(cli.code, 0, cli.err);
        assert.equal(k.store.record('1', ME).record.notes[0].by.id, BOT.id);
    } finally { clearInterval(timer); }
});

test('an ask too old is not done; nobody keeping says so, and nothing changed', async () => {
    const store = tmp(); const side = tmp();
    const k = keeper(store, { sides: () => [{ dir: side, who: BOT }] });
    const l = k.store.createList({ template: 'simple' }, ME);
    k.store.grant(l.id, BOT.id, 'write', ME);
    appendFileSync(join(side, 'asks.jsonl'), `${JSON.stringify({ id: 'old', at: new Date(Date.now() - 120_000).toISOString(), op: 'add', args: { list: l.id, title: 'late' } })}\n`);
    assert.equal(k.pump(), 1);
    assert.equal(k.store.list(l.id, ME).records.length, 0);
    assert.match(readFileSync(join(side, 'answers.jsonl'), 'utf8'), /too late/);
    const nobody = await run(['lists'], { env: { BINDER_DIR: tmp() }, wait: 200 });
    assert.equal(nobody.code, 3);
    assert.match(nobody.err, /nobody keeps this binder/);
});

test('the command line is read as the help says', () => {
    assert.deepEqual(read(['add', 'Batches', 'Dark', 'mode', '--owner', 'me', '--field', 'phone=01 02']),
        ['add', { list: 'Batches', title: 'Dark mode', state: undefined, due: undefined, owners: ['me'], note: undefined, fields: { phone: '01 02' } }]);
    assert.deepEqual(read(['edit', '3', '--due', 'none', '--owner', 'none']), ['edit', { id: '3', title: undefined, due: '', owners: [] }]);
    assert.deepEqual(read([]), ['lists', {}]);
    assert.ok(read(['fly']).refused);
    assert.ok(read(['move', '3']).refused);
    assert.ok(Refused);
});
