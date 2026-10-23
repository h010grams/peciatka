import type { FastifyPluginAsync } from 'fastify';
import type { LoyaltyProgram } from '@prisma/client';
import { programSchema, type ProgramDto } from '@peciatka/shared';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { parse } from '../../lib/validate.js';
import { requireTenant } from '../../plugins/auth.js';
import { processLogoUpload } from '../../services/images.js';
import { urls } from '../../services/urls.js';
import * as google from '../../services/wallet/google.js';
import { enqueueProgramSync, kickWalletWorker } from '../../services/wallet/sync.js';

export function toProgramDto(p: LoyaltyProgram): ProgramDto {
  return {
    id: p.id,
    name: p.name,
    stampsRequired: p.stampsRequired,
    rewardText: p.rewardText,
    cooldownHours: p.cooldownHours,
    firstStampOnJoin: p.firstStampOnJoin,
    bgColor: p.bgColor,
    fgColor: p.fgColor,
    labelColor: p.labelColor,
    logoUrl: p.logoAssetId ? urls.logo(p.id, p.designVersion) : null,
  };
}

/** После смены дизайна: обновить класс в Google (вне транзакции, ошибка не критична). */
async function refreshGoogleClass(programId: string) {
  if (!google.googleEnabled()) return;
  const program = await prisma.loyaltyProgram.findUnique({ where: { id: programId }, include: { salon: true } });
  if (program?.googleClassId) {
    await google.ensureClass(program, program.salon).catch((e) => console.warn('[google] class update failed', e));
  }
}

/** /api/program — программа лояльности текущего салона. */
export const programRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: requireTenant() }, async (req) => {
    const p = await prisma.loyaltyProgram.findUnique({ where: { salonId: req.tenant!.salonId } });
    return { program: p ? toProgramDto(p) : null };
  });

  app.put('/', { preHandler: requireTenant('OWNER') }, async (req) => {
    const { salonId } = req.tenant!;
    const input = parse(programSchema, req.body);

    const program = await prisma.$transaction(async (tx) => {
      const before = await tx.loyaltyProgram.findUnique({ where: { salonId } });
      let program: LoyaltyProgram;
      if (!before) {
        program = await tx.loyaltyProgram.create({ data: { salonId, ...input } });
      } else {
        // всё, кроме лимита, видно на карте → новая версия дизайна и пересинхронизация карт
        const visibleChanged = (['name', 'stampsRequired', 'rewardText', 'bgColor', 'fgColor', 'labelColor'] as const).some(
          (k) => before[k] !== input[k],
        );
        program = await tx.loyaltyProgram.update({
          where: { id: before.id },
          data: { ...input, ...(visibleChanged ? { designVersion: { increment: 1 } } : {}) },
        });
        if (visibleChanged) await enqueueProgramSync(tx, program.id);
      }
      await audit(tx, {
        salonId,
        actorUserId: req.auth!.user.id,
        action: before ? 'program.update' : 'program.create',
        entityType: 'program',
        entityId: program.id,
        payload: input,
      });
      return program;
    });

    kickWalletWorker();
    void refreshGoogleClass(program.id);
    return { program: toProgramDto(program) };
  });

  app.post('/logo', { preHandler: requireTenant('OWNER') }, async (req) => {
    const { salonId } = req.tenant!;
    const program = await prisma.loyaltyProgram.findUnique({ where: { salonId } });
    if (!program) throw notFound('program_missing');

    const file = await req.file();
    if (!file) throw badRequest('image_invalid');
    const buffer = await file.toBuffer();
    const logo = await processLogoUpload(buffer);

    const updated = await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.create({ data: { salonId, mime: 'image/png', ...logo } });
      const old = program.logoAssetId;
      const updated = await tx.loyaltyProgram.update({
        where: { id: program.id },
        data: { logoAssetId: asset.id, designVersion: { increment: 1 } },
      });
      if (old) await tx.asset.delete({ where: { id: old } }).catch(() => {});
      await enqueueProgramSync(tx, program.id);
      await audit(tx, {
        salonId,
        actorUserId: req.auth!.user.id,
        action: 'program.logo',
        entityType: 'program',
        entityId: program.id,
        payload: { width: logo.width, height: logo.height },
      });
      return updated;
    });

    kickWalletWorker();
    void refreshGoogleClass(program.id);
    return { program: toProgramDto(updated) };
  });

  app.delete('/logo', { preHandler: requireTenant('OWNER') }, async (req) => {
    const { salonId } = req.tenant!;
    const program = await prisma.loyaltyProgram.findUnique({ where: { salonId } });
    if (!program) throw notFound('program_missing');
    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.loyaltyProgram.update({
        where: { id: program.id },
        data: { logoAssetId: null, designVersion: { increment: 1 } },
      });
      if (program.logoAssetId) await tx.asset.delete({ where: { id: program.logoAssetId } }).catch(() => {});
      await enqueueProgramSync(tx, program.id);
      return updated;
    });
    kickWalletWorker();
    void refreshGoogleClass(program.id);
    return { program: toProgramDto(updated) };
  });
};
