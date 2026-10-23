import type { AIProvider } from '../types/index.js';

/**
 * Default model per provider. Users can set any model with `ownkey config --model`.
 * Reviewed 2026-10: mid-tier models balance review quality and cost for bring-your-own-key use.
 */
export const DEFAULT_MODELS: Record<AIProvider, string> = {
    openai: 'gpt-6.1-sol',
    anthropic: 'claude-sonnet-5-5',
    gemini: 'gemini-3.8-flash',
    ollama: 'qwen2.5-coder:latest',
};

/**
 * OpenAI reasoning-era models (gpt-5+, o-series) reject `max_tokens` and custom `temperature`
 * on Chat Completions.
 */
export function isOpenAIReasoningModel(model: string): boolean {
    const id = model.toLowerCase().replace(/^openai\//, '');
    return /^(gpt-([5-9]|\d{2,})|o\d)/.test(id);
}
