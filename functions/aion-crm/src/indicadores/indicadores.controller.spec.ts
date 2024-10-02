import { Test, TestingModule } from '@nestjs/testing';
import { IndicadoresController } from './indicadores.controller';

describe('IndicadoresController', () => {
  let controller: IndicadoresController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IndicadoresController],
    }).compile();

    controller = module.get<IndicadoresController>(IndicadoresController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
