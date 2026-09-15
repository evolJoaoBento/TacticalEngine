/**
 * The level-up sheet for one character.
 *
 * The rules live in `engine/character/progression.ts`; this only lays the
 * choices out and hands a plan back. Every option shows how many boxes it has
 * left and what it costs, the way the printed sheet does, and the plan is
 * applied whole or not at all — the panel shows the engine's reasons when it
 * refuses rather than guessing at its own.
 */

import { useState } from 'preact/hooks';
import { isDomainCard, type ContentPack } from '../../engine/content/pack/import';
import type { CharacterSheet } from '../../engine/character/sheet';
import {
  ACHIEVEMENT_LEVELS,
  PICKS_PER_LEVEL,
  availableAdvancements,
  cardAllowed,
  markedTraits,
  tierOf,
  type Advancement,
  type AdvancementKind,
  type LevelUpIssue,
  type LevelUpPlan,
} from '../../engine/character/progression';
import type { Trait } from '../../engine/scene/primitives';
import './hud.css';

export interface LevelUpPanelProps {
  sheet: CharacterSheet;
  content: ContentPack;
  /** Reasons the last attempt was refused, if any. */
  issues: readonly LevelUpIssue[];
  onApply: (plan: LevelUpPlan) => void;
  onClose: () => void;
}

const TRAITS: readonly Trait[] = ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'];

const LABELS: Readonly<Record<AdvancementKind, string>> = {
  traits: '+1 to two unmarked traits',
  hitPoint: '+1 Hit Point slot',
  stress: '+1 Stress slot',
  experiences: '+1 to two Experiences',
  domainCard: 'An extra domain card',
  evasion: '+1 Evasion',
  subclass: 'Upgrade your subclass',
  proficiency: '+1 Proficiency',
  multiclass: 'Multiclass',
};

/** A pick with everything it needs filled in with a sensible first choice. */
function blank(kind: AdvancementKind, sheet: CharacterSheet, content: ContentPack, level: number): Advancement {
  switch (kind) {
    case 'traits': {
      const marked = markedTraits(sheet);
      const free = TRAITS.filter((t) => !marked.has(t));
      return { kind, traits: [free[0] ?? 'agility', free[1] ?? 'strength'] };
    }
    case 'experiences': {
      const names = (sheet.experiences ?? []).map((e) => e.name);
      return { kind, names: [names[0] ?? '', names[1] ?? names[0] ?? ''] };
    }
    case 'domainCard':
      return { kind, card: allowedCards(sheet, content, level)[0]?.id ?? '' };
    case 'multiclass': {
      const other = [...content.classes.values()].find((c) => c.id !== sheet.classId);
      return { kind, classId: other?.id ?? '', domain: other?.domains[0] ?? '' };
    }
    default:
      return { kind } as Advancement;
  }
}

