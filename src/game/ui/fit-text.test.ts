/**
 * Words set to fit their card (`fit-text.ts`). The e2e test finds no card on the table whose words run
 * past it; what is driven here is the search that picks the size, and what it takes to fit - a box
 * whose text is as tall and as wide as its size makes it, faked, since there is no layout here.
 */

import { describe, expect, it } from 'vitest';
import { fitText, largestFitting } from './fit-text';

describe('the size words are set at', () => {
  it('is the largest they fit at, to a quarter pixel', () => {
    expect(largestFitting((size) => size <= 7.6, 12, 4)).toBe(7.5);
    expect(largestFitting((size) => size <= 4.3, 12, 4)).toBe(4.25);
  });

  it('is the size asked for when they fit at it, and the floor when they fit at nothing', () => {
    expect(largestFitting(() => true, 10.5, 4)).toBe(10.5);
    expect(largestFitting(() => false, 10.5, 4)).toBe(4);
  });

  it('takes a handful of tries, not one for every size', () => {
    let tries = 0;
    largestFitting((size) => {
      tries += 1;
      return size <= 6.1;
    }, 12, 4);
    expect(tries).toBeLessThanOrEqual(7);
  });
});

describe('a box of words fitted', () => {
  /** A box 100 by 60 whose words run `lines` lines of `size * 1.4` each, and whose longest word is `size * 6` wide. */
  const box = (lines: number) => {
    const element = {
      style: { fontSize: '' },
      clientHeight: 60,
      clientWidth: 100,
      get scrollHeight() {
        return Math.ceil(lines * parseFloat(element.style.fontSize) * 1.4);
      },
      get scrollWidth() {
        return Math.max(100, Math.ceil(parseFloat(element.style.fontSize) * 6));
      },
    };
    return element;
  };

  it('keeps its size when it all shows, and is set smaller until it does when it would not', () => {
    const short = box(3);
    expect(fitText(short as unknown as HTMLElement, 10)).toBe(10);
    expect(short.style.fontSize).toBe('10px');
    const long = box(9);
    const size = fitText(long as unknown as HTMLElement, 10);
    expect(size).toBeLessThan(10);
    expect(long.scrollHeight).toBeLessThanOrEqual(60);
    expect(long.style.fontSize).toBe(`${size}px`);
  });

  it('is set smaller for a word too long for its width, too', () => {
    const wide = box(1);
    const size = fitText(wide as unknown as HTMLElement, 20);
    expect(size * 6).toBeLessThanOrEqual(100.5);
  });
});
