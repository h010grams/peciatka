import type { FastifyPluginAsync } from 'fastify';
import type { Salon } from '@prisma/client';
import { updateSalonSchema, type SalonDto } from '@peciatka/shared';
import { audit } from '../../lib/audit.js';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { requireTenant } from '../../plugins/auth.js';

function toDto(s: Salon): SalonDto {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    address: s.address,
    phone: s.phone,
    defaultLocale: s.defaultLocale,
    timezone: s.timezone,
  };
}

/** /api/salon — текущий салон из сессии. */
export const salonRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: requireTenant() }, async (req) => {
    const salon = await prisma.salon.findUniqueOrThrow({ where: { id: req.tenant!.salonId } });
    return toDto(salon);
  });

  app.patch('/', { preHandler: requireTenant('OWNER') }, async (req) => {
    const { salonId } = req.tenant!;
    const input = parse(updateSalonSchema, req.body);
    const salon = await prisma.$transaction(async (tx) => {
      const salon = await tx.salon.update({ where: { id: salonId }, data: input });
      await audit(tx, {
        salonId,
        actorUserId: req.auth!.user.id,
        action: 'salon.update',
        entityType: 'salon',
        entityId: salonId,
        payload: input,
      });
      return salon;
    });
    return toDto(salon);
  });
};
