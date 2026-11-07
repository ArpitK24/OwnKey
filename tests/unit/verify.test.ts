import { describe, it, expect } from 'vitest';
import { evidence, parseVerdicts, verifyFindings } from '../../src/core/review/verify';
import { newFilesIn } from '../../src/core/review/run';

const fake = (reply: string | Error) =>
    ({
        chat: async () => {
            if (reply instanceof Error) throw reply;
            return reply;
        },
    }) as any;
const s = (content: string, line = 2) => ({ type: 'bug', severity: 'high', content, filePath: 'a.js', rationale: '', diff: '', line }) as any;

describe('double check', () => {
    it('shows numbered code around the line', () => {
        expect(evidence(['a', 'b', 'c'], 2, 1)).toBe('    1   a\n    2 > b\n    3   c');
        expect(evidence(undefined, 2)).toBe('(file not available)');
        expect(evidence(['a'], 99, 1)).toBe('    1 > a');
    });

    it('reads verdicts and ignores bad indexes', () => {
        expect(parseVerdicts('{"verdicts":[{"index":0,"verdict":"rejected","reason":"no"},{"index":7,"verdict":"rejected"}]}', 2)).toEqual([{ index: 0, confirmed: false, reason: 'no' }]);
        expect(parseVerdicts('nonsense', 2)).toBeUndefined();
    });

    it('drops rejected findings and keeps the rest', async () => {
        const rejected: string[] = [];
        const out = await verifyFindings(fake('{"verdicts":[{"index":0,"verdict":"rejected","reason":"not there"},{"index":1,"verdict":"confirmed"}]}'), [s('fake'), s('real')], () => ['x', 'y'], (f, why) => rejected.push(`${f.content}: ${why}`));
        expect(out.map((f) => f.content)).toEqual(['real']);
        expect(rejected).toEqual(['fake: not there']);
    });

    it('keeps everything when the check fails or gives no verdict', async () => {
        expect(await verifyFindings(fake(new Error('down')), [s('a')], () => [])).toHaveLength(1);
        expect(await verifyFindings(fake('{"verdicts":[]}'), [s('a')], () => [])).toHaveLength(1);
        expect(await verifyFindings(fake('x'), [], () => [])).toEqual([]);
    });

    it('finds the files a diff adds', () => {
        expect(newFilesIn('diff --git a/x b/x\nnew file mode 100644\n--- /dev/null\ndiff --git a/y b/y\nindex 1..2\n')).toEqual(['x']);
    });
});
