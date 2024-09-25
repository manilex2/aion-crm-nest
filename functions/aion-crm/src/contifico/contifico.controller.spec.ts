import { Test, TestingModule } from '@nestjs/testing';
import { ContificoController } from './contifico.controller';

describe('ContificoController', () => {
  let controller: ContificoController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContificoController],
    }).compile();

    controller = module.get<ContificoController>(ContificoController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