function allowedCards(sheet: CharacterSheet, content: ContentPack, level: number) {
  return [...content.cards.values()]
    .filter(isDomainCard)
    .filter((card) => cardAllowed(sheet, content, card.id, level).ok)
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

export function LevelUpPanel(props: LevelUpPanelProps): preact.JSX.Element {
  const { sheet, content } = props;
  const next = sheet.level + 1;
  const [picks, setPicks] = useState<Advancement[]>([]);
  const cards = allowedCards(sheet, content, next);
  const [card, setCard] = useState<string>(cards[0]?.id ?? '');
  const [experience, setExperience] = useState<string>('');
  const achievement = ACHIEVEMENT_LEVELS.includes(next);

  const tier = tierOf(next);
  const options = availableAdvancements(sheet, next);
  const optionOf = (pick: Advancement) => options.find((o) => o.kind === pick.kind && o.tier === (pick.fromTier ?? tier));
  const spent = picks.reduce((sum, pick) => sum + (optionOf(pick)?.cost ?? 1), 0);
  const usedNow = (kind: AdvancementKind, from: number): number =>
    picks.filter((p) => p.kind === kind && (p.fromTier ?? tier) === from).length;

  const replace = (index: number, pick: Advancement): void =>
    setPicks(picks.map((p, i) => (i === index ? pick : p)));

  const pickSelect = <T extends string>(
    value: T,
    choices: readonly { id: T; label: string }[],
    set: (v: T) => void,
    testId: string,
  ) => (
    <select value={value} data-testid={testId} onChange={(e) => set((e.target as HTMLSelectElement).value as T)}>
      {choices.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
        </option>
      ))}
    </select>
  );

  const detail = (pick: Advancement, index: number): preact.JSX.Element | null => {
    switch (pick.kind) {
      case 'traits': {
        const marked = markedTraits(sheet);
        const choices = TRAITS.map((t) => ({ id: t, label: marked.has(t) ? `${t} (marked)` : t }));
        return (
          <>
            {pickSelect(pick.traits[0], choices, (t) => replace(index, { ...pick, traits: [t, pick.traits[1]] }), `trait-0-${index}`)}
            {pickSelect(pick.traits[1], choices, (t) => replace(index, { ...pick, traits: [pick.traits[0], t] }), `trait-1-${index}`)}
          </>
        );
      }
      case 'experiences': {
        const choices = (sheet.experiences ?? []).map((e) => ({ id: e.name, label: `${e.name} +${e.modifier}` }));
        return (
          <>
            {pickSelect(pick.names[0], choices, (n) => replace(index, { ...pick, names: [n, pick.names[1]] }), `exp-0-${index}`)}
            {pickSelect(pick.names[1], choices, (n) => replace(index, { ...pick, names: [pick.names[0], n] }), `exp-1-${index}`)}
          </>
        );
      }
      case 'domainCard': {
        const cap = optionOf(pick)?.cardCap ?? next;
        return pickSelect(
          pick.card,
          cards.filter((c) => c.id !== card && c.level <= cap).map((c) => ({ id: c.id, label: `${c.name} (${c.domain} ${c.level})` })),
          (id) => replace(index, { ...pick, card: id }),
          `extra-card-${index}`,
        );
      }
      case 'multiclass': {
        const classes = [...content.classes.values()].filter((c) => c.id !== sheet.classId);
        const klass = content.classes.get(pick.classId);
        return (
          <>
            {pickSelect(
              pick.classId,
              classes.map((c) => ({ id: c.id, label: c.name })),
              (id) => replace(index, { ...pick, classId: id, domain: content.classes.get(id)?.domains[0] ?? '' }),
              `multiclass-${index}`,
            )}
            {pickSelect(
              pick.domain,
              (klass?.domains ?? []).map((d) => ({ id: d, label: d })),
              (d) => replace(index, { ...pick, domain: d }),
              `multiclass-domain-${index}`,
            )}
          </>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="play level" data-testid="level-up">
      <div className="level-head">
        <h2>
          {sheet.name} — level {next}
        </h2>
        <span className="level-count">
          {spent} / {PICKS_PER_LEVEL} picks
        </span>
      </div>

      <span className="play-eyebrow">Advancements</span>
      {options.map((option) => {
        const left = option.limit - usedNow(option.kind, option.tier);
        const affordable = spent + option.cost <= PICKS_PER_LEVEL;
        const fromPrevious = option.tier !== tier;
        return (
          <div key={`${option.tier}-${option.kind}`} className="level-option">
            <button
              className="play-btn"
              disabled={left <= 0 || !affordable}
              data-pick={option.kind}
              data-tier={option.tier}
              onClick={() =>
                setPicks([
                  ...picks,
                  { ...blank(option.kind, sheet, content, Math.min(next, option.cardCap ?? next)), ...(fromPrevious ? { fromTier: option.tier } : {}) },
                ])
              }
            >
              {LABELS[option.kind]}
              {fromPrevious ? ` (tier ${option.tier} sheet)` : ''}
            </button>
            <span className="level-note">
              {left} left{option.cost === 2 ? ' · costs both picks' : ''}
              {option.cardCap !== undefined && option.cardCap < next ? ` · up to level ${option.cardCap}` : ''}
            </span>
          </div>
        );
      })}

      {picks.length > 0 ? (
        <div style={{ margin: '10px 0 0' }} data-testid="picks">
          {picks.map((pick, index) => (
            <div key={index} className="level-pick">
              <span>
                {LABELS[pick.kind]}
                {pick.fromTier !== undefined ? ` (tier ${pick.fromTier})` : ''}
              </span>
              {detail(pick, index)}
              <button className="play-btn is-ghost" onClick={() => setPicks(picks.filter((_, i) => i !== index))} title="Remove">
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <span className="play-eyebrow">New domain card</span>
      <select value={card} data-testid="granted-card" onChange={(e) => setCard((e.target as HTMLSelectElement).value)}>
        {cards.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} — {c.domain} {c.level}, {c.type}
          </option>
        ))}
      </select>
      {content.cards.get(card) !== undefined ? (
        <div className="level-card">{content.cards.get(card)!.text}</div>
      ) : null}

      {achievement ? (
        <>
          <span className="play-eyebrow">New Experience (+2) — and Proficiency rises by one</span>
          <input
            value={experience}
            placeholder="What have they learned? e.g. Survived the vault"
            data-testid="experience"
            onInput={(e) => setExperience((e.target as HTMLInputElement).value)}
          />
        </>
      ) : null}

      {props.issues.length > 0 ? (
        <div className="level-issues" data-testid="level-issues">
          {props.issues.map((issue, i) => (
            <div key={i}>{issue.message}</div>
          ))}
        </div>
      ) : null}

      <div className="level-actions">
        <button
          className="play-btn is-primary"
          data-testid="take-level"
          onClick={() =>
            props.onApply({
              advancements: picks,
              domainCard: card,
              ...(achievement && experience.trim() !== '' ? { experience: { name: experience.trim(), modifier: 2 } } : {}),
            })
          }
        >
          Take level {next}
        </button>
        <button className="play-btn" onClick={props.onClose}>
          Later
        </button>
      </div>
    </div>
  );
}
