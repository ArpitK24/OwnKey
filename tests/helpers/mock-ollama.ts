import http from 'http';
import type { AddressInfo } from 'net';

/**
 * Minimal Ollama-compatible server. `reply` is what /api/generate and /api/chat return as the model text.
 * Put strings in `script` to answer successive requests in order (then fall back to `reply`).
 */
export async function startMockOllama(models: string[] = ['mock-coder']) {
    const state = { reply: '[]', script: [] as string[], requests: [] as any[] };
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
            res.setHeader('content-type', 'application/json');
            if (req.url === '/api/tags') {
                res.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
                return;
            }
            if (req.url === '/api/generate' || req.url === '/api/chat') {
                state.requests.push({ url: req.url, ...JSON.parse(body || '{}') });
                const text = state.script.length ? state.script.shift()! : state.reply;
                res.end(JSON.stringify(req.url === '/api/chat' ? { message: { role: 'assistant', content: text } } : { response: text }));
                return;
            }
            res.statusCode = 404;
            res.end('{}');
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    return {
        url: `http://127.0.0.1:${port}`,
        state,
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
}
