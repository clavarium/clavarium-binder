import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, Refused } from '../server/store.mjs';
import { seed } from '../server/templates.mjs';
import { keeper } from '../host/binder-host.mjs';
import { ask, asked, TOOLS } from '../server/binder.mjs';
import { say } from '../host/binder-host.mjs';
import { blocks, toggled, inline, firstLine, rich, facts, isPicture, pictures, coverOf, imageOf, stateShown, canMatrix, score, MATRIX_AXES, KEYS, mount } from '../ui/binder-ui.js';
import { isPicture as storeIsPicture } from '../server/store.mjs';
import { DESCRIPTION_MAX, AGENT_LISTS_MAX, AGENT_LISTS_DEFAULT } from '../server/store.mjs';
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
    s.attach(r.id, { kind: 'commit', ref: 'clavarium:abc1234', title: 'The fix' }, ME);
    assert.equal(s.record(r.id, ME).record.attached.find((a) => a.kind === 'commit').ref, 'clavarium:abc1234', 'a commit is attached by repository:sha');
    assert.throws(() => s.attach(r.id, { kind: 'message', ref: 'abc-123' }, ME), /already/);
    assert.throws(() => s.attach(r.id, { kind: 'record', ref: r.id }, ME), /itself/);
    assert.throws(() => s.attach(r.id, { kind: 'link', ref: 'ftp://x' }, ME), /http/);
    assert.throws(() => s.attach(r.id, { kind: 'pigeon', ref: 'x' }, ME), /attach one of/);
    assert.equal(s.record(r.id, ME).record.attached.length, 3);
});

