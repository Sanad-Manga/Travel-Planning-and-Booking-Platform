import { inflateSync } from 'node:zlib';

/** The objects of a PDF made by pdfkit: object number to the text of its dictionary (and stream, as latin1). */
function pdfObjects(pdf: Buffer): Map<number, string> {
  const objects = new Map<number, string>();
  for (const match of pdf
    .toString('latin1')
    .matchAll(/(\d+) 0 obj\r?\n([\s\S]*?)\r?\nendobj/g)) {
    objects.set(Number(match[1]), match[2]);
  }
  return objects;
}

/** The inflated stream of an object, or null when it has none or it is not deflated (a font file, an image). */
function streamOf(body: string | undefined): string | null {
  const stream = body?.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
  if (!stream) return null;
  try {
    return inflateSync(Buffer.from(stream[1], 'latin1')).toString('latin1');
  } catch {
    return null;
  }
}

/** One UTF-16BE destination of a CMap, written in hex. A ligature has several characters, separated by a space: <0644 0627>. */
const utf16 = (hex: string): string =>
  Buffer.from(hex.replace(/\s+/g, ''), 'hex').swap16().toString('utf16le');

/** Glyph id to text, from a ToUnicode CMap (the part of a PDF that says which character each glyph of an embedded font is). */
function parseToUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F\s]+)>/g,
    )) {
      map.set(parseInt(pair[1], 16), utf16(pair[2]));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1].matchAll(
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F]+>)/g,
    )) {
      const low = parseInt(range[1], 16);
      const high = parseInt(range[2], 16);
      if (range[3].startsWith('[')) {
        [...range[3].matchAll(/<([0-9a-fA-F\s]+)>/g)].forEach((entry, offset) =>
          map.set(low + offset, utf16(entry[1])),
        );
      } else {
        const first = utf16(range[3].slice(1, -1));
        for (let glyph = low; glyph <= high; glyph += 1) {
          map.set(
            glyph,
            String.fromCodePoint(
              (first.codePointAt(0) as number) + (glyph - low),
            ),
          );
        }
      }
    }
  }
  return map;
}

/** Resource name of a font (F2) to its glyph-to-text map. */
function fontMaps(
  objects: Map<number, string>,
): Map<string, Map<number, string>> {
  const maps = new Map<string, Map<number, string>>();
  for (const body of objects.values()) {
    for (const font of body.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
      const toUnicode = objects
        .get(Number(font[2]))
        ?.match(/\/ToUnicode (\d+) 0 R/);
      const cmap = toUnicode
        ? streamOf(objects.get(Number(toUnicode[1])))
        : null;
      if (cmap) maps.set(font[1], parseToUnicode(cmap));
    }
  }
  return maps;
}

/**
 * The text of a PDF made by pdfkit with embedded fonts, one line per text-showing operator, so tests can check what a
 * reader would see without a PDF library. pdfkit writes each piece as `[<glyph ids> kerning <glyph ids> ...] TJ`; the
 * glyph ids are turned back into characters with the font's ToUnicode map. Arabic words come out as the shaped
 * (visual) order of one word, so tests compare Latin text here and leave Arabic to the layout tests.
 */
export function pdfText(pdf: Buffer): string {
  const objects = pdfObjects(pdf);
  const fonts = fontMaps(objects);
  const lines: string[] = [];
  for (const body of objects.values()) {
    const stream =
      body.includes('/FlateDecode') && !body.includes('/Length1')
        ? streamOf(body)
        : null;
    if (!stream || !stream.includes(' Tf')) continue;
    let current = new Map<number, string>();
    for (const op of stream.matchAll(/\/(F\d+) [\d.]+ Tf|\[([^\]]*)\]\s*TJ/g)) {
      if (op[1]) {
        current = fonts.get(op[1]) ?? new Map();
        continue;
      }
      const pieces = [...op[2].matchAll(/<([0-9a-fA-F]*)>/g)].map((hex) => {
        const glyphs = hex[1].match(/.{1,4}/g) ?? [];
        return glyphs
          .map((glyph) => current.get(parseInt(glyph, 16)) ?? '')
          .join('');
      });
      lines.push(pieces.join(''));
    }
  }
  return lines.join('\n');
}

/** How many pages the PDF has. */
export function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
}
