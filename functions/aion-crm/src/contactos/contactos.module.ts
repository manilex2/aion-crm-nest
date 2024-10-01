import { Module } from '@nestjs/common';
import { ContactosController } from './contactos.controller';
import { ContactosService } from './contactos.service';

@Module({
  controllers: [ContactosController],
  providers: [ContactosService],
})
export class ContactosModule {}
