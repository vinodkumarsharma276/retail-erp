import { PAGINATION_DEFAULT_PAGE, PAGINATION_DEFAULT_PAGE_SIZE, PAGINATION_MAX_PAGE_SIZE } from '@retailerp/shared-utils';

export function parsePagination(query: { page?: string; pageSize?: string }) {
  const page = Math.max(1, parseInt(query.page || String(PAGINATION_DEFAULT_PAGE), 10));
  const pageSize = Math.min(
    PAGINATION_MAX_PAGE_SIZE,
    Math.max(1, parseInt(query.pageSize || String(PAGINATION_DEFAULT_PAGE_SIZE), 10)),
  );
  const skip = (page - 1) * pageSize;

  return { page, pageSize, skip, take: pageSize };
}
