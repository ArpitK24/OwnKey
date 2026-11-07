import { useEffect, useState } from 'react';
import { Text, useStdout } from 'ink';
import { KEEPER_FPS, keeperAnimates, keeperFits, keeperSegments, keeperShown, type KeeperMood } from './keeper.js';

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

/** A tick counter at the mark's frame rate, or a still 0 where motion is off. */
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
    /** Stop animating (for example once a prompt is submitted), keeping the last frame */
    still?: boolean;
}

/** The one-line mark as an Ink element; hidden on very narrow terminals. */
export function Keeper({ mood = 'idle', still = false }: KeeperProps) {
    const { columns } = useTerminalSize();
    const tick = useKeeperTick(!still && (mood === 'thinking' || mood === 'found' || mood === 'idle'));
    if (!keeperShown() || !keeperFits(columns)) return null;
    return (
        <Text>
            {keeperSegments(mood, tick).map((seg, i) => (
                <Text key={i} color={seg.color} bold={seg.part !== 'shaft'}>
                    {seg.text}
                </Text>
            ))}
        </Text>
    );
}
