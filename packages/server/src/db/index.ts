import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config.ts';
import { schema } from './schema.ts';

export const sql = postgres(config.DATABASE_URL, {
    max: 10,
    onnotice: () => {},
});

export const db = drizzle(sql, { schema });

export type Db = typeof db;

export type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
