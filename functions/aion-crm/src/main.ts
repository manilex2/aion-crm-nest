import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import * as admin from 'firebase-admin';

async function bootstrap() {
  if (!admin.apps.length) {
    const serviceAccountPath = './src/serviceAccountKey.json';
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath),
      // Si usas Realtime Database o Cloud Storage, puedes añadir:
      // databaseURL: "https://YOUR_PROJECT_ID.firebaseio.com",
      // storageBucket: "YOUR_PROJECT_ID.appspot.com"
    });
    console.log('Firebase Admin SDK initialized with service account.');
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
