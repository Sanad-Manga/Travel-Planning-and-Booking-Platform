import { normalizeSeat, seatExists, seatLabel, seatLabels } from './seat-map';

describe('seat map (FLT-28)', () => {
  it('numbers seats in rows of six', () => {
    expect(seatLabels(8)).toEqual([
      '1A',
      '1B',
      '1C',
      '1D',
      '1E',
      '1F',
      '2A',
      '2B',
    ]);
    expect(seatLabel(59)).toBe('10F');
  });

  it('knows which seats exist in a cabin of a given size', () => {
    expect(seatExists('2B', 8)).toBe(true);
    expect(seatExists('2C', 8)).toBe(false);
    expect(seatExists('3A', 8)).toBe(false);
    expect(seatExists('1F', 6)).toBe(true);
    expect(seatExists('1G', 60)).toBe(false);
  });

  it('normalises input and rejects anything that is not a label', () => {
    expect(normalizeSeat(' 12a ')).toBe('12A');
    for (const bad of ['', 'A12', '0A', '12', '12AA', '12G', '-1A']) {
      expect(normalizeSeat(bad)).toBeNull();
    }
  });
});
