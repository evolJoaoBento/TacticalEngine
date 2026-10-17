/**
 * New Game's two halves that are not a screen: the character made from what was chosen
 * (`new-character.ts`), and the camp they begin at (`camp.ts`) - which must open and play as any
 * project does, the character whole, the company standing round the fire.
 */

import { describe, it, expect } from 'vitest';
import { deriveCharacter } from '../engine/character/sheet';
import { EQUIPMENT } from '../engine/content/equipment/catalogue';
import { buildProjectScene } from './demo-scene';
import { withListedPacks, shippedPack } from './listed-packs';
import { characterContentFor } from './room';
import { CAMP_CREW, campProject, crewPlaces } from './camp';
import { GEAR, SPREADS, idFromName, sheetFor, type Creation } from './new-character';

const WREN: Creation = {
  name: 'Wren Ashdown',
  ancestryId: 'elf',
  model: 'violet',
  communityId: 'wildborne',
  classId: 'ranger',
  subclassId: 'wayfinder',
  domainCards: ['gifted-tracker', 'natures-tongue'],
};

describe('a character made at New Game', () => {
  it('is what was chosen, with a spread of traits and gear the class sets out with', () => {
    const sheet = sheetFor(WREN);
    expect(sheet).toMatchObject({
      id: 'wren-ashdown', name: 'Wren Ashdown', level: 1, classId: 'ranger', subclassId: 'wayfinder',
      ancestryId: 'elf', communityId: 'wildborne', model: 'violet', domainCards: WREN.domainCards,
      primaryWeaponId: 'primary-shortbow', armorId: 'armor-leather-armor',
    });
    expect(Object.values(sheet.traits).sort((a, b) => a - b)).toEqual([-1, 0, 0, 1, 1, 2]);
  });

  it('gives every class the standard spread, and gear the catalogue has', () => {
    const weapons = new Set(EQUIPMENT.weapons.map((weapon) => weapon.id));
    const armors = new Set(EQUIPMENT.armors.map((armor) => armor.id));
    for (const klass of shippedPack('srd-characters')!.classes) {
      expect(Object.values(SPREADS[klass.id]!).sort((a, b) => a - b), klass.id).toEqual([-1, 0, 0, 1, 1, 2]);
      const gear = GEAR[klass.id]!;
      expect(weapons.has(gear.primary), gear.primary).toBe(true);
      expect(armors.has(gear.armor), gear.armor).toBe(true);
      if (gear.secondary !== undefined) expect(weapons.has(gear.secondary), gear.secondary).toBe(true);
    }
  });

  it('takes an id from the name, and a name of nothing is a hero', () => {
    expect(idFromName('  Ëlva  of the Fen ')).toBe('elva-of-the-fen');
    expect(idFromName('!!!')).toBe('hero');
  });
});

describe('the camp a new game begins at', () => {
  it('opens and plays: the character whole, made of the SRD content its project lists', () => {
    const project = campProject(sheetFor(WREN), 0);
    expect(project.packs).toEqual(['srd-characters']);
    const problems: string[] = [];
    const demo = buildProjectScene(withListedPacks(project, problems), project.id);
    expect(problems).toEqual([]);
    const content = characterContentFor(demo.project);
    // Every card the wizard offered is one the project knows, and the character derives cleanly.
    for (const id of WREN.domainCards) expect(content.cards.has(id), id).toBe(true);
    expect(deriveCharacter(sheetFor(WREN), content, demo.project.abilities).issues).toEqual([]);
    expect(demo.party.members()).toEqual(['wren-ashdown']);
    expect(demo.scene.id).toBe('camp');
  });

  it('has the company round the fire, facing it, each on a tile of their own', () => {
    const project = campProject(sheetFor(WREN), 0);
    const decos = project.scenes[0]!.decos;
    const at = decos.map((deco) => `${deco.position.x},${deco.position.y}`);
    expect(new Set(at).size).toBe(at.length);
    // All of the company but the one whose model the new character took: nobody meets their twin.
    for (const model of CAMP_CREW) expect(decos.some((deco) => deco.model === model), model).toBe(model !== WREN.model);
    const spawn = project.scenes[0]!.spawns[0]!;
    expect(at).not.toContain(`${spawn.x},${spawn.y}`);
    for (const figure of crewPlaces()) {
      // Facing the fire: a step along the way they face brings them nearer to it.
      const nearer = Math.hypot(9 - (figure.x + Math.sin(figure.rotation)), 6 - (figure.y + Math.cos(figure.rotation)));
      expect(nearer, figure.model).toBeLessThan(Math.hypot(9 - figure.x, 6 - figure.y));
    }
  });

  it('lays its ground as floor pieces on plain ground, every tile at level 0 - none standing off it', () => {
    const scene = campProject(sheetFor(WREN), 0).scenes[0]!;
    expect(new Set(scene.terrain)).toEqual(new Set(['floor']));
    const pieces = Object.values(scene.buildingTiles ?? {});
    expect(pieces.length).toBe(scene.width * scene.height);
    expect(new Set(pieces.map((piece) => `${piece.level}:${piece.shape}`))).toEqual(new Set(['0:floor']));
    expect(new Set(pieces.map((piece) => piece.tile))).toEqual(new Set(['grass', 'dirt', 'trodden']));
  });

  it('is its own game: a new id each time, and named for the character', () => {
    const one = campProject(sheetFor(WREN), 1);
    const two = campProject(sheetFor(WREN), 2);
    expect(one.id).not.toBe(two.id);
    expect(one.name).toBe("Wren Ashdown's camp");
  });
});
