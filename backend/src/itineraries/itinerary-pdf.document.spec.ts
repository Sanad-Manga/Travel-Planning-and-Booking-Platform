import { pdfPageCount, pdfText } from '../../test/helpers/pdf-text';
import { BudgetSummaryDto } from './dto/budget-summary.dto';
import { ItineraryDayDto } from './dto/itinerary-day.dto';
import {
  ItineraryPdfData,
  pdfFilename,
  pdfLines,
  renderPdf,
  toPdfData,
} from './itinerary-pdf.document';

const day = (
  dayNumber: number,
  date: string,
  cityId: string,
  extra: Partial<ItineraryDayDto> = {},
): ItineraryDayDto => ({
  id: `day-${dayNumber}`,
  dayNumber,
  date,
  cityId,
  notes: '',
  activities: [],
  ...extra,
});

const activity = (
  name: string,
  time: string | null,
  costCents: number | null,
  currency = 'USD',
  description = '',
) =>
  ({
    id: `a-${name}`,
    itineraryId: 'it',
    dayId: 'day',
    name,
    description,
    time,
    costCents,
    currency,
    images: [],
  }) as unknown as ItineraryDayDto['activities'][number];

const summary = (totals: BudgetSummaryDto['totals']): BudgetSummaryDto => ({
  itineraryId: 'it',
  platformCurrency: 'USD',
  totals,
});

const block = (
  currency: string,
  lines: Record<string, number>,
  byDay: Record<string, number>,
) => ({
  currency,
  totalCents: Object.values(lines).reduce((a, b) => a + b, 0),
  byCategory: Object.entries(lines).map(([category, totalCents]) => ({
    category: category as never,
    totalCents,
  })),
  byDay: Object.entries(byDay).map(([dayId, totalCents], index) => ({
    dayId,
    dayNumber: index + 1,
    date: '2026-12-20',
    totalCents,
  })),
});

const meta = {
  title: 'Two weeks in Egypt',
  countryCodes: ['EG', 'AE'],
  startDate: '2026-12-20',
  authorName: 'Sandbox One',
};
const NOW = new Date('2026-11-19T10:00:00.000Z');

