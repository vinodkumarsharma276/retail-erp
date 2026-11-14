import 'dotenv/config';

const rawOpenAiApiKey = process.env.OPENAI_API_KEY || '';
const openAiApiKey = rawOpenAiApiKey.startsWith('sk-') && rawOpenAiApiKey !== 'sk-your-openai-key-here'
  ? rawOpenAiApiKey
  : '';

/**
 * Fastify `trustProxy`: unset/false when the API is reached directly (local dev),
 * `true`, a hop count, or a comma-separated list of proxy IPs/CIDRs when it sits
 * behind a reverse proxy, so `request.ip` (used by the rate limiter) is the client's.
 */
export function parseTrustProxy(value: string | undefined): boolean | number | string[] {
  const raw = value?.trim();
  if (!raw || raw === 'false') return false;
  if (raw === 'true') return true;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return raw.split(',').map((part) => part.trim()).filter(Boolean);
}

const DEV_JWT_SECRETS = new Set(['dev-secret', 'dev-refresh-secret']);

/** Settings that must be real before the API may start with NODE_ENV=production. */
export function productionConfigProblems(env: NodeJS.ProcessEnv): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  for (const name of ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    const value = env[name]?.trim() ?? '';
    if (value.length < 32 || DEV_JWT_SECRETS.has(value) || value.startsWith('<')) {
      problems.push(`${name} must be a random string of at least 32 characters.`);
    }
  }
  if (env.JWT_SECRET && env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
    problems.push('JWT_SECRET and JWT_REFRESH_SECRET must differ.');
  }
  if (!env.DATABASE_URL?.trim()) problems.push('DATABASE_URL is required.');
  const origins = (env.CORS_ORIGIN ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (origins.length === 0) problems.push('CORS_ORIGIN must list the hosted web origin(s).');
  if (origins.some((o) => o === '*' || !o.startsWith('https://'))) {
    problems.push('CORS_ORIGIN entries must be exact https:// origins.');
  }
  return problems;
}

export const config = {
  port: parseInt(process.env.API_PORT || '3001', 10),
  host: process.env.API_HOST || '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5180',
  nodeEnv: process.env.NODE_ENV || 'development',
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessExpiresIn: '1h',
    refreshExpiresIn: '7d',
  },
  database: {
    url: process.env.DATABASE_URL || 'postgresql://retailerp:retailerp@localhost:5432/retailerp',
  },
  ocr: {
    provider: process.env.OCR_PROVIDER || (openAiApiKey ? 'openai' : 'disabled'),
    openAiApiKey,
    invoiceModel: process.env.OCR_INVOICE_MODEL || 'gpt-4o-mini',
    registerModel: process.env.OCR_REGISTER_MODEL || 'gpt-4o',
    maxFileMb: parseInt(process.env.OCR_MAX_FILE_MB || '15', 10),
    maxPdfPages: parseInt(process.env.OCR_MAX_PDF_PAGES || '8', 10),
  },
  // Bank statement analysis (parsing fallback + categorisation). Shares the OCR key.
  statements: {
    openAiApiKey,
    model: process.env.STATEMENTS_AI_MODEL || 'gpt-4.1-mini',
    maxFileMb: parseInt(process.env.STATEMENTS_MAX_FILE_MB || '30', 10),
  },
};
