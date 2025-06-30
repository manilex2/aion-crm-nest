import {
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { Response } from 'express';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Get('send-notifications')
  @Header('Content-Type', 'application/json')
  async sendNotifications(@Res() res: Response) {
    try {
      await this.whatsappService.sendNotifications();
      return res
        .status(HttpStatus.CREATED)
        .send({ message: 'Notificaciones enviadas exitosamente' });
    } catch (error) {
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

  @Get('send-notifications-pre')
  @Header('Content-Type', 'application/json')
  async sendNotificationsPre(@Res() res: Response) {
    try {
      await this.whatsappService.sendNotificationsPrev();
      return res
        .status(HttpStatus.CREATED)
        .send({ message: 'Notificaciones enviadas exitosamente' });
    } catch (error) {
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

  @Get('send-notifications-pos')
  @Header('Content-Type', 'application/json')
  async sendNotificationsPos(@Res() res: Response) {
    try {
      await this.whatsappService.sendNotificationsPos();
      return res
        .status(HttpStatus.CREATED)
        .send({ message: 'Notificaciones enviadas exitosamente' });
    } catch (error) {
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
