import { useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { applySuggestion, suggest, type CommandInfo } from './complete.js';
import type { SessionInfo } from './context.js';
import { Keeper, useTerminalSize } from './keeper-view.js';
import { KEEPER_BREAKPOINTS, keeperShown, keeperSize, type KeeperMood } from './keeper.js';

export interface PromptProps {
    info: SessionInfo;
    commands: CommandInfo[];
    history: string[];
    /** Called once with the submitted line, or null when the user leaves */
    onDone: (line: string | null) => void;
    /** Show the welcome banner above this prompt (the first one in a session) */
    banner?: string;
    /** How the last command went, which Keeper wears at this prompt */
    mood?: KeeperMood;
}

const ORANGE = '#ff5a1f';

export function Banner({ version, still = false }: { version: string; still?: boolean }) {
    const { columns, rows } = useTerminalSize();
    const size = keeperShown() ? keeperSize(columns, rows) : 'none';
    const title = (
        <Text>
            <Text color={ORANGE} bold>
                OwnKey
            </Text>
            <Text dimColor> {version}</Text>
        </Text>
    );
    const tagline = <Text>Local-first AI code review on your own keys.</Text>;
    const hint = <Text dimColor>Type any command without the ownkey prefix. Tab completes, ↑↓ history, help lists everything.</Text>;

    if (size === 'full' || size === 'compact') {
        return (
            <Box flexDirection="row" marginBottom={1}>
                <Keeper size={size} still={still} />
                <Box flexDirection="column" marginLeft={2} justifyContent="center" flexShrink={1}>
                    {title}
                    {tagline}
                    <Text> </Text>
                    {hint}
                </Box>
            </Box>
        );
    }
    return (
        <Box borderStyle="round" borderColor={ORANGE} paddingX={1} flexDirection="column" marginBottom={1}>
            <Box>
                {size === 'inline' ? (
                    <Box marginRight={1}>
                        <Keeper size="inline" still={still} />
                    </Box>
                ) : null}
                {title}
            </Box>
            {tagline}
            {hint}
        </Box>
    );
}

export function Header({ info, mood = 'idle', keeper = true }: { info: SessionInfo; mood?: KeeperMood; keeper?: boolean }) {
    const { columns } = useTerminalSize();
    const where = [info.folder, info.branch, info.changed === undefined ? undefined : info.changed === 0 ? 'clean' : `${info.changed} changed`]
        .filter(Boolean)
        .join(' · ');
    return (
        <Box flexDirection="row">
            {keeper && keeperShown() && columns >= KEEPER_BREAKPOINTS.compact ? (
                <Box marginRight={1}>
                    <Keeper size="inline" mood={mood} />
                </Box>
            ) : null}
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

export function Prompt({ info, commands, history, onDone, banner, mood }: PromptProps) {
    const { exit } = useApp();
    const { columns } = useTerminalSize();
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

    // Narrow terminals get a tighter label column; descriptions truncate rather than wrap
    const labelWidth = columns < 60 ? Math.min(14, Math.max(...suggestions.map((x) => x.label.length), 4) + 2) : 22;
    const before = value.slice(0, cursor);
    const at = value[cursor] ?? ' ';
    const after = value.slice(cursor + 1);

    return (
        <Box flexDirection="column">
            {banner ? <Banner version={banner} still={finished} /> : null}
            {!finished ? <Header info={info} mood={mood} keeper={!banner} /> : null}
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
                        <Text key={s.label} wrap="truncate-end">
                            <Text color={i === sel ? ORANGE : undefined} bold={i === sel}>
                                {s.label.padEnd(labelWidth)}
                            </Text>
                            <Text dimColor>{s.description}</Text>
                        </Text>
                    ))}
                </Box>
            ) : null}
            {!finished ? (
                <Text dimColor wrap="truncate-end">
                    {'  Tab complete · ↑↓ history · help · Ctrl+D exit'}
                </Text>
            ) : null}
        </Box>
    );
}
