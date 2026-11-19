import { dirname, join } from 'node:path';
import PDFDocument from 'pdfkit';
import { formatMoney } from '../payments/money/money.util';
import {
  BudgetSummaryDto,
  INTERCITY_TRANSPORT,
} from './dto/budget-summary.dto';
import { ItineraryDayDto } from './dto/itinerary-day.dto';
import { BudgetCategory } from './schemas/budget.schema';
import {
  hasRtl,
  isRtlParagraph,
  tokenize,
  visualOrder,
  wrapTokens,
} from './itinerary-pdf.bidi';

/** ITN-28: what the PDF of an itinerary shows, with the money already written as text. Built by `toPdfData`. */
export interface PdfActivity {
  name: string;
  description: string;
  time: string | null;
  cost: string | null;
}

export interface PdfDay {
  dayNumber: number;
  date: string;
  cityName: string;
  notes: string;
  activities: PdfActivity[];
  /** The day's cost, one entry per currency that has a cost on it (platform currency first). */
  costs: string[];
}

export interface PdfBudgetBlock {
  currency: string;
  total: string;
  lines: { label: string; amount: string }[];
}

export interface ItineraryPdfData {
  title: string;
  countries: string;
  startDate: string;
  endDate: string | null;
  authorName: string | null;
  days: PdfDay[];
  budget: PdfBudgetBlock[];
  createdOn: string;
}

export interface PdfLine {
  text: string;
  style: 'title' | 'subtitle' | 'heading' | 'body' | 'muted' | 'gap';
  /** Drawn a little to the right, under the line above it. */
  indent?: boolean;
  /** The app lays this line out itself (time, name, cost), so it is left to right even if the name is Arabic. */
  ltr?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  [BudgetCategory.FOOD]: 'Food',
  [BudgetCategory.ACCOMMODATION]: 'Accommodation',
  [BudgetCategory.IN_CITY_TRANSPORT]: 'In-city transport',
  [BudgetCategory.ACTIVITIES]: 'Activities',
  [INTERCITY_TRANSPORT]: 'Intercity transport',
};

/**
 * Puts the days, the activities and the budget summary of an itinerary into the shape the PDF shows. Pure: the
 * caller decides which itinerary may be exported and which budget it gets (the owner's includes linked bookings,
 * the public view's does not), so this never reads a database.
 */
export function toPdfData(input: {
  title: string;
  countryCodes: string[];
  startDate: string;
  authorName: string | null;
  days: ItineraryDayDto[];
  summary: BudgetSummaryDto;
  cityNames: Map<string, string>;
  now: Date;
}): ItineraryPdfData {
  const { summary } = input;
  return {
    title: input.title,
    countries: input.countryCodes.join(', '),
    startDate: input.startDate,
    endDate:
      input.days.length > 0 ? input.days[input.days.length - 1].date : null,
    authorName: input.authorName,
    days: input.days.map((day) => ({
      dayNumber: day.dayNumber,
      date: day.date,
      cityName: input.cityNames.get(day.cityId) ?? day.cityId,
      notes: day.notes,
      activities: day.activities.map((activity) => ({
        name: activity.name,
        description: activity.description,
        time: activity.time,
        cost:
          activity.costCents === null
            ? null
            : formatMoney(activity.costCents, activity.currency),
      })),
      costs: summary.totals.flatMap((block) => {
        const cents =
          block.byDay.find((entry) => entry.dayId === day.id)?.totalCents ?? 0;
        return cents > 0 ? [formatMoney(cents, block.currency)] : [];
      }),
    })),
    budget: summary.totals.map((block) => ({
      currency: block.currency,
      total: formatMoney(block.totalCents, block.currency),
      lines: block.byCategory
        .filter((line) => line.totalCents > 0)
        .map((line) => ({
          label: CATEGORY_LABELS[line.category] ?? line.category,
          amount: formatMoney(line.totalCents, block.currency),
        })),
    })),
    createdOn: input.now.toISOString().slice(0, 10),
  };
}

/** Control characters cannot be drawn; everything else is kept (the PDF font covers Latin, Cyrillic, Greek, Arabic and symbols). */
function printable(text: string): string {
  return [...text]
    .map((char) => {
      const code = char.codePointAt(0) as number;
      return code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : char;
    })
    .join('');
}

/** U+200E: a left-to-right mark, put after a user's text so the number or cost that follows is not pulled into an Arabic run. */
const LTR_MARK = '\u200e';

/** The lines of the document, in order. A line break inside a text (day notes) becomes several lines. */
export function pdfLines(data: ItineraryPdfData): PdfLine[] {
  const lines: PdfLine[] = [];
  const add = (
    style: PdfLine['style'],
    text: string,
    options: { indent?: boolean; ltr?: boolean } = {},
  ) => {
    for (const part of text.split(/\r?\n/))
      lines.push({
        style,
        text: printable(part),
        ...(options.indent ? { indent: true } : {}),
        ...(options.ltr ? { ltr: true } : {}),
      });
  };

  add('title', data.title);
  add('subtitle', `Countries: ${data.countries}`);
  add(
    'subtitle',
    data.endDate === null
      ? `Starts ${data.startDate}, no days yet`
      : `Starts ${data.startDate}, ends ${data.endDate}, ${data.days.length} ${data.days.length === 1 ? 'day' : 'days'}`,
  );
  if (data.authorName !== null) add('subtitle', `By ${data.authorName}`);
  add('gap', '');

  if (data.days.length === 0) add('body', 'No days have been planned yet.');
  for (const day of data.days) {
    add('heading', `Day ${day.dayNumber} - ${day.cityName} - ${day.date}`);
    if (day.notes.trim() !== '') add('body', day.notes);
    for (const activity of day.activities) {
      const mark = hasRtl(activity.name) ? LTR_MARK : '';
      add(
        'body',
        `${activity.time ? `${activity.time}  ` : ''}${activity.name}${activity.cost ? `${mark} - ${activity.cost}` : ''}`,
        { ltr: true },
      );
      if (activity.description.trim() !== '')
        add('muted', activity.description, { indent: true });
    }
    if (day.costs.length > 0)
      add('muted', `Cost of the day: ${day.costs.join(', ')}`);
    add('gap', '');
  }

  add('heading', 'Budget');
  if (data.budget.length === 0) add('body', 'No costs have been planned yet.');
  for (const block of data.budget) {
    add('body', `${block.currency}: ${block.total}`);
    for (const line of block.lines)
      add('muted', `${line.label}: ${line.amount}`, { indent: true });
  }
  add('gap', '');
  add('muted', `Created on ${data.createdOn}`);
  return lines;
}

