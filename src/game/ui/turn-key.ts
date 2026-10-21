/**
 * The turn's key at the hand's right, in a fight (`ActionBar.tsx`): what it says and whether it can be pressed.
 *
 * On the party's side it hands the spotlight to the GM. A roll that went the GM's way hands it over by itself, and
 * then nothing plays the GM's turn until somebody asks: the key says so and plays it, as Space does. While a question
 * waits on somebody - the GM's turn held on how a blow lands - there is nothing for it to do, and it is shut.
 */

export interface TurnKey {
  label: string;
  title: string;
  enabled: boolean;
}

export function turnKey(side: 'party' | 'gm' | null, asked: boolean): TurnKey {
  if (side === 'gm') return { label: "GM's Turn", title: 'Let the GM take the spotlight (Space)', enabled: !asked };
  return { label: 'End Turn', title: 'Hand the spotlight to the GM (Space)', enabled: side === 'party' };
}
