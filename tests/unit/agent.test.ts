import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AIProvider, type ChatMessage } from '../../src/ai/provider';
import { RepoTools, readCalls, readFindings, runAgentReview } from '../../src/core/review/agent';

class ScriptedProvider extends AIProvider {
    calls: ChatMessage[][] = [];
    constructor(private replies: string[]) {
        super(undefined, 'scripted');
    }
    getDefaultModel() {
        return 'scripted';
    }
    async testConnection() {
        return true;
    }
    async chat(_system: string, messages: ChatMessage[]) {
        this.calls.push(messages.map((m) => ({ ...m })));
        return this.replies.length > 1 ? this.replies.shift()! : this.replies[0];
    }
}

const FINDING = { type: 'bug', severity: 'high', content: 'order may be undefined', filePath: 'src/checkout.ts', rationale: 'findOrder returns undefined', diff: '' };
const ctx = { files: [], projectInfo: { name: 'p', rootPath: '/p', fileCount: 0 }, reviewPatch: '+x' } as any;

describe('review agent', () => {
    let repo: string;
    let tools: RepoTools;

    beforeAll(() => {
        repo = mkdtempSync(join(tmpdir(), 'ownkey-agent-'));
        mkdirSync(join(repo, 'src', 'lib'), { recursive: true });
        writeFileSync(join(repo, 'src', 'orders.ts'), ['export function findOrder(id: string) {', '    return orders.get(id);', '}', ''].join('\n'));
        writeFileSync(join(repo, 'src', 'checkout.ts'), 'old\n');
        writeFileSync(join(repo, 'src', 'lib', 'util.ts'), 'export const big = 1;\n'.repeat(500));
        writeFileSync(join(repo, '.env'), 'SECRET=1\n');
        execFileSync('git', ['init', '-q'], { cwd: repo });
        execFileSync('git', ['add', '.'], { cwd: repo });
        execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'i'], { cwd: repo });
        writeFileSync(join(repo, 'src', 'checkout.ts'), 'const o = findOrder(id);\nreturn o.total;\n');
        tools = new RepoTools(repo, { kind: 'working' }, ['src/orders.ts', 'src/checkout.ts', 'src/lib/util.ts'], new Set(['src/checkout.ts']));
    });

    afterAll(() => rmSync(repo, { recursive: true, force: true }));

    it('reads files with line numbers, within the allowed set only', () => {
        expect(tools.readFile('src/orders.ts')).toContain('    2      return orders.get(id);');
        expect(tools.readFile('./src/checkout.ts')).toContain('o.total');
        expect(tools.readFile('.env')).toContain('not an available file');
        expect(tools.readFile('../../etc/passwd')).toContain('not an available file');
        expect(tools.readFile('orders.ts')).toContain('Did you mean: src/orders.ts');
        const long = tools.readFile('src/lib/util.ts');
        expect(long).toContain('lines 1-300');
        expect(long).toContain('start=301');
        expect(tools.readFile('src/lib/util.ts', 499, 900)).toContain('lines 499-500');
    });

    it('searches and lists', () => {
        expect(tools.search('findOrder\\(')).toBe('src/checkout.ts:1: const o = findOrder(id);\nsrc/orders.ts:1: export function findOrder(id: string) {');
        expect(tools.search('findOrder(', 'src/orders.ts')).toContain('src/orders.ts:1:');
        expect(tools.search('nothing-here')).toContain('No matches');
        expect(tools.search('big', 'src/lib')).toContain('stopped at 40 matches');
        expect(tools.listFiles('src/lib')).toBe('src/lib/util.ts');
        expect(tools.listFiles()).not.toContain('.env');
    });

    it('understands the reply shapes models use', () => {
        expect(readCalls({ calls: [{ tool: 'search', pattern: 'x' }] })).toHaveLength(1);
        expect(readCalls({ tool: 'read_file', path: 'a' })).toHaveLength(1);
        expect(readCalls({ tool_calls: [{ name: 'list_files' }] })).toHaveLength(1);
        expect(readCalls([{ type: 'bug' }])).toBeNull();
        expect(readFindings({ findings: [] })).toEqual([]);
        expect(readFindings([FINDING])).toHaveLength(1);
        expect(readFindings({ calls: [] })).toBeNull();
    });

    it('investigates, then reports', async () => {
        const provider = new ScriptedProvider([JSON.stringify({ calls: [{ tool: 'search', pattern: 'findOrder' }, { tool: 'read_file', path: 'src/orders.ts' }] }), JSON.stringify({ findings: [FINDING] })]);
        const steps: string[] = [];
        const result = await runAgentReview(provider, ctx, tools, { onStep: (s) => steps.push(s.label) });
        expect(result.suggestions).toHaveLength(1);
        expect(result.suggestions[0].filePath).toBe('src/checkout.ts');
        expect(steps).toEqual(['search /findOrder/', 'read src/orders.ts']);
        const toolTurn = provider.calls[1].at(-1)!;
        expect(toolTurn.role).toBe('user');
        expect(toolTurn.content).toContain('return orders.get(id);');
        expect(toolTurn.content).toContain('5 tool round(s) left');
    });

    it('accepts a plain findings array straight away', async () => {
        const provider = new ScriptedProvider([JSON.stringify([FINDING])]);
        const result = await runAgentReview(provider, ctx, tools);
        expect(result.steps).toHaveLength(0);
        expect(provider.calls).toHaveLength(1);
    });

    it('nudges once on an invalid reply, then reports', async () => {
        const provider = new ScriptedProvider(['let me think about it', '{"findings": []}']);
        const result = await runAgentReview(provider, ctx, tools);
        expect(result.suggestions).toEqual([]);
        expect(provider.calls[1].at(-1)!.content).toContain('not a valid reply');
    });

    it('caps tool rounds and calls per round', async () => {
        const many = JSON.stringify({ calls: Array.from({ length: 6 }, () => ({ tool: 'list_files' })) });
        const provider = new ScriptedProvider([many, many, '{"findings": []}']);
        const result = await runAgentReview(provider, ctx, tools, { maxSteps: 1 });
        expect(result.steps).toHaveLength(4);
        expect(provider.calls[1].at(-1)!.content).toContain('Only the first 4 calls were run');
        expect(provider.calls[2].at(-1)!.content).toContain('No more tool calls');
    });

    it('gives up with a clear error when the model never answers', async () => {
        const provider = new ScriptedProvider([JSON.stringify({ calls: [{ tool: 'list_files' }] })]);
        await expect(runAgentReview(provider, ctx, tools, { maxSteps: 2 })).rejects.toThrow('--quick');
    });
});