test('a mail and a calendar event attach by their Tether ref, each with a title the card shows', () => {
    const s = openStore(tmp());
    const l = s.createList({ template: 'simple', title: 'Sujets' }, ME);
    const r = s.add(l.id, { title: 'Atelier datacraft' }, ME);
    s.attach(r.id, { kind: 'mail', ref: 'AAMkAGI2', title: 'RE: datacraft — alice@example.org — 28 oct.' }, ME);
    s.attach(r.id, { kind: 'event', ref: 'evt-9f3', title: 'Atelier datacraft — 10 nov. 14:00' }, ME);
    const got = s.record(r.id, ME).record.attached;
    assert.equal(got.find((a) => a.kind === 'mail').ref, 'AAMkAGI2', 'the mail keeps its Tether id');
    assert.match(got.find((a) => a.kind === 'mail').title, /datacraft/, 'and the subject the card shows');
    assert.equal(got.find((a) => a.kind === 'event').ref, 'evt-9f3');
    assert.equal(got.length, 2);
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

test('what is due: a date alone at 09:00 by the keeper\'s clock; not archived; kept across a restart', () => {
    const dir = tmp();
    let t = Date.parse('2026-11-04T08:59:00');
    const s = openStore(dir, { now: () => t });
    const l = s.createList({ template: 'simple' }, ME);
    const r = s.add(l.id, { title: 'Renew', due: '2026-11-04', owners: [BOT.id] }, ME);
    const gone = s.add(l.id, { title: 'Put away', due: '2026-11-04' }, ME);
    s.archive(gone.id, true, ME);
    assert.equal(s.due().length, 0, 'not before 09:00');
    t = Date.parse('2026-11-04T09:00:00');
    const told = s.due();
    assert.deepEqual(told.map((x) => [x.record.id, x.list.title]), [[r.id, l.title]]);
    const again = openStore(dir, { now: () => t });
    assert.equal(again.due().length, 0, 'a restart does not say it again');
    again.edit(r.id, { due: '2026-11-06 14:30' }, ME);
    t = Date.parse('2026-11-06T14:29:00');
    assert.equal(again.due().length, 0);
    t = Date.parse('2026-11-06T14:30:00');
    assert.deepEqual(again.due().map((x) => x.record.id), [r.id], 'moved later: said again');
    const other = again.createList({ template: 'simple' }, ME);
    again.add(other.id, { title: 'In a list put away', due: '2026-11-01' }, ME);
    again.archiveList(other.id, true, ME);
    assert.equal(again.due().length, 0);
});

test('a lead reminder is said once, remindBefore days before the due, then the due time itself', () => {
    let t = Date.parse('2026-10-27T10:00:00');
    const s = openStore(tmp(), { now: () => t });
    const l = s.createList({ template: 'simple' }, ME);
    const r = s.add(l.id, { title: 'Voyage à Paris', due: '2026-11-04 09:00', remindBefore: 7, owners: [BOT.id] }, ME);
    assert.equal(s.due().length, 0, 'before the lead moment: nothing');
    t = Date.parse('2026-10-28T09:00:00');     // due − 7 days
    assert.deepEqual(s.due().map((x) => [x.kind, x.days, x.record.id]), [['due-soon', 7, r.id]]);
    assert.equal(s.due().length, 0, 'the lead is said only once');
    t = Date.parse('2026-11-01T12:00:00');     // between lead and due
    assert.equal(s.due().length, 0, 'no second lead, and not yet due');
    t = Date.parse('2026-11-04T09:00:00');     // the due time
    assert.deepEqual(s.due().map((x) => x.kind), ['due']);
    assert.equal(s.due().length, 0, 'the due is said only once');
});

test('a lead re-arms when the due or the lead changes', () => {
    let t = Date.parse('2026-10-28T09:00:00');
    const s = openStore(tmp(), { now: () => t });
    const l = s.createList({ template: 'simple' }, ME);
    const r = s.add(l.id, { title: 'Lead', due: '2026-11-04 09:00', remindBefore: 7, owners: [BOT.id] }, ME);
    const lead = () => s.due().filter((x) => x.kind === 'due-soon');
    assert.deepEqual(lead().map((x) => x.days), [7], '28 Oct = 4 Nov − 7');
    assert.equal(lead().length, 0, 'only once');
    s.edit(r.id, { due: '2026-11-10 09:00' }, ME);   // lead moves to 3 Nov
    t = Date.parse('2026-11-03T09:00:00');
    assert.deepEqual(lead().map((x) => x.days), [7], 'moved due: the lead is said afresh');
    s.edit(r.id, { remindBefore: 3 }, ME);            // lead moves to 7 Nov
    t = Date.parse('2026-11-07T09:00:00');
    assert.deepEqual(lead().map((x) => x.days), [3], 'changed lead: said afresh');
    s.edit(r.id, { remindBefore: 0 }, ME);            // lead removed
    t = Date.parse('2026-11-09T09:00:00');
    assert.equal(lead().length, 0, 'removed: never a lead again');
});

test('no lead without remindBefore; a lead is a whole number of days', () => {
    const t = Date.parse('2026-11-03T09:00:00');
    const s = openStore(tmp(), { now: () => t });
    const l = s.createList({ template: 'simple' }, ME);
    const r = s.add(l.id, { title: 'Plain', due: '2026-11-04 09:00', owners: [BOT.id] }, ME);
    assert.equal(s.due().length, 0, 'no due-soon without remindBefore, and not yet due');
    assert.throws(() => s.edit(r.id, { remindBefore: 0.5 }, ME), /whole number/);
    assert.throws(() => s.edit(r.id, { remindBefore: -2 }, ME), /whole number/);
    s.edit(r.id, { remindBefore: 7 }, ME);
    assert.equal(s.record(r.id, ME).record.remindBefore, 7);
});

test('past the due time the lead window is gone: only the due is said', () => {
    const t = Date.parse('2026-11-05T09:00:00');     // already past the due
    const s = openStore(tmp(), { now: () => t });
    const l = s.createList({ template: 'simple' }, ME);
    const r = s.add(l.id, { title: 'Late', due: '2026-11-04 09:00', remindBefore: 7, owners: [BOT.id] }, ME);
    assert.deepEqual(s.due().map((x) => [x.kind, x.record.id]), [['due', r.id]]);
    assert.equal(s.due().length, 0);
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
        const made = await ask(side, 'create-list', { template: 'batches' }, { wait: 3000, every: 10 });
        assert.equal(made.ok, true, made.text);
        assert.match(made.text, /^Made the list Batches \[batches\], yours to change: binder add batches "title"\.$/);
        const refused = await ask(side, 'create-list', { template: 'nothing' }, { wait: 3000, every: 10 });
        assert.equal(refused.ok, false);
        assert.match(refused.text, /made from a template/);
        const cli = await run(['note', '1', 'it', 'works'], { env: { BINDER_DIR: side }, wait: 3000 });
        assert.equal(cli.code, 0, cli.err);
        assert.equal(k.store.record('1', ME).record.notes[0].by.id, BOT.id);
    } finally { clearInterval(timer); }
});

test('an agent makes a list from a template: given to it alone, to change; a few at most; it still never approves nor changes the list itself', async () => {
    const s = openStore(tmp());
    const mine = s.createList({ template: 'batches', title: 'Lots' }, BOT);
    assert.equal(mine.title, 'Lots');
    assert.deepEqual(mine.access, { [BOT.id]: 'write' });
    assert.equal(mine.by, BOT.id);
    assert.deepEqual(s.lists(BOT).map((l) => [l.id, l.access]), [[mine.id, 'write']]);
    assert.deepEqual(s.lists(OTHER), [], 'another agent does not see it');
    assert.equal(s.lists(ME).length, 1, 'a person sees it as any');
    const r = s.add(mine.id, { title: 'Fix diff line numbers' }, BOT);
    assert.throws(() => s.move(r.id, 'doing', BOT), /only a person approves/);
    assert.throws(() => s.editList(mine.id, { title: 'x' }, BOT), /only a person/);
    assert.throws(() => s.grant(mine.id, OTHER.id, 'write', BOT), /only a person/);
    assert.throws(() => s.createList({ template: 'nothing' }, BOT), /made from a template/);
    for (let i = 0; i < AGENT_LISTS_MAX - 1; i++) s.createList({ template: 'simple' }, BOT);
    assert.throws(() => s.createList({ template: 'simple' }, BOT), new RegExp(`${AGENT_LISTS_MAX} lists made by you at most`));
    s.createList({ template: 'simple' }, OTHER);
    assert.equal(read(['new', 'batches', 'Lots', 'of', 'work'])[1].title, 'Lots of work');
    assert.deepEqual(read(['new', 'batches']), ['create-list', { template: 'batches', title: undefined }]);
    assert.ok(read(['new']).refused);
    assert.deepEqual(asked('new-list', { template: 'batches' }), ['create-list', { template: 'batches', title: undefined }]);
    assert.ok(TOOLS.some((x) => x.name === 'new-list'));
});

test('lists an agent may make: set by a person alone (0 to 50, 5 by default), kept, in the history, applied; 0 makes none', () => {
    const dir = tmp();
    const s = openStore(dir);
    assert.deepEqual(s.settings(BOT), { agentLists: AGENT_LISTS_DEFAULT, agentColumns: true });
    assert.equal(AGENT_LISTS_DEFAULT, 5);
    assert.throws(() => s.editSettings({ agentLists: 9 }, BOT), /only a person changes the settings/);
    for (const bad of [-1, 51, 2.5, 'two', null, '']) assert.throws(() => s.editSettings({ agentLists: bad }, ME), /from 0 to 50/, String(bad));
    assert.equal(s.settings(ME).agentLists, 5, 'nothing refused was kept');
    assert.deepEqual(s.editSettings({ agentLists: 2 }, ME), { agentLists: 2, agentColumns: true });
    assert.equal(openStore(dir).settings(ME).agentLists, 2, 'kept in the store');
    const line = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n').map((x) => JSON.parse(x)).find((x) => x.op === 'edit-settings');
    assert.deepEqual([line.by.id, line.change], [ME.id, { agentLists: 2 }], 'in the history');
    s.createList({ template: 'simple' }, BOT);
    const second = s.createList({ template: 'simple' }, BOT);
    assert.throws(() => s.createList({ template: 'simple' }, BOT), (e) => e instanceof Refused && /^2 lists made by you at most/.test(e.message), 'the number said');
    s.archiveList(second.id, true, ME);
    s.createList({ template: 'simple' }, BOT);
    s.createList({ template: 'simple' }, ME);
    s.editSettings({ agentLists: '0' }, ME);
    assert.throws(() => s.createList({ template: 'simple' }, OTHER), /set 0 lists an agent may make/);
    s.createList({ template: 'simple' }, ME);
    s.editSettings({ agentLists: 50 }, ME);
    s.createList({ template: 'simple' }, OTHER);
    /* Through the keeper: a person from the page, an agent from its folder. */
    const k = keeper(tmp());
    assert.deepEqual(k.act('edit-settings', { agentLists: 1 }, ME), { ok: true, text: 'Lists an agent may make: 1. Columns an agent may change: yes.', data: { agentLists: 1, agentColumns: true } });
    assert.equal(k.act('edit-settings', { agentLists: 7 }, BOT).ok, false);
    assert.equal(k.act('settings', {}, BOT).data.agentLists, 1);
    k.act('create-list', { template: 'simple' }, BOT);
    assert.match(k.act('create-list', { template: 'simple' }, BOT).text, /1 lists made by you at most/);
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
        ['add', { list: 'Batches', title: 'Dark mode', state: undefined, due: undefined, owners: ['me'], note: undefined, description: undefined, fields: { phone: '01 02' } }]);
    assert.deepEqual(read(['edit', '3', '--due', 'none', '--owner', 'none']), ['edit', { id: '3', title: undefined, description: undefined, due: '', owners: [] }]);
    assert.equal(read(['edit', '3', '--remind-before', '7'])[1].remindBefore, '7');
    assert.equal(read(['edit', '3', '--remind-before', 'none'])[1].remindBefore, '', 'none clears the lead');
    assert.equal('remindBefore' in read(['edit', '3', '--due', 'none'])[1], false, 'no key without the flag');
    assert.equal(read(['add', 'Batches', 'Dark mode', '--description', 'The site in dark.\n- evenings'])[1].description, 'The site in dark.\n- evenings');
    assert.equal(read(['edit', '3', '--description', ''])[1].description, '', 'an empty description is said, to remove it');
    assert.ok(read(['edit', '3', '--description']).refused);
    assert.deepEqual(read([]), ['lists', {}]);
    assert.ok(read(['fly']).refused);
    assert.ok(read(['move', '3']).refused);
    assert.deepEqual(read(['archive', '12']), ['archive', { id: '12', restore: false }], 'archive is handled, not "not understood"');
    assert.deepEqual(read(['restore', '12']), ['archive', { id: '12', restore: true }], 'restore is the archive action with restore');
    assert.ok(read(['archive']).refused, 'archive needs an id');
    assert.ok(Refused);
});

