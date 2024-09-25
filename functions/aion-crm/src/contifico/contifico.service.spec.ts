import { Test, TestingModule } from '@nestjs/testing';
import { ContificoService } from './contifico.service';

describe('ContificoService', () => {
  let service: ContificoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ContificoService],
    }).compile();

    service = module.get<ContificoService>(ContificoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
