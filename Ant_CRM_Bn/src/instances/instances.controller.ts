import { BadRequestException, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
import { EngineClientService } from './engine-client.service';
import { AntibanReadonlyService } from '../antiban-readonly/antiban-readonly.service';
import { InstanceOwnersService } from '../instance-owners/instance-owners.service';

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
    private readonly instanceOwners: InstanceOwnersService,
  ) {}

  @Get()
  async list(@Req() req: any) {
    const requester = { id: req.user.sub, role: req.user.role };
    const instances = await this.engineClient.listInstances();
    const ownedIds = await this.instanceOwners.listOwnedInstanceIds(
      requester,
      instances.map((i) => i.instanceId),
    );
    const ownedSet = new Set(ownedIds);

    return Promise.all(
      instances
        .filter((instance) => ownedSet.has(instance.instanceId))
        .map(async (instance) => {
          const { level, ageDays } = await this.antibanReadonly.getWarmupLevel(instance.instanceId);
          return { ...instance, warmupLevel: level, warmupAgeDays: ageDays };
        }),
    );
  }

  @Post(':instanceId/connect')
  async connect(@Param('instanceId') instanceId: string, @Req() req: any) {
    assertValidInstanceId(instanceId);
    const requester = { id: req.user.sub, role: req.user.role };

    const existingInstances = await this.engineClient.listInstances();
    const instanceExistsInEngine = existingInstances.some((i) => i.instanceId === instanceId);
    await this.instanceOwners.resolveOwnerOnConnect(instanceId, requester, instanceExistsInEngine);

    return this.engineClient.connect(instanceId);
  }

  @Get(':instanceId/status')
  async status(@Param('instanceId') instanceId: string, @Req() req: any) {
    assertValidInstanceId(instanceId);
    await this.instanceOwners.assertAccess(instanceId, { id: req.user.sub, role: req.user.role });
    return this.engineClient.getStatus(instanceId);
  }

  @Post(':instanceId/reconnect')
  async reconnect(@Param('instanceId') instanceId: string, @Req() req: any) {
    assertValidInstanceId(instanceId);
    await this.instanceOwners.assertAccess(instanceId, { id: req.user.sub, role: req.user.role });
    return this.engineClient.reconnect(instanceId);
  }

  @Get(':instanceId/check/:to')
  async check(@Param('instanceId') instanceId: string, @Param('to') to: string, @Req() req: any) {
    assertValidInstanceId(instanceId);
    await this.instanceOwners.assertAccess(instanceId, { id: req.user.sub, role: req.user.role });
    return this.engineClient.checkNumber(instanceId, to);
  }

  @Get(':instanceId/usage')
  async usage(@Param('instanceId') instanceId: string, @Req() req: any) {
    assertValidInstanceId(instanceId);
    await this.instanceOwners.assertAccess(instanceId, { id: req.user.sub, role: req.user.role });
    return this.antibanReadonly.getUsage(instanceId);
  }

  // Apaga a sessão (WhatsApp invalidou, chip trocou de dono, etc) - depois
  // disso a instância volta a precisar de QR novo pra parear. Mantém a
  // "posse" (instance_owners) intacta - reconectar com o mesmo instanceId
  // continua sendo desse mesmo usuário.
  @Delete(':instanceId')
  async reset(@Param('instanceId') instanceId: string, @Req() req: any) {
    assertValidInstanceId(instanceId);
    await this.instanceOwners.assertAccess(instanceId, { id: req.user.sub, role: req.user.role });
    return this.engineClient.resetInstance(instanceId);
  }
}
