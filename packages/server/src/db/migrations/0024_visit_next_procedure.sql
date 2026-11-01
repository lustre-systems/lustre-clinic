-- Hand-written, like 0023. What the doctor wants done at the patient's next
-- visit, and the booking that took it. Null `next_appointment_id` with a
-- procedure set means the next booking has not been made yet.
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "next_procedure_id" uuid REFERENCES "procedure_types"("id");--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "next_procedure_tooth" text;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN IF NOT EXISTS "next_appointment_id" uuid REFERENCES "appointments"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "visits" DROP CONSTRAINT IF EXISTS "visits_next_procedure_set";--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_next_procedure_set" CHECK ("next_procedure_id" IS NOT NULL OR ("next_procedure_tooth" IS NULL AND "next_appointment_id" IS NULL));
