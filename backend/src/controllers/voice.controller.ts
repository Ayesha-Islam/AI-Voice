import { Request, Response } from 'express';
import { container } from '../di/container';
import { VoiceService } from '../services/voice.services';
import { sendSuccess, sendError, handleAsync } from '../utils/helpers';
import { logger } from '../utils/logger';
import { ServiceKeys } from '../di/interfaces';

export class VoiceController {
    private voiceService: VoiceService;

    constructor() {
        this.voiceService = container.get<VoiceService>(ServiceKeys.VOICE);
    }

    handleIncomingCall = handleAsync(async (req: Request, res: Response) => {
        const { from, callSid } = req.body;

        if (!callSid) {
            return res.status(400).send('Missing callSid');
        }

        logger.info(`Incoming call webhook received: ${callSid} from ${from}`);

        const voiceXML = await this.voiceService.handleIncomingCall(req.body);

        res.set('Content-Type', 'text/xml');
        res.send(voiceXML);
        return res.send(voiceXML);

    });

    handleTranscription = handleAsync(async (req: Request, res: Response) => {
        const { callSid } = req.params;
        const { speechResult, confidence } = req.body;

        logger.info(`Transcription received for ${callSid}: ${speechResult} (confidence: ${confidence})`);

        if (!speechResult || confidence < 0.5) {
            // Low confidence or no speech detected
            const fallbackResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>I didn't quite catch that. Could you please repeat?</Say>
  <Redirect method="POST">/api/voice/incoming</Redirect>
</Response>`;

            res.set('Content-Type', 'text/xml');
            return res.send(fallbackResponse);
        }

        const voiceXML = await this.voiceService.handleSpeechInput(req.body);

        res.set('Content-Type', 'text/xml');
        res.send(voiceXML);
        return res.send(voiceXML);

    });

    handleOutboundCall = handleAsync(async (req: Request, res: Response) => {
        const { to, metadata } = req.body;

        if (!to) {
            return sendError(res, new Error('Missing "to" phone number'));
        }

        const callResponse = await this.voiceService.makeOutboundCall(to, metadata);

        sendSuccess(res, callResponse);
    });

    handleFallback = handleAsync(async (req: Request, res: Response) => {
        const { callSid } = req.params;

        logger.warn(`Fallback triggered for call: ${callSid}`);

        const fallbackResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>I'm having trouble understanding. Let me connect you to a human agent.</Say>
  <Dial>+1234567890</Dial>
</Response>`;

        res.set('Content-Type', 'text/xml');
        res.send(fallbackResponse);
        return res.send(fallbackResponse);

    });
}