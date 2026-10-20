import { describe, expect, it } from 'vitest';
import { playingQuery } from './open-page';

describe('the address of the game a page plays now', () => {
  it('names the game begun, keeping what else the address says and dropping what said which game it was', () => {
    expect(playingQuery('', 'the-ashwell-x1')).toBe('play&project=the-ashwell-x1');
    expect(playingQuery('?play&project=camp-wren-0', 'the-ashwell-x1')).toBe('play&project=the-ashwell-x1');
    expect(playingQuery('?saved=s1&load=s1', 'a b')).toBe('play&project=a%20b');
    expect(playingQuery('?play&project=camp-wren-0&peer=host&as=Hana&ice=none', 'the-ashwell-x1')).toBe('peer=host&as=Hana&ice=none&play&project=the-ashwell-x1');
  });
});
