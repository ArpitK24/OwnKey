import { describe, it, expect } from 'vitest';
import { AIProvider } from '../../src/ai/provider';
import { meetsSeverity, parseSeverity } from '../../src/utils/severity';
import { DatabaseClient } from '../../src/db/client';

class TestProvider extends AIProvider {
    getDefaultModel() {
        return 'test';
    }
    async testConnection() {
        return true;
    }
    async chat() {
        return '[]';
    }
    parse(text: string) {
        return this.parseSuggestions(text);
    }
}

describe('model output parsing', () => {
    const p = new TestProvider();

    it('reads a fenced JSON array with chatter around it', () => {
        const s = p.parse('Sure!\n```json\n[{"type":"bug","severity":"high","content":"x","filePath":"a.ts","diff":"--- a/a.ts"}]\n```\nDone.');
        expect(s).toHaveLength(1);
        expect(s[0].diff).toBe('--- a/a.ts');
    });

    it('accepts {"suggestions": [...]}', () => {
        expect(p.parse('{"suggestions":[{"type":"style","severity":"info","content":"y"}]}')).toHaveLength(1);
    });

    it('reads the line a finding is about, under any common key', () => {
        const s = p.parse('[{"type":"bug","line":8},{"type":"bug","lineNumber":"12"},{"type":"bug","line":0},{"type":"bug"}]');
        expect(s.map((x) => x.line)).toEqual([8, 12, undefined, undefined]);
    });

    it('throws a helpful error on non-JSON replies', () => {
        expect(() => p.parse('I could not find anything.')).toThrow(/expected JSON format/);
    });
});

describe('severity filter', () => {
    it('treats --severity as a minimum', () => {
        expect(meetsSeverity('critical', 'high')).toBe(true);
        expect(meetsSeverity('high', 'high')).toBe(true);
        expect(meetsSeverity('low', 'high')).toBe(false);
        expect(meetsSeverity('low', undefined)).toBe(true);
        expect(() => parseSeverity('urgent')).toThrow(/Invalid severity/);
    });
});

describe('database migrations', () => {
    it('discovers every numbered migration in order', async () => {
        const versions = (await DatabaseClient.listMigrations()).map((m) => m.version);
        expect(versions).toEqual([1, 2]);
    });
});

describe('ollama auth', () => {
    it('sends OLLAMA_API_KEY as a bearer token, and nothing without it', async () => {
        const { ollamaHeaders } = await import('../../src/ai/ollama');
        const saved = process.env.OLLAMA_API_KEY;
        try {
            delete process.env.OLLAMA_API_KEY;
            expect(ollamaHeaders({ 'Content-Type': 'application/json' })).toEqual({ 'Content-Type': 'application/json' });
            process.env.OLLAMA_API_KEY = 'k-test';
            expect(ollamaHeaders()).toEqual({ Authorization: 'Bearer k-test' });
        } finally {
            if (saved === undefined) delete process.env.OLLAMA_API_KEY;
            else process.env.OLLAMA_API_KEY = saved;
        }
    });
});
