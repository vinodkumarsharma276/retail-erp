import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify';

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  request.log.error(error);

  if (error.validation) {
    return reply.status(400).send({
      success: false,
      error: 'Validation error',
      details: error.validation,
    });
  }

  const statusCode = error.statusCode || 500;
  return reply.status(statusCode).send({
    success: false,
    error: statusCode === 500 ? 'Internal server error' : error.message,
  });
}
