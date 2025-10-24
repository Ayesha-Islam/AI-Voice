import { Request, Response } from 'express';
import { container } from '../di/container';
import { ConversationService } from '../services/conversation.services';
import { ChromaService } from '../services/chroma.services';
import { sendSuccess, handleAsync } from '../utils/helpers';
import { logger } from '../utils/logger';
import { ServiceKeys } from '../di/interfaces';

export class WebhookController {
    private conversationService: ConversationService;
    private chromaService: ChromaService;

    constructor() {
        this.conversationService = container.get<ConversationService>(ServiceKeys.CONVERSATION);
        this.chromaService = container.get<ChromaService>(ServiceKeys.CHROMA);
    }

    // POST /api/webhooks/call-status
    handleCallStatus = handleAsync(async (req: Request, res: Response) => {
        const { callSid, status, duration } = req.body;

        logger.info(`Call status update: ${callSid} -> ${status}`);

        await this.conversationService.updateCallStatus(callSid, status, duration);

        sendSuccess(res, { message: 'Call status updated' });
    });

    // POST /api/webhooks/sms
    handleSMS = handleAsync(async (req: Request, res: Response) => {
        const { from, text } = req.body;

        logger.info(`SMS received from ${from}: ${text}`);

        sendSuccess(res, { message: 'SMS received' });
    });

    // GET /api/webhooks/health
    healthCheck = handleAsync(async (_req: Request, res: Response) => {
        const chromaStatus = this.chromaService.isConnected() ? 'connected' : 'disconnected';

        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            services: {
                database: 'connected',
                fonoster: 'initialized',
                ai: 'ready',
                chroma: chromaStatus
            }
        };

        sendSuccess(res, health);
    });

    // GET /api/webhooks/chroma-health
    chromaHealth = handleAsync(async (_req: Request, res: Response) => {
        try {
            const isHealthy = this.chromaService.isConnected();
            const isLimited = this.chromaService.isLimitedMode();
            const collectionInfo = await this.chromaService.getCollectionInfo();

            sendSuccess(res, {
                chroma: isHealthy ? 'connected' : 'disconnected',
                mode: isLimited ? 'local_knowledge_base' : 'chroma_db',
                status: isHealthy ? 'healthy' : 'fallback_mode',
                knowledge_base_size: this.chromaService.getKnowledgeBaseSize(),
                limited_mode: isLimited,
                collection_info: collectionInfo
            });
        } catch (error) {
            logger.error('Chroma health check failed:', error);
            sendSuccess(res, {
                chroma: 'error',
                status: 'unavailable',
                message: 'ChromaDB health check failed'
            });
        }
    });
}