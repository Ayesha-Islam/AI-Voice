import { logger } from '../utils/logger';
import {
    IDeepgramService,
    IAIService,
    ITTSService,
    IChromaService
} from '../di/interfaces';
import { ConversationService } from './conversation.services';
import { AppointmentService } from './appointment.services';
import { TwilioService } from './twilio.services';
import { ExternalServiceError } from '../utils/errors';

export interface VoiceServiceDependencies {
    deepgram: IDeepgramService;
    ai: IAIService;
    tts: ITTSService;
    twilio: TwilioService;
    chroma: IChromaService;
    conversation: ConversationService;
    appointment: AppointmentService;
}

export interface AIResponse {
    message: string;
    intent: string;
    extractedData: any;
    shouldContinue: boolean;
    confidence?: number;
}

export interface WebhookData {
    CallSid: string;
    CallStatus: 'initiated' | 'ringing' | 'answered' | 'in-progress' | 'completed' | 'failed' | 'busy' | 'no-answer';
    From: string;
    To: string;
    CallDuration?: string;
    RecordingUrl?: string;
    SpeechResult?: string;
    Confidence?: string;
    Digits?: string;
    [key: string]: any;
}

export interface SessionData {
    sessionId: string;
    callSid: string;
    callerNumber: string;
    startTime: Date;
    lastActivity: Date;
    conversationTurns: number;
    callStatus: string;
}

export class VoiceService {
    private activeSessions: Map<string, SessionData> = new Map();
    private readonly DB_TIMEOUT_MS = 3000;

    constructor(private deps: VoiceServiceDependencies) {
        logger.info('VoiceService initialized with dependencies');
    }

    // Handle incoming call - return TwiML
    async handleIncomingCall(webhookData: WebhookData): Promise<string> {
        const { CallSid, From } = webhookData;

        logger.info(`📞 Incoming call from ${From}`, { callSid: CallSid });

        try {
            // Initialize session
            this.initializeSession(CallSid, From, 'incoming');

            // Initialize conversation context
            await this.withTimeout(
                this.deps.conversation.initializeContext(CallSid, From),
                this.DB_TIMEOUT_MS
            );

            // Log the incoming call
            await this.withTimeout(
                this.deps.conversation.logCall(CallSid, From, 'inbound', 'in-progress'),
                this.DB_TIMEOUT_MS
            );

            const greeting = 'Hello! Thank you for calling our healthcare center. I am your AI assistant. How may I help you today?';

            // Return TwiML with gather to collect speech
            return this.generateSpeechGatherTwiML(greeting, CallSid);

        } catch (error) {
            logger.error(`Error handling incoming call ${CallSid}:`, error);
            return this.deps.twilio.generateTwiML('Thank you for calling. We are experiencing technical difficulties. Please try again later.');
        }
    }

    //Handle user speech input from Twilio

    async handleSpeechInput(webhookData: WebhookData): Promise<string> {
        const { CallSid, SpeechResult, Confidence } = webhookData;

        if (!SpeechResult) {
            logger.warn(`No speech detected for call ${CallSid}`);
            const retryMessage = "I didn't catch that. Could you please repeat?";
            return this.generateSpeechGatherTwiML(retryMessage, CallSid);
        }

        logger.info(`🗣️ Speech input for call ${CallSid}: "${SpeechResult}"`, {
            confidence: Confidence
        });

        try {
            // Update session
            const session = this.activeSessions.get(CallSid);
            if (session) {
                session.lastActivity = new Date();
                session.conversationTurns++;
            }

            // Get conversation context
            const context = await this.withTimeout(
                this.deps.conversation.getContext(CallSid),
                this.DB_TIMEOUT_MS
            );

            // Search knowledge base
            const relevantDocs = await this.withTimeout(
                this.deps.chroma.search(SpeechResult, 3),
                this.DB_TIMEOUT_MS
            );

            // Get AI response
            const aiResponse = await this.getAIResponse(SpeechResult, context, relevantDocs);

            // Update conversation
            await this.withTimeout(
                this.deps.conversation.updateContext(
                    CallSid,
                    SpeechResult,
                    aiResponse.message,
                    aiResponse.intent,
                    aiResponse.extractedData
                ),
                this.DB_TIMEOUT_MS
            );

            // Handle appointment booking
            if (aiResponse.intent === 'appointment_booking' &&
                context.collectedData &&
                this.isAppointmentDataComplete(context.collectedData)) {
                await this.handleAppointmentBooking(CallSid, context);
            }

            // Check if call should continue
            if (!aiResponse.shouldContinue) {
                await this.withTimeout(
                    this.deps.conversation.updateCallStatus(CallSid, 'completed'),
                    this.DB_TIMEOUT_MS
                ).catch(err => logger.warn('Error updating call status:', err));

                this.cleanupSession(CallSid);
                return this.deps.twilio.generateTwiML(aiResponse.message);
            }

            // Return TwiML with next prompt
            return this.generateSpeechGatherTwiML(aiResponse.message, CallSid);

        } catch (error) {
            logger.error(`Error processing speech for call ${CallSid}:`, error);
            const errorMessage = "I'm having trouble understanding. Could you please repeat that?";
            return this.generateSpeechGatherTwiML(errorMessage, CallSid);
        }
    }

