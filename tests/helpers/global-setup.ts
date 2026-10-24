import { spawnSync } from 'child_process';
import { join, resolve } from 'path';
import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

/**
 * Warm up tsx once before any test runs. The first tsx start on a fresh machine
 * (CI right after `npm ci`) can take tens of seconds while it fills its compile cache;
 * paying that here keeps it out of individual test timeouts.
 */
export default function setup(): void {
    const root = resolve(__dirname, '..', '..');
    const tsx = pathToFileURL(createRequire(join(root, 'package.json')).resolve('tsx')).href;
    const home = mkdtempSync(join(tmpdir(), 'ownkey-warmup-'));
    spawnSync(process.execPath, ['--import', tsx, join(root, 'src', 'index.ts'), '--version'], {
        env: { ...process.env, HOME: home, USERPROFILE: home, OWNKEY_NO_KEYCHAIN: '1' },
        stdio: 'ignore',
        timeout: 180_000,
    });
}
