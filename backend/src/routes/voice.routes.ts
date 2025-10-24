import { Router, Request, Response } from 'express';
import { container } from '../di/container';
import { VoiceService } from '../services/voice.services';
import { TwilioService } from '../services/twilio.services';
import { logger } from '../utils/logger';

const router = Router();

// Middleware: Request ID & Logging 
router.use((req, res, next) => {
    (req as any).id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    (req as any).startTime = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - (req as any).startTime;
        logger.info(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms (${(req as any).id})`);
    });
    next();
});


//INCOMING CALL ENDPOINT
router.post('/incoming', async (req: Request, res: Response): Promise<void> => {
    const requestId = (req as any).id;

    try {
        const { CallSid, From, To, CallStatus } = req.body;

        logger.info(`[${requestId}] 📞 INCOMING CALL`, {
            callSid: CallSid,
            from: From,
            to: To,
            status: CallStatus
        });

        // Validate required Twilio webhook parameters
        if (!CallSid || !From) {
            logger.error(`[${requestId}] Missing required Twilio parameters`);
            res.status(400).send('Missing required parameters');
            return;
        }

        // Get voice service
        const voiceService = container.get<VoiceService>('VoiceService');

        // Handle incoming call and get TwiML response
        const twiml = await voiceService.handleIncomingCall(req.body);

        // Return TwiML (XML format) to Twilio
        res.set('Content-Type', 'application/xml');
        res.status(200).send(twiml);

    } catch (error) {
        logger.error(`[${requestId}] Error handling incoming call:`, error);

        // Return error TwiML - Twilio will play this to caller
        const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">We are experiencing technical difficulties. Please try again later.</Say>
</Response>`;

        res.set('Content-Type', 'application/xml');
        res.status(200).send(errorTwiml);
    }
});

//GATHER ENDPOINT
router.post('/gather', async (req: Request, res: Response): Promise<void> => {
    const requestId = (req as any).id;

    try {
        const { CallSid, SpeechResult, Digits, Confidence } = req.body;

        logger.info(`[${requestId}] User input received`, {
            callSid: CallSid,
            hasSpeech: !!SpeechResult,
            hasDigits: !!Digits,
            speechPreview: SpeechResult?.substring(0, 50),
            confidence: Confidence
        });

        if (!CallSid) {
            logger.warn(`[${requestId}] Missing CallSid`);
            res.status(400).send('Missing CallSid');
            return;
        }

        const voiceService = container.get<VoiceService>('VoiceService');
        let twiml: string;

        if (SpeechResult && SpeechResult.trim()) {
            // User spoke
            logger.info(`[${requestId}] 🗣️ Processing speech: "${SpeechResult}"`);
            twiml = await voiceService.handleSpeechInput(req.body);
        } else if (Digits && Digits.trim()) {
            // User pressed keys (DTMF)
            logger.info(`[${requestId}] 🔢 Processing DTMF: ${Digits}`);
            twiml = await voiceService.handleDTMFInput(req.body);
        } else {
            // No input detected
            logger.warn(`[${requestId}] No speech or digits detected`);
            const twilioService = container.get<TwilioService>('TwilioService');
            twiml = twilioService.generateTwiML(
                "I didn't catch any input. Could you please try again?"
            );
        }

        res.set('Content-Type', 'application/xml');
        res.status(200).send(twiml);

    } catch (error) {
        logger.error(`[${requestId}] Error handling gather input:`, error);

        const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">I'm having trouble processing your input. Please try again.</Say>
  <Gather input="speech" speechTimeout="auto" maxSpeechTime="10" method="POST" action="/api/voice/gather">
    <Say voice="alice">Please speak your response now</Say>
  </Gather>
</Response>`;

        res.set('Content-Type', 'application/xml');
        res.status(200).send(errorTwiml);
    }
});

//CALL STATUS ENDPOINT
router.post('/status', async (req: Request, res: Response): Promise<void> => {
    const requestId = (req as any).id;

    try {
        const { CallSid, CallStatus, CallDuration, RecordingUrl } = req.body;

        logger.info(`[${requestId}] Call status update`, {
            callSid: CallSid,
            status: CallStatus,
            duration: CallDuration,
            hasRecording: !!RecordingUrl
        });

        if (!CallSid) {
            res.status(400).send('Missing CallSid');
            return;
        }

        const voiceService = container.get<VoiceService>('VoiceService');
        await voiceService.handleCallStatus(req.body);

        // Twilio doesn't use the response for status callbacks
        // Just return 200 OK
        res.status(200).send('');

    } catch (error) {
        logger.error(`[${requestId}] Error handling call status:`, error);
        res.status(200).send(''); // Still return 200 to acknowledge receipt
    }
});

//TRANSCRIPTION ENDPOINT
router.post('/transcription', async (req: Request, res: Response): Promise<void> => {
    const requestId = (req as any).id;

    try {
        const { CallSid, SpeechResult, RecordingUrl, Confidence } = req.body;

        logger.info(`[${requestId}] Transcription received`, {
            callSid: CallSid,
            text: SpeechResult?.substring(0, 50),
            confidence: Confidence,
            recordingUrl: RecordingUrl?.substring(0, 50)
        });

        if (!CallSid) {
            res.status(400).send('Missing CallSid');
            return;
        }

        const voiceService = container.get<VoiceService>('VoiceService');
        const twiml = await voiceService.handleTranscription(req.body);

        res.set('Content-Type', 'application/xml');
        res.status(200).send(twiml);

    } catch (error) {
        logger.error(`[${requestId}] Error handling transcription:`, error);

        const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">We encountered an error processing your speech. Please try again.</Say>
</Response>`;

        res.set('Content-Type', 'application/xml');
        res.status(200).send(errorTwiml);
    }
});

