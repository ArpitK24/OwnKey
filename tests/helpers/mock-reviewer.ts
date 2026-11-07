import http from 'http';
import type { AddressInfo } from 'net';

/**
 * An Ollama-compatible model that answers by what it is asked: a pull request summary,
 * a review (one tool round, then findings), or a question in a conversation (one tool
 * round, then an answer). Requests run concurrently, so answers depend on the prompt,
 * never on arrival order.
 */
export async function startMockReviewer() {
    const state = {
        findings: [] as any[],
        summary: {} as any,
        answer: 'An answer.',
        prompts: [] as string[],
        failSummary: false,
    };
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
            res.setHeader('content-type', 'application/json');
            if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'mock-coder' }] }));
            const body = JSON.parse(raw || '{}');
            const all = JSON.stringify(body);
            state.prompts.push(all);
            const turns = (body.messages ?? []).length;
            let text: string;
            if (all.includes('overview of a pull request')) {
                if (state.failSummary) {
                    res.statusCode = 500;
                    return res.end('{"error":"boom"}');
                }
                text = JSON.stringify(state.summary);
            } else if (all.includes('pull request conversation')) text = turns ? JSON.stringify({ answer: state.answer }) : JSON.stringify({ calls: [{ tool: 'list_files' }] });
            else text = turns ? JSON.stringify({ findings: state.findings }) : JSON.stringify({ calls: [{ tool: 'list_files' }] });
            res.end(JSON.stringify(req.url === '/api/chat' ? { message: { role: 'assistant', content: text } } : { response: text }));
        });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return {
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        state,
        close: () => new Promise<void>((r) => server.close(() => r())),
    };
}
