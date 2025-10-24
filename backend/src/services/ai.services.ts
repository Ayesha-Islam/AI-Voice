import { logger } from '../utils/logger';
import { config } from '../config';
import { IAIService } from '../di/interfaces';

interface GroqMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface GroqResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

interface GroqModelsResponse {
    object: string;
    data: Array<{
        id: string;
        object: string;
        created: number;
        owned_by: string;
    }>;
}

// Type guards for runtime type checking
function isGroqModelsResponse(data: any): data is GroqModelsResponse {
    return (
        typeof data === 'object' &&
        data !== null &&
        typeof data.object === 'string' &&
        Array.isArray(data.data)
    );
}

function isGroqResponse(data: any): data is GroqResponse {
    return (
        typeof data === 'object' &&
        data !== null &&
        typeof data.id === 'string' &&
        typeof data.object === 'string' &&
        Array.isArray(data.choices)
    );
}

export class AIService implements IAIService {
    private apiKey: string;
    private baseURL: string = 'https://api.groq.com/openai/v1';
    private model: string = 'llama-3.1-8b-instant';

    constructor() {
        this.apiKey = process.env.GROQ_API_KEY || config.GROQ_API_KEY || '';
        if (!this.apiKey) {
            logger.warn('Groq API key not found. AI service will run in fallback mode.');
        }
    }


    async initialize(): Promise<void> {
        if (!this.apiKey) {
            logger.warn('AI Service: No Groq API key provided, using fallback responses');
            return;
        }

        try {
            await this.testConnection();
            logger.info('✅ AI Service (Groq) initialized successfully');
        } catch (error) {
            logger.error('❌ AI Service initialization failed:', error);
            logger.info('🔄 AI Service will use fallback responses');
        }
    }