/**
 * TwiML Response for Outbound Calls
 * This is called by Twilio when an outbound call is answered
 * Returns TwiML instructions for the call
 */
router.post('/twiml/outbound', async (req: Request, res: Response): Promise<void> => {
    const requestId = (req as any).id;

    try {
        logger.info(`[${requestId}] TwiML request for outbound call`);

        // Return a greeting for outbound calls
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Hello! This is a call from our healthcare center. How are you doing today?</Say>
  <Gather input="speech" speechTimeout="auto" maxSpeechTime="10" method="POST" action="/api/voice/gather">
    <Say voice="alice">Please tell us how we can help</Say>
  </Gather>
</Response>`;

        res.set('Content-Type', 'application/xml');
        res.status(200).send(twiml);

    } catch (error) {
        logger.error(`[${requestId}] Error generating TwiML:`, error);
        res.set('Content-Type', 'application/xml');
        res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">We encountered an error. Please try again later.</Say>
</Response>`);
    }
});



//MAKE OUTBOUND CALL
router.post('/outbound', async (req: Request, res: Response): Promise<void> => {
    const requestId = (req as any).id;

    try {
        const { to, metadata } = req.body;

        if (!to) {
            logger.warn(`[${requestId}] Missing "to" phone number`);
            res.status(400).json({
                success: false,
                error: 'Missing required field: to (phone number)',
                example: { to: '+1234567890', metadata: {} },
                requestId
            });
            return;
        }

        logger.info(`[${requestId}] Outbound call request`, {
            to,
            metadata
        });

        const voiceService = container.get<VoiceService>('VoiceService');
        const callResponse = await voiceService.makeOutboundCall(to, metadata);

        logger.info(`[${requestId}] Outbound call initiated successfully`, {
            callSid: callResponse.sid
        });

        res.status(200).json({
            success: true,
            data: callResponse,
            message: 'Call initiated successfully',
            requestId
        });

    } catch (error) {
        logger.error(`[${requestId}] Error making outbound call:`, error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Failed to initiate outbound call',
            requestId
        });
    }
});

//GET CALL STATUS
router.get('/status/:callSid', async (req: Request, res: Response): Promise<void> => {
    const requestId = (req as any).id;
    const { callSid } = req.params;

    try {
        logger.info(`[${requestId}] Fetching session status for: ${callSid}`);

        const voiceService = container.get<VoiceService>('VoiceService');
        const sessionInfo = voiceService.getSessionInfo(callSid);

        if (!sessionInfo) {
            logger.warn(`[${requestId}] Session not found: ${callSid}`);
            res.status(404).json({
                success: false,
                error: 'Session not found',
                callSid,
                requestId
            });
            return;
        }

        logger.info(`[${requestId}] Session found`, sessionInfo);

        res.status(200).json({
            success: true,
            data: sessionInfo,
            requestId
        });

    } catch (error) {
        logger.error(`[${requestId}] Error fetching session status:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch session status',
            requestId
        });
    }
});

//LIST ACTIVE SESSIONS
router.get('/sessions/active/list', async (req: Request, res: Response): Promise<void> => {
    const requestId = (req as any).id;

    try {
        logger.info(`[${requestId}] Fetching active sessions list`);

        const voiceService = container.get<VoiceService>('VoiceService');
        const count = voiceService.getActiveSessionsCount();
        const sessions = voiceService.getAllActiveSessions?.() || [];

        logger.info(`[${requestId}] Active sessions: ${count}`);

        res.status(200).json({
            success: true,
            data: {
                activeCount: count,
                sessions: sessions.map(s => ({
                    callSid: s.callSid,
                    callerNumber: s.callerNumber,
                    startTime: s.startTime,
                    conversationTurns: s.conversationTurns,
                    duration: new Date().getTime() - new Date(s.startTime).getTime()
                }))
            },
            requestId
        });

    } catch (error) {
        logger.error(`[${requestId}] Error fetching active sessions:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch active sessions',
            requestId
        });
    }
});

