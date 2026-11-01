-- Hand-written, like 0025. A visit can ask for several procedures next time, so
-- they move off `visits` into their own table. The booking that takes them
-- stays on the visit (`next_appointment_id`): one booking takes them all.
--
-- `next_procedure_id` and `next_procedure_tooth` are copied and left in place,
-- not dropped: the server this deploy replaces keeps answering while it
-- migrates, and it still selects them. A later migration drops them.
CREATE TABLE IF NOT EXISTS "visit_next_procedures" (
    "id" uuid PRIMARY KEY,
    "visit_id" uuid NOT NULL REFERENCES "visits"("id") ON DELETE CASCADE,
    "procedure_id" uuid NOT NULL REFERENCES "procedure_types"("id"),
    "tooth" text,
    "sort_order" integer NOT NULL DEFAULT 0
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_next_procedures_visit_id_idx" ON "visit_next_procedures" ("visit_id");--> statement-breakpoint
INSERT INTO "visit_next_procedures" ("id", "visit_id", "procedure_id", "tooth", "sort_order")
SELECT gen_random_uuid(), "id", "next_procedure_id", "next_procedure_tooth", 0
FROM "visits"
WHERE "next_procedure_id" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "visit_next_procedures" WHERE "visit_id" = "visits"."id");--> statement-breakpoint
ALTER TABLE "visits" DROP CONSTRAINT IF EXISTS "visits_next_procedure_set";
