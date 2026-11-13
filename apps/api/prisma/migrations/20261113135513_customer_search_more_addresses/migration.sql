-- AlterTable
ALTER TABLE "customer_search_entries" ADD COLUMN     "co_address" VARCHAR(500),
ADD COLUMN     "co_more_addresses" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "more_addresses" TEXT[] DEFAULT ARRAY[]::TEXT[];
