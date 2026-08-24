import { Body, Controller, Post, Req } from '@nestjs/common';
import { TestDispatchService } from './test-dispatch.service';
import { TestDispatchDto } from './dto';

@Controller('test-dispatch')
export class TestDispatchController {
  constructor(private readonly testDispatchService: TestDispatchService) {}

  @Post()
  dispatch(@Body() dto: TestDispatchDto, @Req() req: any) {
    return this.testDispatchService.dispatch(dto, {
      id: req.user.sub,
      role: req.user.role,
      canDispatchTest: req.user.canDispatchTest,
    });
  }
}
