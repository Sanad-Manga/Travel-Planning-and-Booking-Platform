import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FlightStatus } from '../common';
import { Flight } from './schemas/flight.schema';

/**
 * FLT-30: stores DEPARTED on every SCHEDULED flight whose departure time has passed.
 * Reads do not wait for this job: effectiveFlightStatus() already reports DEPARTED, so the job only keeps
 * the stored value (and anything that filters on it) in step. One idempotent bulk update, safe to run twice.
 */
@Injectable()
export class FlightStatusJob {
  private readonly logger = new Logger(FlightStatusJob.name);

  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron(): Promise<void> {
    try {
      await this.markDeparted();
    } catch (error) {
      this.logger.error(
        'Marking departed flights failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /** Returns how many flights changed. `now` is a parameter only so tests can fix the clock. */
  async markDeparted(now: Date = new Date()): Promise<number> {
    const result = await this.flights.updateMany(
      { status: FlightStatus.SCHEDULED, departureAt: { $lte: now } },
      { $set: { status: FlightStatus.DEPARTED } },
    );
    return result.modifiedCount;
  }
}
