-- AlterTable: store per-user preferences as JSONB on users
ALTER TABLE "users" ADD COLUMN "preferences" JSONB;
