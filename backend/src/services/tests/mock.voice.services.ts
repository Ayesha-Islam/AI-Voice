import { AIService } from "../ai.services";
import { AppointmentService } from "../appointment.services";
import { ChromaService } from "../chroma.services";
import { ConversationService } from "../conversation.services";
import { DeepgramService } from "../deepgram.services";
import { TTSService } from "../tts.services";
import { TwilioService } from "../twilio.services";
import { VoiceService } from "../voice.services";

describe('VoiceService', () => {
    let voiceService: VoiceService;
    let mockConversationService: jest.Mocked<ConversationService>;
    let mockApointmentService: jest.Mocked<AppointmentService>;
    let mockAIService: jest.Mocked<AIService>;
    let mockTwilioService: jest.Mocked<TwilioService>;
    let mockDeepgramService: jest.Mocked<DeepgramService>;
    let mockTTSService: jest.Mocked<TTSService>;
    let mockChromaService: jest.Mocked<ChromaService>;

    const mockDependencies = {
        deepgram: mockDeepgramService,
        ai: mockAIService,
        tts: mockTTSService,
        twilio: mockTwilioService,
        chroma: mockChromaService,
        conversation: mockConversationService,
        ppointment: mockAppointmentService;
    };


    beforeEach(() => {
        mockConversationService = {
            initializeContext: jest.fn().mockResolvedValue(undefined),
            logCall: jest.fn().mockResolvedValue(undefined),
            getContext: jest.fn().mockResolvedValue({
                currentStep: 'greeting',
                collectedData: {},
                previousMessage: []
            }),
            updateContext: jest.fn().mockResolvedValue(undefined),
            updateCallStatus: jest.fn().mockResolvedValue(undefined),
        };
    });
});