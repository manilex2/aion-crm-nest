import {
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { Response } from 'express';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Post('send-notifications')
  async sendNotifications(@Res() res: Response) {
    try {
      await this.whatsappService.sendNotifications();
      res.setHeader('Content-Type', 'application/json');
      return res
        .status(HttpStatus.CREATED)
        .send({ message: 'Notificaciones enviadas exitosamente' });
    } catch (error) {
      res.setHeader('Content-Type', 'application/json');
      // Si el error es de tipo HttpException, usamos su código de estado
      if (error instanceof HttpException) {
        return res.status(error.getStatus()).send({ message: error.message });
      }
      // Si no es un HttpException, retornamos un error genérico 500
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        message: 'Error al enviar las notificaciones',
        error: error.message,
      });
    }
  }
}
