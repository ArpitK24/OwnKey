import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ownkey, makeHome } from '../helpers/cli';
import { startMockOllama } from '../helpers/mock-ollama';

// The mock answers every case the same way: one high-severity bug on line 3 of src/cart.js.
const reply = JSON.stringify([
    {
        type: 'bug',
        severity: 'high',
        content: 'Loop reads past the end of items',
        filePath: 'src/cart.js',
        rationale: 'i <= items.length',
        diff: ['--- a/src/cart.js', '+++ b/src/cart.js', '@@ -1,4 +1,4 @@', ' export function subtotal(items) {', '     let total = 0;', '-    for (let i = 0; i <= items.length; i++) {', '+    for (let i = 0; i < items.length; i++) {', '         total += items[i].price * items[i].qty;'].join('\n'),
    },
]);

describe('ownkey bench', () => {
    let mock: Awaited<ReturnType<typeof startMockOllama>>;
    let home: string;

    beforeAll(async () => {
        mock = await startMockOllama();
        mock.state.reply = reply;
        home = makeHome();
        const cfg = await ownkey(['config', '--provider', 'ollama', '--endpoint', mock.url, '--model', 'mock-coder', '--no-database', '--yes'], { home });
        expect(cfg.code).toBe(0);
    });

    afterAll(async () => {
        await mock.close();
    });

    it('lists cases', async () => {
        const r = await ownkey(['bench', '--list'], { home });
        expect(r.code).toBe(0);
        expect(r.stdout).toContain('off-by-one');
        expect(r.stdout).toContain('control');
    });

    it('scores a catch, a miss, and a flagged control', async () => {
        const r = await ownkey(['bench', '--case', 'off-by-one,sql-injection,clean-refactor', '--format', 'json'], { home });
        expect(r.code).toBe(0);
        const report = JSON.parse(r.stdout);
        const byId = Object.fromEntries(report.results.map((x: any) => [x.id, x]));
        expect(byId['off-by-one'].caught).toBe(true);
        expect(byId['sql-injection'].caught).toBe(false);
        expect(byId['clean-refactor'].noise).toBe(1);
        expect(report.summary).toMatchObject({ bugCases: 2, caught: 1, controlsFlagged: 1 });
        expect(report.model).toBe('ollama/mock-coder');
        expect(mock.state.requests.length).toBe(3);
        // The model sees the planted change as the review focus
        expect(mock.state.requests[0].prompt).toContain('i <= items.length');
    });

    it('gates on --min-recall and writes markdown', async () => {
        const out = join(home, 'bench.md');
        const r = await ownkey(['bench', '--case', 'off-by-one,sql-injection', '--format', 'markdown', '--output', out, '--min-recall', '0.9'], { home });
        expect(r.code).toBe(1);
        expect(readFileSync(out, 'utf-8')).toContain('Recall 50%');
    });

    it('rejects unknown cases', async () => {
        const r = await ownkey(['bench', '--case', 'nope'], { home });
        expect(r.code).toBe(2);
        expect(r.out).toContain('Unknown case');
    });
});
