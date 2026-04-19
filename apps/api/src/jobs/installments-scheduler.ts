import cron from 'node-cron';
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../config/database.js';
import { ensureRolledForToday } from '../modules/installments/installments.rules.js';

/**
 * Daily installment rollover job.
 *
 * Runs once per day at 01:00 Asia/Kolkata. For every active installment
 * schedule, it:
 *   1. Redistributes any primary chain whose next primary has reached its
 *      due date and still has remaining > 0 (Rule R4).
 *   2. Flips due-today / overdue status flags for visibility (Rule R1).
 *   3. Keeps `sale.pendingAmount` + `sale.completedAt` consistent.
 *
 * Idempotency: each schedule's `lastRolloverDate` is checked so reruns on
 * the same business date are no-ops.
 *
 * Activation: gated by `ENABLE_SCHEDULER=true` in the environment so dev
 * machines don't mutate data unintentionally. Production containers should
 * set this.
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
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      logger.info({ date: today.toISOString().split('T')[0] }, '[scheduler] daily rollover starting');

      try {
        const result = await prisma.$transaction(async (tx) => {
          return ensureRolledForToday(tx, today, {});
        });
        logger.info(
          { date: today.toISOString().split('T')[0], ...result },
          '[scheduler] daily rollover completed',
        );
      } catch (err) {
        logger.error({ err }, '[scheduler] daily rollover failed');
      }
    },
    { timezone },
  );
}

/**
 * Ad-hoc entry point to run the rollover imperatively (admin endpoint).
 */
export async function runDailyRollover(asOf?: Date) {
  const today = asOf ?? new Date();
  today.setHours(0, 0, 0, 0);
  return prisma.$transaction(async (tx) => {
    return ensureRolledForToday(tx, today, {});
  });
}
