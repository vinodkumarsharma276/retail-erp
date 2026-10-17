import cron from 'node-cron';
import type { FastifyBaseLogger } from 'fastify';
import { syncAllDue } from '../modules/bank-statements/feeds/feeds.service.js';

/**
 * Nightly bank statement feed sync. Runs every connected account with auto-sync
 * on (and whose tenant has the "bank.api_feeds" add-on). Gated by ENABLE_SCHEDULER
 * like the other jobs; the time is BANK_FEED_CRON (default 06:30 IST, after banks
 * finish their overnight posting).
 */
export function registerBankFeedScheduler(logger: FastifyBaseLogger): void {
  if (process.env.ENABLE_SCHEDULER !== 'true') {
    logger.info('[scheduler] ENABLE_SCHEDULER is not "true" — bank feed sync disabled');
    return;
  }
  const schedule = process.env.BANK_FEED_CRON ?? '30 6 * * *';
  const timezone = process.env.SCHEDULER_TZ ?? 'Asia/Kolkata';
  logger.info({ schedule, timezone }, '[scheduler] bank feed sync registered');

  cron.schedule(
    schedule,
    async () => {
      logger.info('[bank-feeds] nightly sync starting');
      try {
        await syncAllDue(logger);
        logger.info('[bank-feeds] nightly sync finished');
      } catch (err) {
        logger.error({ err }, '[bank-feeds] nightly sync failed');
      }
    },
    { timezone },
  );
}
