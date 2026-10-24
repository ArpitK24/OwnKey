import type { SuggestionType } from '../types/index.js';

/**
 * Seeded-bug benchmark cases.
 *
 * Each case is a tiny repository: `base` is committed, then `changed` is staged and reviewed.
 * A bug case plants exactly one defect in the change; `expect.needle` is a substring of the
 * line that carries it. A control case is a correct change: anything the reviewer reports
 * there at medium severity or above counts as a false alarm.
 */
export interface BenchCase {
    id: string;
    title: string;
    language: string;
    file: string;
    base: string;
    changed: string;
    /** Absent for control cases */
    expect?: {
        needle: string;
        /** Finding types that count as a catch */
        types: SuggestionType[];
    };
}

const lines = (...l: string[]) => l.join('\n') + '\n';

/** Fake, non-working payment key for the hardcoded-secret case. */
const FAKE_LIVE_KEY = ['sk', 'live', '51Hx9aQ2eZvKYlo2C8b7fW3mN0pR4tUv'].join('_');

export const BENCH_CASES: BenchCase[] = [
    {
        id: 'off-by-one',
        title: 'Loop reads one past the end of the array',
        language: 'javascript',
        file: 'src/cart.js',
        base: lines(
            'export function subtotal(items) {',
            '    return 0;',
            '}',
        ),
        changed: lines(
            'export function subtotal(items) {',
            '    let total = 0;',
            '    for (let i = 0; i <= items.length; i++) {',
            '        total += items[i].price * items[i].qty;',
            '    }',
            '    return total;',
            '}',
        ),
        expect: { needle: 'i <= items.length', types: ['bug'] },
    },
    {
        id: 'sql-injection',
        title: 'User input concatenated into a SQL query',
        language: 'typescript',
        file: 'src/users.ts',
        base: lines(
            "import { db } from './db';",
            '',
            'export async function findUser(id: number) {',
            "    return db.query('SELECT id, email FROM users WHERE id = $1', [id]);",
            '}',
        ),
        changed: lines(
            "import { db } from './db';",
            '',
            'export async function findUser(id: number) {',
            "    return db.query('SELECT id, email FROM users WHERE id = $1', [id]);",
            '}',
            '',
            'export async function searchUsers(name: string) {',
            "    return db.query(`SELECT id, email FROM users WHERE name LIKE '%${name}%'`);",
            '}',
        ),
        expect: { needle: "LIKE '%${name}%'", types: ['security'] },
    },
    {
        id: 'missing-await',
        title: 'Async call not awaited inside try/catch',
        language: 'typescript',
        file: 'src/orders.ts',
        base: lines(
            "import { saveOrder } from './store';",
            '',
            'export async function placeOrder(order: { id: string }) {',
            '    await saveOrder(order);',
            '    return { ok: true };',
            '}',
        ),
        changed: lines(
            "import { saveOrder } from './store';",
            "import { log } from './log';",
            '',
            'export async function placeOrder(order: { id: string }) {',
            '    try {',
            '        saveOrder(order);',
            '        return { ok: true };',
            '    } catch (err) {',
            "        log.error('order failed', err);",
            '        return { ok: false };',
            '    }',
            '}',
        ),
        expect: { needle: '        saveOrder(order);', types: ['bug'] },
    },
    {
        id: 'null-deref',
        title: 'Optional lookup result used without a check',
        language: 'typescript',
        file: 'src/profile.ts',
        base: lines(
            'interface User { id: string; name: string; address?: { city: string } }',
            '',
            'export function displayName(user: User): string {',
            '    return user.name;',
            '}',
        ),
        changed: lines(
            'interface User { id: string; name: string; address?: { city: string } }',
            '',
            'export function displayName(user: User): string {',
            '    return user.name;',
            '}',
            '',
            'export function cityLabel(users: User[], id: string): string {',
            '    const user = users.find((u) => u.id === id);',
            '    return `${user.name} (${user.address.city})`;',
            '}',
        ),
        expect: { needle: '${user.name} (${user.address.city})', types: ['bug'] },
    },
    {
        id: 'hardcoded-secret',
        title: 'Live API key committed in source',
        language: 'python',
        file: 'app/payments.py',
        base: lines(
            'import os',
            'import requests',
            '',
            'def charge(amount_cents, token):',
            "    key = os.environ['PAYMENTS_KEY']",
            "    return requests.post('https://api.payments.example/charge', auth=(key, ''), data={'amount': amount_cents, 'source': token})",
        ),
        changed: lines(
            'import requests',
            '',
            // Assembled at runtime so this fake key never appears whole in OwnKey's own source
            // (secret scanners would flag it); the case file on disk gets the full value.
            `PAYMENTS_KEY = '${FAKE_LIVE_KEY}'`,
            '',
            'def charge(amount_cents, token):',
            "    return requests.post('https://api.payments.example/charge', auth=(PAYMENTS_KEY, ''), data={'amount': amount_cents, 'source': token})",
        ),
        expect: { needle: "PAYMENTS_KEY = '", types: ['security'] },
    },
    {
        id: 'path-traversal',
        title: 'Request parameter joined into a file path',
        language: 'javascript',
        file: 'src/files.js',
        base: lines(
            "import express from 'express';",
            '',
            'export const router = express.Router();',
        ),
        changed: lines(
            "import express from 'express';",
            "import path from 'path';",
            '',
            'export const router = express.Router();',
            "const UPLOADS = path.resolve('uploads');",
            '',
            "router.get('/download', (req, res) => {",
            '    const file = path.join(UPLOADS, req.query.name);',
            '    res.sendFile(file);',
            '});',
        ),
        expect: { needle: 'path.join(UPLOADS, req.query.name)', types: ['security'] },
    },
    {
        id: 'command-injection',
        title: 'Shell command built from user input',
        language: 'javascript',
        file: 'src/thumbs.js',
        base: lines(
            "import { execFile } from 'child_process';",
            '',
            'export function thumbnail(src, out, cb) {',
            "    execFile('convert', [src, '-resize', '200x200', out], cb);",
            '}',
        ),
        changed: lines(
            "import { exec } from 'child_process';",
            '',
            'export function thumbnail(src, out, size, cb) {',
            '    exec(`convert ${src} -resize ${size} ${out}`, cb);',
            '}',
        ),
        expect: { needle: 'exec(`convert ${src}', types: ['security'] },
    },
    {
        id: 'inverted-auth',
        title: 'Authorization check inverted',
        language: 'typescript',
        file: 'src/admin.ts',
        base: lines(
            "import type { Request, Response, NextFunction } from 'express';",
            '',
            'export function requireAdmin(req: Request, res: Response, next: NextFunction) {',
            "    res.status(403).end();",
            '}',
        ),
        changed: lines(
            "import type { Request, Response, NextFunction } from 'express';",
            '',
            'export function requireAdmin(req: Request, res: Response, next: NextFunction) {',
            '    const user = (req as any).user;',
            '    if (!user || !user.isAdmin) {',
            '        return next();',
            '    }',
            "    res.status(403).json({ error: 'forbidden' });",
            '}',
        ),
        expect: { needle: 'if (!user || !user.isAdmin)', types: ['security', 'bug'] },
    },
    {
        id: 'mutable-default',
        title: 'Mutable default argument shared across calls',
        language: 'python',
        file: 'app/tags.py',
        base: lines(
            'def normalize(tag):',
            '    return tag.strip().lower()',
        ),
        changed: lines(
            'def normalize(tag):',
            '    return tag.strip().lower()',
            '',
            'def add_tag(tag, tags=[]):',
            '    tags.append(normalize(tag))',
            '    return tags',
        ),
        expect: { needle: 'def add_tag(tag, tags=[])', types: ['bug'] },
    },
    {
        id: 'numeric-sort',
        title: 'Numbers sorted with the default string comparator',
        language: 'javascript',
        file: 'src/stats.js',
        base: lines(
            'export function mean(values) {',
            '    return values.reduce((a, b) => a + b, 0) / values.length;',
            '}',
        ),
        changed: lines(
            'export function mean(values) {',
            '    return values.reduce((a, b) => a + b, 0) / values.length;',
            '}',
            '',
            'export function median(values) {',
            '    const sorted = [...values].sort();',
            '    const mid = Math.floor(sorted.length / 2);',
            '    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;',
            '}',
        ),
        expect: { needle: '[...values].sort()', types: ['bug'] },
    },
    {
        id: 'switch-fallthrough',
        title: 'Missing break makes one case fall into the next',
        language: 'javascript',
        file: 'src/pricing.js',
        base: lines(
            'export function discount(tier) {',
            '    return 0;',
            '}',
        ),
        changed: lines(
            'export function discount(tier) {',
            '    let pct = 0;',
            '    switch (tier) {',
            "        case 'gold':",
            '            pct = 20;',
            "        case 'silver':",
            '            pct = 10;',
            '            break;',
            '        default:',
            '            pct = 0;',
            '    }',
            '    return pct;',
            '}',
        ),
        expect: { needle: 'pct = 20;', types: ['bug'] },
    },
    {
        id: 'string-identity',
        title: 'String compared with `is` instead of `==`',
        language: 'python',
        file: 'app/roles.py',
        base: lines(
            'def can_edit(user):',
            '    return False',
        ),
        changed: lines(
            'def can_edit(user):',
            "    role = user.get('role', '').lower()",
            "    return role is 'editor' or role is 'admin'",
        ),
        expect: { needle: "role is 'editor'", types: ['bug'] },
    },
    // Controls: correct changes. Reports here at medium or above are false alarms.
    {
        id: 'clean-refactor',
        title: 'Control: loop rewritten as reduce',
        language: 'javascript',
        file: 'src/cart.js',
        base: lines(
            'export function subtotal(items) {',
            '    let total = 0;',
            '    for (let i = 0; i < items.length; i++) {',
            '        total += items[i].price * items[i].qty;',
            '    }',
            '    return total;',
            '}',
        ),
        changed: lines(
            'export function subtotal(items) {',
            '    return items.reduce((total, item) => total + item.price * item.qty, 0);',
            '}',
        ),
    },
    {
        id: 'clean-feature',
        title: 'Control: parameterized query added',
        language: 'typescript',
        file: 'src/users.ts',
        base: lines(
            "import { db } from './db';",
            '',
            'export async function findUser(id: number) {',
            "    return db.query('SELECT id, email FROM users WHERE id = $1', [id]);",
            '}',
        ),
        changed: lines(
            "import { db } from './db';",
            '',
            'export async function findUser(id: number) {',
            "    return db.query('SELECT id, email FROM users WHERE id = $1', [id]);",
            '}',
            '',
            'export async function findByEmail(email: string) {',
            "    return db.query('SELECT id, email FROM users WHERE email = $1', [email.trim().toLowerCase()]);",
            '}',
        ),
    },
    {
        id: 'clean-guard',
        title: 'Control: null check added',
        language: 'typescript',
        file: 'src/profile.ts',
        base: lines(
            'interface User { id: string; name: string }',
            '',
            'export function greet(user: User): string {',
            '    return `Hello, ${user.name}`;',
            '}',
        ),
        changed: lines(
            'interface User { id: string; name: string }',
            '',
            'export function greet(user: User | undefined): string {',
            "    if (!user) return 'Hello, guest';",
            '    return `Hello, ${user.name}`;',
            '}',
        ),
    },
];
