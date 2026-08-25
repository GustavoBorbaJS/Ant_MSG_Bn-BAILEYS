import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { InstanceOwner } from '../database/entities/instance-owner.entity';
import { User, UserRole } from '../database/entities/user.entity';

export interface RequesterInfo {
  id: string;
  role: UserRole;
}

@Injectable()
export class InstanceOwnersService {
  constructor(
    @InjectRepository(InstanceOwner) private readonly ownerRepo: Repository<InstanceOwner>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  private async getDefaultOwnerId(): Promise<string | null> {
    const admin = await this.userRepo.findOne({ where: { username: 'admin' } });
    return admin?.id ?? null;
  }

  // Dono "de verdade" (linha em instance_owners) ou, se nunca foi
  // reivindicada, o dono padrão (admin bootstrap) - trata instâncias
  // criadas antes desse recurso existir como pertencentes ao admin.
  async getEffectiveOwnerId(instanceId: string): Promise<string | null> {
    const row = await this.ownerRepo.findOne({ where: { instanceId } });
    if (row) return row.ownerId;
    return this.getDefaultOwnerId();
  }

  async canAccess(instanceId: string, requester: RequesterInfo): Promise<boolean> {
    const ownerId = await this.getEffectiveOwnerId(instanceId);
    return ownerId === requester.id;
  }

  async assertAccess(instanceId: string, requester: RequesterInfo): Promise<void> {
    if (!(await this.canAccess(instanceId, requester))) {
      throw new ForbiddenException('Você não tem permissão para usar essa instância.');
    }
  }

  // Chamado no POST /instances/:id/connect. instanceExistsInEngine vem do
  // controller (já consultou o Engine) - uma instância que já existe lá mas
  // nunca foi reivindicada aqui é "legada" e só o admin pode reivindicar,
  // pra ninguém sequestrar uma sessão WhatsApp alheia só digitando o mesmo
  // instanceId (geralmente um número de telefone, nada secreto).
  async resolveOwnerOnConnect(
    instanceId: string,
    requester: RequesterInfo,
    instanceExistsInEngine: boolean,
  ): Promise<void> {
    const existing = await this.ownerRepo.findOne({ where: { instanceId } });
    if (existing) {
      if (existing.ownerId !== requester.id) {
        throw new ForbiddenException('Essa instância já pertence a outro usuário.');
      }
      return;
    }

    if (instanceExistsInEngine && requester.role !== 'admin') {
      throw new ForbiddenException('Essa instância já existe e não pertence a você.');
    }

    await this.ownerRepo.save(this.ownerRepo.create({ instanceId, ownerId: requester.id }));
  }

  // Todas as instanceIds "de verdade" de um usuário: as reivindicadas
  // explicitamente + (se for admin) as legadas sem dono nenhum, pra filtrar a
  // lista vinda do Engine (que não sabe nada sobre isso).
  async listOwnedInstanceIds(requester: RequesterInfo, allInstanceIds: string[]): Promise<string[]> {
    if (allInstanceIds.length === 0) return [];

    const rows = await this.ownerRepo.find({ where: { instanceId: In(allInstanceIds) } });
    const ownerById = new Map(rows.map((r) => [r.instanceId, r.ownerId]));

    const defaultOwnerId = requester.role === 'admin' ? await this.getDefaultOwnerId() : null;

    return allInstanceIds.filter((id) => {
      const ownerId = ownerById.get(id) ?? defaultOwnerId;
      return ownerId === requester.id;
    });
  }

  // Chamado quando um usuário é removido de vez (ver UsersService.remove) -
  // instance_owners.ownerId tem FK ON DELETE RESTRICT pra users. Só libera a
  // POSSE no CRM (a instância volta a ser "legada"/tratada como do admin,
  // ver getEffectiveOwnerId) - não mexe na sessão WhatsApp em si no engine,
  // ela continua conectada normalmente.
  async releaseAllOwnedBy(ownerId: string): Promise<void> {
    await this.ownerRepo.delete({ ownerId });
  }
}
