/**
 * What each pool is drawn as, so a row is known by its shape before its label is read: a heart for
 * a Hit Point, a bolt for Stress, a shield for an Armor Slot, and for Light a star of four points --
 * the long-rayed kind, a plus sign drawn with a pen. One closed outline each on a 16-unit square.
 *
 * In a file of their own because the same marks turn up off the sheet: a card's Recall Cost is paid
 * in Stress, so the cost on its face is a number and a bolt rather than a word too long for its ring.
 */
export type PipIcon = 'heart' | 'bolt' | 'shield' | 'star';

export const PIP_ICONS: Readonly<Record<PipIcon, string>> = {
  heart: 'M8 14.4C3.4 10.9 1.2 8.4 1.2 5.6A3.5 3.5 0 0 1 8 4.4A3.5 3.5 0 0 1 14.8 5.6C14.8 8.4 12.6 10.9 8 14.4Z',
  bolt: 'M9.8 .9L2.9 9.3H7.3L6 15.1L13.1 6.5H8.7Z',
  shield: 'M8 1.1L14.2 3.1V7.5C14.2 11.2 11.8 13.7 8 15.1C4.2 13.7 1.8 11.2 1.8 7.5V3.1Z',
  star: 'M8 .6C8.5 5 11 7.5 15.4 8C11 8.5 8.5 11 8 15.4C7.5 11 5 8.5 .6 8C5 7.5 7.5 5 8 .6Z',
};
