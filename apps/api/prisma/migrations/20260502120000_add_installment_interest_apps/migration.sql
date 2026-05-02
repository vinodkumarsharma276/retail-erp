-- CreateTable: discretionary overdue-interest penalties applied to installments
CREATE TABLE "installment_interest_applications" (
    "id" TEXT NOT NULL,
    "installment_id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "days_overdue" INTEGER NOT NULL,
    "daily_rate" DECIMAL(8,6) NOT NULL,
    "base_amount" DECIMAL(12,2) NOT NULL,
    "applied_amount" DECIMAL(12,2) NOT NULL,
    "applied_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_by" TEXT NOT NULL,
    "notes" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "rolled_back_by" TEXT,
    "rollback_reason" TEXT,

    CONSTRAINT "installment_interest_applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "installment_interest_applications_installment_id_idx"
    ON "installment_interest_applications"("installment_id");
CREATE INDEX "installment_interest_applications_schedule_id_idx"
    ON "installment_interest_applications"("schedule_id");
CREATE INDEX "installment_interest_applications_rolled_back_at_idx"
    ON "installment_interest_applications"("rolled_back_at");

ALTER TABLE "installment_interest_applications"
    ADD CONSTRAINT "installment_interest_applications_installment_id_fkey"
    FOREIGN KEY ("installment_id") REFERENCES "installments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "installment_interest_applications"
    ADD CONSTRAINT "installment_interest_applications_schedule_id_fkey"
    FOREIGN KEY ("schedule_id") REFERENCES "installment_schedules"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "installment_interest_applications"
    ADD CONSTRAINT "installment_interest_applications_applied_by_fkey"
    FOREIGN KEY ("applied_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "installment_interest_applications"
    ADD CONSTRAINT "installment_interest_applications_rolled_back_by_fkey"
    FOREIGN KEY ("rolled_back_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
