import { config } from '../../../config/index.js';

type OcrFile = {
  buffer: Buffer;
  mimeType: string;
  filename: string;
};

function toDataUrl(file: OcrFile) {
  return `data:${file.mimeType};base64,${file.buffer.toString('base64')}`;
}

function extractOutputText(payload: any): string {
  if (typeof payload.output_text === 'string') return payload.output_text;
  const output = payload.output ?? [];
  for (const item of output) {
    for (const content of item.content ?? []) {
      if (typeof content.text === 'string') return content.text;
    }
  }
  throw new Error('OCR provider returned no text output');
}

export async function parseWithOpenAi<T>(args: {
  file: OcrFile;
  model: string;
  schemaName: string;
  schema: unknown;
  systemPrompt: string;
  userPrompt: string;
}): Promise<T> {
  if (!config.ocr.openAiApiKey) {
    throw new Error('OCR is not configured. Set OPENAI_API_KEY to enable scanning.');
  }

  const isPdf = args.file.mimeType === 'application/pdf';
  const documentPart = isPdf
    ? { type: 'input_file', filename: args.file.filename || 'document.pdf', file_data: toDataUrl(args.file) }
    : { type: 'input_image', image_url: toDataUrl(args.file) };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.ocr.openAiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: args.model,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: args.systemPrompt }] },
        { role: 'user', content: [{ type: 'input_text', text: args.userPrompt }, documentPart] },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: args.schemaName,
          strict: true,
          schema: args.schema,
        },
      },
    }),
  });

  if (!response.ok) {
    let errorText = '';
    let errorJson: any = undefined;
    try {
      errorText = await response.text();
      try {
        errorJson = JSON.parse(errorText);
      } catch {
        // ignore non-JSON bodies
      }
    } catch {
      // ignore body read failures
    }

    const providerMessage =
      (typeof errorJson?.error?.message === 'string' && errorJson.error.message) ||
      (typeof errorJson?.message === 'string' && errorJson.message) ||
      '';
    const providerCode =
      (typeof errorJson?.error?.code === 'string' && errorJson.error.code) ||
      (typeof errorJson?.code === 'string' && errorJson.code) ||
      '';

    let message = `OCR provider failed: ${response.status}`;
    if (response.status === 401) {
      message = 'OpenAI authentication failed. Check OPENAI_API_KEY.';
    } else if (response.status === 429 && providerCode === 'insufficient_quota') {
      message =
        'OpenAI quota/billing is not available for this key. Add billing/credits in OpenAI and try again.';
    } else if (response.status === 429) {
      message = 'OpenAI rate limit exceeded. Please retry in a minute.';
    } else if (providerMessage) {
      message = `OCR provider failed: ${response.status} ${providerMessage}`;
    } else if (errorText) {
      message = `OCR provider failed: ${response.status} ${errorText}`;
    }

    const error = new Error(message) as Error & { statusCode?: number };
    error.statusCode = response.status;
    throw error;
  }

  const payload = await response.json();
  const outputText = extractOutputText(payload);
  return JSON.parse(outputText) as T;
}