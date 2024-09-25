import {
  Controller,
  Res,
  HttpException,
  HttpStatus,
  Query,
  Get,
} from '@nestjs/common';
import { ContificoService } from './contifico.service';
import { Response } from 'express';

@Controller('contifico')
export class ContificoController {
  constructor(private readonly contificoService: ContificoService) {}

  @Get('documentos')
  async obtenerDocsContifico(
    @Query() query: any,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const message = await this.contificoService.contificoDocuments(query);
      res.setHeader('Content-Type', 'application/json');
      res.status(HttpStatus.OK).send({ message });
    } catch (error) {
      res.setHeader('Content-Type', 'application/json');
      if (error instanceof HttpException) {
        res.status(error.getStatus()).send({ message: error.message });
      } else {
        res
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .send({ message: 'Error interno del servidor' });
      }
    }
  }
}
