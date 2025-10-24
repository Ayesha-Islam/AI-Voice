import { Router } from 'express';
import appointmentRoutes from './appointment.routes';
import voiceRoutes from './voice.routes';
import webhookRoutes from './webhook.routes';

const router = Router();

router.use('/appointments', appointmentRoutes);
router.use('/voice', voiceRoutes);
router.use('/webhooks', webhookRoutes);

// Root API endpoint
router.get('/', (_req, res) => {
    res.json({
        message: 'Healthcare Voice API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        endpoints: {
            appointments: {
                'GET /api/appointments/slots': 'Get available appointment slots',
                'POST /api/appointments': 'Create new appointment',
                'GET /api/appointments/doctors/:doctorId/appointments': 'Get doctor appointments',
                'PATCH /api/appointments/:appointmentId/cancel': 'Cancel appointment',
                'PATCH /api/appointments/doctors/:doctorId/soft-delete': 'Soft delete doctor'
            },
            voice: {
                'POST /api/voice/webhook': 'Handle Fonoster webhook (incoming calls, speech, DTMF)',
                'GET /api/voice/status/:sessionId': 'Get session status',
                'GET /api/voice/sessions/active/list': 'List active sessions',
                'GET /api/voice/health': 'Voice service health check',
                'GET /api/voice/debug/fonoster-status': 'Debug Fonoster readiness',
                'POST /api/voice/outbound': 'Initiate outbound call'
            },
            webhooks: {
                'GET /api/webhooks/health': 'Health check',
                'GET /api/webhooks/chroma-health': 'ChromaDB health check',
                'POST /api/webhooks/call-status': 'Update call status',
                'POST /api/webhooks/sms': 'Handle SMS webhook'
            }
        }
    });
});

export default router;