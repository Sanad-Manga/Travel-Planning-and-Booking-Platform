import { inflateSync } from 'node:zlib';

/** The content streams of a PDF made by pdfkit, inflated. Streams that are not deflated (fonts, images) are skipped. */
function contentStreams(pdf: Buffer): string[] {
  const source = pdf.toString('latin1');
  const streams: string[] = [];
  for (const match of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      streams.push(
        inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'),
      );
    } catch {
      // not a deflated stream
    }
  }
  return streams;
}

/**
 * The text of a PDF made by pdfkit with a standard font, one line per text-showing operator, so tests can check what
 * a reader would see without a PDF library. pdfkit writes each line as `[<hex> kerning <hex> ...] TJ`.
 */
export function pdfText(pdf: Buffer): string {
  const lines: string[] = [];
  for (const stream of contentStreams(pdf)) {
    for (const op of stream.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      const parts = [...op[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((hex) =>
        Buffer.from(hex[1], 'hex').toString('latin1'),
      );
      lines.push(parts.join(''));
    }
  }
  return lines.join('\n');
}

/** How many pages the PDF has. */
export function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
}
