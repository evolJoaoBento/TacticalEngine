# Notice

Tactical Engine — a browser CRPG engine and editor for party-based tactical RPGs.
Copyright (C) 2026 João Bento (evolJoaoBento)

This program is free software: you can redistribute it and/or modify it under the terms of the GNU
Affero General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along with this program.
If not, see <https://www.gnu.org/licenses/>. The full text is in `LICENSE`.

## What the licence covers

The project's own work, which is nearly all of it: the engine, the editor, the starter content
pack, the models and art authored for it, the tests, the documentation, and the `legacy/` prototype
this grew out of.

## What it does not cover

- **The rules the engine implements.** The Daggerheart System Reference Document is Public Game
  Content under the DPCGL, and the attribution that licence requires is kept in `docs/CONTEXT.md`,
  which is the only place holding its wording. The AGPL covers the code that implements those
  rules; it does not reach the rules themselves, and nothing here relicenses them.
  Daggerheart is a trademark of Critical Role, LLC; this project is unaffiliated and unendorsed.

- **Kreon**, the play UI's font: Copyright 2018 The Kreon Project Authors, used under the SIL Open
  Font License 1.1, which travels with it in `public/fonts/kreon/OFL.txt`.

- **Card art.** `public/cards/` is ignored by git and nothing in it is distributed from here. Cards
  draw their own emblems when the directory is empty.

## Running it for other people

Section 13 is why this licence and not the GPL: a browser game is used over a network rather than
handed over as a binary. If you run a modified copy and let other people play it, you owe those
people the source of your version. The source of this one is at
<https://github.com/evolJoaoBento/TacticalEngine>.
