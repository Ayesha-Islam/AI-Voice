// src/routes/webhook.routes.ts
import { Router } from 'express';
import { WebhookController } from '../controllers/webhook.controller';

const router = Router();
const webhookController = new WebhookController();

// GET /api/webhooks/health - Health check
router.get('/health', webhookController.healthCheck);

// GET /api/webhooks/chroma-health - ChromaDB health check
router.get('/chroma-health', webhookController.chromaHealth);

// POST /api/webhooks/call-status - Update call status
router.post('/call-status', webhookController.handleCallStatus);

// POST /api/webhooks/sms - Handle SMS webhook
router.post('/sms', webhookController.handleSMS);

export default router;