    //Handle DTMF input (keypad presses)
    async handleDTMFInput(webhookData: WebhookData): Promise<string> {
        const { CallSid, Digits } = webhookData;

        if (!Digits) {
            const retryMessage = "I didn't receive any input. Please try again.";
            return this.generateSpeechGatherTwiML(retryMessage, CallSid);
        }

        logger.info(`🔢 DTMF input for call ${CallSid}: ${Digits}`);

        const session = this.activeSessions.get(CallSid);
        if (session) {
            session.lastActivity = new Date();
            session.conversationTurns++;
        }

        let response = '';

        switch (Digits) {
            case '1':
                response = "You've selected appointment scheduling. Please tell me what type of appointment you need.";
                break;
            case '2':
                response = "You've selected prescription refills. Please describe which medication you need refilled.";
                break;
            case '3':
                response = "You've selected symptom check. Please describe your symptoms.";
                break;
            case '0':
                response = "Transferring to a human operator. Please hold.";
                // In production, you'd transfer to an agent here
                break;
            case '9':
                this.cleanupSession(CallSid);
                return this.deps.twilio.generateTwiML("Thank you for calling. Have a great day!");
            default:
                response = "I didn't recognize that option. Please try again or say 'help' for options.";
                return this.generateSpeechGatherTwiML(response, CallSid);
        }

        return this.generateSpeechGatherTwiML(response, CallSid);
    }

    //Handle call status updates (webhooks from Twilio)
    async handleCallStatus(webhookData: WebhookData): Promise<void> {
        const { CallSid, CallStatus, CallDuration } = webhookData;

        logger.info(`Call status update: ${CallSid}`, {
            status: CallStatus,
            duration: CallDuration
        });

        if (CallStatus === 'completed') {
            await this.withTimeout(
                this.deps.conversation.updateCallStatus(CallSid, 'completed'),
                this.DB_TIMEOUT_MS
            ).catch(err => logger.warn('Error updating call status:', err));

            this.cleanupSession(CallSid);
        }
    }

    //Handle transcription webhook from Twilio
    async handleTranscription(webhookData: WebhookData): Promise<string> {
        const { CallSid, SpeechResult, RecordingUrl } = webhookData;

        logger.info(`Transcription received for call ${CallSid}`, {
            text: SpeechResult,
            recordingUrl: RecordingUrl
        });

        // Process similar to speech input
        return this.handleSpeechInput({
            ...webhookData,
            SpeechResult: SpeechResult || ''
        });
    }

    private async getAIResponse(
        userMessage: string,
        context: any,
        relevantDocs: string[] = []
    ): Promise<AIResponse> {
        try {
            const prompt = this.buildAIPrompt(userMessage, context, relevantDocs);
            const response = await this.withTimeout(
                this.deps.ai.generateResponse(prompt, context),
                8000
            );

            return this.parseAIResponse(response);
        } catch (error) {
            logger.error('Error getting AI response:', error);
            return {
                message: "I apologize for the difficulty. Please try again or call back later.",
                intent: 'error',
                extractedData: {},
                shouldContinue: false,
                confidence: 0
            };
        }
    }

    private buildAIPrompt(userMessage: string, context: any, relevantDocs: string[]): string {
        const collectedData = context?.collectedData || {};
        const previousMessages = context?.previousMessages || [];

        return `
CONVERSATION CONTEXT:
- Current Step: ${context?.currentStep || 'initial'}
- Collected Data: ${JSON.stringify(collectedData)}
- Previous Messages: ${JSON.stringify(previousMessages.slice(-3))}

RELEVANT HEALTHCARE INFORMATION:
${relevantDocs.join('\n')}

USER MESSAGE: "${userMessage}"

INSTRUCTIONS:
You are a healthcare AI assistant. Respond in JSON format.

RESPONSE FORMAT:
{
  "message": "Your response (1-2 sentences, conversational, clear for voice)",
  "intent": "appointment_booking|prescription_refill|symptom_check|general_info|emergency|fallback",
  "extractedData": {
    "specialty": "cardiology|dermatology|etc",
    "preferredDate": "YYYY-MM-DD",
    "reason": "reason for visit",
    "medication": "medication name",
    "urgency": "routine|urgent|emergency"
  },
  "shouldContinue": true/false,
  "confidence": 0.0-1.0
}

RULES:
- Keep responses concise and natural for voice
- Extract data progressively
- Ask for missing information naturally
- Set shouldContinue=false for goodbye, completion, or emergencies
- For emergencies, direct to call 911 immediately
- Maintain HIPAA compliance`;
    }

