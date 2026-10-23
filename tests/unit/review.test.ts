import { describe, it, expect } from 'vitest';
import { parseChangedLines } from '../../src/core/review/git';
import { anchorLine, sortFindings, toSarif, toMarkdown } from '../../src/core/review/report';
import { isOpenAIReasoningModel, DEFAULT_MODELS } from '../../src/config/models';

describe('review helpers', () => {
    it('parses changed line ranges from a git patch', () => {
        const patch = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1,3 +1,4 @@', ' x', '+y', '@@ -10 +11 @@', '-a', '+b', '--- a/gone.ts', '+++ /dev/null'].join('\n');
        expect(parseChangedLines(patch).get('a.ts')).toEqual([[1, 4], [11, 11]]);
        expect(parseChangedLines(patch).has('gone.ts')).toBe(false);
    });

    it('anchors a finding on the first changed line of its diff', () => {
        const diff = ['--- a/a.ts', '+++ b/a.ts', '@@ -5,4 +5,4 @@', ' keep', ' keep', '-old', '+new'].join('\n');
        expect(anchorLine({ diff } as any)).toBe(7);
        expect(anchorLine({ diff: '' } as any, [[12, 14]])).toBe(12);
        expect(anchorLine({ diff: '' } as any)).toBe(1);
    });

    it('sorts by severity, then file, then line', () => {
        const f = (severity: string, filePath: string, line: number) => ({ severity, filePath, line }) as any;
        const sorted = sortFindings([f('low', 'a', 1), f('critical', 'b', 9), f('critical', 'a', 5)]);
        expect(sorted.map((x) => `${x.severity}:${x.filePath}`)).toEqual(['critical:a', 'critical:b', 'low:a']);
    });

    it('maps severities to SARIF levels', () => {
        const mk = (severity: string) => ({ type: 'bug', severity, content: 'c', rationale: '', diff: '', filePath: 'a.ts', line: 1 }) as any;
        const levels = (toSarif([mk('critical'), mk('medium'), mk('info')], '0.0.0') as any).runs[0].results.map((r: any) => r.level);
        expect(levels).toEqual(['error', 'warning', 'note']);
    });

    it('renders an all-clear markdown report', () => {
        expect(toMarkdown([], 'staged changes', 'm')).toContain('No issues found in staged changes');
    });
});

describe('model defaults', () => {
    it('detects OpenAI reasoning-era models', () => {
        for (const id of ['gpt-6.1-sol', 'gpt-5.4-mini', 'o3', 'openai/gpt-6-astra']) expect(isOpenAIReasoningModel(id)).toBe(true);
        for (const id of ['gpt-4o', 'gpt-4.1', 'llama-3.3-70b', 'qwen2.5-coder']) expect(isOpenAIReasoningModel(id)).toBe(false);
    });

    it('ships current defaults', () => {
        expect(DEFAULT_MODELS).toEqual({ openai: 'gpt-6.1-sol', anthropic: 'claude-sonnet-5-5', gemini: 'gemini-3.8-flash', ollama: 'qwen2.5-coder:latest' });
    });
});
