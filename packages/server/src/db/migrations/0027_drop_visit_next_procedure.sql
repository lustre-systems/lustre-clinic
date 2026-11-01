-- Hand-written, like 0026. The single next procedure's columns from 0024,
-- unread since 0026 copied them into `visit_next_procedures`. The server this
-- deploy replaces (1.10.1) no longer selects them, so they can go.
ALTER TABLE "visits" DROP COLUMN IF EXISTS "next_procedure_id";--> statement-breakpoint
ALTER TABLE "visits" DROP COLUMN IF EXISTS "next_procedure_tooth";
