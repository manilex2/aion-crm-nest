import { Module } from '@nestjs/common';
import { ContificoService } from './contifico.service';
import { ContificoController } from './contifico.controller';

@Module({
  providers: [ContificoService],
  controllers: [ContificoController],
})
export class ContificoModule {}
