import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import postgres from 'postgres';
import { ownkey, makeHome } from '../helpers/cli';
import { startMockOllama } from '../helpers/mock-ollama';

/**
 * Optional: runs only when OWNKEY_TEST_DATABASE_URL points at a disposable Postgres
 * (e.g. a local Supabase, or `npx @electric-sql/pglite-socket` style server).
 */
const DB_URL = process.env.OWNKEY_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)('optional database (Supabase/Postgres)', () => {
    let mock: Awaited<ReturnType<typeof startMockOllama>>;
    const home = makeHome();
    const project = join(home, 'p');

    beforeAll(async () => {
        mock = await startMockOllama();
        mock.state.reply = JSON.stringify([
            {
                type: 'bug',
                severity: 'high',
                content: 'fix',
                filePath: 'a.js',
                rationale: '',
                diff: '--- a/a.js\n+++ b/a.js\n@@ -1,1 +1,1 @@\n-let x = 1\n+const x = 1',
            },
        ]);
        mkdirSync(project, { recursive: true });
        writeFileSync(join(project, 'a.js'), 'let x = 1\n');
        await ownkey(['config', '--provider', 'ollama', '--endpoint', mock.url], { home });
        await ownkey(['config', '--database-url', DB_URL!], { home });
    });

    afterAll(async () => mock.close());

    it('migrates, stores suggestions and records apply + undo', async () => {
        const s = await ownkey(['suggest', '.'], { home, cwd: project });
        expect(s.code).toBe(0);
        expect(s.out).not.toMatch(/Database unavailable/);

        const stored = JSON.parse(readFileSync(join(home, '.ownkey', 'storage', 'suggestions.json'), 'utf-8'));
        const last = stored[stored.length - 1];
        expect(last.dbId).toMatch(/^[0-9a-f-]{36}$/);

        expect((await ownkey(['apply', last.id, '--auto'], { home, cwd: project })).code).toBe(0);
        const backupId = readdirSync(join(home, '.ownkey', 'backups'))[0];
        expect((await ownkey(['undo', backupId, '--yes'], { home })).code).toBe(0);

        const sql = postgres(DB_URL!, { ssl: /localhost|127\.0\.0\.1/.test(DB_URL!) ? false : 'require', max: 1 });
        try {
            const versions = (await sql`select version from schema_migrations order by version`).map((r) => r.version);
            expect(versions).toEqual(expect.arrayContaining([1, 2]));
            const [row] = await sql`select status from applies where suggestion_id = ${last.dbId}`;
            expect(row.status).toBe('rolled_back');
        } finally {
            await sql.end();
        }
    });
});
