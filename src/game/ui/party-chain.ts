/**
 * The chain behind the party's cards: which cards it runs between.
 *
 * Two characters who walk together are chained, and the chain is drawn down the middle of the
 * column, behind the cards, so it passes under each sheet and shows in the gaps between them.
 * One chain per run of cards next to each other in the same group, rather than one per group:
 * a chain that ran behind somebody else's card would read as though they were in it too, and a
 * group whose cards have been split up the column is shown by a tab on the stranded cards instead.
 *
 * The shape of it is here, away from the DOM, so the HUD only has to measure where its cards
 * are; somebody who walks alone is in no chain at all.
 */

/** A chain to draw: the group it belongs to, and the cards at either end of it. */
export interface ChainSpan {
  group: number;
  from: string;
  to: string;
}

/** Who is in a group but has no card of it next to them, so no chain reaches them: the tab is theirs. */
export function strandedIds(members: readonly { id: string; group: number | null }[]): string[] {
  return members.filter((member, i) => member.group !== null && members[i - 1]?.group !== member.group && members[i + 1]?.group !== member.group).map((member) => member.id);
}

/** The chains to draw behind a column of cards, top to bottom. */
export function chainSpans(members: readonly { id: string; group: number | null }[]): ChainSpan[] {
  const spans: ChainSpan[] = [];
  members.forEach((member, i) => {
    if (member.group === null) return;
    const run = spans[spans.length - 1];
    // A run goes on while the card above is in the same group, and starts afresh otherwise.
    if (run !== undefined && run.group === member.group && run.to === members[i - 1]?.id) run.to = member.id;
    else spans.push({ group: member.group, from: member.id, to: member.id });
  });
  // A card with nobody next to it in its group is a chain with nothing to run to.
  return spans.filter((span) => span.from !== span.to);
}
