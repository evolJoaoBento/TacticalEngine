# Tactical Engine

A browser CRPG engine and editor for party-based tactical RPGs. TypeScript (strict),
Vite, three.js, Preact + signals, zod, Vitest, Playwright.

**The repository path contains a space.** Quote it everywhere, and prefer repo-relative paths —
the repo has moved between machines, so never hardcode a path or a home directory.

## Read these, in this order, before writing anything

1. `docs/CONTEXT.md` — the goal, the hard constraints, the stack, the SRD sourcing.
2. **`docs/BACKLOG.md`** — what to build next, and the working rules that are not written elsewhere
   (the patch-script protocol, the driver-type mirror, what to run before claiming done).
3. `docs/DEVELOPING.md` — extending the engine. **§11 Gotchas** repays reading twice.
4. `docs/CRPG-GAPS.md` — the honest audit. Read the relevant section before claiming a system
   exists or is missing.
5. `.claude/skills/run-the-demo/SKILL.md` — driving the app in a real browser.

## The rules that are not negotiable

- **No TTS, no speech synthesis, no "voice" features.** Both attempts were removed at the user's
  instruction. All content text is English.
- **`legacy/` is never modified.** It is the original prototype, kept runnable. Read
  `docs/research/legacy-*.md` instead of its sources.
- **No rules text is vendored any more.** `tools/srd-sources/` is gone and the engine ships its
  own starter pack. Both the 2.0 and 1.0 attributions must survive; `docs/CONTEXT.md` holds the
  wording, and is now the only place that does.
- **The engine core is DOM-free**, there is one effect schema, RNG is seeded, and every module is
  tested. `npx tsc --noEmit` is the only static check — there is no lint and no formatter, so match
  the surrounding style by reading it.
- **The repository is public and AGPL-3.0-or-later.** `LICENSE`, `NOTICE.md` and `package.json`
  must agree, and the notice's carve-outs stay: the font under the OFL, and the rules the engine
  implements, which are somebody else's Public Game Content. `AGENTS.md` carries the case in full.
- **Do not `git checkout` a file with uncommitted work in it.** Copy it aside and back.

## Commands

```bash
npm run models       # fetch public/models/*.glb from Hugging Face (models.lock.json); needed once per clone
npm run dev          # 127.0.0.1:8420 (Playwright starts its own on 8421)
npx tsc --noEmit     # the only static check
npx vitest run       # unit
npx playwright test  # e2e, ~2.7 min — run it before claiming done
```

Ship a **slice**: one behaviour complete — rule, content, editor field, validation, tests, docs.
Close every reply to the user with a ranked recommendation of what to do next.
