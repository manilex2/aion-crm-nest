import { Controller, Header, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ReportesService } from './reportes.service';

@Controller('reportes')
export class ReportesController {
  constructor(private readonly reportesService: ReportesService) {}

  @Post('contact-failed')
  @Header('Content-Type', 'application/json')
  async reportePDFContactFailed(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const result = await this.reportesService.reportePDFContactFailed(req);
      res.status(HttpStatus.OK).send({ message: result });
    } catch (error) {
      const status = error.status || 500;
      const message = error.message || 'Error interno del servidor';
      res.status(status).send({ message });
    }
  }

  @Post('cotizacion-terreno')
  @Header('Content-Type', 'application/json')
  async reportePDFCotTerreno(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const result = await this.reportesService.reportePDFCotTerreno(req);
      res.status(HttpStatus.OK).send({ message: result });
    } catch (error) {
      const status = error.status || HttpStatus.INTERNAL_SERVER_ERROR;
      const message = error.message || 'Error interno del servidor';
      res.status(status).send({ message });
    }
  }

  @Post('lead-status')
  @Header('Content-Type', 'application/json')
  async reportePDFLeadStatus(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const result = await this.reportesService.reportePDFLeadStatus(req);
      res.status(200).send({ message: result });
    } catch (error) {
      const status = error.status || HttpStatus.INTERNAL_SERVER_ERROR;
      const message = error.message || 'Error interno del servidor';
      res.status(status).send({ message });
    }
  }

  @Post('seguimiento')
  @Header('Content-Type', 'application/json')
  async reportePDFSeguimiento(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const result = await this.reportesService.reportePDFSeguimiento(req);
      res.status(HttpStatus.OK).send({ message: result });
    } catch (error) {
      const status = error.status || 500;
      const message = error.message || 'Error interno del servidor';
      res.status(status).send({ message });
    }
  }
}
