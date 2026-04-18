-- AlterTable
ALTER TABLE "installments" ADD COLUMN     "is_closed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parent_installment_number" INTEGER,
ADD COLUMN     "sub_sequence" INTEGER;

-- CreateTable
CREATE TABLE "installment_roll_log" (
    "id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "installment_id" TEXT,
    "event_type" VARCHAR(40) NOT NULL,
    "event_date" DATE NOT NULL,
    "display_message" TEXT NOT NULL,
    "metadata" JSONB,
    "actor_user_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installment_roll_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "installment_roll_log_schedule_id_event_date_idx" ON "installment_roll_log"("schedule_id", "event_date");

-- CreateIndex
CREATE INDEX "installment_roll_log_installment_id_idx" ON "installment_roll_log"("installment_id");

-- CreateIndex
CREATE INDEX "installment_roll_log_event_type_idx" ON "installment_roll_log"("event_type");

-- CreateIndex
CREATE INDEX "installments_is_closed_idx" ON "installments"("is_closed");

-- AddForeignKey
ALTER TABLE "installment_roll_log" ADD CONSTRAINT "installment_roll_log_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "installment_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_roll_log" ADD CONSTRAINT "installment_roll_log_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installment_roll_log" ADD CONSTRAINT "installment_roll_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
