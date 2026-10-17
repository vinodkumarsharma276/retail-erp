import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Bank API credentials are encrypted at rest with AES-256-GCM. The key comes
 * from BANK_FEED_SECRET_KEY (any long random string; it is hashed to 32 bytes).
 * Losing or changing the key means every connection must be re-entered.
 */
function key(): Buffer {
  const secret = process.env.BANK_FEED_SECRET_KEY?.trim();
  if (!secret || secret.length < 32) {
    throw Object.assign(new Error('BANK_FEED_SECRET_KEY is not set (at least 32 characters) on the API server, so bank credentials cannot be stored safely.'), {
      statusCode: 503,
    });
  }
  return createHash('sha256').update(secret).digest();
}

/** Returns "v1:<iv>:<tag>:<ciphertext>" (base64 parts). */
export function encryptSecret(value: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decryptSecret(blob: string | null): Record<string, string> {
  if (!blob) return {};
  const [version, iv, tag, data] = blob.split(':');
  if (version !== 'v1') throw new Error('Unknown credential format.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const json = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  return JSON.parse(json);
}
