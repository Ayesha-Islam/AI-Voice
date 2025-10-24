import { logger } from '../utils/logger';
import { ExternalServiceError } from '../utils/errors';
import { IDeepgramService } from '../di/interfaces';

export class DeepgramService implements IDeepgramService {
    private apiKey: string;
    private baseURL: string = 'https://api.deepgram.com/v1';

    constructor(apiKey?: string) {
        this.apiKey = apiKey || '';
        if (!this.apiKey) {
            logger.warn('Deepgram API key not found. Speech recognition will be limited.');
        }
    }

    async initialize(): Promise<void> {
        if (!this.apiKey) {
            logger.warn('Deepgram Service: No API key provided');
            return;
        }

        try {
            await this.testConnection();
            logger.info('✅ Deepgram Service initialized successfully');
        } catch (error) {
            logger.error('❌ Deepgram Service initialization failed:', error);
            throw new ExternalServiceError('Deepgram', error);
        }
    }

    private async testConnection(): Promise<void> {
        if (!this.apiKey) return;

        const response = await fetch(`${this.baseURL}/projects`, {
            headers: {
                'Authorization': `Token ${this.apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Deepgram API test failed: ${response.statusText}`);
        }
    }

    async transcribe(audioUrl: string): Promise<string> {
        try {
            if (!this.apiKey) {
                logger.warn('Deepgram API key missing, returning empty transcript');
                return '';
            }

            const response = await fetch(`${this.baseURL}/listen`, {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    url: audioUrl,
                    model: 'nova-2',
                    language: 'en',
                    smart_format: true,
                    punctuate: true,
                    diarize: false
                })
            });

            if (!response.ok) {
                throw new Error(`Deepgram transcription failed: ${response.statusText}`);
            }

            const raw = await response.json();
            const data = raw as any;
            return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';

        } catch (error) {
            logger.error('Error transcribing audio:', error);
            throw new ExternalServiceError('Deepgram Transcription', error);
        }
    }

    async destroy(): Promise<void> {
        logger.info('Deepgram Service destroyed');
    }
}