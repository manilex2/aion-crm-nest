import {
  Controller,
  Res,
  HttpException,
  HttpStatus,
  Get,
  Header,
} from '@nestjs/common';
import { ContificoService } from './contifico.service';
import { Response } from 'express';

@Controller('contifico')
export class ContificoController {
  constructor(private readonly contificoService: ContificoService) {}

  @Get('documentos')
  @Header('Content-Type', 'application/json')
  async obtenerDocsContifico(@Res() res: Response): Promise<void> {
    try {
      const message = await this.contificoService.contificoDocuments();
      res.status(HttpStatus.OK).send({ message });
    } catch (error) {
      if (error instanceof HttpException) {
        res.status(error.getStatus()).send({ message: error.message });
      } else {
        res
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .send({ message: 'Error interno del servidor' });
      }
    }
  }

  @Get('actualizar-docs')
  @Header('Content-Type', 'application/json')
  async actualizarDocsContifico(@Res() res: Response): Promise<void> {
    try {
      const message =
        await this.contificoService.syncPaymentStatesWithContifico();
      res.status(HttpStatus.OK).send({ message });
    } catch (error) {
      if (error instanceof HttpException) {
        res.status(error.getStatus()).send({ message: error.message });
      } else {
        res
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .send({ message: 'Error interno del servidor' });
      }
    }
  }

  @Get('actualizar-docs-pagados')
  @Header('Content-Type', 'application/json')
  async actualizarDocsContificoPagados(@Res() res: Response): Promise<void> {
    try {
      const message = await this.contificoService.verifyPaidPayments();
      res.status(HttpStatus.OK).send({ message });
    } catch (error) {
      if (error instanceof HttpException) {
        res.status(error.getStatus()).send({ message: error.message });
      } else {
        res
          .status(HttpStatus.INTERNAL_SERVER_ERROR)
          .send({ message: 'Error interno del servidor' });
      }
    }
  }

  @Get('actualizar-docs-barrido')
  @Header('Content-Type', 'application/json')
  async actualizarDocsContificoBarrido(@Res() res: Response): Promise<void> {
    try {
      const message =
        await this.contificoService.runHistoricalContificoImport();
      res.status(HttpStatus.OK).send({ message });
    } catch (error) {
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
