import http from 'http';
import type { AddressInfo } from 'net';

/**
 * Minimal Ollama-compatible server. `reply` is what /api/generate returns as the model text.
 */
export async function startMockOllama(models: string[] = ['mock-coder']) {
    const state = { reply: '[]', requests: [] as any[] };
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
            res.setHeader('content-type', 'application/json');
            if (req.url === '/api/tags') {
                res.end(JSON.stringify({ models: models.map((name) => ({ name })) }));
                return;
            }
            if (req.url === '/api/generate') {
                state.requests.push(JSON.parse(body || '{}'));
                res.end(JSON.stringify({ response: state.reply }));
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
