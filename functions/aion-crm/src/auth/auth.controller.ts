import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service'; // Servicio de autenticación

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('change-password')
  async changePassword(@Req() req: Request, @Res() res: Response) {
    const { uid, clave, email } = req.body;

    try {
      const message = await this.authService.changePassword(uid, clave, email);
      res.setHeader('Content-Type', 'application/json');
      return res.status(HttpStatus.OK).send({ message });
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

  @Post('signup')
  async singUp(@Body() body: any, @Res() res: Response) {
    try {
      await this.authService.singUp(body);
      res.setHeader('Content-Type', 'application/json');
      return res
        .status(HttpStatus.CREATED)
        .send({ message: 'Usuario creado exitosamente' });
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

  @Post('reset-password')
  async resetPassword(@Res() res: Response, @Body('email') email: string) {
    try {
      await this.authService.resetPassword(email);
      res.setHeader('Content-Type', 'application/json');
      return res.status(HttpStatus.OK).send({
        message: 'Se ha enviado un correo para restablecer la contraseña',
      });
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

  // Ruta para confirmar el restablecimiento de contraseña
  @Post('confirm-reset')
  async confirmReset(
    @Res() res: Response,
    @Body('email') email: string,
    @Body('token') token: string,
  ) {
    try {
      await this.authService.confirmReset(email, token);
      res.setHeader('Content-Type', 'application/json');
      return res.status(HttpStatus.OK).send({
        message:
          'La contraseña ha sido restablecida y enviada al correo electrónico',
      });
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
