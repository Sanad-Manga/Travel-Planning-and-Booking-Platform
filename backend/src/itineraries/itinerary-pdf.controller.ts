import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthenticatedUser, CurrentUser } from '../common';
import { ItineraryIdParamDto } from './dto/itinerary-id-param.dto';
import { ApiBadRequest, ApiNotFound, UserRoutes } from './itineraries.swagger';
import { ItineraryPdfFile, ItineraryPdfService } from './itinerary-pdf.service';

/** Sends the PDF as a download. The filename is ASCII only (see `pdfFilename`), so it is safe in the header. */
export function sendPdf(res: Response, file: ItineraryPdfFile): StreamableFile {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${file.filename}"`,
    'Content-Length': file.buffer.length.toString(),
  });
  return new StreamableFile(file.buffer);
}

const PDF_RESPONSE = {
  description:
    'The itinerary as a downloadable PDF attachment: title, countries, dates, every day with its city, notes and activities (time and cost), and the budget by currency and category.',
  content: {
    'application/pdf': { schema: { type: 'string', format: 'binary' } },
  },
};

// ITN-28: export or print an itinerary as a PDF. Guests use the public route (ItineraryPublicPdfController).
@UserRoutes('itineraries')
@Controller('itineraries')
export class ItineraryPdfController {
  constructor(private readonly pdf: ItineraryPdfService) {}

  @Get(':id/pdf')
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary:
      'Export one of my itineraries, or any public itinerary, as a PDF - ITN-28',
    description:
      'The owner can export their itinerary whatever its visibility (the budget is the one of the budget summary). ' +
      "A logged-in traveler can also export someone else's itinerary while it is public. Guests use GET /api/itineraries/public/:id/pdf. " +
      'The PDF is made for each request and is not stored. Text is drawn with an embedded Unicode font: Latin (with accents), Cyrillic, Greek, Arabic (joined and right to left) and common symbols are supported; characters the font has no glyph for (Chinese, Japanese, Korean, emoji) are shown as "?".',
  })
  @ApiOkResponse(PDF_RESPONSE)
  @ApiBadRequest('id is not a valid id')
  @ApiNotFound(
    "No such itinerary, or it is someone else's and not public (private, hidden by an admin, or its author is not active)",
  )
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: ItineraryIdParamDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendPdf(res, await this.pdf.exportForUser(user, params.id));
  }
}

export { PDF_RESPONSE };
