import 'dotenv/config';

const rawOpenAiApiKey = process.env.OPENAI_API_KEY || '';
const openAiApiKey = rawOpenAiApiKey.startsWith('sk-') && rawOpenAiApiKey !== 'sk-your-openai-key-here'
  ? rawOpenAiApiKey
  : '';

export const config = {
  port: parseInt(process.env.API_PORT || '3001', 10),
  host: process.env.API_HOST || '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5174',
  nodeEnv: process.env.NODE_ENV || 'development',
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
