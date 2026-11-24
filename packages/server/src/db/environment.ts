import type postgres from 'postgres';

export type DatabaseEnvironment = 'production' | 'development' | 'unmarked';

export async function databaseEnvironment(client: postgres.Sql): Promise<DatabaseEnvironment> {
    const [row] = await client<{ value: string | null }[]>`
        SELECT current_setting('lustre.environment', true) AS value
    `;
    const value = row?.value?.trim();
    if (value === 'production') return 'production';
    if (value === 'development') return 'development';
    return 'unmarked';
}

export async function refuseProduction(client: postgres.Sql, action: string): Promise<void> {
    if ((await databaseEnvironment(client)) === 'production') {
        throw new Error(`refusing to ${action}: this is the production database`);
    }
}
