import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import * as admin from 'firebase-admin';

async function bootstrap() {
  if (!admin.apps.length) {
    try {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
      console.log('Firebase Admin SDK initialized successfully.'); // Mensaje de éxito
    } catch (error) {
      console.error('Error al inicializar Firebase Admin SDK:', error); // Captura el error aquí
      // Aquí puedes decidir si quieres que la aplicación se detenga o intente continuar
      process.exit(1); // Detener la aplicación si la inicialización falla críticamente
    }
  }

  const app = await NestFactory.create(AppModule);

  const corsOptions: CorsOptions = {
    origin: [
      'https://aion-crm.flutterflow.app',
      'https://app.flutterflow.io/debug',
      'https://aion-crm-asm.web.app',
      'https://crm.vistalmar.com.ec',
    ],
    methods: 'GET, POST, PUT, OPTIONS',
    allowedHeaders: 'Content-Type, Authorization',
    credentials: true,
  };
  app.enableCors(corsOptions);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`NestJS application is running on: http://localhost:${port}`);
}
bootstrap();
