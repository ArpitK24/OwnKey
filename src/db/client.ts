import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readFile } from 'fs/promises';
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
            logger.info('Running in local-only mode (no database persistence)');
            return;
        }

        try {
            const config = await configManager.load();

            if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
                logger.warn('Supabase not configured. Running in local-only mode.');
                logger.info('Run "ownkey config" to set up database persistence.');
                this.isLocalOnly = true;
                return;
            }

            // Extract database details from Supabase URL
            // Format: https://PROJECT_REF.supabase.co
            const supabaseUrl = new URL(config.supabaseUrl);
            const projectRef = supabaseUrl.hostname.split('.')[0];

            // Construct PostgreSQL connection string
            // Format: postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres
            const connectionString = `postgresql://postgres:${config.supabaseServiceRoleKey}@db.${projectRef}.supabase.co:5432/postgres`;

            this.sql = postgres(connectionString, {
                max: 10,
                idle_timeout: 20,
                connect_timeout: 10,
            });

            this.db = drizzle(this.sql, { schema });

            // Test connection
            await this.sql`SELECT 1`;
            logger.verbose('Database connection established');

            // Run migrations
            await this.runMigrations();
        } catch (error) {
            logger.warn('Failed to connect to database. Running in local-only mode.');
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(`Database error details: ${errorMessage}`);
            if (error instanceof Error && error.stack) {
                logger.debug('Stack trace:', error.stack);
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

    private async runMigrations(): Promise<void> {
        if (!this.sql) {
            return;
        }

        try {
            logger.verbose('Checking database migrations...');

            // Check if migrations table exists
            const tableCheck = await this.sql`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public'
                    AND table_name = 'schema_migrations'
                ) as exists;
            `;

            const tableExists = tableCheck[0]?.exists === true;
            logger.debug(`schema_migrations table exists: ${tableExists}`);

            if (!tableExists) {
                logger.info('Initializing database schema...');
                await this.runMigration(1);
                logger.success('Database schema initialized');
                return;
            }

            // Check current version
            const versionCheck = await this.sql`
                SELECT MAX(version) as version FROM schema_migrations;
            `;

            const version = versionCheck[0]?.version || 0;
            logger.verbose(`Current schema version: ${version}`);

            // Run pending migrations
            const latestVersion = 1; // Update this as we add more migrations
            if (version < latestVersion) {
                for (let v = version + 1; v <= latestVersion; v++) {
                    await this.runMigration(v);
                    logger.success(`Applied migration ${v}`);
                }
            } else {
                logger.verbose('Database schema is up to date');
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error(`Migration error: ${errorMsg}`);
            if (error instanceof Error && error.stack) {
                logger.debug(`Migration stack: ${error.stack}`);
            }
            throw new DatabaseError('Failed to run migrations', error);
        }
    }

    private async runMigration(version: number): Promise<void> {
        if (!this.sql) {
            return;
        }

        const migrationFile = join(__dirname, 'migrations', `${String(version).padStart(3, '0')}_init.sql`);
        logger.verbose(`Running migration file: ${migrationFile}`);

        try {
            const migrationSql = await readFile(migrationFile, 'utf-8');
            logger.debug(`Migration SQL length: ${migrationSql.length} characters`);
            await this.sql.unsafe(migrationSql);
            logger.verbose(`Migration ${version} applied successfully`);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error(`Migration ${version} failed: ${errorMsg}`);
            if (error instanceof Error && error.stack) {
                logger.debug(`Migration ${version} stack: ${error.stack}`);
            }
            throw new DatabaseError(`Failed to apply migration ${version}`, error);
        }
    }
}

export const dbClient = new DatabaseClient();
