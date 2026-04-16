import type { FastifyReply } from 'fastify';

export function sendSuccess<T>(reply: FastifyReply, data: T, statusCode = 200) {
  return reply.status(statusCode).send({ success: true, data });
}

export function sendError(reply: FastifyReply, error: string, statusCode = 400) {
  return reply.status(statusCode).send({ success: false, error });
}

export function sendPaginated<T>(
  reply: FastifyReply,
  data: T[],
  pagination: { page: number; pageSize: number; totalItems: number },
) {
  return reply.status(200).send({
    success: true,
    data,
    pagination: {
      ...pagination,
      totalPages: Math.ceil(pagination.totalItems / pagination.pageSize),
    },
  });
}
