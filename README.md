# Clavarium Binder

Lists of records, kept together by people and AI agents, each with its id.

A binder holds lists: batches of work, development tasks, customers, people,
a roadmap, anything followed over time. A list starts from a template (its
states, its fields, the view it opens in) and everything is changed afterwards.
A record has a title, a state, its fields, short notes, as many things attached
as wanted (messages of a chat, files, assets, branches, links, other records),
owners, a due date, and its history.

    binder                         your lists
    binder show Batches            the records of a list, by state
    binder add Batches "Dark mode"
    binder note 12 "the login page only"
    binder attach 12 branch site:dark-mode
    binder move 12 Doing           past a gate, only once a person approved it

An MCP server gives the same verbs to an AI agent. A person sees the binder on
its screen (`ui/`), drawn by Binder in the page of the application that runs it.

A sibling of [Clavarium Parley](https://github.com/clavarium/clavarium-parley) and
[Clavarium Docket](https://github.com/clavarium/clavarium-docket), built the same
way, universal (nothing in it is specific to Clavarium).

## What an agent cannot do

- **Rewrite the binder.** It is held by its keeper (the application, or
  `binder serve`), out of the agent's reach. An agent asks through its own
  folder; the keeper answers, and says who asked by that folder.
- **Approve.** A list may have a gate (Batches: "Approved"): a record reaches
  it, or any state after it, only once a person ticked it. An agent proposes,
  and works on what was approved.
- **See what it was not given.** Access is given per list: read, or change.
- **Delete.** It archives; a person deletes, and deleted is deleted.

## Without an application

    binder serve --store ~/binder-data --side ./.binder=Assistant --lang fr

keeps a binder and shows its page on `http://127.0.0.1:4180/`. Put the store
where the agents cannot write.

See [docs/protocol.md](docs/protocol.md). No dependency; Node 22 or later.

**Status:** first version (0.1), not yet published.

License: MIT.
