import bidiFactory from 'bidi-js';

const bidi = bidiFactory();

/** A word, or the spaces between words, with its bidi embedding level: odd is right to left, even is left to right. */
export interface BidiToken {
  text: string;
  level: number;
}

/** Left-to-right, right-to-left and Arabic-letter marks: they steer the algorithm but are never drawn. */
const DIRECTION_MARKS = /[‎‏؜]/;

/** True when the text has a right-to-left character (Arabic, Hebrew, ...), so it needs the bidi layout. */
export function hasRtl(text: string): boolean {
  return bidi
    .getEmbeddingLevels(text, 'ltr')
    .levels.some((level) => level % 2 === 1);
}

/** True when the text, left to itself, is a right-to-left paragraph: its first strong character is right to left. */
export function isRtlParagraph(text: string): boolean {
  return (bidi.getEmbeddingLevels(text).paragraphs[0]?.level ?? 0) % 2 === 1;
}

/**
 * Splits a line into words and the runs of spaces between them, each with its embedding level (Unicode UAX #9). A
 * token is also split where the level changes. `forceLtr` makes the paragraph left to right whatever its first
 * letter is, for the lines the app lays out itself (time, name, cost). Direction marks are used and then dropped.
 * Brackets in right-to-left text are swapped for their mirror images, as a reader expects.
 */
export function tokenize(text: string, forceLtr = false): BidiToken[] {
  const { levels } = bidi.getEmbeddingLevels(
    text,
    forceLtr ? 'ltr' : undefined,
  );
  const tokens: BidiToken[] = [];
  let current: (BidiToken & { space: boolean }) | null = null;

  for (let index = 0; index < text.length;) {
    const codePoint = text.codePointAt(index) as number;
    const char = String.fromCodePoint(codePoint);
    const level = levels[index];
    index += char.length;
    if (DIRECTION_MARKS.test(char)) {
      current = null; // a mark ends the token before it and adds nothing
      continue;
    }
    const space = /\s/.test(char);
    const drawn =
      level % 2 === 1 ? (bidi.getMirroredCharacter(char) ?? char) : char;
    if (current && current.level === level && current.space === space) {
      current.text += drawn;
    } else {
      current = { text: drawn, level, space };
      tokens.push(current);
    }
  }
  return tokens.map(({ text: value, level }) => ({ text: value, level }));
}

/**
 * The tokens of one line in the order they are drawn from left to right (rule L2 of UAX #9): from the deepest level
 * up to the lowest odd one, every run of tokens at that level or higher is reversed.
 */
export function visualOrder(tokens: BidiToken[]): BidiToken[] {
  const ordered = [...tokens];
  const levels = ordered.map((token) => token.level);
  if (levels.length === 0) return ordered;
  const highest = Math.max(...levels);
  const lowestOdd = Math.min(
    ...levels.filter((level) => level % 2 === 1),
    highest + 1,
  );
  for (let level = highest; level >= lowestOdd; level -= 1) {
    for (let start = 0; start < ordered.length;) {
      if (ordered[start].level < level) {
        start += 1;
        continue;
      }
      let end = start;
      while (end + 1 < ordered.length && ordered[end + 1].level >= level)
        end += 1;
      const run = ordered.slice(start, end + 1).reverse();
      ordered.splice(start, run.length, ...run);
      start = end + 1;
    }
  }
  return ordered;
}

/**
 * Breaks tokens (in logical order) into lines no wider than `maxWidth`, at the spaces. Spaces at the start and end of
 * a line are dropped. A word wider than the line stays whole on a line of its own. Always at least one line.
 */
export function wrapTokens(
  tokens: BidiToken[],
  maxWidth: number,
  widthOf: (text: string) => number,
): BidiToken[][] {
  const lines: BidiToken[][] = [];
  let line: BidiToken[] = [];
  let width = 0;
  const isSpace = (token: BidiToken) => token.text.trim() === '';
  const finish = () => {
    while (line.length > 0 && isSpace(line[line.length - 1])) line.pop();
    lines.push(line);
    line = [];
    width = 0;
  };

  for (const token of tokens) {
    if (isSpace(token)) {
      if (line.length > 0) {
        line.push(token);
        width += widthOf(token.text);
      }
      continue;
    }
    const tokenWidth = widthOf(token.text);
    if (line.length > 0 && width + tokenWidth > maxWidth) finish();
    line.push(token);
    width += tokenWidth;
  }
  if (line.length > 0 || lines.length === 0) finish();
  return lines;
}
