import { BadRequestException, Controller, Get, Param, Post } from '@nestjs/common';
import { EngineClientService } from './engine-client.service';
import { AntibanReadonlyService } from '../antiban-readonly/antiban-readonly.service';

const INSTANCE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function assertValidInstanceId(instanceId: string): void {
  if (!INSTANCE_ID_PATTERN.test(instanceId)) {
    throw new BadRequestException('instanceId inválido');
  }
}

@Controller('instances')
export class InstancesController {
  constructor(
    private readonly engineClient: EngineClientService,
    private readonly antibanReadonly: AntibanReadonlyService,
  ) {}

  @Get()
  async list() {
    const instances = await this.engineClient.listInstances();
    return Promise.all(
      instances.map(async (instance) => {
        const { level, ageDays } = await this.antibanReadonly.getWarmupLevel(instance.instanceId);
        return { ...instance, warmupLevel: level, warmupAgeDays: ageDays };
      }),
    );
  }

  @Post(':instanceId/connect')
  connect(@Param('instanceId') instanceId: string) {
    assertValidInstanceId(instanceId);
    return this.engineClient.connect(instanceId);
  }

  @Get(':instanceId/status')
  status(@Param('instanceId') instanceId: string) {
    assertValidInstanceId(instanceId);
    return this.engineClient.getStatus(instanceId);
  }

  @Post(':instanceId/reconnect')
  reconnect(@Param('instanceId') instanceId: string) {
    assertValidInstanceId(instanceId);
    return this.engineClient.reconnect(instanceId);
  }

  @Get(':instanceId/check/:to')
  check(@Param('instanceId') instanceId: string, @Param('to') to: string) {
    assertValidInstanceId(instanceId);
    return this.engineClient.checkNumber(instanceId, to);
  }

  @Get(':instanceId/usage')
  usage(@Param('instanceId') instanceId: string) {
    assertValidInstanceId(instanceId);
    return this.antibanReadonly.getUsage(instanceId);
  }
}
