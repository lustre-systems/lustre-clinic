/**
 * `@lustre/shared` holds what tRPC inference cannot provide (SPEC §3): the
 * `ERROR_CODE` enum, domain enums, constants, and any Zod schema used by both
 * sides.
 *
 * Request and response types are NOT written here. They flow from the inferred
 * `AppRouter` type, which the app imports from the server package.
 */
export * from './clinicTime.ts';
export { BUNDLED_CLINIC_ZONE } from './clinicZone.bundled.ts';
export * from './constants.ts';
export * from './dates.ts';
export * from './enums.ts';
export * from './errors.ts';
export * from './grant.ts';
export * from './labels.ts';
export * from './locale.ts';
export * from './reminder.ts';
