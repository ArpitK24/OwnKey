import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ownkey, makeHome } from '../helpers/cli';
import { startMockOllama } from '../helpers/mock-ollama';

const CLEAN = ['function calculateTotal(items) {', '    let total = 0;', '    for (let i = 0; i < items.length; i++) {', '        total += items[i].price;', '    }', '    return total;', '}', ''].join('\n');
const BUGGY = CLEAN.replace('i < items.length', 'i <= items.length');
const FIX = [
    '--- a/src/total.js',
    '+++ b/src/total.js',
    '@@ -1,5 +1,5 @@',
    ' function calculateTotal(items) {',
    '     let total = 0;',
    '-    for (let i = 0; i <= items.length; i++) {',
    '+    for (let i = 0; i < items.length; i++) {',
    '         total += items[i].price;',
    '     }',
].join('\n');

const reply = JSON.stringify([
    { type: 'bug', severity: 'high', content: 'Off-by-one in loop', filePath: 'src/total.js', rationale: 'reads past end', diff: FIX },
    { type: 'style', severity: 'low', content: 'Outside the change', filePath: 'src/untouched.js', rationale: '', diff: '' },
]);

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf-8' });

describe('ownkey review', () => {
    let mock: Awaited<ReturnType<typeof startMockOllama>>;
    let home: string;
    let repo: string;

    beforeAll(async () => {
        mock = await startMockOllama();
        mock.state.reply = reply;
        home = makeHome();
        repo = join(home, 'repo');
        mkdirSync(join(repo, 'src'), { recursive: true });
        writeFileSync(join(repo, 'src', 'total.js'), CLEAN);
        writeFileSync(join(repo, 'src', 'untouched.js'), 'export const x = 1;\n');
        git(repo, 'init', '-q', '-b', 'main');
        git(repo, 'config', 'user.email', 't@t');
        git(repo, 'config', 'user.name', 't');
        git(repo, 'add', '.');
        git(repo, 'commit', '-qm', 'init');
        const cfg = await ownkey(['config', '--provider', 'ollama', '--endpoint', mock.url, '--model', 'mock-coder', '--no-database', '--yes'], { home });
        expect(cfg.code).toBe(0);
    });

    afterAll(async () => {
        await mock.close();
    });

    it('reports nothing when there are no changes', async () => {
        const r = await ownkey(['review'], { home, cwd: repo });
        expect(r.code).toBe(0);
        expect(r.out).toContain('Nothing to review');
        expect(mock.state.requests.length).toBe(0);
    });

    it('reviews uncommitted changes and keeps findings to changed files', async () => {
        writeFileSync(join(repo, 'src', 'total.js'), BUGGY);
        const r = await ownkey(['review', '--format', 'json'], { home, cwd: repo });
        expect(r.code).toBe(0);
        const report = JSON.parse(r.stdout);
        expect(report.scope).toBe('uncommitted changes');
        expect(report.findings).toHaveLength(1);
        expect(report.findings[0]).toMatchObject({ filePath: 'src/total.js', severity: 'high', line: 3 });
        const prompt = mock.state.requests.at(-1).prompt as string;
        expect(prompt).toContain('Changes Under Review');
        expect(prompt).not.toContain('untouched.js');
    });

    it('writes valid SARIF for staged changes and fails CI on --fail-on', async () => {
        git(repo, 'add', 'src/total.js');
        const r = await ownkey(['review', '--staged', '--format', 'sarif', '--fail-on', 'high'], { home, cwd: repo });
        expect(r.code).toBe(1);
        const sarif = JSON.parse(r.stdout);
        expect(sarif.version).toBe('2.1.0');
        const result = sarif.runs[0].results[0];
        expect(result.ruleId).toBe('ownkey/bug');
        expect(result.level).toBe('error');
        expect(result.locations[0].physicalLocation).toEqual({ artifactLocation: { uri: 'src/total.js' }, region: { startLine: 3 } });
    });

    it('reviews a branch against its base as markdown', async () => {
        git(repo, 'checkout', '-qb', 'feature');
        git(repo, 'commit', '-qm', 'bug');
        const r = await ownkey(['review', '--base', 'main', '--format', 'markdown'], { home, cwd: repo });
        expect(r.code).toBe(0);
        expect(r.stdout).toContain('## OwnKey review');
        expect(r.stdout).toMatch(/changes since main/);
        expect(r.stdout).toContain('`src/total.js:3`');
    });

    it('does not duplicate pending suggestions across reviews', async () => {
        const list = await ownkey(['apply', '--project', repo], { home, cwd: repo });
        expect((list.out.match(/local-\d+-\d+/g) || []).length).toBe(1);
    });

    it('apply --verify reverts when the check fails and keeps the change when it passes', async () => {
        const failed = await ownkey(['apply', '--all', '--auto', '--verify', 'node -e "process.exit(3)"'], { home, cwd: repo });
        expect(failed.code).toBe(1);
        expect(failed.out).toContain('reverted');
        expect(readFileSync(join(repo, 'src', 'total.js'), 'utf-8')).toBe(BUGGY);

        const passed = await ownkey(['apply', '--all', '--auto', '--verify', 'node -e "process.exit(0)"'], { home, cwd: repo });
        expect(passed.code).toBe(0);
        expect(readFileSync(join(repo, 'src', 'total.js'), 'utf-8')).toBe(CLEAN);

        const undo = await ownkey(['undo', '--last', '--yes'], { home, cwd: repo });
        expect(undo.code).toBe(0);
        expect(readFileSync(join(repo, 'src', 'total.js'), 'utf-8')).toBe(BUGGY);
    });

    it('explains when run outside a git repository', async () => {
        const r = await ownkey(['review'], { home, cwd: home });
        expect(r.code).toBe(2);
        expect(r.out).toContain('Not a git repository');
    });
});
