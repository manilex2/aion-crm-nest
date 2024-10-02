import { Test, TestingModule } from '@nestjs/testing';
import { IndicadoresService } from './indicadores.service';

describe('IndicadoresService', () => {
  let service: IndicadoresService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IndicadoresService],
    }).compile();

    service = module.get<IndicadoresService>(IndicadoresService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