describe('itinerary PDF document (ITN-28)', () => {
  describe('toPdfData', () => {
    it('lists the days with the city name, notes and activities with time and cost', () => {
      const data = toPdfData({
        ...meta,
        days: [
          day(1, '2026-12-20', 'cairo', {
            notes: 'Arrive and rest',
            activities: [
              activity('Pyramids visit', '09:30', 6000, 'USD', 'Morning tour'),
              activity('Walk', null, null),
            ],
          }),
          day(2, '2026-12-21', 'dubai'),
        ],
        summary: summary([]),
        cityNames: new Map([
          ['cairo', 'Cairo'],
          ['dubai', 'Dubai'],
        ]),
        now: NOW,
      });

      expect(data.days.map((d) => [d.dayNumber, d.date, d.cityName])).toEqual([
        [1, '2026-12-20', 'Cairo'],
        [2, '2026-12-21', 'Dubai'],
      ]);
      expect(data.days[0].notes).toBe('Arrive and rest');
      expect(data.days[0].activities).toEqual([
        {
          name: 'Pyramids visit',
          description: 'Morning tour',
          time: '09:30',
          cost: '60.00 USD',
        },
        { name: 'Walk', description: '', time: null, cost: null },
      ]);
      expect(data.endDate).toBe('2026-12-21');
    });

    it('falls back to the city id when the name is unknown and has no end date without days', () => {
      const withUnknown = toPdfData({
        ...meta,
        days: [day(1, '2026-12-20', 'atlantis')],
        summary: summary([]),
        cityNames: new Map(),
        now: NOW,
      });
      expect(withUnknown.days[0].cityName).toBe('atlantis');

      const empty = toPdfData({
        ...meta,
        days: [],
        summary: summary([]),
        cityNames: new Map(),
        now: NOW,
      });
      expect(empty.endDate).toBeNull();
    });

    it('shows each currency of the budget apart, with its non-zero categories and the cost of each day', () => {
      const data = toPdfData({
        ...meta,
        days: [day(1, '2026-12-20', 'cairo'), day(2, '2026-12-21', 'dubai')],
        summary: summary([
          block(
            'USD',
            { ACCOMMODATION: 9000, INTERCITY_TRANSPORT: 30000, FOOD: 0 },
            { 'day-1': 39000, 'day-2': 0 },
          ),
          block('EGP', { FOOD: 2500 }, { 'day-1': 2500, 'day-2': 0 }),
        ]),
        cityNames: new Map(),
        now: NOW,
      });

      expect(data.budget).toEqual([
        {
          currency: 'USD',
          total: '390.00 USD',
          lines: [
            { label: 'Accommodation', amount: '90.00 USD' },
            { label: 'Intercity transport', amount: '300.00 USD' },
          ],
        },
        {
          currency: 'EGP',
          total: '25.00 EGP',
          lines: [{ label: 'Food', amount: '25.00 EGP' }],
        },
      ]);
      expect(data.days[0].costs).toEqual(['390.00 USD', '25.00 EGP']);
      expect(data.days[1].costs).toEqual([]);
    });
  });

  describe('pdfLines', () => {
    const data = (): ItineraryPdfData =>
      toPdfData({
        ...meta,
        days: [
          day(1, '2026-12-20', 'cairo', {
            notes: 'Arrive and rest',
            activities: [activity('Pyramids visit', '09:30', 6000)],
          }),
        ],
        summary: summary([
          block('USD', { ACTIVITIES: 6000 }, { 'day-1': 6000 }),
        ]),
        cityNames: new Map([['cairo', 'Cairo']]),
        now: NOW,
      });
    const texts = (d: ItineraryPdfData) => pdfLines(d).map((line) => line.text);

    it('has the title, the dates, the author, the days, the activities and the budget', () => {
      const lines = texts(data());
      expect(lines).toEqual(
        expect.arrayContaining([
          'Two weeks in Egypt',
          'Countries: EG, AE',
          'Starts 2026-12-20, ends 2026-12-20, 1 day',
          'By Sandbox One',
          'Day 1 - Cairo - 2026-12-20',
          'Arrive and rest',
          '09:30  Pyramids visit - 60.00 USD',
          'Budget',
          'USD: 60.00 USD',
          'Activities: 60.00 USD',
          'Created on 2026-11-19',
        ]),
      );
    });

    it('says so when there are no days and no costs yet', () => {
      const lines = texts(
        toPdfData({
          ...meta,
          authorName: null,
          days: [],
          summary: summary([]),
          cityNames: new Map(),
          now: NOW,
        }),
      );
      expect(lines).toContain('No days have been planned yet.');
      expect(lines).toContain('No costs have been planned yet.');
      expect(lines.some((line) => line.startsWith('By '))).toBe(false);
    });

    it('keeps only characters the standard PDF font can draw', () => {
      const lines = texts({ ...data(), title: 'رحلة مصر ✈ Café Zürich' });
      expect(lines[0]).toBe('???? ??? ? Cafe? Zürich');
      for (const line of lines) {
        expect([...line].every((ch) => ch.charCodeAt(0) <= 0xff)).toBe(true);
      }
    });
  });

  describe('renderPdf', () => {
    it('makes a real PDF whose text has the content', async () => {
      const buffer = await renderPdf(
        pdfLines(
          toPdfData({
            ...meta,
            days: [
              day(1, '2026-12-20', 'cairo', {
                activities: [activity('Pyramids visit', '09:30', 6000)],
              }),
            ],
            summary: summary([
              block('USD', { ACTIVITIES: 6000 }, { 'day-1': 6000 }),
            ]),
            cityNames: new Map([['cairo', 'Cairo']]),
            now: NOW,
          }),
        ),
      );
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
      expect(buffer.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
      const text = pdfText(buffer);
      expect(text).toContain('Two weeks in Egypt');
      expect(text).toContain('Day 1 - Cairo - 2026-12-20');
      expect(text).toContain('09:30  Pyramids visit - 60.00 USD');
    });

    it('goes on to more pages when the itinerary is long', async () => {
      const days = Array.from({ length: 60 }, (_, i) =>
        day(i + 1, '2026-12-20', 'cairo', {
          activities: Array.from({ length: 5 }, (_, j) =>
            activity(`Activity ${i + 1}.${j + 1}`, '10:00', 1000),
          ),
        }),
      );
      const buffer = await renderPdf(
        pdfLines(
          toPdfData({
            ...meta,
            days,
            summary: summary([]),
            cityNames: new Map(),
            now: NOW,
          }),
        ),
      );
      expect(pdfPageCount(buffer)).toBeGreaterThan(5);
      expect(pdfText(buffer)).toContain('Activity 60.5');
    });
  });

  describe('pdfFilename', () => {
    it('is a safe .pdf name made from the title', () => {
      expect(pdfFilename('Two weeks in Egypt & the UAE!')).toBe(
        'itinerary-two-weeks-in-egypt-the-uae.pdf',
      );
      expect(pdfFilename('رحلة')).toBe('itinerary.pdf');
      expect(pdfFilename('x'.repeat(200)).length).toBeLessThanOrEqual(60);
    });
  });
});
