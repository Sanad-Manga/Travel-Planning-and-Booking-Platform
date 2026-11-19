import {
  hasRtl,
  isRtlParagraph,
  tokenize,
  visualOrder,
  wrapTokens,
} from './itinerary-pdf.bidi';

const AR_TRIP = 'رحلة'; // "trip"
const AR_TO = 'إلى'; // "to"
const AR_EGYPT = 'مصر'; // "Egypt"
const AR_CAIRO = 'القاهرة'; // "Cairo"

/** A fixed-width stand-in for the font: every character is 10 wide. */
const widthOf = (text: string) => text.length * 10;
const texts = (tokens: { text: string }[]) => tokens.map((t) => t.text);

describe('itinerary PDF right-to-left text (ITN-28)', () => {
  describe('hasRtl and isRtlParagraph', () => {
    it('is false for Latin, accented Latin, digits and symbols', () => {
      for (const text of [
        'Two weeks in Egypt',
        'Café Zürich',
        '09:30  Walk - 60.00 USD',
        'Москва Αθήνα ✈',
      ]) {
        expect(hasRtl(text)).toBe(false);
      }
    });

    it('is true when a line has Arabic, and the paragraph is RTL only when it starts with it', () => {
      expect(hasRtl(AR_TRIP)).toBe(true);
      expect(isRtlParagraph(`${AR_TRIP} ${AR_TO} ${AR_EGYPT}`)).toBe(true);
      expect(hasRtl(`Day 1 - ${AR_CAIRO}`)).toBe(true);
      expect(isRtlParagraph(`Day 1 - ${AR_CAIRO}`)).toBe(false);
    });
  });

  describe('tokenize', () => {
    it('splits into words and the spaces between them, with an embedding level per token', () => {
      const tokens = tokenize(`${AR_TRIP} ${AR_TO} ${AR_EGYPT}`);
      expect(texts(tokens)).toEqual([AR_TRIP, ' ', AR_TO, ' ', AR_EGYPT]);
      expect(tokens.every((t) => t.level === 1)).toBe(true);
    });

    it('puts numbers inside right-to-left text on an even level, so they read left to right', () => {
      const tokens = tokenize(`${AR_CAIRO} 2026`);
      expect(tokens.find((t) => t.text === '2026')?.level).toBe(2);
      expect(tokens.find((t) => t.text === AR_CAIRO)?.level).toBe(1);
    });

    it('mirrors brackets inside right-to-left text', () => {
      const tokens = tokenize(`${AR_CAIRO} (${AR_EGYPT})`);
      const bracketed = tokens.find((t) => t.text.includes(AR_EGYPT));
      expect(bracketed?.text).toBe(`)${AR_EGYPT}(`);
    });

    it('can be told the line is left to right, as for a line the app lays out itself (time, name, cost)', () => {
      // The app puts a left-to-right mark (U+200E) after a user's text, so the cost after it is not pulled into the Arabic run.
      const text = `09:30  ${AR_TRIP} ${AR_EGYPT}\u200e - 60.00 USD`;
      expect(isRtlParagraph(text)).toBe(true); // the first strong character decides when nothing is forced
      const forced = tokenize(text, true);
      expect(forced.find((t) => t.text === '09:30')?.level).toBe(0);
      expect(forced.find((t) => t.text === '60.00')?.level).toBe(0);
      expect(forced.find((t) => t.text === AR_TRIP)?.level).toBe(1);
      expect(texts(visualOrder(forced)).join('')).toBe(
        `09:30  ${AR_EGYPT} ${AR_TRIP} - 60.00 USD`,
      );
      expect(texts(forced).join('')).not.toContain('\u200e'); // the marks are only instructions, never drawn
    });

    it('keeps the characters of a line with nothing right-to-left in one level', () => {
      expect(tokenize('Hello world').map((t) => t.level)).toEqual([0, 0, 0]);
    });
  });

  describe('visualOrder', () => {
    it('shows the first Arabic word at the right: the visual order is the reverse of the logical order', () => {
      const logical = tokenize(`${AR_TRIP} ${AR_TO} ${AR_EGYPT}`);
      expect(texts(visualOrder(logical))).toEqual([
        AR_EGYPT,
        ' ',
        AR_TO,
        ' ',
        AR_TRIP,
      ]);
    });

    it('keeps an English prefix on the left and reverses only the Arabic part', () => {
      const logical = tokenize(`Day 1 - ${AR_CAIRO} ${AR_EGYPT}`);
      expect(texts(visualOrder(logical)).join('')).toBe(
        `Day 1 - ${AR_EGYPT} ${AR_CAIRO}`,
      );
    });

    it('keeps digits in their own order inside right-to-left text', () => {
      // After Arabic letters a hyphenated number is split by the algorithm, so the app puts a mark (U+200E) before the numbers it writes.
      const logical = tokenize(`${AR_TRIP} \u200e2026-12-20 ${AR_EGYPT}`);
      expect(texts(visualOrder(logical)).join('')).toBe(
        `${AR_EGYPT} 2026-12-20 ${AR_TRIP}`,
      );
    });

    it('leaves left-to-right text as it is', () => {
      const logical = tokenize('Two weeks in Egypt');
      expect(texts(visualOrder(logical))).toEqual(texts(logical));
    });
  });

  describe('wrapTokens', () => {
    it('breaks between words when the line is too wide and drops the spaces at the ends of lines', () => {
      const tokens = tokenize('aaaa bbbb cccc dddd');
      const lines = wrapTokens(tokens, 90, widthOf);
      expect(lines.map((line) => texts(line).join(''))).toEqual([
        'aaaa bbbb',
        'cccc dddd',
      ]);
    });

    it('keeps one line when everything fits and never returns an empty line list', () => {
      expect(wrapTokens(tokenize('short'), 500, widthOf)).toHaveLength(1);
      expect(wrapTokens([], 500, widthOf)).toEqual([[]]);
    });

    it('lets a word that is wider than the line stand alone instead of dropping it', () => {
      const lines = wrapTokens(
        tokenize('xx supercalifragilistic yy'),
        60,
        widthOf,
      );
      expect(lines.map((line) => texts(line).join(''))).toEqual([
        'xx',
        'supercalifragilistic',
        'yy',
      ]);
    });

    it('wraps Arabic in logical order, so each line can then be put in visual order', () => {
      const tokens = tokenize(`${AR_TRIP} ${AR_TO} ${AR_EGYPT} ${AR_CAIRO}`);
      const lines = wrapTokens(tokens, 110, widthOf); // fits about three 3-4 letter words
      expect(lines.length).toBeGreaterThan(1);
      expect(
        lines
          .flatMap((line) => texts(line))
          .join('')
          .replace(/ /g, ''),
      ).toBe(`${AR_TRIP}${AR_TO}${AR_EGYPT}${AR_CAIRO}`);
    });
  });
});