test('a description: kept on add and edit, in the history, searched, removed when empty, refused when too long', () => {
    const dir = tmp();
    const s = openStore(dir);
    const l = s.createList({ template: 'batches' }, ME);
    s.grant(l.id, BOT.id, 'write', ME);
    const r = s.add(l.id, { title: 'Dark mode', description: '  The whole site in dark.\r\n\n\n\n- for **evenings**\u0007  \n' }, BOT);
    assert.equal(r.description, 'The whole site in dark.\n\n- for **evenings**', 'trimmed, blank lines folded, invisible characters out');
    assert.equal(s.add(l.id, { title: 'none', description: '   ' }, BOT).description, undefined);
    assert.deepEqual(s.search('evenings', BOT).map((x) => x.id), [r.id]);
    assert.deepEqual(s.list(l.id, ME, { text: 'whole site' }).records.map((x) => x.id), [r.id]);
    s.edit(r.id, { description: 'Only the settings page.' }, BOT);
    assert.equal(s.record(r.id, ME).record.description, 'Only the settings page.');
    assert.throws(() => s.edit(r.id, { description: 'x'.repeat(DESCRIPTION_MAX + 1) }, BOT), /4000 characters at most/);
    assert.throws(() => s.edit(r.id, { description: { text: 'x' } }, BOT), /a description is a text/);
    assert.equal(s.edit(r.id, { description: 'y'.repeat(DESCRIPTION_MAX) }, BOT).description.length, DESCRIPTION_MAX);
    s.edit(r.id, { description: '' }, BOT);
    assert.equal(s.record(r.id, ME).record.description, undefined);
    const changes = s.record(r.id, ME).history.map((x) => x.change);
    assert.equal(changes[0].description, 'The whole site in dark.\n\n- for **evenings**');
    assert.equal(changes[1].description, 'Only the settings page.');
    assert.equal(changes.at(-1).description, null);
    assert.equal(s.record(r.id, BOT).record.state, 'proposed', 'a description approves nothing');
    s.edit(r.id, { description: 'Secret plan' }, ME);
    s.delete(r.id, ME);
    assert.equal(readFileSync(join(dir, 'log.jsonl'), 'utf8').includes('Secret plan'), false, 'deleted is deleted, description too');
});

