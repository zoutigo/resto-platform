import { type AddStaffInput, type Role, type StaffRole, canManageRole } from '@resto/shared';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service.js';
import { AuditService } from '../auth/audit.service.js';
import { HasherService } from '../auth/hasher.service.js';
import type { ActiveMembership } from '../auth/restaurant-roles.guard.js';
import { RecoveryService } from '../auth/recovery.service.js';
import { SessionService } from '../auth/session.service.js';

type MemberRow = {
  role: Role;
  status: string;
  user: {
    id: string;
    name: string;
    phone: string | null;
    managedByRestaurantId: string | null;
    credentials: { mustChange: boolean }[];
    recoveryRequests?: { availableAt: Date }[];
  };
};

const forbidden = () =>
  new ForbiddenException({
    statusCode: 403,
    error: 'Forbidden',
    message: 'team.cannotManageRole',
  });

const notFound = () =>
  new NotFoundException({ statusCode: 404, error: 'NotFound', message: 'team.memberNotFound' });

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: HasherService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly recovery: RecoveryService,
  ) {}

  async list(restaurantId: string) {
    const members = await this.prisma.membership.findMany({
      where: { restaurantId, status: 'ACTIVE' },
      include: this.memberInclude(),
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => this.view(m, restaurantId));
  }

  /**
   * Ajoute un employé. Numéro inconnu : on crée le compte avec un PIN temporaire, renvoyé
   * une seule fois. Numéro déjà inscrit : on rattache le compte sans toucher à son PIN.
   */
  async add(actor: ActiveMembership, input: AddStaffInput & { phone: string; role: StaffRole }) {
    if (!canManageRole(actor.role, input.role)) throw forbidden();

    const existing = await this.prisma.user.findUnique({
      where: { phone: input.phone },
      include: { memberships: { where: { restaurantId: actor.restaurantId } } },
    });

    if (existing) {
      const current = existing.memberships[0];
      if (current?.status === 'ACTIVE') {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: 'team.alreadyMember',
        });
      }
      // Un ancien membre révoqué ne peut pas être « repris » à un rôle que l'acteur ne gère pas.
      if (current && !canManageRole(actor.role, current.role)) throw forbidden();
      await this.prisma.membership.upsert({
        where: { userId_restaurantId: { userId: existing.id, restaurantId: actor.restaurantId } },
        update: { role: input.role, status: 'ACTIVE', approvedById: actor.userId },
        create: {
          userId: existing.id,
          restaurantId: actor.restaurantId,
          role: input.role,
          status: 'ACTIVE',
          approvedById: actor.userId,
        },
      });
      await this.audit.log({
        action: 'team.member.added',
        userId: actor.userId,
        restaurantId: actor.restaurantId,
        meta: { memberId: existing.id, role: input.role, existingAccount: true },
      });
      return { member: await this.getView(existing.id, actor.restaurantId), temporaryPin: null };
    }

    const temporaryPin = this.hasher.generateTemporaryPin();
    const hash = await this.hasher.hashSecret(temporaryPin);
    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        phone: input.phone,
        managedByRestaurantId: actor.restaurantId,
        credentials: { create: { type: 'PIN', hash, mustChange: true } },
        memberships: {
          create: {
            restaurantId: actor.restaurantId,
            role: input.role,
            status: 'ACTIVE',
            approvedById: actor.userId,
          },
        },
      },
    });
    await this.audit.log({
      action: 'team.member.added',
      userId: actor.userId,
      restaurantId: actor.restaurantId,
      meta: { memberId: user.id, role: input.role, existingAccount: false },
    });
    return { member: await this.getView(user.id, actor.restaurantId), temporaryPin };
  }

  async changeRole(actor: ActiveMembership, memberId: string, role: StaffRole) {
    const target = await this.findTarget(actor.restaurantId, memberId);
    if (!canManageRole(actor.role, target.role) || !canManageRole(actor.role, role)) {
      throw forbidden();
    }
    await this.prisma.membership.update({
      where: { userId_restaurantId: { userId: memberId, restaurantId: actor.restaurantId } },
      data: { role },
    });
    await this.audit.log({
      action: 'team.member.roleChanged',
      userId: actor.userId,
      restaurantId: actor.restaurantId,
      meta: { memberId, from: target.role, to: role },
    });
    return this.getView(memberId, actor.restaurantId);
  }

  /** Nouveau PIN temporaire. Réservé aux comptes créés par ce restaurant. */
  async resetPin(actor: ActiveMembership, memberId: string) {
    const target = await this.findTarget(actor.restaurantId, memberId);
    if (!canManageRole(actor.role, target.role)) throw forbidden();
    if (target.user.managedByRestaurantId !== actor.restaurantId) {
      // Compte personnel (client, autre restaurant) : il se récupère lui-même.
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        message: 'team.accountNotManaged',
      });
    }
    const temporaryPin = this.hasher.generateTemporaryPin();
    const hash = await this.hasher.hashSecret(temporaryPin);
    await this.prisma.credential.upsert({
      where: { userId_type: { userId: memberId, type: 'PIN' } },
      update: { hash, mustChange: true },
      create: { userId: memberId, type: 'PIN', hash, mustChange: true },
    });
    await this.sessions.revokeAllForUser(memberId);
    await this.audit.log({
      action: 'team.member.pinReset',
      userId: actor.userId,
      restaurantId: actor.restaurantId,
      meta: { memberId },
    });
    return { temporaryPin };
  }

  /** Annule une récupération de compte en attente (« ce n'est pas lui »). */
  async cancelRecovery(actor: ActiveMembership, memberId: string): Promise<{ cancelled: number }> {
    const target = await this.findTarget(actor.restaurantId, memberId);
    if (!canManageRole(actor.role, target.role)) throw forbidden();
    return {
      cancelled: await this.recovery.cancelForMember(memberId, actor.userId, actor.restaurantId),
    };
  }

  /** Retire l'accès au restaurant (le compte lui-même n'est pas supprimé). */
  async remove(actor: ActiveMembership, memberId: string): Promise<void> {
    const target = await this.findTarget(actor.restaurantId, memberId);
    if (!canManageRole(actor.role, target.role)) throw forbidden();
    await this.prisma.membership.update({
      where: { userId_restaurantId: { userId: memberId, restaurantId: actor.restaurantId } },
      data: { status: 'REVOKED' },
    });
    await this.audit.log({
      action: 'team.member.removed',
      userId: actor.userId,
      restaurantId: actor.restaurantId,
      meta: { memberId, role: target.role },
    });
  }

  private memberInclude() {
    return {
      user: {
        select: {
          id: true,
          name: true,
          phone: true,
          managedByRestaurantId: true,
          credentials: { where: { type: 'PIN' as const }, select: { mustChange: true } },
          recoveryRequests: {
            where: { status: 'PENDING' as const },
            select: { availableAt: true },
          },
        },
      },
    };
  }

  /** Membre ACTIF de CE restaurant uniquement : un id d'ailleurs donne toujours 404. */
  private async findTarget(restaurantId: string, userId: string): Promise<MemberRow> {
    const target = await this.prisma.membership.findUnique({
      where: { userId_restaurantId: { userId, restaurantId } },
      include: this.memberInclude(),
    });
    if (!target || target.status !== 'ACTIVE') throw notFound();
    return target as MemberRow;
  }

  private async getView(userId: string, restaurantId: string) {
    const member = await this.prisma.membership.findUniqueOrThrow({
      where: { userId_restaurantId: { userId, restaurantId } },
      include: this.memberInclude(),
    });
    return this.view(member as MemberRow, restaurantId);
  }

  private view(m: MemberRow, restaurantId: string) {
    return {
      userId: m.user.id,
      name: m.user.name,
      phone: m.user.phone,
      role: m.role,
      mustChangePin: m.user.credentials[0]?.mustChange ?? false,
      pinResettable: m.user.managedByRestaurantId === restaurantId,
      recoveryPendingUntil: m.user.recoveryRequests?.[0]?.availableAt.toISOString() ?? null,
    };
  }
}
