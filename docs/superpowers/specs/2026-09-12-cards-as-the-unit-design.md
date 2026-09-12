# Cards as the unit

**Status:** decided by the user, 2026-09-12. Not yet built. This records the decision and
what it costs, so the work that follows honours it instead of drifting.

**Related:** `2026-09-12-generic-engine-content-packs-design.md` — §5 The pack format and
§6 The renames both change under this, and the migration this needs can ride slice 4's
`formatVersion` 1→2 rather than paying for a second one.

---

## 1. The decision

> Things should be centered around cards. Not just domain cards — **any** feature should be
> seen as a card and interacted with like a card in the game, like a TCG. Some cards may be
> passive abilities, others can be active abilities. And importing should mean importing
> cards, and customising cards.

So: a class feature is a card. A subclass foundation is a card. An ancestry's knack is a
card. What a creature's stat block does is a card. There is one kind of thing a character
or a creature *has*, and it is a card — held, played, turned face up, counted.

## 2. What this actually changes

Today the engine has two concepts doing one job:

- **A card** — `domainCardDefSchema`: id, name, domain, type, level, recallCost, text. It is
  chosen into a loadout, and abilities point at it with `source: { kind: 'domainCard', card }`.
- **A feature** — `featureSchema`: a bare `{ name, text }` sitting in an array on a class,
  subclass, ancestry or community. Mechanical ones are backed by an ability with a *different*
  source kind, matched to the printed entry **by name**.

That name-matching is the tell. It exists only because features and cards are separate things,
and it is fragile: rename the ability and the text silently stops being found.

Under this decision:

- `abilitySourceSchema`'s six kinds — `domainCard`, `classHope`, `classFeature`, `subclass`,
  `granted`, `adversary` — collapse toward **one**: the card the ability sits on. What differs
  between them is not the *kind* of thing but **how the card got into play**, which becomes a
  field on the card rather than a variant of the source.
- `featureSchema` stops being a content type. A class's features become a list of card ids.
- `kind: 'action' | 'reaction' | 'passive'` already exists on abilities and is exactly the
  passive/active split the decision names. Nothing new is needed there.
- The pack format's `domainCards` becomes `cards`, and `classes`/`subclasses`/`ancestries`
  stop carrying feature text of their own.

## 3. Zones, which is the part that needs designing

A TCG has zones, and this model needs at least two, because the loadout limit must not apply
to a card you did not choose:

| How it got there | Limit | Example |
|---|---|---|
| **Chosen** — picked into the loadout | `LOADOUT_LIMIT` (5) | a domain card |
| **Granted** — in play because of what you are | none | a class or ancestry card |

`loadoutOf` already reads `sheet.loadout`; `abilitiesFor` already folds class and subclass
abilities in regardless of it. So the behaviour exists — what is missing is saying so on the
card instead of inferring it from a source kind.

Suggested shape, to be argued with when it is built:

```ts
grant: { kind: 'chosen' }                                  // a domain card
grant: { kind: 'class', classId: 'sentinel' }              // in play for every Sentinel
grant: { kind: 'subclass', subclassId: 'x', stage: 'foundation' }
grant: { kind: 'ancestry', ancestryId: 'stoneborn' }
grant: { kind: 'adversary', adversaries: ['hollow-knight'] } // the GM's side
grant: { kind: 'given', characters: ['kara'] }              // a project handing one over
```

The last two matter: it keeps the GM's side on the same model, and it keeps the seam a test
or a project uses to hand a character one card without inventing a class for it.

## 4. What it does not change

**The IP constraints are untouched.** A card-centric architecture is mechanics and structure,
which is not what copyright covers — but it is not a licence to rebuild the nine-domain
catalogue with a card model instead of a list. The rule from the legal note stands: ship an
original set, and let people import their own.

**The engine stays content-agnostic.** Cards are data. The engine reads them; it does not
contain them.

## 5. Interaction with work in flight

Two places this lands well and one where it costs something:

- **Good:** the test conversion underway needs tests to carry their own content, and it has
  been splitting hairs between a `granted` ability (no card) and a card-sourced one (a card in
  the loadout). Under one model that split disappears and the fixture route is uniform.
- **Good:** the migration is already budgeted. Slice 4 bumps `formatVersion` 1→2 for the
  resource rename; folding features into cards can ride the same load-time migration.
- **Costs:** the editor gains a card editor, and "customise cards" means the panels that
  currently edit a class's feature text edit cards instead. The renderer gains card zones and
  the handling to play from them, which is new UI rather than a rename.

## 6. Open questions

Answers recommended, none of them settled.

1. **Does a card hold its abilities inline, or keep pointing at them by id?**
   *Recommend: by id.* One card routinely carries several abilities — the sigil that marks, the
   two halves that add a token, and the one that spends them are four abilities on one card.
   Inline nesting would force that into one object and break every reaction that has to be
   found by trigger. Pointing at them already works.
2. **Are adversary features cards the GM plays, or cards only in the data model?**
   *Recommend: the data model first, the table later.* Unifying the schema is cheap; a GM-side
   card UI is a separate slice and should be judged on its own.
3. **Does a passive card need to be "in play" visually, or is being held enough?**
   *Recommend: in play.* The decision says interacted with like a TCG, and a passive that
   changes a number while sitting face-up in a zone is the clearest reading of that.
4. **What happens to `recallCost` and the vault?** They are loadout mechanics, and only
   `chosen` cards have a loadout. A granted card presumably has neither.
