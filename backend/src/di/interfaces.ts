export interface IService {
    initialize?(): Promise<void>;
    destroy?(): Promise<void>;

}

export interface IDeepgramService extends IService {
    transcribe(audioUrl: string): Promise<string>;
}

export interface IAIService extends IService {
    generateResponse(prompt: string, context: any): Promise<string>;
    processSMS(message: string, sender: string): Promise<any>;
    healthCheck(): Promise<boolean>;
}

export interface ITTSService extends IService {
    synthesize(text: string): Promise<string>;
}

export interface ITwilioService extends IService {
    makeCall(to: string, from: string, webhookUrl: string): Promise<any>;
    sendSMS(to: string, from: string, message: string): Promise<any>;
    getCall(callSid: string): Promise<any>;
    listCalls(limit?: number): Promise<any[]>;
    hangupCall(callSid: string): Promise<void>;
    getWebhookUrl(path?: string): string;
    isReady(): boolean;
}

export interface IChromaService extends IService {
    search(query: string, nResults?: number): Promise<string[]>;
    addDocuments(documents: any[]): Promise<void>;
    isConnected(): boolean;
    isLimitedMode(): boolean;
    getKnowledgeBaseSize(): number;
    getCollectionInfo(): Promise<any>;
    getStats(): Promise<any>;
    healthCheck(): Promise<boolean>;
}

export interface IConversationService extends IService {
    updateCallStatus(callSid: string, status: string, duration?: number): Promise<void>;
    logCallStart(callSid: string, from: string, to: string, direction: string): Promise<void>;
    finalizeCall(callSid: string, details: any): Promise<void>;
    getCallSummary(callSid: string): Promise<any>;
    logSMSInteraction(data: any): Promise<void>;
    logEmergency(phoneNumber: string, message: string): Promise<void>;
    getActiveCallCount(): Promise<number>;
    healthCheck(): Promise<void>;
    initializeContext(callSid: string, callerId: string): Promise<any>;
}

export interface IAppointmentService extends IService {
    scheduleFromSMS(data: any): Promise<any>;
    getPendingAppointmentCount(): Promise<number>;
    scheduleAppointment(appointmentData: any): Promise<any>;
    cancelAppointment(appointmentId: string): Promise<any>;
    getAvailableSlots(doctorId?: string, date?: string): Promise<any[]>;
}

export interface IVoiceService extends IService {
    handleIncomingCall(callData: any): Promise<any>;
    handleOutboundCall(callData: any): Promise<any>;
    transcribeCall(callSid: string, audioUrl: string): Promise<any>;
}

export const ServiceKeys = {
    PRISMA: 'PrismaClient',
    DEEPGRAM: 'DeepgramService',
    AI: 'AIService',
    TTS: 'TTSService',
    TWILIO: 'TwilioService',
    CHROMA: 'ChromaService',
    APPOINTMENT: 'AppointmentService',
    CONVERSATION: 'ConversationService',
    VOICE: 'VoiceService',
} as const;

export type ServiceKey = typeof ServiceKeys[keyof typeof ServiceKeys];
