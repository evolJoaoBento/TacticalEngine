# PolyHeart — instructions for agents

A browser CRPG engine and editor running the **Daggerheart SRD 2.0** rules. TypeScript (strict),
Vite, three.js, Preact + signals, zod, Vitest, Playwright.

Claude Code reads `CLAUDE.md`, Codex reads this file. Both carry the same rules; the licensing
case below lives here in full, and `CLAUDE.md` points at it rather than repeating it. Keep the rules
in step when you change either.

---

## Read this first: what may enter the repository

**Only vendored SRD *text* and your own code go in git.** This boundary is the project's oldest hard
constraint and it is easy to breach by accident.

The Darrington Press Community Gaming License covers the **System Reference Document** — rules text
and mechanics. It does **not** cover Critical Role's artwork, logos or trade dress. Card
illustrations are not SRD content, and a fan mirror is not a licence.

### The live case: `public/cards/`

`tools/download-card-art.mjs` fetches 191 card illustrations (about 89 MB) from
`https://en.daggerheart.su`, a third-party mirror. **Those files are now in `.gitignore` and must
stay there.**

- **Do not commit them, and do not `git add -f` them.** Nothing licenses them for redistribution.
- **Once a blob is committed it is in history permanently.** A later `git rm` only adds a deletion
  commit; every clone still downloads the files and any old revision checks them back out. Removing
  them for real means rewriting history with `git-filter-repo` or BFG, which changes every commit
  hash from that point on and breaks every clone and fork. There is no cheap undo, which is why the
  guard is at the front.
- **Nothing in `src/` reads those files.** Card faces draw their own art: `ui/card-sigil.ts`
  generates each card's emblem from its id and domain, seeded through `createRng`, so a fresh
  clone renders a complete card with no assets. Do not reintroduce an `<img>` pointing at
  `/cards/`; it 404s for everyone but the one machine that ran the downloader.
- **Keeping the script is fine** — it is your own code, and a developer fetching art onto their own
  disk is not the project redistributing it. It is unused as of 2026-09-10.
- **The frames, domain colours, filters, search and enlarged reading view are original work and are
  the valuable half.** Rendering card faces from the vendored SRD text carries no licensing risk at
  all. If art has to go, that work survives untouched.

`tests/unit/licensing-boundary.test.ts` fails if the ignore rule is removed. Do not delete the test
to make the suite green — it is the guard, not the problem.

Both attributions must survive: the SRD 2.0 DPCGL notice and the SRD 1.0 notice the community data
sets carry. The exact wording is in `docs/CONTEXT.md` and the three
`tools/srd-sources/*/README.md` files. Daggerheart is a trademark of Critical Role, LLC; this
project is unaffiliated. The source PDF is deliberately not committed — only the extracted text.

---

## Where everything is written down

| Order | File | Why |
|---|---|---|
| 1 | `docs/CONTEXT.md` | The goal, the hard constraints, the stack, the SRD sourcing. The working agreement. |
| 2 | `docs/BACKLOG.md` | What to build next, ranked, and the working rules learned the expensive way. |
| 3 | `docs/DEVELOPING.md` | Extending the engine. **§11 Gotchas** repays reading twice. |
| 4 | `docs/CRPG-GAPS.md` | The honest audit. Read the relevant section before claiming a system exists. |
| 5 | `.claude/skills/run-the-demo/SKILL.md` | Driving the app in a real browser through `window.__polyheart`. |

`docs/ADVERSARIES.md` and `docs/CARDS.md` are **generated** — hand-edits are thrown away by the next
`python tools/*-doc.py`. `docs/MANUAL.md` is user-facing.

## The other rules that are not negotiable

- **No TTS, no speech synthesis, no "voice" features.** Both attempts were removed at the user's
  instruction. All content text is English.
- **`legacy/` is never modified.** Read `docs/research/legacy-*.md` instead of its sources.
- **The engine core is DOM-free**, there is one effect schema (never add a second), RNG is seeded,
  and every module is tested.
- **Do not `git checkout` a file with uncommitted work in it.** Copy it aside and back.
- **The repository path contains a space.** Quote it. Never hardcode a home directory.
- `npx tsc --noEmit` is the only static check — no ESLint, no Prettier. Match surrounding style.

## Commands

```bash
npm run dev          # 127.0.0.1:8420 (Playwright starts its own on 8421)
npx tsc --noEmit     # the only static check
npx vitest run       # unit
npx playwright test  # e2e — run it before claiming done
```

Ship a **slice**: one behaviour complete — rule, content, editor field, validation, tests, docs.

---

## You may not be alone in this tree

More than one agent has worked this repository at the same time, in the same working tree, on
`main`. Before a destructive git operation, run `git status` and assume the changes you did not make
belong to someone who is still working. Never `git checkout`, `stash` or `reset` a path you did not
modify, and never commit another agent's uncommitted work as your own.
