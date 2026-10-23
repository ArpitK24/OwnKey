import { AIProvider } from './provider.js';
import type { CodeContext, Suggestion } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_MODELS, isOpenAIReasoningModel } from '../config/models.js';

export class OpenAIProvider extends AIProvider {
    private baseUrl: string;

    /**
     * @param endpoint Optional OpenAI-compatible base URL (OpenRouter, Groq, LM Studio, vLLM, ...)
     */
    constructor(apiKey?: string, model?: string, endpoint?: string) {
        super(apiKey, model, endpoint);
        this.baseUrl = (endpoint || 'https://api.openai.com/v1').replace(/\/+$/, '');
    }

    getDefaultModel(): string {
        return DEFAULT_MODELS.openai;
    }

    async testConnection(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/models`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                },
            });

            if (!response.ok) {
                logger.debug(`OpenAI connection test failed: ${response.status}`);
                return false;
            }

            return true;
        } catch (error) {
            logger.debug('OpenAI connection test error:', error);
            return false;
        }
    }

    /** Chat Completions body; reasoning-era models take max_completion_tokens and no temperature. */
    private buildBody(prompt: string, reasoning: boolean): Record<string, unknown> {
        const body: Record<string, unknown> = {
            model: this.model,
            messages: [
                { role: 'system', content: this.getSystemPrompt() },
                { role: 'user', content: prompt },
            ],
        };
        if (reasoning) {
            // Reasoning tokens count toward this cap, so leave room beyond the visible answer.
            body.max_completion_tokens = 32000;
        } else {
            body.temperature = 0.3;
            body.max_tokens = 8192;
        }
        return body;
    }

    async *analyze(context: CodeContext): AsyncGenerator<Suggestion> {
        const prompt = this.buildUserPrompt(context);

        try {
            logger.verbose(`Analyzing with OpenAI (${this.model})...`);

            const response = await fetch(`${this.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify(this.buildBody(prompt, isOpenAIReasoningModel(this.model))),
            });
            let res = response;
            if (res.status === 400) {
                // Some OpenAI-compatible models reject max_tokens/temperature; retry once in reasoning shape.
                const text = await res.clone().text();
                if (/max_tokens|temperature|max_completion_tokens|unsupported/i.test(text)) {
                    res = await fetch(`${this.baseUrl}/chat/completions`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${this.apiKey}`,
                        },
                        body: JSON.stringify(this.buildBody(prompt, !isOpenAIReasoningModel(this.model))),
                    });
                }
            }
            const response2 = res;
            if (!response2.ok) {
                const errorData = await response2.json().catch(() => ({})) as any;
                logger.error('OpenAI API error:', errorData as Error);
                throw new Error(`OpenAI API error: ${errorData.error?.message || response2.statusText}`);
            }

            const data = await response2.json() as any;
            const content = data.choices[0]?.message?.content;

            if (!content) {
                throw new Error('No content in OpenAI response');
            }

            // Parse suggestions from response
            const suggestions = this.parseSuggestions(content);
            for (const suggestion of suggestions) {
                yield suggestion;
            }
        } catch (error) {
            logger.error('OpenAI analysis error:', error as Error);
            throw error;
        }
    }

    static async getAvailableModels(apiKey: string): Promise<string[]> {
        try {
            const response = await fetch('https://api.openai.com/v1/models', {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                },
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.statusText}`);
            }

            const data = await response.json() as any;

            // Filter for GPT models suitable for code analysis
            const models = data.data
                .filter((m: any) =>
                    m.id.includes('gpt') &&
                    !m.id.includes('instruct') &&
                    !m.id.includes('vision')
                )
                .map((m: any) => m.id)
                .sort((a: string, b: string) => b.localeCompare(a, undefined, { numeric: true }));

            return models;
        } catch (error) {
            logger.error('Failed to fetch OpenAI models:', error as Error);
            return [DEFAULT_MODELS.openai, 'gpt-6-astra', 'gpt-6-luna']; // Fallback
        }
    }
}
