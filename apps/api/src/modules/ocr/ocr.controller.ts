import type { FastifyReply, FastifyRequest } from 'fastify';
import { ocrService } from './ocr.service.js';
import { config } from '../../config/index.js';
import { sendError, sendSuccess } from '../../utils/response.js';

async function readUpload(request: FastifyRequest) {
  const upload = await request.file();
  if (!upload) throw new Error('No file uploaded');

  const buffer = await upload.toBuffer();
  return {
    buffer,
    mimeType: upload.mimetype,
    filename: upload.filename,
  };
}

function statusFor(error: unknown) {
  const statusCode = (error as Error & { statusCode?: number })?.statusCode;
  if (statusCode) return statusCode;
  const message = error instanceof Error ? error.message : '';
  if (message.includes('disabled')) return 503;
  if (message.includes('too large')) return 413;
  if (message.includes('Unsupported file type') || message.includes('No file')) return 400;
  if (message.includes('OCR provider failed')) return 502;
  return 400;
}

export const ocrController = {
  async status(_request: FastifyRequest, reply: FastifyReply) {
    return sendSuccess(reply, {
      enabled: config.ocr.provider !== 'disabled' && !!config.ocr.openAiApiKey,
      provider: config.ocr.provider,
      invoiceModel: config.ocr.invoiceModel,
      registerModel: config.ocr.registerModel,
    });
  },

  async parseInvoice(request: FastifyRequest, reply: FastifyReply) {
    try {
      const file = await readUpload(request);
      const tenantId = request.currentUser!.tenantId;
      const result = await ocrService.parseInvoice(file, tenantId);
      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to parse invoice';
      return sendError(reply, message, statusFor(error));
    }
  },

  async parseRegisterEntry(request: FastifyRequest, reply: FastifyReply) {
    try {
      const file = await readUpload(request);
      const result = await ocrService.parseRegisterEntry(file);
      return sendSuccess(reply, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to parse register page';
      return sendError(reply, message, statusFor(error));
    }
  },
};