//HEALTH CHECK
router.get('/health', async (req: Request, res: Response): Promise<void> => {
    const requestId = (req as any).id;

    try {
        const voiceService = container.get<VoiceService>('VoiceService');
        const twilioService = container.get<TwilioService>('TwilioService');
        const activeSessions = voiceService.getActiveSessionsCount();
        const twilioReady = twilioService.isReady();

        const healthStatus = {
            success: true,
            status: twilioReady ? 'OK' : 'DEGRADED',
            service: 'voice-webhook',
            platform: 'Twilio',
            twilio: {
                ready: twilioReady,
                phoneNumber: process.env.TWILIO_PHONE_NUMBER
            },
            activeSessions,
            timestamp: new Date().toISOString(),
            requestId
        };

        logger.info(`[${requestId}] Health check:`, healthStatus);

        res.status(twilioReady ? 200 : 503).json(healthStatus);

    } catch (error) {
        logger.error(`[${requestId}] Health check error:`, error);
        res.status(503).json({
            success: false,
            status: 'ERROR',
            error: 'Service unhealthy',
            requestId
        });
    }
});

//DEBUG: TWILIO STATUS
router.get('/debug/twilio-status', async (req: Request, res: Response): Promise<void> => {
    const requestId = (req as any).id;

    try {
        const twilioService = container.get<TwilioService>('TwilioService');
        const isReady = twilioService.isReady();

        logger.info(`[${requestId}] Twilio debug status check:`, { isReady });

        if (!isReady) {
            logger.warn(`[${requestId}] Twilio service not ready - check credentials`);
        }

        res.status(isReady ? 200 : 503).json({
            success: true,
            twilio: {
                isReady,
                status: isReady ? 'ready' : 'not-ready',
                message: isReady
                    ? 'Twilio service is ready to receive calls'
                    : 'Twilio service is not initialized - check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN'
            },
            requestId
        });

    } catch (error) {
        logger.error(`[${requestId}] Twilio status check error:`, error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Error checking Twilio status',
            requestId
        });
    }
});

//INFO: API DOCUMENTATION
router.get('/info', (_req: Request, res: Response): void => {
    res.status(200).json({
        service: 'Healthcare Voice API - Twilio',
        version: '1.0.0',
        platform: 'Twilio',
        endpoints: {
            incoming: {
                method: 'POST',
                path: '/api/voice/incoming',
                description: 'Twilio calls this when someone dials your number',
                authentication: 'Twilio verification only',
                note: 'Configure in Twilio console'
            },
            gather: {
                method: 'POST',
                path: '/api/voice/gather',
                description: 'Twilio sends user speech/DTMF input here',
                authentication: 'Twilio verification only',
                note: 'Automatic - called by Twilio'
            },
            status: {
                method: 'POST',
                path: '/api/voice/status',
                description: 'Twilio sends call status updates',
                authentication: 'Twilio verification only',
                note: 'Automatic - called by Twilio'
            },
            outbound: {
                method: 'POST',
                path: '/api/voice/outbound',
                description: 'Make an outbound call programmatically',
                authentication: 'Required',
                example: { to: '+1234567890', metadata: {} }
            },
            callStatus: {
                method: 'GET',
                path: '/api/voice/status/:callSid',
                description: 'Get status of a specific call session',
                authentication: 'Required',
                example: '/api/voice/status/CA123456789'
            },
            activeSessions: {
                method: 'GET',
                path: '/api/voice/sessions/active/list',
                description: 'List all active call sessions',
                authentication: 'Required'
            },
            health: {
                method: 'GET',
                path: '/api/voice/health',
                description: 'Health check endpoint',
                authentication: 'Optional'
            },
            twilioDebug: {
                method: 'GET',
                path: '/api/voice/debug/twilio-status',
                description: 'Debug Twilio service status',
                authentication: 'Optional'
            }
        },
        webhookConfiguration: {
            description: 'Configure these in Twilio console',
            url: 'https://console.twilio.com/phone-numbers/PN...',
            incomingCall: '{WEBHOOK_BASE_URL}/api/voice/incoming',
            httpMethod: 'POST'
        }
    });
});



