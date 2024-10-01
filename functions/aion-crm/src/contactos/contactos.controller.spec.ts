import { Test, TestingModule } from '@nestjs/testing';
import { ContactosController } from './contactos.controller';

describe('ContactosController', () => {
  let controller: ContactosController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContactosController],
    }).compile();

    controller = module.get<ContactosController>(ContactosController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
