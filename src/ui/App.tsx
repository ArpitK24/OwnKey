import { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { applySuggestion, suggest, type CommandInfo } from './complete.js';
import type { SessionInfo } from './context.js';

export interface PromptProps {
    info: SessionInfo;
    commands: CommandInfo[];
    history: string[];
    /** Called once with the submitted line, or null when the user leaves */
    onDone: (line: string | null) => void;
}

const ORANGE = '#ff5a1f';

export function Banner({ version }: { version: string }) {
    return (
        <Box borderStyle="round" borderColor={ORANGE} paddingX={1} flexDirection="column" marginBottom={1}>
            <Text>
                <Text color={ORANGE} bold>
                    ◆ OwnKey
                </Text>
                <Text dimColor> {version}</Text>
                <Text>  local-first AI code review on your own keys</Text>
            </Text>
            <Text dimColor>Type any command without the ownkey prefix. Tab completes, ↑↓ history, help lists everything.</Text>
        </Box>
    );
}

export function Header({ info }: { info: SessionInfo }) {
    const where = [info.folder, info.branch, info.changed === undefined ? undefined : info.changed === 0 ? 'clean' : `${info.changed} changed`]
        .filter(Boolean)
        .join(' · ');
    return (
        <Box flexDirection="column">
            <Text>
                <Text bold>{where}</Text>
                <Text dimColor>  ·  </Text>
                {info.provider ? (
                    <Text color="cyan">
                        {info.provider} / {info.model}
                    </Text>
                ) : (
                    <Text color="yellow">No model yet. Type config to set one up.</Text>
                )}
            </Text>
        </Box>
    );
}

export function Prompt({ info, commands, history, onDone }: PromptProps) {
    const { exit } = useApp();
    const [value, setValue] = useState('');
    const [cursor, setCursor] = useState(0);
    const [histIndex, setHistIndex] = useState(history.length);
    const [selected, setSelected] = useState(0);
    const [finished, setFinished] = useState(false);

    const suggestions = suggest(value.slice(0, cursor), commands);
    const sel = Math.min(selected, Math.max(0, suggestions.length - 1));

    // Exit only after the final frame (prompt line alone, no header or menu) has rendered,
    // so scrollback keeps a clean record of each command.
    useEffect(() => {
        if (finished) exit();
    }, [finished, exit]);

    const finish = (line: string | null) => {
        onDone(line);
        setFinished(true);
    };
    const set = (v: string, c = v.length) => {
        setValue(v);
        setCursor(c);
        setSelected(0);
    };

    useInput((input, key) => {
        if (finished) return;
        if (key.ctrl && input === 'c') {
            if (value) set('');
            else finish(null);
            return;
        }
        if (key.ctrl && input === 'd') {
            if (!value) finish(null);
            return;
        }
        if (key.return) {
            finish(value);
            return;
        }
        if (key.tab) {
            if (suggestions.length) set(applySuggestion(value, suggestions[sel].value));
            return;
        }
        if (key.escape) {
            set('');
            return;
        }
        if (key.upArrow || key.downArrow) {
            // With a suggestion list open, arrows pick from it; otherwise they walk history
            if (suggestions.length > 1 && value) {
                const n = suggestions.length;
                setSelected((sel + (key.upArrow ? n - 1 : 1)) % n);
                return;
            }
            const next = Math.max(0, Math.min(history.length, histIndex + (key.upArrow ? -1 : 1)));
            setHistIndex(next);
            set(history[next] ?? '');
            return;
        }
        if (key.leftArrow) return setCursor(Math.max(0, cursor - 1));
        if (key.rightArrow) return setCursor(Math.min(value.length, cursor + 1));
        if (key.ctrl && input === 'a') return setCursor(0);
        if (key.ctrl && input === 'e') return setCursor(value.length);
        if (key.ctrl && input === 'u') return set(value.slice(cursor), 0);
        if (key.backspace || key.delete) {
            if (cursor > 0) set(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1);
            return;
        }
        if (input && !key.ctrl && !key.meta) {
            // A paste (or fast typing) can arrive with its Enter in the same chunk
            const nl = input.search(/[\r\n]/);
            const text = nl === -1 ? input : input.slice(0, nl);
            const next = value.slice(0, cursor) + text + value.slice(cursor);
            set(next, cursor + text.length);
            if (nl !== -1) finish(next);
        }
    });

    const before = value.slice(0, cursor);
    const at = value[cursor] ?? ' ';
    const after = value.slice(cursor + 1);

    return (
        <Box flexDirection="column">
            {!finished ? <Header info={info} /> : null}
            <Text>
                <Text color={ORANGE} bold>
                    ›{' '}
                </Text>
                <Text>{before}</Text>
                {finished ? <Text>{at === ' ' ? '' : at}</Text> : <Text inverse>{at}</Text>}
                <Text>{after}</Text>
            </Text>
            {!finished && suggestions.length > 0 ? (
                <Box flexDirection="column" marginLeft={2}>
                    {suggestions.map((s, i) => (
                        <Text key={s.label}>
                            <Text color={i === sel ? ORANGE : undefined} bold={i === sel}>
                                {s.label.padEnd(22)}
                            </Text>
                            <Text dimColor>{s.description}</Text>
                        </Text>
                    ))}
                </Box>
            ) : null}
            {!finished ? <Text dimColor>  Tab complete · ↑↓ history · help · Ctrl+D exit</Text> : null}
        </Box>
    );
}