    private async testConnection(): Promise<void> {
        if (!this.apiKey) return;

        try {
            const response = await fetch(`${this.baseURL}/models`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Groq API test failed: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            // Use type guard to check the response
            if (isGroqModelsResponse(data)) {
                logger.debug(`Groq API connected. Available models: ${data.data?.length || 0}`);
            } else {
                logger.debug('Groq API connected (unexpected response format)');
            }

        } catch (error) {
            throw new Error(`Groq API connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async generateResponse(prompt: string, context: any = {}): Promise<string> {
        try {
            if (!this.apiKey) {
                return this.getFallbackResponse(prompt, context);
            }

            const messages = this.buildMessages(prompt, context);
            const response = await this.callGroqAPI(messages);

            return this.parseAIResponse(response);
        } catch (error) {
            logger.error('Error generating AI response:', error);
            return this.getFallbackResponse(prompt, context);
        }
    }

    private buildMessages(prompt: string, context: any): GroqMessage[] {
        const systemMessage = this.getSystemPrompt(context);

        return [
            { role: 'system', content: systemMessage },
            { role: 'user', content: prompt }
        ];
    }

    private getSystemPrompt(context: any): string {
        return `You are HealthAssist AI, a healthcare voice assistant for a medical clinic. Your role is to help patients with:

SERVICES:
- Booking appointments with doctors (General Practice, Cardiology, Pediatrics)
- Checking doctor availability and schedules
- Answering general healthcare questions
- Providing information about clinic services and hours
- Collecting necessary information for appointments

CLINIC INFORMATION:
- Hours: Monday-Friday, 9:00 AM - 5:00 PM
- Doctors: Dr. Sarah Smith (General Practice), Dr. Michael Johnson (Cardiology), Dr. Emily Williams (Pediatrics)
- Appointment duration: 30 minutes typically
- Insurance: We accept most major insurance plans

VOICE CONVERSATION GUIDELINES:
1. Keep responses concise (1-2 sentences maximum for voice)
2. Use friendly, professional, and empathetic tone
3. Ask clarifying questions when information is missing
4. For appointments, collect: preferred date/time, doctor specialty, reason for visit
5. Confirm key details before proceeding
6. If unsure, direct to call main office at (555) 123-HELP

CURRENT CONTEXT:
${JSON.stringify(context, null, 2)}

Respond naturally for voice conversation. Be helpful but concise.`;
    }

    private async callGroqAPI(messages: GroqMessage[]): Promise<string> {
        const response = await fetch(`${this.baseURL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages,
                model: this.model,
                temperature: 0.7,
                max_tokens: 150,
                top_p: 1,
                stream: false
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Groq API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();

        // Use type guard to validate the response
        if (!isGroqResponse(data)) {
            throw new Error('Invalid response format from Groq API');
        }

        if (!data.choices || data.choices.length === 0) {
            throw new Error('No response choices from Groq API');
        }

        const content = data.choices[0]?.message?.content;
        if (!content) {
            throw new Error('Empty response content from Groq API');
        }

        return content;
    }

    private parseAIResponse(response: string): string {
        return response
            .replace(/```json\n?|\n?```/g, '')
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/\*(.*?)\*/g, '$1')
            .replace(/#{1,6}\s?/g, '')
            .replace(/\n+/g, ' ')
            .trim();
    }

    private getFallbackResponse(prompt: string, context: any): string {
        const lowerPrompt = prompt.toLowerCase();
        const currentStep = context?.currentStep || 'greeting';

        switch (currentStep) {
            case 'greeting':
                return "Hello! Welcome to HealthCare Voice. I'm your AI assistant. How can I help you with your healthcare needs today?";

            case 'collecting_specialty':
                return "I'd be happy to help you book an appointment. Which specialty are you interested in: General Practice, Cardiology, or Pediatrics?";

            case 'collecting_date':
                return "Great choice! What's your preferred date and time for the appointment? We're available Monday through Friday, 9 AM to 5 PM.";

            case 'collecting_reason':
                return "Could you briefly tell me the reason for your visit? This helps us prepare for your appointment.";

            case 'confirming_appointment':
                return "I have your appointment details. Should I proceed with booking this appointment?";
        }

        if (lowerPrompt.includes('appointment') || lowerPrompt.includes('book') || lowerPrompt.includes('schedule')) {
            return "I can help you book an appointment with our doctors. We have specialists in General Practice, Cardiology, and Pediatrics. What type of doctor would you like to see?";
        }

        if (lowerPrompt.includes('availability') || lowerPrompt.includes('available')) {
            return "I can check doctor availability for you. We're open Monday to Friday, 9 AM to 5 PM. Which specialty and what date are you looking for?";
        }

        if (lowerPrompt.includes('cardiology') || lowerPrompt.includes('heart')) {
            return "Dr. Michael Johnson is our Cardiology specialist. He has 15 years of experience in heart conditions and cardiovascular health. Would you like to book an appointment with him?";
        }

        if (lowerPrompt.includes('pediatric') || lowerPrompt.includes('child')) {
            return "Dr. Emily Williams specializes in Pediatrics and cares for children and infants. She has 8 years of experience. Would you like to schedule a pediatric appointment?";
        }

        if (lowerPrompt.includes('general') || lowerPrompt.includes('practice')) {
            return "Dr. Sarah Smith is our General Practitioner with 10 years of experience in family medicine. She handles routine checkups and common illnesses. Shall I book an appointment with her?";
        }

        if (lowerPrompt.includes('hello') || lowerPrompt.includes('hi') || lowerPrompt.includes('hey')) {
            return "Hello! Thank you for calling HealthCare Voice. I'm here to help with appointments, medical information, and clinic services. How can I assist you today?";
        }

        if (lowerPrompt.includes('hour') || lowerPrompt.includes('time') || lowerPrompt.includes('open')) {
            return "Our clinic is open Monday through Friday from 9:00 AM to 5:00 PM. We're closed on weekends and holidays.";
        }

        if (lowerPrompt.includes('insurance')) {
            return "We accept most major insurance plans including Blue Cross, Aetna, Cigna, and United Healthcare. Please bring your insurance card to your appointment.";
        }

        return "I understand. Could you please provide more details about what you need help with? I can assist with appointment booking, doctor information, or general healthcare questions.";
    }

    async destroy(): Promise<void> {
        logger.info('AI Service destroyed');
    }
    async processSMS(message: string): Promise<any> {
        try {
            // For SMS processing, we might want different behavior than voice
            const response = await this.generateResponse(message, {
                channel: 'sms',
                isSMS: true
            });

            return {
                success: true,
                response,
                vectorCount: 0,
                responseTime: 'N/A',
                uptime: 'N/A'
            };
        } catch (error) {
            logger.error('Error processing SMS:', error);
            return {
                success: false,
                response: this.getFallbackResponse(message, { channel: 'sms' }),
                vectorCount: 0,
                responseTime: 'N/A',
                uptime: 'N/A'
            };
        }
    }

    async healthCheck(): Promise<boolean> {
        try {
            if (!this.apiKey) {
                return true;
            }

            // Test the connection by making a simple models request
            const response = await fetch(`${this.baseURL}/models`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            return response.ok;
        } catch (error) {
            logger.error('AI Service health check failed:', error);
            return false;
        }
    }


}
