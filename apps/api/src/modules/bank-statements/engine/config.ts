import { config as appConfig } from '../../../config/index.js';

/** Shape kept from the original LedgerLens config so the engine files stay unchanged. */
export const config = {
  openaiKey: appConfig.statements.openAiApiKey,
  openaiModel: appConfig.statements.model,
  maxFileBytes: appConfig.statements.maxFileMb * 1024 * 1024,
};

export const aiEnabled = () => config.openaiKey.length > 0;
