import { useEffect, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import {
    KEEPER_FPS,
    KEEPER_ORANGE,
    keeperAnimates,
    keeperFrame,
    keeperSegments,
    keeperShown,
    keeperSize,
    type KeeperMood,
    type KeeperSize,
} from './keeper.js';

/** Terminal width and height, kept current as the window is resized. */
export function useTerminalSize(): { columns: number; rows: number } {
    const { stdout } = useStdout();
    const read = () => ({ columns: stdout?.columns || 80, rows: stdout?.rows || 24 });
    const [size, setSize] = useState(read);
    useEffect(() => {
        if (!stdout) return;
        const onResize = () => setSize(read());
        stdout.on('resize', onResize);
        return () => {
            stdout.off('resize', onResize);
        };
    }, [stdout]);
    return size;
}

/** A tick counter at Keeper's frame rate, or a still 0 where motion is off. */
export function useKeeperTick(active = true): number {
    const { stdout } = useStdout();
    const [tick, setTick] = useState(0);
    const moving = active && keeperAnimates(stdout ?? process.stdout);
    useEffect(() => {
        if (!moving) return;
        const id = setInterval(() => setTick((t) => t + 1), 1000 / KEEPER_FPS);
        return () => clearInterval(id);
    }, [moving]);
    return tick;
}

export interface KeeperProps {
    mood?: KeeperMood;
    /** Force a size; by default it follows the terminal width */
    size?: KeeperSize;
    /** Stop animating (for example once a prompt is submitted), keeping the last frame */
    still?: boolean;
}

/** Keeper as an Ink element: moves with its mood, resizes with the terminal. */
export function Keeper({ mood = 'idle', size, still = false }: KeeperProps) {
    const { columns, rows } = useTerminalSize();
    const tick = useKeeperTick(!still);
    if (!keeperShown()) return null;
    const lines = keeperFrame(mood, size ?? keeperSize(columns, rows), tick);
    if (!lines.length) return null;
    return (
        <Box flexDirection="column" flexShrink={0}>
            {lines.map((line, i) => (
                <Text key={i}>
                    {keeperSegments(line).map((seg, j) =>
                        seg.part === 'body' ? (
                            <Text key={j} color={KEEPER_ORANGE}>
                                {seg.text}
                            </Text>
                        ) : seg.part === 'eye' ? (
                            <Text key={j} bold>
                                {seg.text}
                            </Text>
                        ) : seg.part === 'mark' ? (
                            <Text key={j} color="red" bold>
                                {seg.text}
                            </Text>
                        ) : (
                            <Text key={j}>{seg.text}</Text>
                        )
                    )}
                </Text>
            ))}
        </Box>
    );
}
