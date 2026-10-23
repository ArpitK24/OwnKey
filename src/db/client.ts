import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DatabaseError } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { configManager } from '../config/manager.js';
import * as schema from './schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class DatabaseClient {
    private sql: postgres.Sql | null = null;
    private db: ReturnType<typeof drizzle> | null = null;
    private isLocalOnly: boolean = false;
    private isDisconnecting: boolean = false;

    async connect(localOnly: boolean = false): Promise<void> {
        if (localOnly) {
            this.isLocalOnly = true;
            logger.verbose('Running in local-only mode (--local-only)');
            return;
        }

        const config = await configManager.load();
        const url = configManager.getDatabaseUrl(config);

        if (!url) {
            this.isLocalOnly = true;
            // Database is optional: stay silent unless an old, unusable config is present.
            if (config.supabaseUrl) {
                logger.warn(
                    'Database skipped: OwnKey needs your Postgres connection string, not the Supabase project URL.'
                );
                logger.info('Fix: ownkey config --database-url "postgresql://..."  (Supabase → Connect)');
            } else {
                logger.verbose('No database configured, using local storage');
            }
            return;
        }

        try {
            const isLocalHost = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
            this.sql = postgres(url, {
                max: 1,
                idle_timeout: 20,
                connect_timeout: 10,
                prepare: false, // required by Supabase's transaction pooler (port 6543)
                ssl: isLocalHost || /sslmode=disable/.test(url) ? false : 'require',
                onnotice: () => {},
            });
            this.db = drizzle(this.sql, { schema });

            await this.sql`SELECT 1`;
            logger.verbose('Database connection established');

            await this.runMigrations();
        } catch (error) {
            const e = error as any;
            const message =
                e?.message || e?.code || e?.errors?.[0]?.message || e?.errors?.[0]?.code || String(error);
            logger.warn(`Database unavailable (${message}). Using local storage.`);
            logger.debug(`Database error: ${error instanceof Error ? error.stack : message}`);
            try {
                await this.sql?.end({ timeout: 1 });
            } catch {
                // ignore
            }
            this.isLocalOnly = true;
            this.sql = null;
            this.db = null;
        }
    }

    async disconnect(): Promise<void> {
        try {
            if (this.sql && !this.isDisconnecting) {
                this.isDisconnecting = true;
                await this.sql.end();
                this.sql = null;
                this.db = null;
                this.isDisconnecting = false;
                logger.verbose('Database connection closed');
            }
        } catch (error) {
            // Ignore errors during disconnect
            this.isDisconnecting = false;
            logger.verbose(`Error during disconnect: ${(error as Error).message}`);
        }
    }

    getDb(): ReturnType<typeof drizzle> {
        if (this.isLocalOnly) {
            throw new DatabaseError('Database not available in local-only mode');
        }
        if (!this.db) {
            throw new DatabaseError('Database not connected');
        }
        return this.db;
    }

    isConnected(): boolean {
        return this.db !== null && !this.isLocalOnly;
    }

    isLocalOnlyMode(): boolean {
        return this.isLocalOnly;
    }

    getClient(): ReturnType<typeof postgres> | null {
        return this.sql;
    }

    /**
     * Apply every migrations/NNN_name.sql that has not been recorded in schema_migrations.
     * Each migration runs in its own transaction together with its version record.
     */
    private async runMigrations(): Promise<void> {
        if (!this.sql) {
            return;
        }
        const sql = this.sql;

        await sql`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT NOW() NOT NULL
            )
        `;
        const rows = await sql`SELECT version FROM schema_migrations`;
        const applied = new Set(rows.map((r) => Number(r.version)));

        for (const migration of await DatabaseClient.listMigrations()) {
            if (applied.has(migration.version)) continue;
            logger.verbose(`Applying database migration ${migration.file}`);
            const body = await readFile(migration.path, 'utf-8');
            try {
                await sql.begin(async (tx) => {
                    await tx.unsafe(body);
                    await tx.unsafe(
                        'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
                        [migration.version]
                    );
                });
            } catch (error) {
                throw new DatabaseError(
                    `Migration ${migration.file} failed: ${(error as Error).message}`,
                    error
                );
            }
        }
    }

    static async listMigrations(): Promise<{ version: number; file: string; path: string }[]> {
        const dir = join(__dirname, 'migrations');
        const files = await readdir(dir);
        return files
            .map((file) => ({ file, match: /^(\d+)_.+\.sql$/.exec(file) }))
            .filter((f) => f.match)
            .map((f) => ({ version: Number(f.match![1]), file: f.file, path: join(dir, f.file) }))
            .sort((a, b) => a.version - b.version);
    }
}

export const dbClient = new DatabaseClient();
