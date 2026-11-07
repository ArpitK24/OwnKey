import http from 'http';
import type { AddressInfo } from 'net';

/** An in-memory GitHub REST API for one pull request: enough for the review bot. */
export async function startMockGitHub(pull: { number: number; title: string; body?: string; draft?: boolean; head: string; base: string; baseRef?: string }) {
    const state = {
        pull: { number: pull.number, title: pull.title, body: pull.body ?? '', draft: pull.draft ?? false, state: 'open', head: { sha: pull.head, ref: 'feature' }, base: { sha: pull.base, ref: pull.baseRef ?? 'main' } },
        issueComments: [] as any[],
        reviewComments: [] as any[],
        reviews: [] as any[],
        reactions: [] as any[],
        requests: [] as { method: string; url: string; body: any; auth?: string }[],
        /** Lines GitHub should refuse comments on, as "path:line" */
        refuse: new Set<string>(),
    };
    let nextId = 100;
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
            const body = raw ? JSON.parse(raw) : undefined;
            const url = (req.url ?? '').replace(/\?.*$/, '');
            state.requests.push({ method: req.method!, url: req.url!, body, auth: req.headers.authorization });
            const send = (code: number, data: unknown) => {
                res.statusCode = code;
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify(data));
            };
            const page = Number(/[?&]page=(\d+)/.exec(req.url ?? '')?.[1] ?? 1);
            const list = (items: any[]) => send(200, page > 1 ? [] : items);
            const n = state.pull.number;
            let m: RegExpExecArray | null;
            if (req.method === 'GET' && url === `/repos/o/r/pulls/${n}`) return send(200, state.pull);
            if (req.method === 'GET' && url === `/repos/o/r/issues/${n}/comments`) return list(state.issueComments);
            if (req.method === 'POST' && url === `/repos/o/r/issues/${n}/comments`) {
                const c = { id: nextId++, body: body.body, user: { login: 'github-actions[bot]', type: 'Bot' } };
                state.issueComments.push(c);
                return send(201, c);
            }
            if (req.method === 'PATCH' && (m = /^\/repos\/o\/r\/issues\/comments\/(\d+)$/.exec(url))) {
                const c = state.issueComments.find((x) => x.id === Number(m![1]));
                if (!c) return send(404, { message: 'Not Found' });
                c.body = body.body;
                return send(200, c);
            }
            if (req.method === 'GET' && url === `/repos/o/r/pulls/${n}/comments`) return list(state.reviewComments);
            if (req.method === 'POST' && url === `/repos/o/r/pulls/${n}/reviews`) {
                const bad = (body.comments ?? []).find((c: any) => state.refuse.has(`${c.path}:${c.line}`));
                if (bad) return send(422, { message: 'Unprocessable Entity', errors: ['Line could not be resolved'] });
                state.reviews.push(body);
                for (const c of body.comments ?? []) state.reviewComments.push({ id: nextId++, ...c, user: { login: 'github-actions[bot]', type: 'Bot' } });
                return send(200, { id: nextId++ });
            }
            if (req.method === 'POST' && (m = /^\/repos\/o\/r\/pulls\/\d+\/comments\/(\d+)\/replies$/.exec(url))) {
                const c = { id: nextId++, body: body.body, in_reply_to_id: Number(m[1]), user: { login: 'github-actions[bot]', type: 'Bot' } };
                state.reviewComments.push(c);
                return send(201, c);
            }
            if (req.method === 'POST' && /reactions$/.test(url)) {
                state.reactions.push({ url, ...body });
                return send(201, {});
            }
            send(404, { message: `Not Found: ${req.method} ${url}` });
        });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return {
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        state,
        close: () => new Promise<void>((r) => server.close(() => r())),
    };
}
