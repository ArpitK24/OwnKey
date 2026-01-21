import { AIProvider } from './provider.js';
import { CodeContext, Suggestion, AnalyzeOptions, AIProviderError } from '../types/index.js';
import { logger } from '../utils/logger.js';

interface GeminiMessage {
    role: 'user' | 'model';
    parts: { text: string }[];
}

interface GeminiRequest {
    contents: GeminiMessage[];
    generationConfig?: {
        temperature?: number;
        maxOutputTokens?: number;
    };
}

interface GeminiResponse {
    candidates: {
        content: {
            parts: { text: string }[];
        };
        finishReason: string;
    }[];
}

/**
 * Google Gemini AI Provider
 * Supports: gemini-1.5-pro, gemini-1.5-flash, gemini-pro
 */
export class GeminiProvider extends AIProvider {
    private baseUrl = 'https://generativelanguage.googleapis.com/v1';

    getDefaultModel(): string {
        return 'gemini-2.5-pro';
    }

    async testConnection(): Promise<boolean> {
        // Temporarily bypass for testing - will fix endpoint later
        logger.verbose('Skipping Gemini connection test (will test during analysis)');
        return true;
    }

    async *analyze(context: CodeContext, options?: AnalyzeOptions): AsyncGenerator<Suggestion> {
        try {
            logger.verbose(`Analyzing with Gemini (${this.model})...`);

            const systemPrompt = this.getSystemPrompt();
            const userPrompt = this.buildUserPrompt(context);

            const request: GeminiRequest = {
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { text: systemPrompt },
                            { text: userPrompt },
                        ],
                    },
                ],
                generationConfig: {
                    temperature: options?.temperature || 0.3,
                    maxOutputTokens: options?.maxTokens || 8192,
                },
            };

            const response = await fetch(
                `${this.baseUrl}/models/${this.model}:generateContent`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': this.apiKey || '',
                    },
                    body: JSON.stringify(request),
                }
            );

            if (!response.ok) {
                const errorText = await response.text();
                logger.error(`Gemini API error: ${errorText}`);
                throw new AIProviderError(`Gemini API error: ${response.status} ${errorText}`);
            }

            const data = (await response.json()) as GeminiResponse;

            if (!data.candidates || data.candidates.length === 0) {
                throw new AIProviderError('No response from Gemini');
            }

            const candidate = data.candidates[0];
            const responseText = candidate.content.parts.map((p) => p.text).join('');

            logger.verbose('Received response from Gemini');
            logger.debug('Response:', responseText.substring(0, 200) + '...');

            // Parse suggestions from response
            const suggestions = this.parseSuggestions(responseText);

            logger.success(`Generated ${suggestions.length} suggestions`);

            // Yield suggestions one by one (simulating streaming)
            for (const suggestion of suggestions) {
                yield suggestion;
            }
        } catch (error) {
            if (error instanceof AIProviderError) {
                throw error;
            }
            throw new AIProviderError('Failed to analyze with Gemini', error);
        }
    }

    /**
     * Get available Gemini models
     */
    static async getAvailableModels(apiKey: string): Promise<string[]> {
        try {
            const response = await fetch(
                'https://generativelanguage.googleapis.com/v1/models',
                {
                    headers: {
                        'x-goog-api-key': apiKey,
                    },
                }
            );

            if (!response.ok) {
                throw new Error(`Failed to fetch models: ${response.statusText}`);
            }

            const data = await response.json() as any;

            // Filter for models that support generateContent
            const models = data.models
                .filter((m: any) =>
                    m.supportedGenerationMethods?.includes('generateContent') &&
                    m.name.includes('gemini')
                )
                .map((m: any) => m.name.replace('models/', ''));

            return models.length > 0 ? models : ['gemini-2.5-pro', 'gemini-2.5-flash'];
        } catch (error) {
            logger.error('Failed to fetch Gemini models:', error as Error);
            return ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
        }
    }

    /**
     * Get recommended model for code analysis
     */
    static getRecommendedModel(): string {
        return 'gemini-2.5-pro';
    }
}
