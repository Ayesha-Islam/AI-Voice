import twilio from 'twilio';
import { logger } from '../utils/logger';

export interface TwilioConfig {
    accountSid: string;
    authToken: string;
    phoneNumber: string;
    webhookBaseUrl: string;
}

export interface CallResponse {
    sid: string;
    status: string;
    from: string;
    to: string;
    createdAt: string;
}

export class TwilioService {
    private client: any;
    private config: TwilioConfig;
    private isInitialized: boolean = false;

    constructor(config: TwilioConfig) {
        this.config = config;
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) {
            logger.info('Twilio service already initialized');
            return;
        }

        try {
            const { accountSid, authToken } = this.config;

            if (!accountSid || !authToken) {
                throw new Error('Twilio credentials (accountSid, authToken) are required');
            }

            logger.info('Initializing Twilio Client...');

            this.client = twilio(accountSid, authToken);

            // Verify credentials by fetching account info
            await this.client.api.accounts(accountSid).fetch();

            this.isInitialized = true;
            logger.info('✓ Twilio Client initialized');

        } catch (error) {
            logger.error('Failed to initialize Twilio service:', error);
            throw new Error(`Twilio initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private ensureInitialized(): void {
        if (!this.isInitialized || !this.client) {
            throw new Error('Twilio service not initialized. Call initialize() first.');
        }
    }

    async makeCall(to: string, url: string): Promise<CallResponse> {
        this.ensureInitialized();

        try {
            logger.info(`Initiating call to ${to}`);

            const call = await this.client.calls.create({
                from: this.config.phoneNumber,
                to,
                url, // TwiML URL that Twilio will call to get voice instructions
                statusCallback: `${this.config.webhookBaseUrl}/api/voice/status`,
                statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
                statusCallbackMethod: 'POST',
            });

            logger.info(`Call initiated successfully: ${call.sid}`);

            return {
                sid: call.sid,
                status: call.status,
                from: call.from,
                to: call.to,
                createdAt: call.dateCreated,
            };

        } catch (error) {
            logger.error('Error making call:', error);
            throw new Error(`Failed to initiate call: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async getCall(callSid: string): Promise<any> {
        this.ensureInitialized();

        try {
            logger.info(`Fetching call details: ${callSid}`);
            const call = await this.client.calls(callSid).fetch();
            return call;
        } catch (error) {
            logger.error(`Error fetching call ${callSid}:`, error);
            throw new Error(`Failed to get call: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async getCallRecording(callSid: string): Promise<any> {
        this.ensureInitialized();

        try {
            logger.info(`Fetching recordings for call: ${callSid}`);
            const recordings = await this.client.calls(callSid).recordings.list();
            return recordings;
        } catch (error) {
            logger.error(`Error fetching recordings for ${callSid}:`, error);
            throw new Error(`Failed to get recordings: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async hangupCall(callSid: string): Promise<void> {
        this.ensureInitialized();

        try {
            logger.info(`Hanging up call: ${callSid}`);
            await this.client.calls(callSid).update({ status: 'completed' });
            logger.info(`Call ${callSid} hung up successfully`);
        } catch (error) {
            logger.error(`Error hanging up call ${callSid}:`, error);
            throw new Error(`Failed to hangup call: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    //Generate TwiML response for Twilio
    //TwiML = Twilio Markup Language (XML-based)
    generateTwiML(message: string, options?: {
        gatherInput?: boolean;
        numDigits?: number;
        timeout?: number;
    }): string {
        const { gatherInput = true, numDigits = 1, timeout = 5 } = options || {};

        let twiml = '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n';

        // Say the message
        twiml += `  <Say voice="alice">${this.escapeTwiML(message)}</Say>\n`;

        // If gathering input (DTMF or speech)
        if (gatherInput) {
            twiml += `  <Gather numDigits="${numDigits}" timeout="${timeout}" method="POST">\n`;
            twiml += `    <Say voice="alice">Press any key or speak to continue</Say>\n`;
            twiml += `  </Gather>\n`;
        }

        twiml += '</Response>';

        return twiml;
    }

    //Generate TwiML for recording with transcription
    generateRecordingTwiML(message: string): string {
        let twiml = '<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n';

        twiml += `  <Say voice="alice">${this.escapeTwiML(message)}</Say>\n`;
        twiml += `  <Record transcribe="true" transcribeCallback="${this.config.webhookBaseUrl}/api/voice/transcription" />\n`;
        twiml += '</Response>';

        return twiml;
    }

    //Escape special characters for TwiML
    private escapeTwiML(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    //Generate webhook URL for voice endpoint
    getWebhookUrl(path: string = '/voice'): string {
        return `${this.config.webhookBaseUrl}/api/voice${path}`;
    }

    isReady(): boolean {
        return this.isInitialized && !!this.client;
    }
}

export function createTwilioService(config: TwilioConfig): TwilioService {
    return new TwilioService(config);
}