    private parseAIResponse(response: string): AIResponse {
        try {
            const cleanedResponse = response.replace(/```json\n?|\n?```/g, '').trim();
            const parsed = JSON.parse(cleanedResponse);

            if (!parsed.message || !parsed.intent) {
                throw new Error('Missing required fields in AI response');
            }

            return {
                message: parsed.message,
                intent: parsed.intent,
                extractedData: parsed.extractedData || {},
                shouldContinue: parsed.shouldContinue !== false,
                confidence: Math.min(1, Math.max(0, parsed.confidence || 0.8))
            };
        } catch (error) {
            logger.error('Error parsing AI response:', error, { response });
            return {
                message: "I understand. How can I assist you with your healthcare needs?",
                intent: "fallback",
                extractedData: {},
                shouldContinue: true,
                confidence: 0.5
            };
        }
    }

    private generateSpeechGatherTwiML(message: string, _callSid: string): string {
        const gatherUrl = `${this.deps.twilio.getWebhookUrl()}/gather`;

        let twiml = '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n';
        twiml += `  <Say voice="alice">${this.escapeTwiML(message)}</Say>\n`;
        twiml += `  <Gather input="speech" speechTimeout="auto" maxSpeechTime="10" `;
        twiml += `method="POST" action="${gatherUrl}">\n`;
        twiml += `    <Say voice="alice">Please speak your response now</Say>\n`;
        twiml += `  </Gather>\n`;
        twiml += '</Response>';

        return twiml;
    }

    private escapeTwiML(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    private async handleAppointmentBooking(callSid: string, context: any): Promise<void> {
        try {
            const { collectedData } = context;

            logger.info(`Appointment booking for call ${callSid}`, {
                specialty: collectedData.specialty,
                preferredDate: collectedData.preferredDate,
                reason: collectedData.reason
            });

            const slots = await this.withTimeout(
                this.deps.appointment.findAvailableSlots(),
                this.DB_TIMEOUT_MS
            );

            const matchingSlot = slots.find(slot =>
                slot.doctorName?.includes(collectedData.specialty) ||
                slot.specialization?.toLowerCase().includes(collectedData.specialty?.toLowerCase())
            );

            if (matchingSlot) {
                logger.info(`Found available slot for call ${callSid}`, { slot: matchingSlot });
            } else {
                logger.warn(`No available slots for: ${collectedData.specialty}`);
            }

        } catch (error) {
            logger.error('Error handling appointment booking:', error, { callSid });
        }
    }

    private isAppointmentDataComplete(collectedData: any): boolean {
        return !!(
            collectedData?.specialty &&
            collectedData?.preferredDate &&
            collectedData?.reason
        );
    }

    private initializeSession(
        callSid: string,
        callerNumber: string,
        callStatus: string = 'incoming'
    ): void {
        const session: SessionData = {
            sessionId: callSid,
            callSid,
            callerNumber,
            startTime: new Date(),
            lastActivity: new Date(),
            conversationTurns: 0,
            callStatus
        };
        this.activeSessions.set(callSid, session);
        logger.info(`Session initialized: ${callSid}`);
    }

    private cleanupSession(callSid: string): void {
        const session = this.activeSessions.get(callSid);
        if (session) {
            const duration = new Date().getTime() - session.startTime.getTime();
            logger.info(`Cleaning up session ${callSid}`, {
                duration: `${duration}ms`,
                turns: session.conversationTurns
            });
        }
        this.activeSessions.delete(callSid);
    }

    private async withTimeout<T>(
        promise: Promise<T>,
        timeoutMs: number
    ): Promise<T> {
        const timeout = new Promise<never>((_, reject) =>
            setTimeout(
                () => reject(new Error(`Operation timeout after ${timeoutMs}ms`)),
                timeoutMs
            )
        );
        return Promise.race([promise, timeout]);
    }

    async makeOutboundCall(to: string, _metadata?: any): Promise<any> {
        try {

            const twimlUrl = this.deps.twilio.getWebhookUrl('/incoming');

            logger.info(`Initiating outbound call to ${to}`);

            const callResponse = await this.deps.twilio.makeCall(to, twimlUrl);

            // Log the outbound call
            await this.withTimeout(
                this.deps.conversation.logCall(
                    callResponse.sid,
                    to,
                    'outbound',
                    'initiated'
                ),
                this.DB_TIMEOUT_MS
            ).catch(err => logger.warn('Error logging outbound call:', err));

            logger.info(`Outbound call initiated successfully: ${callResponse.sid}`);
            return callResponse;

        } catch (error) {
            logger.error('Error making outbound call:', error);
            throw new ExternalServiceError('Twilio Outbound Call', error);
        }
    }

    getActiveSessionsCount(): number {
        return this.activeSessions.size;
    }

    getSessionInfo(callSid: string): SessionData | undefined {
        return this.activeSessions.get(callSid);
    }

    getAllActiveSessions(): SessionData[] {
        return Array.from(this.activeSessions.values());
    }

    async destroy(): Promise<void> {
        logger.info('AI Service destroyed');
    }
}