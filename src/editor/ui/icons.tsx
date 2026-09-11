/**
 * The editor's icons: a few strokes each, drawn in the current text colour so a
 * button's state colours its icon too. Keyed by mode and tool name, so a rail
 * can ask for `Icon name={tool}` without a lookup table of its own.
 */

const PATHS = {
  buildTile: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  eraseTile: 'M4 8l8-4 8 4v8l-8 4-8-4zM8 10l8 6M16 10l-8 6',
  inspect: 'M5 3l6.5 17 2.2-7.3L21 10.5z',
  terrain: 'M2 19l6.5-11 4 6.5 3-4.5L22 19z',
  combat: 'M4 4l10 10M20 4L10 14M7 17l-3 3M17 17l3 3M6 14l4 4M18 14l-4 4',
  interaction: 'M4 5h16v10H10l-5 4v-4H4z',
  select: 'M5 3l6.5 17 2.2-7.3L21 10.5z',
  paintTerrain: 'M4 20c4 0 5-2 5-5l8-8 3 3-8 8c-3 0-5 1-5 5z',
  raise: 'M12 4l6 6h-4v8h-4v-8H6z',
  lower: 'M12 20l6-6h-4V6h-4v8H6z',
  prop: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  interactable: 'M4 9h16v10H4zM4 9l2-4h12l2 4M10 13h4',
  adversary: 'M12 3a4 4 0 110 8 4 4 0 010-8zM5 21c0-4 3-7 7-7s7 3 7 7',
  trigger: 'M4 4h6v6H4zM14 14h6v6h-6zM14 4h6v6h-6z',
  spawn: 'M6 21V4M6 4h11l-3 4 3 4H6',
  erase: 'M4 16l9-9 6 6-7 7H7zM10 20h10',
  undo: 'M9 7L4 12l5 5M4 12h11a5 5 0 010 10h-2',
  redo: 'M15 7l5 5-5 5M20 12H9a5 5 0 000 10h2',
  search: 'M11 5a6 6 0 110 12 6 6 0 010-12zM20 20l-4.5-4.5',
  close: 'M6 6l12 12M18 6L6 18',
} as const;

/** Every name `Icon` can draw. A typo here is a compile error, not a blank icon. */
export type IconName = keyof typeof PATHS;

export function Icon(props: { name: IconName; size?: number }): preact.JSX.Element {
  const size = props.size ?? 18;
  return (
    <svg class="ph-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[props.name]} />
    </svg>
  );
}
