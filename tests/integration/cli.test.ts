import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { ownkey, makeHome } from '../helpers/cli';
import { startMockOllama } from '../helpers/mock-ollama';

const BUGGY = [
    '// demo',
    '',
    'function calculateTotal(items) {',
    '    let total = 0;',
    '    for (let i = 0; i <= items.length; i++) {',
    '        total += items[i].price;',
    '    }',
    '    return total;',
    '}',
    '',
].join('\n');

const FIX_DIFF = [
    '--- a/src/total.js',
    '+++ b/src/total.js',
    '@@ -3,5 +3,5 @@',
    ' function calculateTotal(items) {',
    '     let total = 0;',
    '-    for (let i = 0; i <= items.length; i++) {',
    '+    for (let i = 0; i < items.length; i++) {',
    '         total += items[i].price;',
    '     }',
].join('\n');

const NEW_FILE_DIFF = [
    '--- /dev/null',
    '+++ b/src/total.test.js',
    '@@ -0,0 +1,2 @@',
    "+const { calculateTotal } = require('./total');",
    '+test("sums", () => expect(calculateTotal([{ price: 2 }])).toBe(2));',
].join('\n');

function modelReply() {
    return (
        'Here are my findings:\n```json\n' +
        JSON.stringify([
            { type: 'bug', severity: 'high', content: 'Off-by-one in loop', filePath: 'src/total.js', rationale: 'reads past end', diff: FIX_DIFF },
            { type: 'test', severity: 'low', content: 'Add a test', filePath: 'src/total.test.js', rationale: 'no tests', diff: NEW_FILE_DIFF },
            { type: 'style', severity: 'info', content: 'Advice only', filePath: 'src/total.js', rationale: '', diff: '' },
        ]) +
        '\n```'
    );
}

function storedIds(home: string): { id: string; type: string }[] {
    return JSON.parse(readFileSync(join(home, '.ownkey', 'storage', 'suggestions.json'), 'utf-8'));
}