// Add this to src/routes/voice.routes.ts temporarily for debugging

/**
 * DIAGNOSTIC ENDPOINT - Test Twilio Credentials
 * GET /api/voice/diagnostic/twilio
 */
router.get('/diagnostic/twilio', async (req: Request, res: Response): Promise<void> => {
    const requestId = (req as any).id;

    try {
        logger.info(`[${requestId}] Running Twilio diagnostic...`);

        // Get Twilio service
        const twilioService = container.get<TwilioService>('TwilioService');

        if (!twilioService.isReady()) {
            logger.error(`[${requestId}] Twilio service not ready`);
            res.status(503).json({
                success: false,
                error: 'Twilio service not initialized',
                ready: false
            });
            return;
        }

        logger.info(`[${requestId}] Twilio service is ready. Attempting to verify credentials...`);

        // Try to access Twilio client to get account info
        // This will fail if credentials are invalid
        const testResult = {
            accountSid: process.env.TWILIO_ACCOUNT_SID,
            phoneNumber: process.env.TWILIO_PHONE_NUMBER,
            authTokenLength: process.env.TWILIO_AUTH_TOKEN?.length,
            webhookBaseUrl: process.env.WEBHOOK_BASE_URL,
            ready: twilioService.isReady()
        };

        logger.info(`[${requestId}] Twilio diagnostic results:`, testResult);

        res.json({
            success: true,
            diagnostic: testResult,
            message: 'Twilio credentials appear valid. If outbound calls still fail, check: 1) Account has credits, 2) Phone number is verified, 3) "to" number format is correct'
        });

    } catch (error) {
        logger.error(`[${requestId}] Twilio diagnostic error:`, error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Diagnostic failed',
            stack: error instanceof Error ? error.stack : undefined
        });
    }
});

/**
 * TEST OUTBOUND CALL - Detailed Error Logging
 * POST /api/voice/diagnostic/test-call
 */
router.post('/diagnostic/test-call', async (req: Request, res: Response): Promise<void> => {
    const requestId = (req as any).id;

    try {
        const { to } = req.body;

        if (!to) {
            res.status(400).json({
                success: false,
                error: 'Missing "to" parameter'
            });
            return;
        }

        logger.info(`[${requestId}] Testing outbound call to: ${to}`);

        // Validate phone number format
        const phoneRegex = /^\+?[1-9]\d{1,14}$/;
        if (!phoneRegex.test(to)) {
            res.status(400).json({
                success: false,
                error: `Invalid phone number format: ${to}. Use E.164 format like +1234567890`
            });
            return;
        }

        logger.info(`[${requestId}] Phone number format is valid`);

        const voiceService = container.get<VoiceService>('VoiceService');

        // Make the call with detailed error catching
        try {
            logger.info(`[${requestId}] Calling VoiceService.makeOutboundCall...`);
            const callResponse = await voiceService.makeOutboundCall(to);

            logger.info(`[${requestId}] Call successful:`, callResponse);

            res.json({
                success: true,
                callResponse
            });
            return;

        } catch (callError) {
            logger.error(`[${requestId}] makeOutboundCall failed:`, {
                error: callError instanceof Error ? callError.message : callError,
                stack: callError instanceof Error ? callError.stack : undefined
            });

            throw callError;
        }

    } catch (error) {
        logger.error(`[${requestId}] Test call error:`, error);

        const errorMessage = error instanceof Error ? error.message : String(error);

        // Provide helpful error messages
        let suggestion = '';

        if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
            suggestion = 'Invalid Twilio credentials. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN';
        } else if (errorMessage.includes('400') || errorMessage.includes('Invalid')) {
            suggestion = 'Invalid phone number or request format';
        } else if (errorMessage.includes('resource not found')) {
            suggestion = 'Twilio account issue - check account status and credits';
        }

        res.status(500).json({
            success: false,
            error: errorMessage,
            suggestion,
            debugging: {
                accountSidPrefix: process.env.TWILIO_ACCOUNT_SID?.substring(0, 5),
                phoneNumber: process.env.TWILIO_PHONE_NUMBER,
                webhookUrl: process.env.WEBHOOK_BASE_URL,
                fullError: error instanceof Error ? error.stack : error
            }
        });
    }
});

export default router;