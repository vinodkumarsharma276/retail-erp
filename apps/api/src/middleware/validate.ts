import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ZodSchema, ZodError } from 'zod';

/**
 * Creates a Fastify preHandler that validates request.body against a Zod schema.
 * Returns 400 with structured errors if validation fails.
 */
export function validate(schema: ZodSchema) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const result = schema.safeParse(request.body);

    if (!result.success) {
      const zodError = result.error as ZodError;
      const errors = zodError.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));

      return reply.status(400).send({
        success: false,
        error: 'Validation error',
        details: errors,
      });
    }

    // Replace body with parsed/transformed data
    request.body = result.data;
  };
}
