-- Hand-written, like 0023. What a procedure costs the clinic, for the stats
-- screen's profit. Zero is "no cost entered", which is what every visit before
-- this counts as.
ALTER TABLE "procedure_types" ADD COLUMN IF NOT EXISTS "cost" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "procedure_types" DROP CONSTRAINT IF EXISTS "procedure_types_cost_non_negative";--> statement-breakpoint
ALTER TABLE "procedure_types" ADD CONSTRAINT "procedure_types_cost_non_negative" CHECK ("procedure_types"."cost" >= 0);--> statement-breakpoint
ALTER TABLE "visit_procedures" ADD COLUMN IF NOT EXISTS "unit_cost" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "visit_procedures" DROP CONSTRAINT IF EXISTS "visit_procedures_unit_cost_non_negative";--> statement-breakpoint
ALTER TABLE "visit_procedures" ADD CONSTRAINT "visit_procedures_unit_cost_non_negative" CHECK ("visit_procedures"."unit_cost" >= 0);
