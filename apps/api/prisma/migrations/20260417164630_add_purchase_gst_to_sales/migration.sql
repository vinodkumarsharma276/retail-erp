-- AlterTable
ALTER TABLE "sale_records" ADD COLUMN     "purchase_gst_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "purchase_price" DECIMAL(12,2) NOT NULL DEFAULT 0;