describe('ownkey CLI', () => {
    let mock: Awaited<ReturnType<typeof startMockOllama>>;
    let home: string;
    let project: string;

    beforeAll(async () => {
        mock = await startMockOllama();
        mock.state.reply = modelReply();
        home = makeHome();
        project = join(home, 'project');
        mkdirSync(join(project, 'src'), { recursive: true });
        writeFileSync(join(project, 'src', 'total.js'), BUGGY);
    });

    afterAll(async () => {
        await mock.close();
    });

    it('keeps plain help for a bare ownkey outside a terminal', async () => {
        const r = await ownkey([], { home });
        expect(r.out).toContain('Usage: ownkey');
        expect(r.out).not.toContain('Tab complete');
    });

    it('prints help and version', async () => {
        const help = (await ownkey(['--help'], { home }));
        expect(help.code).toBe(0);
        for (const cmd of ['config', 'scan', 'suggest', 'apply', 'undo']) expect(help.stdout).toContain(cmd);
        const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
        expect((await ownkey(['--version'], { home })).stdout.trim()).toBe(pkg.version);
    });

    it('config works on a fresh install (no config file yet)', async () => {
        const fresh = makeHome();
        const r = (await ownkey(['config', '--show'], { home: fresh }));
        expect(r.code).toBe(0);
        expect(r.out).not.toContain('No configuration found');
        expect(r.out).toContain('Not configured yet');
    });

    it('config wizard without a terminal explains the flags instead of crashing', async () => {
        const r = (await ownkey(['config'], { home: makeHome() }));
        expect(r.code).toBe(1);
        expect(r.out).toContain('--provider');
        expect(r.out).not.toMatch(/^\s*✗ Configuration failed\s*$/m);
    });

    it('config rejects bad input loudly', async () => {
        const h = makeHome();
        expect((await ownkey(['config', '--provider', 'nope'], { home: h })).out).toContain('Unknown provider');
        const noKey = (await ownkey(['config', '--provider', 'openai'], { home: h }));
        expect(noKey.code).toBe(1);
        expect(noKey.out).toContain('--api-key is required');
        const httpsDb = (await ownkey(['config', '--supabase-url', 'https://abc.supabase.co', '--supabase-key', 'x'], { home: h }));
        expect(httpsDb.code).toBe(1);
        expect(httpsDb.out).toContain('connection string');
    });

    it('config stores provider, key and model', async () => {
        const h = makeHome();
        expect((await ownkey(['config', '--provider', 'gemini', '--api-key', 'test-key-1234', '--model', 'gemini-x'], { home: h })).code).toBe(0);
        const show = (await ownkey(['config', '--show'], { home: h }));
        expect(show.out).toContain('gemini');
        expect(show.out).toContain('gemini-x');
        expect(show.out).toContain('…1234');
        expect(show.out).not.toContain('test-key-1234');
    });

    it('suggest tells an unconfigured user how to set up', async () => {
        const r = (await ownkey(['suggest', '.'], { home: makeHome() }));
        expect(r.code).toBe(1);
        expect(r.out).toContain('No AI provider configured');
    });

    it('local-only mode is quiet about the optional database', async () => {
        const r = (await ownkey(['scan', project], { home }));
        expect(r.code).toBe(0);
        expect(r.out).not.toMatch(/supabase|database/i);
    });

    it('configures ollama and generates suggestions with IDs', async () => {
        const cfg = (await ownkey(['config', '--provider', 'ollama', '--endpoint', mock.url, '--model', 'mock-coder'], { home }));
        expect(cfg.code).toBe(0);

        const r = (await ownkey(['suggest', '.'], { home, cwd: project }));
        expect(r.code).toBe(0);
        expect(r.out).toContain('Off-by-one in loop');
        expect(r.out).toContain('apply-ready');
        expect(r.out).toContain('advice only');
        // Ollama now uses the shared JSON prompt that asks for diffs
        expect(mock.state.requests.at(-1).system).toContain('Unified diff');
        expect(storedIds(home)).toHaveLength(3);
    });

    it('apply with no id lists pending suggestions', async () => {
        const r = (await ownkey(['apply'], { home, cwd: project }));
        expect(r.code).toBe(0);
        expect(r.out).toContain('Pending suggestions');
        expect(r.out).toContain('Off-by-one in loop');
    });

    it('apply --dry-run previews without writing', async () => {
        const id = storedIds(home)[0].id;
        const r = (await ownkey(['apply', id, '--dry-run'], { home, cwd: project }));
        expect(r.code).toBe(0);
        expect(r.out).toContain('+    for (let i = 0; i < items.length; i++) {');
        expect(readFileSync(join(project, 'src', 'total.js'), 'utf-8')).toBe(BUGGY);
    });

    it('apply refuses to write without confirmation when there is no terminal', async () => {
        const id = storedIds(home)[0].id;
        const r = (await ownkey(['apply', id], { home, cwd: project }));
        expect(r.code).toBe(1);
        expect(r.out).toContain('--auto');
        expect(readFileSync(join(project, 'src', 'total.js'), 'utf-8')).toBe(BUGGY);
    });

    it('apply --auto patches the project even when run from another folder, then undo restores it', async () => {
        const id = storedIds(home)[0].id;
        const r = (await ownkey(['apply', id, '--auto'], { home, cwd: home }));
        expect(r.code).toBe(0);
        const patched = readFileSync(join(project, 'src', 'total.js'), 'utf-8');
        expect(patched).toContain('i < items.length');
        expect(patched.split('\n')).toHaveLength(BUGGY.split('\n').length);

        const again = (await ownkey(['apply', id, '--auto'], { home, cwd: project }));
        expect(again.code).toBe(1);
        expect(again.out).toContain('Already applied');

        const list = (await ownkey(['undo', '--list'], { home }));
        expect(list.code).toBe(0);
        const backupId = readdirSync(join(home, '.ownkey', 'backups'))[0];
        expect(list.out).toContain(backupId);

        expect((await ownkey(['undo', backupId], { home })).code).toBe(1); // no terminal, no --yes
        const undo = (await ownkey(['undo', backupId, '--yes'], { home, cwd: home }));
        expect(undo.code).toBe(0);
        expect(readFileSync(join(project, 'src', 'total.js'), 'utf-8')).toBe(BUGGY);
    });

    it('apply creates new files and undo removes them', async () => {
        const id = storedIds(home)[1].id;
        const r = (await ownkey(['apply', id, '--auto'], { home, cwd: project }));
        expect(r.code).toBe(0);
        const created = join(project, 'src', 'total.test.js');
        expect(existsSync(created)).toBe(true);

        const backupId = r.out.match(/ownkey undo (\S+)/)![1];
        expect((await ownkey(['undo', backupId, '--yes'], { home })).code).toBe(0);
        expect(existsSync(created)).toBe(false);
    });

    it('apply on an advice-only suggestion explains why', async () => {
        const id = storedIds(home)[2].id;
        const r = (await ownkey(['apply', id, '--auto'], { home, cwd: project }));
        expect(r.code).toBe(1);
        expect(r.out).toContain('no code change');
    });

    it('apply --all --severity applies only matching pending suggestions', async () => {
        const r = (await ownkey(['apply', '--all', '--severity', 'high', '--auto'], { home, cwd: project }));
        expect(r.code).toBe(0);
        expect(r.out).toContain('Applied: 1');
        expect(readFileSync(join(project, 'src', 'total.js'), 'utf-8')).toContain('i < items.length');
        expect(existsSync(join(project, 'src', 'total.test.js'))).toBe(false);
    });

    it('apply with an unknown id fails cleanly', async () => {
        const r = (await ownkey(['apply', 'local-0-0', '--auto'], { home, cwd: project }));
        expect(r.code).toBe(1);
        expect(r.out).toContain('Suggestion not found');
    });
});
