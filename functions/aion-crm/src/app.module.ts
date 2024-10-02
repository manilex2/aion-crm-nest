import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CommonService } from './common/common.service';
import { ConfigModule } from '@nestjs/config';
import { ContificoModule } from './contifico/contifico.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { ReportesModule } from './reportes/reportes.module';
import { ContactosModule } from './contactos/contactos.module';
import { IndicadoresModule } from './indicadores/indicadores.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ContificoModule,
    WhatsappModule,
    ReportesModule,
    ContactosModule,
    IndicadoresModule,
  ],
  controllers: [AppController],
  providers: [AppService, CommonService],
})
export class AppModule {}
