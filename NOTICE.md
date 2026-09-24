# Notice

Tactical Engine — a browser CRPG engine and editor for party-based tactical RPGs.
Copyright (C) 2026 João Bento (evolJoaoBento)

This work is licensed under the Creative Commons Attribution-NonCommercial 4.0 International
License (CC BY-NC 4.0). The full legal code is in `LICENSE`; a summary is at
<https://creativecommons.org/licenses/by-nc/4.0/>.

You may share and adapt it, for any purpose that is not commercial, as long as you give credit,
link to the licence, and say if you changed it. Using it commercially needs the author's
permission. It comes with no warranty of any kind: see section 5 of the licence.

Copies obtained before 24 September 2026 were licensed under the GNU Affero General Public License,
version 3 or later, and remain so for whoever holds them. From that date the work is CC BY-NC 4.0.

## What the licence covers

The project's own work, which is nearly all of it: the engine, the editor, the starter content
pack, the models and art authored for it, the tests, the documentation, and the `legacy/` prototype
this grew out of. The models are distributed from a Hugging Face repository,
[JunjiBento/tactical-engine-models](https://huggingface.co/JunjiBento/tactical-engine-models), under
the same licence; `models.lock.json` names them. The source is at
<https://github.com/evolJoaoBento/TacticalEngine>.

## What it does not cover

- **The rules the engine implements.** The Daggerheart System Reference Document is Public Game
  Content under the DPCGL, and the attribution that licence requires is kept in `docs/CONTEXT.md`,
  which is the only place holding its wording. This licence covers the code that implements those
  rules; it does not reach the rules themselves, and nothing here relicenses them.
  Daggerheart is a trademark of Critical Role, LLC; this project is unaffiliated and unendorsed.

- **Kreon**, the play UI's font: Copyright 2018 The Kreon Project Authors, used under the SIL Open
  Font License 1.1, which travels with it in `public/fonts/kreon/OFL.txt`.

- **Card art.** `public/cards/` is ignored by git and nothing in it is distributed from here. Cards
  draw their own emblems when the directory is empty.