/** DejaVu Sans (free to embed; Latin, Cyrillic, Greek, Arabic, symbols). pdfkit embeds only the glyphs a document uses. */
const FONT_DIRECTORY = join(
  dirname(require.resolve('dejavu-fonts-ttf/package.json')),
  'ttf',
);
const REGULAR = 'Sans';
const BOLD = 'Sans-Bold';

const STYLES: Record<
  Exclude<PdfLine['style'], 'gap'>,
  { font: string; size: number; color: string }
> = {
  title: { font: BOLD, size: 22, color: '#000000' },
  subtitle: { font: REGULAR, size: 11, color: '#444444' },
  heading: { font: BOLD, size: 14, color: '#000000' },
  body: { font: REGULAR, size: 11, color: '#000000' },
  muted: { font: REGULAR, size: 9, color: '#555555' },
};

const INDENT = 16;
/** Joiners and variation selectors only change how neighbouring characters look; the font cannot use them, so they are left out. */
const INVISIBLE = /\u200b|\u200c|\u200d|\u2060|[\ufe00-\ufe0f]/g;
const DIRECTION_MARKS = /[\u200e\u200f\u061c]/g;

interface FontFile {
  hasGlyphForCodePoint(codePoint: number): boolean;
}

/** Characters the current font has no glyph for (Chinese, Japanese, Korean, emoji) become "?" instead of an empty box. */
function drawableText(
  doc: PDFKit.PDFDocument,
  text: string,
  keepMarks: boolean,
): string {
  const font = (doc as unknown as { _font: { font: FontFile } })._font.font;
  const withoutInvisible = text.replace(INVISIBLE, '');
  return [
    ...(keepMarks
      ? withoutInvisible
      : withoutInvisible.replace(DIRECTION_MARKS, '')),
  ]
    .map((char) =>
      /\s/.test(char) ||
      '‎‏؜'.includes(char) ||
      font.hasGlyphForCodePoint(char.codePointAt(0) as number)
        ? char
        : '?',
    )
    .join('');
}

/**
 * Draws a line that has right-to-left text. pdfkit shapes Arabic letters (joins them) but does not order mixed text,
 * so the line is wrapped by words, put in visual order (Unicode UAX #9) and drawn word by word, from the left edge, or
 * from the right edge when the paragraph itself is right to left.
 */
function drawBidiLine(
  doc: PDFKit.PDFDocument,
  text: string,
  line: PdfLine,
  style: { font: string; size: number; color: string },
): void {
  const left = doc.page.margins.left;
  const fullWidth = doc.page.width - left - doc.page.margins.right;
  const indent = line.indent ? INDENT : 0;
  const rtl = !line.ltr && isRtlParagraph(text);
  const widthOf = (value: string) => doc.widthOfString(value);

  for (const tokens of wrapTokens(
    tokenize(text, !rtl),
    fullWidth - indent,
    widthOf,
  )) {
    const visual = visualOrder(tokens);
    const width = visual.reduce((sum, token) => sum + widthOf(token.text), 0);
    const height = doc.currentLineHeight(true);
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      doc.font(style.font).fontSize(style.size).fillColor(style.color);
    }
    const top = doc.y;
    let x = rtl ? left + fullWidth - indent - width : left + indent;
    for (const token of visual) {
      doc.text(token.text, x, top, { lineBreak: false });
      x += widthOf(token.text);
    }
    doc.x = left;
    doc.y = top + height;
  }
}

/** Draws the lines on A4 pages in memory. Nothing is written to disk, and pdfkit starts a new page by itself. */
export function renderPdf(lines: PdfLine[]): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: {
      Title: printable(lines[0]?.text ?? 'Itinerary').replace(
        DIRECTION_MARKS,
        '',
      ),
    },
  });
  doc.registerFont(REGULAR, join(FONT_DIRECTORY, 'DejaVuSans.ttf'));
  doc.registerFont(BOLD, join(FONT_DIRECTORY, 'DejaVuSans-Bold.ttf'));
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  try {
    for (const line of lines) {
      if (line.style === 'gap') {
        doc.moveDown(0.6);
        continue;
      }
      const style = STYLES[line.style];
      if (line.style === 'heading') doc.moveDown(0.3);
      doc.font(style.font).fontSize(style.size).fillColor(style.color);
      // Marks are kept only for the bidi layout, which uses them and drops them; the plain path never draws them.
      const rtlLine = hasRtl(line.text);
      const text = drawableText(doc, line.text, rtlLine);
      if (rtlLine) drawBidiLine(doc, text, line, style);
      else doc.text(text, { indent: line.indent ? INDENT : 0 });
    }
    doc.end();
  } catch (error) {
    doc.emit('error', error);
  }
  return finished;
}

/** A safe attachment name made from the title: ASCII letters and digits only, at most 40 of them. */
export function pdfFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug === '' ? 'itinerary.pdf' : `itinerary-${slug}.pdf`;
}
