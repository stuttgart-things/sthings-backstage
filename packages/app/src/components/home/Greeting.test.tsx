import { greetingsFor, pickGreeting, REGIONAL_GREETINGS } from './Greeting';

describe('greetingsFor', () => {
  it.each([
    [8, 'Guten Morgen', 'Good morning'],
    [14, 'Guten Tag', 'Good afternoon'],
    [20, 'Guten Abend', 'Good evening'],
    [23, 'Guten Abend', 'Good evening'],
  ])('at %i h offers %s and %s', (hour, de, en) => {
    expect(greetingsFor(hour)).toEqual([de, en, ...REGIONAL_GREETINGS]);
  });
});

describe('pickGreeting', () => {
  it('only picks German, English, Servus or Gude', () => {
    for (const r of [0, 0.3, 0.6, 0.99]) {
      expect(greetingsFor(9)).toContain(pickGreeting(9, r));
    }
    expect(pickGreeting(9, 0.99)).toBe('Gude');
    expect(pickGreeting(9, 0)).toBe('Guten Morgen');
  });
});
