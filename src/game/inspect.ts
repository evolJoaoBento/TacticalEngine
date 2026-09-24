/**
 * What a right-click in play shows about whatever stands on a tile: a party member, a creature, an
 * object. Facts only, no verbs. Out of `main.ts`, which is pinned at its size; `main.ts` still finds
 * what stands there, since that takes the board.
 */

import type { DemoScene } from './demo-scene';
import { statBlockCards } from './demo-abilities';
import { gearOf } from './equip';
import { characterContentFor } from './room';
import type { Inspection } from './ui/PlayPanel';
import { interactablesOf } from '../engine/scene/prop-functions';

/** Facts about the living creature `occupant`, else the object `objectId`, else nothing. */
export function inspection(demo: DemoScene, occupant: string | null, objectId: string | null): Inspection | null {
  if (occupant !== null) {
    const entity = demo.state.entity(occupant)!;
    const pools = [
      `HP ${entity.hitPoints.marked}/${entity.hitPoints.max}`,
      `Stress ${entity.stress.marked}/${entity.stress.max}`,
      `Armor ${entity.armorSlots.marked}/${entity.armorSlots.max}`,
    ];
    if (entity.faction === 'party') {
      const character = demo.characters.get(entity.id);
      const sheet = character?.sheet;
      const klass = sheet === undefined ? undefined : characterContentFor(demo.project).classes.get(sheet.classId);
      const gear = gearOf(demo, entity.id);
      return {
        kind: 'character',
        id: entity.id,
        name: sheet?.name ?? entity.id,
        line: `${klass?.name ?? sheet?.classId ?? ''} · level ${sheet?.level ?? 1}`,
        text: `${gear.weapon} · ${gear.armor}`,
        facts: [
          ...pools,
          ...(entity.good === undefined ? [] : [`Light ${entity.good.value}/${entity.good.max}`]),
          `Evasion ${character?.evasion ?? '?'}`,
          // Named, not keyed: an inspect card is read by a player.
          ...[...entity.conditions].map((c) => demo.world.conditionName(c)),
        ],
      };
    }
    // Whatever this fight is being played with, project content included. A
    // creature nobody can look up is named by its id below, which is the truth;
    // standing in a different creature's block would not be.
    const def = demo.world.adversaryDef(entity.definition);
    return {
      kind: 'adversary',
      id: entity.id,
      // Its own name where it has one, and then what it is, so a named lieutenant still says which block it fights with.
      name: entity.name ?? def?.name ?? entity.definition,
      line: def === undefined ? entity.definition : `${entity.name === undefined || entity.name === def.name ? '' : `${def.name} · `}Tier ${def.tier} ${def.role}`,
      text: def?.description ?? '',
      facts: [
        ...pools,
        ...(def === undefined ? [] : [`Difficulty ${def.difficulty}`]),
        ...[...entity.conditions].map((c) => demo.world.conditionName(c)),
      ],
      // What its block prints, face up: the GM's side of the table.
      cards: statBlockCards(demo, entity.definition),
    };
  }
  if (objectId !== null) {
    const object = interactablesOf(demo.scene).find((i) => i.id === objectId)!;
    const state = demo.state.interactable(objectId);
    const facts: string[] = [];
    if (state.removed) facts.push('Gone');
    else if (state.open) facts.push('Open');
    else if (state.used) facts.push('Used');
    if (object.requiresKey !== undefined) facts.push('Needs a key');
    if (object.check !== undefined) facts.push(`${object.check.trait} ${object.check.difficulty}`);
    return { kind: 'object', id: objectId, name: object.name || objectId, line: object.kind, text: object.flavor, facts };
  }
  return null;
}
