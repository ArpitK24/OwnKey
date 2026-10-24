import { AIProvider, type ChatMessage } from './provider.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_MODELS } from '../config/models.js';

/**
 * Ollama AI Provider
 * Supports local LLMs via Ollama (DeepSeek Coder, CodeLlama, etc.)
 * No API key required - runs completely offline
 */
/**
 * Headers for an Ollama request. Ollama Cloud (https://ollama.com) and authenticated
 * proxies take a bearer key, read from OLLAMA_API_KEY as Ollama's own clients do.
 */
export function ollamaHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const key = process.env.OLLAMA_API_KEY?.trim();
    return key ? { ...extra, Authorization: `Bearer ${key}` } : extra;
}

export class OllamaProvider extends AIProvider {
    private baseUrl: string;

    constructor(apiKey?: string, model?: string, baseUrl?: string) {
        super(apiKey, model);
        this.baseUrl = baseUrl || 'http://localhost:11434';
    }

    getDefaultModel(): string {
        return DEFAULT_MODELS.ollama;
    }

    async testConnection(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`, {
                method: 'GET',
                headers: ollamaHeaders(),
            });
            return response.ok;
        } catch (error) {
            logger.verbose(`Ollama connection test failed: ${(error as Error).message}`);
            return false;
        }
    }

    async chat(system: string, messages: ChatMessage[]): Promise<string> {
        // A single turn uses /api/generate (unchanged from earlier versions); a conversation uses /api/chat
        const single = messages.length === 1 && messages[0].role === 'user';
        const url = `${this.baseUrl}${single ? '/api/generate' : '/api/chat'}`;
        const payload = single
            ? { model: this.model, system, prompt: messages[0].content, stream: false, options: { temperature: 0.2 } }
            : { model: this.model, messages: [{ role: 'system', content: system }, ...messages], stream: false, options: { temperature: 0.2 } };

        let response: Response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: ollamaHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(payload),
            });
        } catch (error) {
            throw new Error(
                `Cannot reach Ollama at ${this.baseUrl} (${(error as Error).message}).\n` +
                    '  Start it with: ollama serve\n' +
                    '  Or set another endpoint: ownkey config --provider ollama --endpoint <url>'
            );
        }

        if (!response.ok) {
            const body = await response.text().catch(() => '');
            if (response.status === 401 || response.status === 403) {
                throw new Error(
                    `Ollama at ${this.baseUrl} rejected the request (${response.status}). ` +
                        'For Ollama Cloud, set OLLAMA_API_KEY to a key from https://ollama.com/settings/keys'
                );
            }
            if (response.status === 404 && /model/i.test(body)) {
                throw new Error(`Model "${this.model}" is not installed. Run: ollama pull ${this.model}`);
            }
            throw new Error(`Ollama API error: ${response.status} ${response.statusText} ${body}`.trim());
        }

        const data = (await response.json()) as { response?: string; message?: { content?: string } };
        const text = data.response ?? data.message?.content ?? '';
        logger.debug(`Ollama raw response (${text.length} chars): ${text.slice(0, 500)}`);
        return text;
    }

    /**
     * Get available Ollama models
     * Lists models installed on the local Ollama instance
     */
    static async getAvailableModels(baseUrl: string = 'http://localhost:11434'): Promise<string[]> {
        try {
            const response = await fetch(`${baseUrl}/api/tags`, { headers: ollamaHeaders() });
            if (!response.ok) {
                return [];
            }

            const data = await response.json() as { models?: Array<{ name: string }> };
            return data.models?.map((m) => m.name) || [];
        } catch (error) {
            logger.verbose(`Failed to get Ollama models: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Check if Ollama is running
     */
    static async isOllamaRunning(baseUrl: string = 'http://localhost:11434'): Promise<boolean> {
        try {
            const response = await fetch(`${baseUrl}/api/tags`, { headers: ollamaHeaders() });
            return response.ok;
        } catch {
            return false;
        }
    }

    /**
     * Check if a specific model is installed
     */
    static async isModelInstalled(
        model: string,
        baseUrl: string = 'http://localhost:11434'
    ): Promise<boolean> {
        const models = await this.getAvailableModels(baseUrl);
        return models.includes(model);
    }
}
