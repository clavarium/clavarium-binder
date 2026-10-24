# The protocol

Binder is four small things: a command and an MCP server for agents, a keeper
that holds the binder, and a screen for people.

## The store: the keeper's alone

| File | What it holds |
|---|---|
| `state.json` | every list and record as it is now, rewritten whole (by a rename) after each change |
| `log.jsonl` | every change, one per line: `{at, by, op, list?, record?, change?}` |

`by` is who did it: `{id, kind, name}`, kind `person` or `agent`. A record
deleted is deleted: its lines in the log are emptied down to who and when, and
one `delete` line says by whom.

## An agent's folder

| File | Written by | What it holds |
|---|---|---|
| `asks.jsonl` | the agent | `{id, at, op, args}`, one per ask |
| `answers.jsonl` | the keeper | `{ask, at, ok, text}`: the answer to an ask, by its id |

The folder is `--dir`, else `$BINDER_DIR`, else the nearest `.binder` from
where the command stands. The keeper knows who asks by the folder: the
application gives each folder its `who`. An ask waits for its answer up to 20
seconds; an ask older than a minute is answered "too late" and never done.
Exit codes of the command: 0 done, 1 refused, 2 no folder, 3 nobody keeps the
binder, 64 not understood.

## The verbs

| Command | MCP tool | Who |
|---|---|---|
| `binder` | `lists()` | anyone: the lists given to them |
| `binder show LIST [--state S] [--mine] [--archived]` | `show` | read |
| `binder get ID` | `get` | read |
| `binder search TEXT` | `search` | read |
| `binder add LIST TITLE [...]` | `add` | change |
| `binder edit ID [...]` | `edit` | change |
| `binder move ID STATE` | `move` | change; past a gate, only an approved record |
| `binder note ID TEXT` | `note` | change |
| `binder attach ID KIND REF [TITLE]` | `attach` | change |
| `binder detach ID WHAT` | `detach` | change |
| `binder archive ID`, `binder restore ID` | `archive` | change |

`add` and `edit` take a `description` (`--description`): a few lines for a
person, what the record is and why; Markdown-ish (paragraphs, `- ` lists,
`**bold**`, `[text](https://...)` and bare http(s) links), 4000 characters at
most, empty to remove it. It is in the history like any other change.

A person's alone (from the screen): `approve`, `delete`, `create-list`,
`edit-list`, `grant`, `archive-list`, `delete-list`; a note is changed by
whoever wrote it (`edit-note`).

## The application's side

    import { keeper } from 'clavarium-binder/host';
    const k = keeper(storeDir, { sides: () => [{ dir, who }] });
    setInterval(() => k.pump(), 1000);      // answer the agents
    k.act(op, args, person);                // a person's change: { ok, text, data }
    k.due();                                // records whose due time came: tell their owners
    k.store.onChange((line) => ...);        // every change, as the log says it

And the screen: `mount(element, { call, words, lang, people, picture, openAttached })`
from `clavarium-binder/ui`, with `ui/binder-ui.css` and `ui/texts/*.json`.

What a card shows: what is set, nothing about what is empty. The fields set
make one line under its title; its state is said unless the card is in the
first state and that is the list's only state not done (with no gate). Its
picture -- the `cover` chosen (`binder edit ID --cover REF`, an attached
picture or a photo field), else its only picture, else none -- is put forward
on its page and in Tiles, through the page's `picture(value)`.
