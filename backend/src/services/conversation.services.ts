import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';
import { NotFoundError } from '../utils/errors';

export interface ConversationContext {
    patientPhone?: string;
    currentStep: string;
    collectedData: Record<string, any>;
    previousMessages: Array<{ role: string; content: string; }>;
    appointmentIntent?: boolean;
}

export class ConversationService {
    constructor(private prisma: PrismaClient) { }

    async initializeContext(callSid: string, phoneNumber: string): Promise<void> {
        try {
            const initialContext: ConversationContext = {
                patientPhone: phoneNumber,
                currentStep: 'greeting',
                collectedData: {},
                previousMessages: [],
                appointmentIntent: false
            };

            await this.prisma.conversationContext.upsert({
                where: { callSid },
                update: {
                    // cast to any so Prisma JsonField accepts complex typed object
                    context: initialContext as any,
                    step: 'greeting',
                    lastMessage: null
                },
                create: {
                    callSid,
                    context: initialContext as any,
                    step: 'greeting'
                }
            });

            logger.info(`Conversation context initialized for call: ${callSid}`);
        } catch (error) {
            logger.error('Error initializing conversation context:', error);
            throw error;
        }
    }

    async getContext(callSid: string): Promise<ConversationContext> {
        try {
            const contextRecord = await this.prisma.conversationContext.findUnique({
                where: { callSid }
            });

            if (!contextRecord) {
                throw new NotFoundError('Conversation context', callSid);
            }

            return contextRecord.context as unknown as ConversationContext;
        } catch (error) {
            logger.error('Error getting conversation context:', error);
            throw error;
        }
    }

    async updateContext(
        callSid: string,
        userMessage: string,
        assistantResponse: string,
        intent: string,
        extractedData: any
    ): Promise<void> {
        try {
            const currentContext = await this.getContext(callSid);

            // Update context with new data
            const updatedContext: ConversationContext = {
                ...currentContext,
                collectedData: { ...currentContext.collectedData, ...extractedData },
                previousMessages: [
                    ...currentContext.previousMessages,
                    { role: 'user', content: userMessage },
                    { role: 'assistant', content: assistantResponse }
                ].slice(-10), // Keep last 10 messages
                appointmentIntent: !!(intent === 'appointment_booking' || currentContext.appointmentIntent)
            };

            // Determine next step based on intent and current state
            updatedContext.currentStep = this.determineNextStep(
                currentContext.currentStep,
                intent,
                updatedContext.collectedData
            );

            await this.prisma.conversationContext.update({
                where: { callSid },
                data: {
                    context: updatedContext as any,
                    step: updatedContext.currentStep,
                    lastMessage: assistantResponse
                }
            });

            logger.debug(`Conversation context updated for call: ${callSid}, step: ${updatedContext.currentStep}`);
        } catch (error) {
            logger.error('Error updating conversation context:', error);
            throw error;
        }
    }

    private determineNextStep(currentStep: string, intent: string, collectedData: any): string {
        switch (currentStep) {
            case 'greeting':
                if (intent === 'appointment_booking') return 'collecting_specialty';
                if (intent === 'availability_check') return 'checking_availability';
                return 'general_inquiry';

            case 'collecting_specialty':
                if (collectedData.specialty) return 'collecting_date';
                return 'collecting_specialty';

            case 'collecting_date':
                if (collectedData.preferredDate) return 'collecting_reason';
                return 'collecting_date';

            case 'collecting_reason':
                if (collectedData.reason) return 'confirming_appointment';
                return 'collecting_reason';

            case 'confirming_appointment':
                return 'completion';

            case 'checking_availability':
                return 'availability_results';

            default:
                return 'general_inquiry';
        }
    }

    async logCall(
        callSid: string,
        phoneNumber: string,
        direction: string,
        status: string,
        duration?: number
    ): Promise<void> {
        try {
            await this.prisma.callLog.create({
                data: {
                    callSid,
                    phoneNumber,
                    direction,
                    status,
                    duration: duration ?? null,
                    startedAt: new Date(),
                    endedAt: status === 'completed' ? new Date() : null
                }
            });

            logger.info(`Call logged: ${callSid}, status: ${status}`);
        } catch (error) {
            logger.error('Error logging call:', error);
        }
    }

    async updateCallStatus(callSid: string, status: string, duration?: number): Promise<void> {
        try {
            await this.prisma.callLog.update({
                where: { callSid },
                data: {
                    status,
                    duration: duration ?? null,
                    endedAt: ['completed', 'failed', 'busy', 'no-answer'].includes(status) ? new Date() : null
                }
            });

            logger.debug(`Call status updated: ${callSid} -> ${status}`);
        } catch (error) {
            logger.error('Error updating call status:', error);
        }
    }

    async cleanupOldContexts(hoursOld: number = 24): Promise<void> {
        try {
            const cutoffTime = new Date();
            cutoffTime.setHours(cutoffTime.getHours() - hoursOld);

            const result = await this.prisma.conversationContext.deleteMany({
                where: {
                    updatedAt: { lt: cutoffTime }
                }
            });

            logger.info(`Cleaned up ${result.count} old conversation contexts`);
        } catch (error) {
            logger.error('Error cleaning up old contexts:', error);
        }
    }
}