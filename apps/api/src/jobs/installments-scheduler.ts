import cron from 'node-cron';
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../config/database.js';
import { runResolvePromisesJob } from './resolve-promises.job.js';

/**
 * Daily installment promise resolver.
 *
 * Pattern B removed automatic rollover/redistribution. The only daily
 * installment job is resolving pending promises whose promised date has
 * passed. It iterates tenant-by-tenant inside the job implementation.
 */
export function registerInstallmentScheduler(logger: FastifyBaseLogger): void {
  if (process.env.ENABLE_SCHEDULER !== 'true') {
    logger.info('[scheduler] ENABLE_SCHEDULER is not "true" — installment scheduler disabled');
    return;
  }

  const schedule = process.env.SCHEDULER_CRON ?? '0 1 * * *';
  const timezone = process.env.SCHEDULER_TZ ?? 'Asia/Kolkata';

  logger.info({ schedule, timezone }, '[scheduler] installment scheduler registered');

  cron.schedule(
    schedule,
    async () => {
      logger.info('[scheduler] promise resolver starting');

      try {
        await runResolvePromisesJob(prisma, logger);
        logger.info('[scheduler] promise resolver completed');
      } catch (err) {
        logger.error({ err }, '[scheduler] promise resolver failed');
      }
    },
    { timezone },
  );
}

/**
 * Ad-hoc entry point retained for backwards compatibility with admin tooling.
 */
export async function runDailyRollover(asOf?: Date) {
  void asOf;
  return { redistributions: 0, markedOverdue: 0 };
}
