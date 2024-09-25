import { Global, Module } from '@nestjs/common';
import { cert, initializeApp } from 'firebase-admin/app';
import { ConfigModule, ConfigService } from '@nestjs/config';
import serviceAccount from '../serviceAccountKey.json';
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'FIREBASE_ADMIN',
      useFactory: (configService: ConfigService) => {
        const nodeEnv = configService.get('NODE_ENV');
        console.log('NODE_ENV:', nodeEnv);
        if (configService.get('NODE_ENV') === 'production') {
          return initializeApp();
        } else {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          return initializeApp({
            credential: cert(serviceAccount.toString()),
          });
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: ['FIREBASE_ADMIN'],
})
export class FirebaseModule {}
