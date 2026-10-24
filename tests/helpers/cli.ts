import { spawn } from 'child_process';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';

const ROOT = resolve(__dirname, '..', '..');
const ENTRY = join(ROOT, 'src', 'index.ts');
// Resolve tsx from the repo so the CLI can run from any cwd
const TSX = pathToFileURL(createRequire(join(ROOT, 'package.json')).resolve('tsx')).href;
// Generous: CI runners and busy laptops can be slow to start a TypeScript process.
const SPAWN_TIMEOUT_MS = Number(process.env.OWNKEY_TEST_SPAWN_TIMEOUT_MS) || 60_000;

export function makeHome(): string {
    const home = mkdtempSync(join(tmpdir(), 'ownkey-home-'));
    mkdirSync(home, { recursive: true });
    return home;
}

/** Run the CLI from source (via tsx) with an isolated HOME and no terminal. */
export function ownkey(
    args: string[],
    opts: { home: string; cwd?: string; input?: string }
): Promise<{ code: number | null; stdout: string; stderr: string; out: string }> {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(process.execPath, ['--import', TSX, ENTRY, ...args], {
            cwd: opts.cwd ?? opts.home,
            env: {
                ...process.env,
                HOME: opts.home,
                USERPROFILE: opts.home,
                OWNKEY_NO_KEYCHAIN: '1',
                FORCE_COLOR: '0',
                NO_COLOR: '1',
            },
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d));
        child.stderr.on('data', (d) => (stderr += d));
        child.stdin.end(opts.input ?? '');
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, SPAWN_TIMEOUT_MS);
        child.on('error', reject);
        child.on('close', (code) => {
            clearTimeout(timer);
            // Say so plainly instead of surfacing a bare `code: null`
            if (timedOut) stderr += `\n[test helper] ownkey ${args.join(' ')} was killed after ${SPAWN_TIMEOUT_MS / 1000}s\n`;
            resolvePromise({ code, stdout, stderr, out: `${stdout}\n${stderr}` });
        });
    });
}
