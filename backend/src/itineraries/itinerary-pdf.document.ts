import PDFDocument from 'pdfkit';
import { formatMoney } from '../payments/money/money.util';
import {
  BudgetSummaryDto,
  INTERCITY_TRANSPORT,
} from './dto/budget-summary.dto';
import { ItineraryDayDto } from './dto/itinerary-day.dto';
import { BudgetCategory } from './schemas/budget.schema';

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

/** The standard PDF fonts draw Latin-1 only: anything else (Arabic, emoji, combining marks) becomes "?" instead of a broken glyph. */
function drawable(text: string): string {
  return text.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

/** The lines of the document, in order. A line break inside a text (day notes) becomes several lines. */
export function pdfLines(data: ItineraryPdfData): PdfLine[] {
  const lines: PdfLine[] = [];
  const add = (style: PdfLine['style'], text: string, indent = false) => {
    for (const part of text.split(/\r?\n/))
      lines.push({
        style,
        text: drawable(part),
        ...(indent ? { indent } : {}),
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
      add(
        'body',
        `${activity.time ? `${activity.time}  ` : ''}${activity.name}${activity.cost ? ` - ${activity.cost}` : ''}`,
      );
      if (activity.description.trim() !== '')
        add('muted', activity.description, true);
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
      add('muted', `${line.label}: ${line.amount}`, true);
  }
  add('gap', '');
  add('muted', `Created on ${data.createdOn}`);
  return lines;
}

/** Draws the lines on A4 pages in memory. Nothing is written to disk, and pdfkit starts a new page by itself. */
export function renderPdf(lines: PdfLine[]): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: { Title: lines[0]?.text ?? 'Itinerary' },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  try {
    for (const line of lines) {
      switch (line.style) {
        case 'title':
          doc
            .font('Helvetica-Bold')
            .fontSize(22)
            .fillColor('#000000')
            .text(line.text);
          break;
        case 'subtitle':
          doc
            .font('Helvetica')
            .fontSize(11)
            .fillColor('#444444')
            .text(line.text);
          break;
        case 'heading':
          doc
            .moveDown(0.3)
            .font('Helvetica-Bold')
            .fontSize(14)
            .fillColor('#000000')
            .text(line.text);
          break;
        case 'muted':
          doc
            .font('Helvetica')
            .fontSize(9)
            .fillColor('#555555')
            .text(line.text, { indent: line.indent ? 16 : 0 });
          break;
        case 'gap':
          doc.moveDown(0.6);
          break;
        default:
          doc
            .font('Helvetica')
            .fontSize(11)
            .fillColor('#000000')
            .text(line.text);
      }
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
