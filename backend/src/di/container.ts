import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { config } from '../config';
import { TwilioService } from '../services/twilio.services';
import { AppointmentService } from '../services/appointment.services';
import { ConversationService } from '../services/conversation.services';
import { VoiceService } from '../services/voice.services';
import { AIService } from '../services/ai.services';
import { DeepgramService } from '../services/deepgram.services';
import { TTSService } from '../services/tts.services';
import { ChromaService } from '../services/chroma.services';
import { IChromaService, IService, ITwilioService, ServiceKeys } from './interfaces';

export class DIContainer {
    private static instance: DIContainer;
    private services: Map<string, any> = new Map();
    private initialized: boolean = false;

    private constructor() { }

    static getInstance(): DIContainer {
        if (!DIContainer.instance) {
            DIContainer.instance = new DIContainer();
        }
        return DIContainer.instance;
    }

    register<T>(key: string, service: T): void {
        this.services.set(key, service);
        logger.debug(`Service registered: ${key}`);
    }

    get<T>(key: string): T {
        const service = this.services.get(key);
        if (!service) {
            throw new Error(`Service not found: ${key}`);
        }
        return service as T;
    }

    has(key: string): boolean {
        return this.services.has(key);
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            logger.info('DI Container already initialized');
            return;
        }

        const services: IService[] = [];

