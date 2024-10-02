import {
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ContactosService } from './contactos.service';

@Controller('contactos')
export class ContactosController {
  constructor(private readonly contactosService: ContactosService) {}

  @Get('export-csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="contactos.csv"')
  async exportCSV(@Req() req: Request, @Res() res: Response) {
    try {
      const message = await this.contactosService.exportContactsToCSV();
      return res.status(HttpStatus.OK).send(message);
    } catch (error) {
      res.setHeader('Content-Type', 'application/json');
      // Si el error es de tipo HttpException, usamos su código de estado
      if (error instanceof HttpException) {
        return res.status(error.getStatus()).send({ message: error.message });
      }
      // Si no es un HttpException, retornamos un error genérico 500
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: 'Error interno del servidor',
        error: error.message,
      });
    }
  }
}
