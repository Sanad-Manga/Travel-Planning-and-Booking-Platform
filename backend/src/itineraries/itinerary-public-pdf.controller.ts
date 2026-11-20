import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common';
import { ItineraryIdParamDto } from './dto/itinerary-id-param.dto';
import { ApiBadRequest, ApiNotFound } from './itineraries.swagger';
import { PDF_RESPONSE, sendPdf } from './itinerary-pdf.controller';
import { ItineraryPdfService } from './itinerary-pdf.service';

/**
 * ITN-28: the PDF of a public itinerary, open to guests (project description, section 4). Like the public view it
 * answers 404 for anything that search would not list, so nothing reveals that a private itinerary exists.
 */
@ApiTags('itineraries')
@Public()
@Controller('itineraries/public')
export class ItineraryPublicPdfController {
  constructor(private readonly pdf: ItineraryPdfService) {}

  @Get(':id/pdf')
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Export a public itinerary as a PDF; open to guests - ITN-28',
    description:
      'The same PDF as GET /api/itineraries/:id/pdf for a public itinerary, without logging in. Its budget is the public view budget.',
  })
  @ApiOkResponse(PDF_RESPONSE)
  @ApiBadRequest('id is not a valid id')
  @ApiNotFound(
    'No such itinerary, or it is private, hidden by an admin, or its author is not active',
  )
  async export(
    @Param() params: ItineraryIdParamDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return sendPdf(res, await this.pdf.exportPublic(params.id));
  }
}
