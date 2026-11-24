import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    dialect: 'postgresql',
    schema: './src/db/schema.ts',
    out: './src/db/migrations',
    dbCredentials: {
        url: process.env.DATABASE_URL ?? 'postgres://lustre:lustre@localhost:5432/lustre',
    },
    casing: 'snake_case',
    verbose: true,
    strict: true,
});
