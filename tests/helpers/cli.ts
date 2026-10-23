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
        const timer = setTimeout(() => child.kill('SIGKILL'), 25000);
        child.on('error', reject);
        child.on('close', (code) => {
            clearTimeout(timer);
            resolvePromise({ code, stdout, stderr, out: `${stdout}\n${stderr}` });
        });
    });
}
