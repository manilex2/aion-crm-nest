import { Controller, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ReportesService } from './reportes.service';

@Controller('reportes')
export class ReportesController {
  constructor(private readonly reportesService: ReportesService) {}

  @Post('contact-failed')
  async reportePDFContactFailed(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const result = await this.reportesService.reportePDFContactFailed(req);
      res.setHeader('Content-Type', 'application/json');
      res.status(HttpStatus.OK).send({ message: result });
    } catch (error) {
      const status = error.status || 500;
      const message = error.message || 'Error interno del servidor';
      res.status(status).send({ message });
    }
  }

  @Post('cotizacion-terreno')
  async reportePDFCotTerreno(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const result = await this.reportesService.reportePDFCotTerreno(req);
      res.setHeader('Content-Type', 'application/json');
      res.status(HttpStatus.OK).send({ message: result });
    } catch (error) {
      const status = error.status || HttpStatus.INTERNAL_SERVER_ERROR;
      const message = error.message || 'Error interno del servidor';
      res.setHeader('Content-Type', 'application/json');
      res.status(status).send({ message });
    }
  }

  @Post('lead-status')
  async reportePDFLeadStatus(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const result = await this.reportesService.reportePDFLeadStatus(req);
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send({ message: result });
    } catch (error) {
      const status = error.status || HttpStatus.INTERNAL_SERVER_ERROR;
      const message = error.message || 'Error interno del servidor';
      res.setHeader('Content-Type', 'application/json');
      res.status(status).send({ message });
    }
  }
}
