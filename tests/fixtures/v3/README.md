# A version-3 document, captured

`project.json` is a **genuine format-version-3 document**. At the commit that added it, while version
3 was still what the code wrote, a throwaway test built the demo the way `main.ts` does
(`buildDemoScene(demoMap())`), added one condition, parsed the project with `projectSchema` and wrote
it out the way the editor's Save does (`JSON.stringify(project, null, 2)`).

The one condition is `captured-lend`, and it lends `power-slash` through `grants: { ability }` --
the only way a condition could put something in its bearer's hands in version 3. The demo carries no
such condition of its own, so it was added by hand; everything else is the demo as it stood, and
every field of the file is what version-3 code wrote.

## Why it exists

Version 4 moves what a condition lends onto a card granted by the condition, and drops `grants`
from the condition. Its migration has to be proved against a document from before it, and version
3 was pushed: files written under it exist. The version-1 fixtures cannot stand in -- the two lends
they carry name abilities they do not have, so the migration's live path would never run on them.

## Rules for this file

The same as `../v1/README.md`: **never hand-edit it, and never regenerate it.** A regenerated file
would be written by version-4 code and prove nothing.
