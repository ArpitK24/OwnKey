import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenAIProvider } from '../../src/ai/openai';
import { AnthropicProvider } from '../../src/ai/anthropic';

const ctx = { files: [], projectInfo: { name: 'p', rootPath: '/p', fileCount: 0 } } as any;
const drain = async (g: AsyncGenerator<unknown>) => {
    for await (const _ of g) void _;
};

afterEach(() => vi.unstubAllGlobals());

describe('provider request shapes', () => {
    it('sends max_completion_tokens and no temperature to GPT-6 models', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }] }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await drain(new OpenAIProvider('k', 'gpt-6.1-sol').analyze(ctx));
        const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
        expect(body.max_completion_tokens).toBeGreaterThan(0);
        expect(body).not.toHaveProperty('temperature');
        expect(body).not.toHaveProperty('max_tokens');
    });

    it('keeps the classic shape for older or compatible models, and retries on a parameter 400', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens'" } }), { status: 400 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }] }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await drain(new OpenAIProvider('k', 'some-new-model', 'https://example.test/v1').analyze(ctx));
        const first = JSON.parse(fetchMock.mock.calls[0][1].body);
        const second = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(first.max_tokens).toBe(8192);
        expect(second.max_completion_tokens).toBeGreaterThan(0);
        expect(second).not.toHaveProperty('temperature');
    });

    it('sends no temperature to Claude and reads text blocks after thinking', async () => {
        const reply = { content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: '[{"type":"bug","severity":"low","content":"c","filePath":"a.ts","diff":""}]' }] };
        const fetchMock = vi.fn(async () => new Response(JSON.stringify(reply), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const out: any[] = [];
        for await (const s of new AnthropicProvider('k', 'claude-sonnet-5-5').analyze(ctx)) out.push(s);
        expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body)).not.toHaveProperty('temperature');
        expect(out).toHaveLength(1);
    });
});
