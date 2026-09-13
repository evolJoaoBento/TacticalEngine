# Version-1 documents, captured

These two files are **genuine format-version-1 documents**. They were not written by hand. At
commit `977840b`, while version 1 was still what the code wrote, a tool ran the demo and saved
exactly what the engine produced:

| file | what it is |
| --- | --- |
| `project.json` | the demo project as `projectSchema` parsed it — `formatVersion: 1`, with every ability, condition and sheet the demo carried |
| `save.json` | a save taken *after the party had acted*, so the pools hold real values: `scenes[*].fear` is `{ value: 3, max: 12 }` and three entities carry `hope` |

## Why they are captured and not written

Slice 4 renamed the two paired-resource pools — `hope` → `good`, `fear` → `bad` — and bumped
`formatVersion` to 2 with a load-time migration (`src/engine/scene/migrate.ts`).

A migration has to be proved against a document that predates it, and there was exactly one window
in which such a document could be produced: before the rename landed. A hand-written "old document"
is written by the same person as the migration, to match it, and so proves only that the two agree.
One captured from a build that had never heard of version 2 can genuinely disagree — which is the
only way `migrate.test.ts` can fail for a real reason.

## Rules for these files

- **Never hand-edit them, and never regenerate them.** Their value is entirely that no
  version-2 code ever touched them. Editing one to make a test pass destroys the only evidence
  the migration has.
- **They are `.json` on purpose.** Every rename pass in slice 4 walked `.ts`/`.tsx` only, which is
  what kept these readable while the rest of the tree moved.
- A save's pools must stay non-default. A migration that quietly did nothing would pass against a
  pristine room, so the capture marked both pools before saving.

## The tool is gone

The capture tool read the pools by their old names off the live types. The rename it existed to
prove is what ended it — afterwards it could only have written *version-2* documents into a
directory named `v1`, which is worse than not having it. It was removed in the same slice; this
file is its record.
