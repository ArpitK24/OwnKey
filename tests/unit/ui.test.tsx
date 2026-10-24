import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { splitWords } from '../../src/ui/words';
import { suggest, applySuggestion, longFlag, type CommandInfo } from '../../src/ui/complete';
import { Prompt } from '../../src/ui/App';

const COMMANDS: CommandInfo[] = [
    { name: 'review', description: 'Review changes', options: [{ flags: '--staged', description: 'Staged only' }, { flags: '--severity <level>', description: 'Min severity' }] },
    { name: 'apply', description: 'Apply a fix', options: [{ flags: '-y, --yes', description: 'No prompts' }, { flags: '--dry-run', description: 'Preview' }] },
];
const INFO = { version: '9.9.9', folder: 'repo', branch: 'main', changed: 2, provider: 'ollama', model: 'qwen' };
const tick = () => new Promise((r) => setTimeout(r, 30));

describe('splitWords', () => {
    it('splits like a shell for quotes and escapes', () => {
        expect(splitWords('apply --verify "npm test" 3')).toEqual(['apply', '--verify', 'npm test', '3']);
        expect(splitWords("review --base 'origin/main'  ")).toEqual(['review', '--base', 'origin/main']);
        expect(splitWords('a\\ b ""')).toEqual(['a b', '']);
        expect(() => splitWords('apply "oops')).toThrow('Unclosed quote');
    });
});

describe('completion', () => {
    it('suggests commands, then their flags', () => {
        expect(suggest('re', COMMANDS).map((s) => s.value)).toEqual(['review']);
        expect(suggest('ownkey ap', COMMANDS).map((s) => s.value)).toEqual(['apply']);
        expect(suggest('review --s', COMMANDS).map((s) => s.value)).toEqual(['--staged', '--severity']);
        expect(suggest('review --staged ', COMMANDS).map((s) => s.value)).toEqual(['--severity']);
        expect(suggest('review origin', COMMANDS)).toEqual([]);
        expect(suggest('', COMMANDS).length).toBeGreaterThan(2);
    });

    it('completes the word being typed', () => {
        expect(applySuggestion('review --s', '--staged')).toBe('review --staged ');
        expect(applySuggestion('rev', 'review')).toBe('review ');
        expect(longFlag('-y, --yes')).toBe('--yes');
        expect(longFlag('--case <ids>')).toBe('--case');
    });
});

describe('Prompt', () => {
    it('shows where you are and which model', () => {
        const { lastFrame, unmount } = render(<Prompt info={INFO} commands={COMMANDS} history={[]} onDone={() => undefined} />);
        expect(lastFrame()).toContain('repo · main · 2 changed');
        expect(lastFrame()).toContain('ollama / qwen');
        unmount();
    });

    it('nudges setup when no model is configured', () => {
        const { lastFrame, unmount } = render(<Prompt info={{ version: '1', folder: 'x' }} commands={COMMANDS} history={[]} onDone={() => undefined} />);
        expect(lastFrame()).toContain('Type config to set one up');
        unmount();
    });

    it('completes with Tab and submits with Enter', async () => {
        const onDone = vi.fn();
        const { stdin, lastFrame } = render(<Prompt info={INFO} commands={COMMANDS} history={[]} onDone={onDone} />);
        await tick();
        stdin.write('rev');
        await tick();
        stdin.write('\t');
        await tick();
        stdin.write('--st');
        await tick();
        stdin.write('\t');
        await tick();
        expect(lastFrame()).toContain('› review --staged');
        stdin.write('\r');
        await tick();
        expect(onDone).toHaveBeenCalledWith('review --staged ');
    });

    it('walks history with the up arrow and leaves on Ctrl+D', async () => {
        const onDone = vi.fn();
        const { stdin, lastFrame } = render(<Prompt info={INFO} commands={COMMANDS} history={['bench --list', 'review']} onDone={onDone} />);
        await tick();
        stdin.write('\u001B[A');
        await tick();
        expect(lastFrame()).toContain('› review');
        stdin.write('\u001B[A');
        await tick();
        expect(lastFrame()).toContain('› bench --list');
        stdin.write('\u0015'); // Ctrl+U clears
        await tick();
        stdin.write('\u0004');
        await tick();
        expect(onDone).toHaveBeenCalledWith(null);
    });
});