        try {
            logger.info('Initializing DI Container...');

            // ===== Step 1: Initialize Database =====
            logger.info('Step 1/7: Initializing Prisma Client...');
            const prisma = new PrismaClient();
            this.register(ServiceKeys.PRISMA, prisma);
            logger.info('✓ Prisma Client initialized');

            // ===== Step 2: Initialize AI Service =====
            logger.info('Step 2/7: Initializing AI Service...');
            const aiService = new AIService();
            services.push(aiService);
            this.register(ServiceKeys.AI, aiService);
            logger.info('✓ AI Service registered');

            // ===== Step 3: Initialize Deepgram Service =====
            logger.info('Step 3/7: Initializing Deepgram Service...');
            const deepgramService = new DeepgramService(config.DEEPGRAM_API_KEY);
            services.push(deepgramService);
            this.register(ServiceKeys.DEEPGRAM, deepgramService);
            logger.info('✓ Deepgram Service registered');

            // ===== Step 4: Initialize TTS Service =====
            logger.info('Step 4/7: Initializing TTS Service...');
            const ttsService = new TTSService();
            services.push(ttsService);
            this.register(ServiceKeys.TTS, ttsService);
            logger.info('✓ TTS Service registered');

            // ===== Step 5: Initialize Twilio Service =====
            logger.info('Step 5/7: Initializing Twilio Service...');
            const twilioConfig = {
                accountSid: config.TWILIO_ACCOUNT_SID,
                authToken: config.TWILIO_AUTH_TOKEN,
                phoneNumber: config.TWILIO_PHONE_NUMBER,
                webhookBaseUrl: config.WEBHOOK_BASE_URL
            };

            // Validate Twilio config
            if (!twilioConfig.accountSid || !twilioConfig.authToken || !twilioConfig.phoneNumber) {
                logger.warn('Twilio credentials missing - service will not be ready for calls/SMS');
            }

            const twilioService = new TwilioService(twilioConfig);
            services.push(twilioService);
            this.register(ServiceKeys.TWILIO, twilioService);
            logger.info('✓ Twilio Service registered');

            // ===== Step 6: Initialize Chroma Service =====
            logger.info('Step 6/7: Initializing Chroma Service...');
            let chromaInstance: IChromaService;

            if (config.CHROMA_SERVER_URL) {
                logger.info(`Using Chroma Server at: ${config.CHROMA_SERVER_URL}`);
                const chromaService = new ChromaService(config.CHROMA_SERVER_URL);
                chromaInstance = chromaService;
                services.push(chromaService);
                this.register(ServiceKeys.CHROMA, chromaService);
                logger.info('✓ Chroma Service registered (connected mode)');
            } else {
                logger.warn('CHROMA_SERVER_URL not set - using fallback implementation');
                const fallbackChroma: IChromaService = {
                    initialize: async () => {
                        logger.info('Chroma Service running in fallback mode');
                    },
                    search: async (query: string, nResults?: number) => {
                        const q = (query || '').toLowerCase();
                        const results: string[] = [];

                        if (q.includes('appointment') || q.includes('book')) {
                            results.push('You can book appointments for General Practice, Cardiology, or Pediatrics.');
                        }
                        if (q.includes('prescription') || q.includes('medication')) {
                            results.push('For prescription refills, please provide the medication name and your patient ID.');
                        }
                        if (q.includes('hours') || q.includes('open')) {
                            results.push('Our clinic is open Monday to Friday from 8 AM to 6 PM, and Saturdays from 9 AM to 2 PM.');
                        }
                        if (q.includes('emergency') || q.includes('urgent')) {
                            results.push('For emergencies, please call 911 or visit your nearest emergency room.');
                        }
                        if (results.length === 0) {
                            results.push('I am unable to reach the knowledge base. How can I assist you today?');
                        }

                        return results.slice(0, nResults || 3);
                    },
                    addDocuments: async () => {
                        logger.debug('Chroma fallback: addDocuments called (no-op)');
                    },
                    isConnected: () => false,
                    isLimitedMode: () => true,
                    getKnowledgeBaseSize: () => 0,
                    getCollectionInfo: async () => ({ name: 'fallback', count: 0 }),
                    getStats: async () => ({ vectorCount: 0, responseTime: 'N/A', uptime: 'N/A' }),
                    healthCheck: async () => false
                };

                chromaInstance = fallbackChroma;
                services.push(fallbackChroma);
                this.register(ServiceKeys.CHROMA, chromaInstance);
                logger.info('✓ Chroma Service registered (fallback mode)');
            }

            // ===== Step 7: Initialize Data Services =====
            logger.info('Step 7/7: Initializing Data Services...');

            // Conversation Service
            const conversationService = new ConversationService(prisma);
            this.register(ServiceKeys.CONVERSATION, conversationService);
            logger.info('✓ Conversation Service registered');

            // Appointment Service
            const appointmentService = new AppointmentService(prisma);
            this.register(ServiceKeys.APPOINTMENT, appointmentService);
            logger.info('✓ Appointment Service registered');

            // Voice Service - depends on all external services
            const voiceService = new VoiceService({
                deepgram: deepgramService,
                ai: aiService,
                tts: ttsService,
                twilio: twilioService,
                chroma: chromaInstance,
                conversation: conversationService,
                appointment: appointmentService
            });
            services.push(voiceService);
            this.register(ServiceKeys.VOICE, voiceService);
            logger.info('✓ Voice Service registered');

            // ===== Step 8: Initialize All Services =====
            logger.info('Initializing all services...');
            for (const service of services) {
                if (service.initialize) {
                    const serviceName = service.constructor?.name || 'Unknown';
                    try {
                        await service.initialize();
                        logger.info(`✓ ${serviceName} initialized successfully`);
                    } catch (err) {
                        logger.warn(
                            `⚠ ${serviceName} initialization warning:`,
                            err instanceof Error ? err.message : 'Unknown error'
                        );
                        // Continue with degraded mode - don't fail the entire initialization
                    }
                }
            }

            this.initialized = true;
            logger.info('✅ DI Container fully initialized');
            this.logServiceStatus();

        } catch (error) {
            logger.error('❌ Failed to initialize DI Container:', error);
            await this.destroy();
            throw error;
        }
    }

    async destroy(): Promise<void> {
        logger.info('Destroying DI Container...');

        for (const [key, service] of this.services.entries()) {
            if (service.destroy && typeof service.destroy === 'function') {
                try {
                    await service.destroy();
                    logger.debug(`Service destroyed: ${key}`);
                } catch (error) {
                    logger.error(`Error destroying service ${key}:`, error);
                }
            }
        }

        this.services.clear();
        this.initialized = false;
        logger.info('DI Container destroyed');
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    private logServiceStatus(): void {
        logger.info('=== Service Status ===');
        try {
            const twilio = this.get<ITwilioService>(ServiceKeys.TWILIO);
            logger.info(`Twilio Ready: ${twilio.isReady()}`);
        } catch (error) {
            logger.info('Twilio Ready: false (not initialized)');
        }

        logger.info(`Registered Services: ${this.services.size}`);
        for (const key of this.services.keys()) {
            logger.info(`  - ${key}`);
        }
    }
}

export const container = DIContainer.getInstance();