test('the keeper says a description: its first line in show, whole in get; the MCP tools take it', () => {
    const s = openStore(tmp());
    const l = s.createList({ template: 'batches' }, ME);
    const r = s.add(l.id, { title: 'Dark mode', description: '- **The whole site** in dark.\nFor the evenings.' }, ME);
    s.add(l.id, { title: 'Bare' }, ME);
    const shown = say('show', s.list(l.id, ME));
    assert.match(shown, /#1 Dark mode\n {6}The whole site in dark\.\n {2}#2 Bare/);
    const got = say('get', s.record(r.id, ME));
    assert.match(got, /Description:\n {2}- \*\*The whole site\*\* in dark\.\n {2}For the evenings\./);
    assert.match(say('get', s.record('2', ME)), /No description yet: .*--description/);
    for (const name of ['add', 'edit']) assert.match(TOOLS.find((t) => t.name === name).inputSchema.properties.description.description, /for a person/);
    assert.equal(asked('add', { list: 'L', title: 't', description: 'd' })[1].description, 'd');
    assert.equal(asked('edit', { id: '1', description: '' })[1].description, '');
});

test('a description\'s list may hold boxes, ticked or not; a tick changes that one line of its text', () => {
    const text = 'Plan\n- [ ] first\n- [x] **second**\n- plain';
    assert.deepEqual(blocks(text)[1], { type: 'list', items: [[{ text: 'first' }], [{ bold: 'second' }], [{ text: 'plain' }]], checks: [{ on: false, line: 1 }, { on: true, line: 2 }, null] });
    assert.equal(toggled(text, 1), 'Plan\n- [x] first\n- [x] **second**\n- plain');
    assert.equal(toggled(text, 2), 'Plan\n- [ ] first\n- [ ] **second**\n- plain');
    assert.equal(toggled(text, 3), text, 'a line with no box is left as it is');
});

test('a description is read as a few blocks: paragraphs, lists, bold, http links; nothing else', () => {
    assert.deepEqual(blocks('One\ntwo\n\n- a\n* **b**\n\nend'), [
        { type: 'p', lines: [[{ text: 'One' }], [{ text: 'two' }]] },
        { type: 'list', items: [[{ text: 'a' }], [{ bold: 'b' }]], checks: [null, null] },
        { type: 'p', lines: [[{ text: 'end' }]] }]);
    assert.deepEqual(inline('see https://example.com/a. and [the doc](https://example.com/d)'), [
        { text: 'see ' }, { link: 'https://example.com/a', text: 'https://example.com/a' }, { text: '.' }, { text: ' and ' }, { link: 'https://example.com/d', text: 'the doc' }]);
    const hostile = '<img src=x onerror=alert(1)> [x](javascript:alert(1)) javascript:alert(1) **<b>**';
    const parts = inline(hostile);
    assert.equal(parts.some((x) => x.link), false, 'no link but http(s)');
    assert.equal(parts.map((x) => x.text ?? x.bold).join(''), '<img src=x onerror=alert(1)> [x](javascript:alert(1)) javascript:alert(1) <b>');
    assert.equal(firstLine('\n\n- **First** thing\nsecond'), 'First thing');
    assert.equal(firstLine(''), '');
});

test('a description is drawn element by element: hostile text stays text', () => {
    /* The smallest document the screen needs: elements, text nodes, attributes. */
    class Node { constructor() { this.childNodes = []; } append(...k) { this.childNodes.push(...k); } }
    class Text extends Node { constructor(t) { super(); this.data = t; } }
    class El extends Node {
        constructor(tag) { super(); this.tag = tag; this.attrs = {}; }
        setAttribute(k, v) { this.attrs[k] = String(v); }
        addEventListener() {}
        set innerHTML(_) { throw new Error('innerHTML used'); }
    }
    const was = { document: globalThis.document, Node: globalThis.Node };
    globalThis.Node = Node;
    globalThis.document = { createElement: (t) => new El(t), createTextNode: (t) => new Text(t) };
    try {
        const out = rich('<script>alert(1)</script> **<img src=x onerror=alert(1)>**\n- [go](https://example.com/?a="b") [no](javascript:alert(1))');
        const tags = []; const texts = []; const links = [];
        const walk = (n) => { if (n instanceof Text) texts.push(n.data); else { tags.push(n.tag); if (n.tag === 'a') links.push(n.attrs.href); n.childNodes.forEach(walk); } };
        walk(out);
        assert.deepEqual([...new Set(tags)].sort(), ['a', 'div', 'li', 'p', 'strong', 'ul']);
        assert.deepEqual(links, ['https://example.com/?a="b"']);
        assert.ok(texts.includes('<script>alert(1)</script> '));
        assert.ok(texts.includes('<img src=x onerror=alert(1)>'));
        assert.ok(texts.some((t) => t.includes('[no](javascript:alert(1))')));
    } finally { globalThis.document = was.document; globalThis.Node = was.Node; }
});

test('a card shows the fields set, on one line; empty fields are not there', () => {
    const l = seed('people', 'fr');
    assert.deepEqual(facts(l, { fields: {} }, 'fr'), [], 'nothing set, nothing said');
    const set = facts(l, { fields: { born: '1931-04-12', place: 'Saint-Aubin', photo: 'photos/a.jpg' } }, 'fr');
    assert.deepEqual(set.map((x) => x.id), ['born', 'place'], 'a photo is shown, not said');
    assert.match(set[0].text, /^Naissance\u202f: 12 avril 1931$/);
    assert.equal(set[1].text, 'Saint-Aubin', 'a text says itself');
    assert.deepEqual(facts(l, { fields: { place: '' } }, 'fr'), [], 'an empty value is not there');
    const crm = seed('customers', 'en');
    assert.deepEqual(facts(crm, { fields: { site: 'https://www.shop.example.com/about', phone: '0102' } }, 'en').map((x) => x.text), ['0102', 'shop.example.com']);
    const n = { fields: [{ id: 'm', name: 'Minutes', type: 'number' }] };
    assert.equal(facts(n, { fields: { m: 52 } }, 'en')[0].text, 'Minutes: 52');
});

test('a picture is known by its name; the cover is the one chosen, else the photo field, else the only one attached, else none', () => {
    for (const ok of ['photos/a.jpg', 'B.JPEG', 'x.png', 'x.webp', 'x.gif', 'x.jpg?v=2']) { assert.equal(isPicture(ok), true, ok); assert.equal(storeIsPicture(ok), true, ok); }
    for (const no of ['report.pdf', 'jpg', 'a.jpg.txt', '', undefined]) { assert.equal(isPicture(no), false, String(no)); assert.equal(storeIsPicture(no), false, String(no)); }
    const l = seed('people', 'en');
    const hook = (v) => `/pics/${v}`;
    const bare = { fields: {}, attached: [{ id: 'a1', kind: 'file', ref: 'notes.pdf' }, { id: 'a2', kind: 'link', ref: 'https://example.com/x.jpg' }] };
    assert.deepEqual(pictures(l, bare), [], 'a link or a pdf is no picture');
    assert.equal(imageOf(l, bare, hook), null, 'no picture: nothing put forward');
    const one = { fields: {}, attached: [{ id: 'w', kind: 'file', ref: 'photos/wedding.jpg' }] };
    assert.equal(imageOf(l, one, hook), '/pics/photos/wedding.jpg', 'the only picture is put forward');
    assert.equal(imageOf(l, one), null, 'without a hook, nothing');
    const two = { fields: { photo: 'portrait.png' }, attached: [{ id: 'w', kind: 'file', ref: 'photos/wedding.jpg' }] };
    assert.deepEqual(pictures(l, two).map((p) => p.key), ['field:photo', 'w']);
    assert.equal(coverOf(l, two).key, 'field:photo', 'none chosen: the photo field, a picture put there on purpose');
    const many = { fields: {}, attached: [{ id: 'w', kind: 'file', ref: 'a.jpg' }, { id: 'v', kind: 'file', ref: 'b.png' }] };
    assert.equal(coverOf(l, many), null, 'several attached, none chosen, no photo field: none');
    assert.equal(coverOf(l, { ...many, cover: 'v' }).key, 'v');
    assert.equal(imageOf(l, { ...two, cover: 'w' }, hook), '/pics/photos/wedding.jpg');
    assert.equal(imageOf(l, { ...two, cover: 'field:photo' }, hook), '/pics/portrait.png');
    assert.equal(coverOf(l, { ...many, cover: 'gone' }), null, 'a cover no longer there counts for nothing');
});

test('the state is shown only when it says something', () => {
    const at = (t, state) => stateShown(seed(t, 'en'), { state });
    assert.equal(at('simple', 'open'), false, 'open, where open is all a card is until done');
    assert.equal(at('simple', 'done'), true);
    assert.equal(at('people', 'open'), false);
    assert.equal(at('people', 'closed'), true);
    assert.equal(at('development', 'todo'), true, 'several states before done: each says where it is');
    assert.equal(at('customers', 'lead'), true);
    assert.equal(stateShown({ states: [{ id: 'open' }, { id: 'ok', gate: true }, { id: 'done', done: true }] }, { state: 'open' }), true, 'a gate is something to say');
});

test('the words: every key in both languages, none for an empty thing', () => {
    for (const lang of ['en', 'fr']) {
        const words = JSON.parse(readFileSync(new URL(`../ui/texts/${lang}.json`, import.meta.url)));
        assert.deepEqual(KEYS.filter((k) => !(k in words)), [], `${lang}: missing`);
        for (const k of ['nobody', 'no-due']) assert.equal(k in words, false, `${lang}: "${k}" says what is empty`);
        for (const op of ['add', 'edit', 'move', 'note', 'attach', 'detach', 'archive', 'restore']) assert.ok(words[`op-${op}`] && words[`op-${op}`] !== op, `${lang}: the history says ${op} in words`);
    }
});

test('a recurrent record never closes: a move to done reopens it and shifts its due; --next and no-rhythm too', () => {
    const s = openStore(tmp());
    const l = s.createList({ template: 'simple', title: 'Fond' }, ME);
    const open = l.states.find((x) => !x.done).id;
    const doneId = l.states.find((x) => x.done).id;
    /* A rhythm of 14 days with a due: done -> reopened, due + 14 days. */
    const a = s.add(l.id, { title: 'Point bimensuel', due: '2026-11-04' }, ME);
    s.edit(a.id, { repeat: 14 }, ME);
    assert.equal(s.record(a.id, ME).record.repeat, 14);
    const moved = s.move(a.id, doneId, ME);
    assert.equal(moved.state, open, 'it reopens instead of closing');
    assert.equal(moved.due, '2026-11-18', 'its due is pushed one rhythm on');
    /* --next overrides the rhythm. */
    const m2 = s.move(a.id, doneId, ME, { next: '2026-12-01' });
    assert.equal(m2.state, open); assert.equal(m2.due, '2026-12-01');
    /* No fixed rhythm (repeat on): reopens, keeps its due, waits for a person to set the next. */
    const b = s.add(l.id, { title: 'Accompagnement', due: '2026-11-10' }, ME);
    s.edit(b.id, { repeat: 'on' }, ME);
    const mb = s.move(b.id, doneId, ME);
    assert.equal(mb.state, open); assert.equal(mb.repeat, true); assert.equal(mb.due, '2026-11-10', 'no rhythm: the due is left as is');
    /* Clearing recurrence makes done close again. */
    s.edit(b.id, { repeat: 'none' }, ME);
    assert.equal(s.record(b.id, ME).record.repeat, undefined);
    assert.equal(s.move(b.id, doneId, ME).state, doneId, 'once not recurrent, done closes');
});

test('show filters by activity: what changed since a day, and what is open but quiet for so long', () => {
    const s = openStore(tmp());
    const l = s.createList({ template: 'simple', title: 'Suivi' }, ME);
    const doneId = l.states.find((x) => x.done).id;
    s.add(l.id, { title: 'Fresh today' }, ME);
    const b = s.add(l.id, { title: 'Open but quiet for weeks' }, ME);
    const c = s.add(l.id, { title: 'Done long ago' }, ME);
    /* Backdate two live records; close one, so "quiet" never catches what is done. */
    const recB = s.record(b.id, ME).record; recB.changed = '2020-01-01T00:00:00';
    const recC = s.record(c.id, ME).record; recC.changed = '2020-01-01T00:00:00'; recC.state = doneId;
    const titles = (opts) => s.list(l.id, ME, opts).records.map((r) => r.title).sort();
    assert.deepEqual(titles({}).length, 3, 'all three without a filter');
    assert.deepEqual(titles({ changedSince: '2999-01-01' }), [], 'nothing changed since the future');
    assert.deepEqual(titles({ changedSince: new Date(Date.now() - 86400000).toISOString().slice(0, 10) }), ['Fresh today'], 'only what moved since yesterday');
    assert.deepEqual(titles({ quietFor: 7 }), ['Open but quiet for weeks'], 'open and stale, not the fresh one, not the done one');
    assert.deepEqual(titles({ quietFor: 99999 }), [], 'quiet for longer than anything has existed: none');
});

test('retype gives a list another type additively: a simple list becomes a priorities matrix, records and states kept, fields only added', () => {
    const s = openStore(tmp());
    const l = s.createList({ template: 'simple', title: 'Sujets', lang: 'fr' }, ME);
    const a = s.add(l.id, { title: 'Facturation' }, ME);
    const statesBefore = l.states.map((x) => x.id);
    assert.equal(canMatrix(l), false, 'a plain list is not yet a matrix');
    const out = s.retype(l.id, { template: 'priorities', lang: 'fr' }, ME);
    assert.equal(out.view, 'matrix');
    assert.deepEqual(out.fields.map((f) => f.id), ['urgence', 'importance', 'charge', 'delegabilite']);
    assert.ok(out.fields.every((f) => f.type === 'number'), 'the four scores are numbers');
    assert.equal(out.fields.find((f) => f.id === 'urgence').name, 'Urgence', 'in the page language');
    assert.deepEqual(out.states.map((x) => x.id), statesBefore, 'states are left as they were');
    assert.equal(s.record(a.id, ME).record.title, 'Facturation', 'every record is kept');
    assert.equal(canMatrix(out), true, 'now it can be a matrix');
    const again = s.retype(l.id, { template: 'priorities', lang: 'fr' }, ME);
    assert.equal(again.fields.length, 4, 'a second convert adds no duplicate fields');
    assert.throws(() => s.retype(l.id, { template: 'priorities' }, BOT), /only a person/, 'an agent cannot change a list type');
    assert.throws(() => s.retype(l.id, { template: 'nope' }, ME), /no template/);
});

test('the matrix: the priorities template seeds the four scores, canMatrix needs the two axes, score clamps to 0..100', () => {
    const p = seed('priorities', 'fr');
    assert.equal(p.view, 'matrix');
    assert.deepEqual(p.fields.map((f) => f.id), ['urgence', 'importance', 'charge', 'delegabilite']);
    assert.ok(p.fields.every((f) => f.type === 'number'), 'the four scores are numbers');
    assert.equal(p.fields.find((f) => f.id === 'urgence').name, 'Urgence');
    assert.deepEqual([MATRIX_AXES.x, MATRIX_AXES.y], ['urgence', 'importance']);
    assert.equal(canMatrix(p), true);
    assert.equal(canMatrix(seed('customers')), false, 'a list without the two number axes does not offer the matrix');
    assert.equal(canMatrix({ fields: [{ id: 'urgence', type: 'text' }, { id: 'importance', type: 'number' }] }), false, 'an axis that is not a number does not count');
    assert.equal(score({ fields: { urgence: 72 } }, 'urgence'), 72);
    assert.equal(score({ fields: { urgence: '80' } }, 'urgence'), 80, 'a number written as text is read');
    assert.equal(score({ fields: { urgence: 140 } }, 'urgence'), 100, 'clamped high');
    assert.equal(score({ fields: { urgence: -5 } }, 'urgence'), 0, 'clamped low');
    assert.equal(score({ fields: {} }, 'urgence'), null, 'not set is unplaced');
    assert.equal(score({ fields: { urgence: 'soon' } }, 'urgence'), null, 'not a number is unplaced');
});

test('the matrix view: placed cards become bubbles at their scores, the rest wait to be placed, a bubble opens its card', async () => {
    class Node { constructor() { this.childNodes = []; } append(...k) { for (const c of k) { c.parent = this; this.childNodes.push(c); } }
        replaceChildren(...k) { this.childNodes = []; this.append(...k); } remove() { if (this.parent) this.parent.childNodes = this.parent.childNodes.filter((c) => c !== this); }
        get textContent() { return this.childNodes.map((c) => c.textContent).join(''); } set textContent(t) { this.childNodes = [new Text(String(t))]; } }
    class Text extends Node { constructor(t) { super(); this.data = t; } get textContent() { return this.data; } }
    class El extends Node { constructor(tag) { super(); this.tag = tag; this.attrs = {}; this.on = {}; this.style = { props: {}, setProperty(k, v) { this.props[k] = String(v); } }; }
        setAttribute(k, v) { this.attrs[k] = String(v); } set className(v) { this.attrs.class = String(v); } get className() { return this.attrs.class ?? ''; }
        addEventListener(k, f) { this.on[k] = f; } focus() {} setSelectionRange() {} querySelector() { return null; } }
    const all = (n, f, out = []) => { if (n instanceof El && f(n)) out.push(n); for (const c of n.childNodes ?? []) all(c, f, out); return out; };
    const names = ['document', 'Node', 'window', 'requestAnimationFrame'];
    const was = Object.fromEntries(names.map((n) => [n, globalThis[n]]));
    Object.assign(globalThis, { Node, window: {}, requestAnimationFrame: () => 0,
        document: { createElement: (t) => new El(t), createTextNode: (t) => new Text(t), addEventListener() {}, removeEventListener() {} } });
    const settle = () => new Promise((r) => setTimeout(r, 20));
    try {
        const k = keeper(tmp());
        const prio = k.act('create-list', { template: 'priorities', title: 'Priorités', lang: 'fr' }, ME).data;
        const a = k.act('add', { list: prio.id, title: 'Ship billing', fields: { urgence: 80, importance: 70, charge: 40, delegabilite: 10 } }, ME).data;
        k.act('add', { list: prio.id, title: 'Tidy docs', fields: { urgence: 20, importance: 30 } }, ME);
        k.act('add', { list: prio.id, title: 'Someday idea' }, ME); // no axes -> to place
        const root = new El('div');
        const b = mount(root, { call: async (op, args) => k.act(op, args, ME), lang: 'fr' });
        await settle();
        const dots = all(root, (e) => e.attrs.class === 'binder-dot');
        assert.equal(dots.length, 2, 'two cards carry both axes -> two bubbles');
        const first = all(root, (e) => e.attrs.class === 'binder-dot' && e.attrs['data-record'] === a.id)[0];
        assert.equal(first.style.props.left, '80%'); assert.equal(first.style.props.bottom, '70%');
        const chips = all(root, (e) => (e.attrs.class ?? '').includes('binder-unplaced-chip'));
        assert.equal(chips.length, 1, 'the card with no scores waits to be placed');
        assert.ok(all(root, (e) => e.attrs['data-view'] === 'matrix').length, 'the matrix view is offered on a list that carries the axes');
        first.on.click();
        await settle();
        assert.equal(b.state.mode, 'record', 'a bubble opens its card to score it');
        b.destroy();
    } finally { for (const n of names) globalThis[n] = was[n]; }
});

test('the cover: set by a person or an agent, a picture only, gone with its picture', () => {
    const s = openStore(tmp());
    const l = s.createList({ template: 'people' }, ME);
    s.grant(l.id, BOT.id, 'write', ME);
    const r = s.add(l.id, { title: 'Jeanne', fields: { photo: 'portrait.jpg' } }, ME);
    const w = s.attach(r.id, { kind: 'file', ref: 'photos/wedding.jpg' }, ME);
    const pdf = s.attach(r.id, { kind: 'file', ref: 'letter.pdf' }, ME);
    s.edit(r.id, { cover: 'photos/wedding.jpg' }, BOT);
    assert.equal(s.record(r.id, ME).record.cover, w.id, 'by its ref, by an agent');
    assert.throws(() => s.edit(r.id, { cover: pdf.id }, ME), /is a picture/);
    assert.throws(() => s.edit(r.id, { cover: 'nothing.jpg' }, ME), /picture attached/);
    s.edit(r.id, { cover: 'Photo' }, ME);
    assert.equal(s.record(r.id, ME).record.cover, 'field:photo', 'a photo field, by its name');
    s.edit(r.id, { fields: { photo: '' } }, ME);
    assert.equal(s.record(r.id, ME).record.cover, undefined, 'the field emptied, the cover goes');
    assert.throws(() => s.edit(r.id, { cover: 'photo' }, ME), /is empty/);
    s.edit(r.id, { cover: w.id }, ME);
    s.detach(r.id, w.id, ME);
    assert.equal(s.record(r.id, ME).record.cover, undefined, 'the picture detached, the cover goes');
    s.edit(r.id, { cover: '' }, ME);
    assert.deepEqual(read(['edit', '7', '--cover', 'photos/a.jpg']), ['edit', { id: '7', title: undefined, description: undefined, due: undefined, owners: undefined, cover: 'photos/a.jpg' }]);
    assert.equal(read(['edit', '7', '--cover', 'none'])[1].cover, '');
    assert.equal(asked('edit', { id: '1', cover: 'a.jpg' })[1].cover, 'a.jpg');
    assert.ok(TOOLS.find((t) => t.name === 'edit').inputSchema.properties.cover);
});

test('the screen opens one record from elsewhere on the page (a list beside a chat): its list, then it; a record it cannot see, not', async () => {
    /* A document just big enough for the screen to be drawn: elements, text, events kept and ignored. */
    class Node { constructor() { this.childNodes = []; } append(...k) { for (const c of k) { c.parent = this; this.childNodes.push(c); } }
        replaceChildren(...k) { this.childNodes = []; this.append(...k); } remove() { if (this.parent) this.parent.childNodes = this.parent.childNodes.filter((c) => c !== this); }
        get textContent() { return this.childNodes.map((c) => c.textContent).join(''); } set textContent(t) { this.childNodes = [new Text(String(t))]; } }
    class Text extends Node { constructor(t) { super(); this.data = t; } get textContent() { return this.data; } }
    class El extends Node { constructor(tag) { super(); this.tag = tag; this.attrs = {}; } setAttribute(k, v) { this.attrs[k] = String(v); } addEventListener() {} focus() {} setSelectionRange() {} querySelector() { return null; } }
    const names = ['document', 'Node', 'window', 'requestAnimationFrame'];
    const was = Object.fromEntries(names.map((n) => [n, globalThis[n]]));
    Object.assign(globalThis, { Node, window: {}, requestAnimationFrame: () => 0,
        document: { createElement: (t) => new El(t), createTextNode: (t) => new Text(t), addEventListener() {}, removeEventListener() {} } });
    try {
        const k = keeper(tmp());
        const batches = k.act('create-list', { template: 'batches' }, ME).data;
        k.act('create-list', { template: 'customers' }, ME);
        const hidden = k.act('create-list', { template: 'simple', title: 'Kept apart' }, ME).data;
        const one = k.act('add', { list: batches.id, title: 'Fix diff line numbers' }, ME).data;
        const apart = k.act('add', { list: hidden.id, title: 'Not shown here' }, ME).data;
        const root = new El('div');
        /* The page shows two lists of three, the first one at first. */
        const b = mount(root, { call: async (op, args) => { const r = k.act(op, args, ME); if (op === 'lists' && r.ok) r.data = r.data.filter((l) => l.id !== hidden.id); return r; } });
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(b.state.mode, 'list');
        assert.equal(await b.open(one.id), true);
        assert.deepEqual(b.state, { at: batches.id, mode: 'record' });
        assert.match(root.textContent, /Fix diff line numbers/);
        assert.equal(await b.open(apart.id), false, 'a list the page does not show is not opened');
        assert.equal(await b.open('999'), false);
        assert.deepEqual(b.state, { at: batches.id, mode: 'record' }, 'what was shown stays');
        assert.doesNotMatch(root.textContent, /no such|not found/i, 'and nothing is said of it');
        b.destroy();
    } finally { for (const n of names) globalThis[n] = was[n]; }
});

test('the screen says where it is (a card, a binder, its settings) when a person goes there; the page takes its "‹" and walks it back with go(), said to no one', async () => {
    class Node { constructor() { this.childNodes = []; } append(...k) { for (const c of k) { c.parent = this; this.childNodes.push(c); } }
        replaceChildren(...k) { this.childNodes = []; this.append(...k); } remove() { if (this.parent) this.parent.childNodes = this.parent.childNodes.filter((c) => c !== this); }
        get textContent() { return this.childNodes.map((c) => c.textContent).join(''); } set textContent(t) { this.childNodes = [new Text(String(t))]; } }
    class Text extends Node { constructor(t) { super(); this.data = t; } get textContent() { return this.data; } }
    class El extends Node { constructor(tag) { super(); this.tag = tag; this.attrs = {}; this.on = {}; } setAttribute(k, v) { this.attrs[k] = String(v); } addEventListener(k, f) { this.on[k] = f; } focus() {} setSelectionRange() {} querySelector() { return null; } }
    const find = (n, f) => { if (n instanceof El && f(n)) return n; for (const c of n.childNodes ?? []) { const x = find(c, f); if (x) return x; } return null; };
    const names = ['document', 'Node', 'window', 'requestAnimationFrame'];
    const was = Object.fromEntries(names.map((n) => [n, globalThis[n]]));
    Object.assign(globalThis, { Node, window: {}, requestAnimationFrame: () => 0,
        document: { createElement: (t) => new El(t), createTextNode: (t) => new Text(t), addEventListener() {}, removeEventListener() {} } });
    const settle = () => new Promise((r) => setTimeout(r, 20));
    try {
        const k = keeper(tmp());
        const batches = k.act('create-list', { template: 'batches' }, ME).data;
        const clients = k.act('create-list', { template: 'customers', title: 'Clients' }, ME).data;
        const one = k.act('add', { list: batches.id, title: 'Fix diff line numbers' }, ME).data;
        const alice = k.act('add', { list: clients.id, title: 'Alice' }, ME).data;
        const root = new El('div');
        const said = []; let taken = true;
        const b = mount(root, { call: async (op, args) => k.act(op, args, ME), onPlace: (p) => said.push(p), onBack: () => taken });
        await settle();
        assert.deepEqual(said, [{ list: batches.id, card: null, page: 'list', from: null }], 'where it opened, once drawn');
        /* A person taps a row: a card, said. */
        find(root, (e) => e.attrs['data-record'] === one.id && e.on.click).on.click();
        await settle();
        assert.deepEqual(said.at(-1), { list: batches.id, card: one.id, page: 'card', from: null });
        assert.equal(find(root, (e) => e.attrs['data-act'] === 'back').textContent, '‹Batches', 'its way back names its binder');
        /* Its "‹", taken by the page: nothing moves until the page says where. */
        find(root, (e) => e.attrs['data-act'] === 'back').on.click();
        await settle();
        assert.equal(b.place.page, 'card');
        const n = said.length;
        assert.equal(await b.go({ list: batches.id }), true);
        assert.equal(b.place.page, 'list');
        assert.equal(said.length, n, 'go() is said to no one');
        /* Another binder, a person's tap: said. Its card opened by the page, from elsewhere: its "‹" names that. */
        find(root, (e) => e.attrs['data-list'] === clients.id).on.click();
        await settle();
        assert.deepEqual(said.at(-1), { list: clients.id, card: null, page: 'list', from: null });
        assert.equal(await b.open(one.id, { from: 'Chat' }), true);
        assert.deepEqual(said.at(-1), { list: batches.id, card: one.id, page: 'card', from: 'Chat' });
        assert.equal(find(root, (e) => e.attrs['data-act'] === 'back').textContent, '‹Chat');
        /* Not taken by the page: one level up, said. */
        taken = false;
        find(root, (e) => e.attrs['data-act'] === 'back').on.click();
        await settle();
        assert.deepEqual(said.at(-1), { list: batches.id, card: null, page: 'list', from: null });
        assert.equal(b.back(), false, 'at the top');
        /* The page's place after a reload: there at once, said once. */
        b.destroy();
        const again = []; const root2 = new El('div');
        const c = mount(root2, { call: async (op, args) => k.act(op, args, ME), place: { list: clients.id, card: alice.id }, onPlace: (p) => again.push(p) });
        await settle();
        assert.deepEqual(again, [{ list: clients.id, card: alice.id, page: 'card', from: null }]);
        assert.match(root2.textContent, /Alice/);
        assert.equal(c.back(), true);
        await settle();
        assert.deepEqual(again.at(-1), { list: clients.id, card: null, page: 'list', from: null });
        c.destroy();
    } finally { for (const n of names) globalThis[n] = was[n]; }
});

test('in a tile the description wraps and is clamped, so a long one does not run over the next tile', () => {
    const css = readFileSync(new URL('../ui/binder-ui.css', import.meta.url), 'utf8');
    const rule = css.split('\n').find((l) => l.trim().startsWith('.binder-face .binder-sub'));
    assert.ok(rule, 'the tile description has its own rule');
    /* The row view sets white-space: nowrap; the tile must reset it or the two-line clamp cannot wrap. */
    assert.match(rule, /white-space:\s*normal/, 'the tile description wraps');
    assert.match(rule, /-webkit-line-clamp:\s*2/, 'and is held to two lines');
    assert.match(rule, /overflow:\s*hidden/);
    /* A long title is held too, so a tile stays tidy whatever the title and the text. */
    const title = css.split('\n').find((l) => l.trim().startsWith('.binder-face b'));
    assert.ok(title && /-webkit-line-clamp:\s*3/.test(title) && /overflow-wrap:\s*anywhere/.test(title), 'the tile title wraps and is clamped to three lines');
});

test('a record shows its number before the title, faint, so a person can name it (binder-num)', async () => {
    class Node { constructor() { this.childNodes = []; } append(...k) { for (const c of k) { c.parent = this; this.childNodes.push(c); } }
        replaceChildren(...k) { this.childNodes = []; this.append(...k); } remove() { if (this.parent) this.parent.childNodes = this.parent.childNodes.filter((c) => c !== this); }
        get textContent() { return this.childNodes.map((c) => c.textContent).join(''); } set textContent(t) { this.childNodes = [new Text(String(t))]; } }
    class Text extends Node { constructor(t) { super(); this.data = t; } get textContent() { return this.data; } }
    class El extends Node { constructor(tag) { super(); this.tag = tag; this.attrs = {}; this.on = {}; } setAttribute(k, v) { this.attrs[k] = String(v); } get className() { return this.attrs.class ?? ''; } set className(v) { this.attrs.class = String(v); } addEventListener(k, f) { this.on[k] = f; } focus() {} setSelectionRange() {} querySelector() { return null; } }
    const find = (n, f) => { if (n instanceof El && f(n)) return n; for (const c of n.childNodes ?? []) { const x = find(c, f); if (x) return x; } return null; };
    const names = ['document', 'Node', 'window', 'requestAnimationFrame'];
    const was = Object.fromEntries(names.map((n) => [n, globalThis[n]]));
    Object.assign(globalThis, { Node, window: {}, requestAnimationFrame: () => 0,
        document: { createElement: (t) => new El(t), createTextNode: (t) => new Text(t), addEventListener() {}, removeEventListener() {} } });
    const settle = () => new Promise((r) => setTimeout(r, 20));
    try {
        const k = keeper(tmp());
        const list = k.act('create-list', { template: 'batches' }, ME).data;
        const one = k.act('add', { list: list.id, title: 'Fix diff line numbers' }, ME).data;
        const root = new El('div');
        const b = mount(root, { call: async (op, args) => k.act(op, args, ME) });
        await settle();
        const numbered = find(root, (e) => (e.attrs.class ?? '').split(' ').includes('binder-num'));
        assert.ok(numbered, 'a record shows its number');
        assert.equal(numbered.textContent, `#${one.id}`, 'the number, with a #');
        /* It sits in the same title line, before the title. */
        const bold = find(root, (e) => e.tag === 'b' && e.textContent.includes('Fix diff line numbers'));
        assert.ok(bold && bold.textContent.startsWith(`#${one.id}`), 'the number comes before the title');
        b.destroy();
    } finally { for (const n of names) globalThis[n] = was[n]; }
});

test('an agent archives and restores a list it made, but not one it did not; a person archives any; archived lists do not count', () => {
    const s = openStore(tmp());
    const mine = s.createList({ template: 'simple', title: 'Mine' }, BOT);
    const theirs = s.createList({ template: 'simple', title: 'Theirs' }, ME);
    s.archiveList(mine.id, true, BOT);
    assert.equal(s.lists(ME).find((l) => l.id === mine.id)?.archived, true);
    s.archiveList(mine.id, false, BOT);
    assert.equal(s.lists(ME).find((l) => l.id === mine.id)?.archived, undefined);
    /* not its own, and no access: refused */
    assert.throws(() => s.archiveList(theirs.id, true, BOT), /no list|a person/);
    /* a person archives any it can see */
    s.archiveList(mine.id, true, ME);
    assert.equal(s.lists(ME).find((l) => l.id === mine.id)?.archived, true);
    /* mine is archived, so it does not count: the agent can still make active lists up to its cap */
    assert.doesNotThrow(() => { for (let i = 0; i < 4; i++) s.createList({ template: 'simple', title: `L${i}` }, BOT); });
});

test('an agent may add and rename columns, never remove one or touch the gate; a person can turn it off', () => {
    const s = openStore(tmp());
    const l = s.createList({ template: 'batches' }, ME);          // a list with a gate
    s.grant(l.id, BOT.id, 'write', ME);
    const cols = () => s.lists(BOT).find((x) => x.id === l.id).states;
    const copy = () => cols().map((x) => ({ id: x.id, name: x.name, ...(x.gate ? { gate: true } : {}), ...(x.done ? { done: true } : {}) }));
    const gateId = cols().find((x) => x.gate).id;

    /* add a plain column at the front: allowed */
    let next = copy(); next.unshift({ name: 'À valider' });
    s.editList(l.id, { states: next }, BOT);
    assert.ok(cols().some((x) => x.name === 'À valider'), 'the agent added a column');

    /* rename a column: allowed */
    next = copy(); next[0] = { ...next[0], name: 'Idées' };
    s.editList(l.id, { states: next }, BOT);
    assert.equal(cols()[0].name, 'Idées', 'the agent renamed a column');

    /* remove a column: refused */
    next = copy(); const i = next.findIndex((x) => !x.gate && !x.done); next.splice(i, 1);
    assert.throws(() => s.editList(l.id, { states: next }, BOT), /does not remove/);

    /* move the gate onto another column: refused */
    next = copy().map((x) => ({ id: x.id, name: x.name, ...(x.done ? { done: true } : {}) })); next[0].gate = true;
    assert.throws(() => s.editList(l.id, { states: next }, BOT), /gate/);

    /* move a before-gate column to after the gate: refused */
    next = copy(); next.push(next.shift());
    assert.throws(() => s.editList(l.id, { states: next }, BOT), /across the gate/);

    /* an agent still cannot change the title */
    assert.throws(() => s.editList(l.id, { title: 'x' }, BOT), /only a person/);

    /* a person turns the setting off: the agent can no longer change columns, a person still can */
    s.editSettings({ agentColumns: false }, ME);
    assert.throws(() => s.editList(l.id, { states: copy() }, BOT), /turned off/);
    s.editList(l.id, { states: copy() }, ME);
    assert.equal(gateId, cols().find((x) => x.gate).id, 'the gate stayed the same throughout');
});

test('the columns op: an agent adds and renames columns, keeping the gate; a person can turn it off', () => {
    const k = keeper(tmp());
    const l = k.store.createList({ template: 'batches' }, ME);   // a list with a gate
    k.store.grant(l.id, BOT.id, 'write', ME);
    const cols = () => k.store.lists(BOT).find((x) => x.id === l.id).states;
    const gateId = cols().find((x) => x.gate).id;

    let r = k.act('columns', { list: l.id, add: 'À valider' }, BOT);
    assert.equal(r.ok, true, r.text);
    assert.ok(cols().some((x) => x.name === 'À valider'), 'the agent added a column');

    r = k.act('columns', { list: l.id, add: 'Revue', after: gateId }, BOT);
    assert.equal(r.ok, true, r.text);
    const ids = cols().map((x) => x.id);
    assert.equal(ids.indexOf('revue'), ids.indexOf(gateId) + 1, 'placed right after the gate');

    r = k.act('columns', { list: l.id, rename: { from: 'À valider', to: 'À relire' } }, BOT);
    assert.equal(r.ok, true, r.text);
    assert.ok(cols().some((x) => x.name === 'À relire'), 'the agent renamed a column');

    assert.equal(cols().find((x) => x.gate).id, gateId, 'the gate stayed the gate');

    k.store.editSettings({ agentColumns: false }, ME);
    r = k.act('columns', { list: l.id, add: 'Nope' }, BOT);
    assert.equal(r.ok, false);
    assert.match(r.text, /turned off/);
});
