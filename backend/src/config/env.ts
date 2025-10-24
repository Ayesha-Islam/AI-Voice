import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export interface EnvConfig {
    NODE_ENV: string;
    PORT: number;
    DATABASE_URL: string;
    TWILIO_ACCOUNT_SID: string;
    TWILIO_AUTH_TOKEN: string,
    TWILIO_PHONE_NUMBER: string;
    WEBHOOK_BASE_URL: string;
    APP_URL?: string;
    DEEPGRAM_API_KEY: string;
    GROQ_API_KEY: string,
    CHROMA_SERVER_URL: string;
    CHROMA_COLLECTION_NAME: string;
    ALLOWED_ORIGINS: string;

}

export function loadConfig(): EnvConfig {
    return {
        // Your existing config
        NODE_ENV: process.env.NODE_ENV || 'development',
        PORT: parseInt(process.env.PORT || '8080'),
        DATABASE_URL: process.env.DATABASE_URL || '',

        // Fonoster config
        TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
        TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
        TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
        WEBHOOK_BASE_URL: process.env.WEBHOOK_BASE_URL || 'http://localhost:8080',
        APP_URL: process.env.APP_URL,

        DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
        GROQ_API_KEY: process.env.GROQ_API_KEY,
        CHROMA_SERVER_URL: process.env.CHROMA_SERVER_URL,
        CHROMA_COLLECTION_NAME: process.env.CHROMA_COLLECTION_NAME,
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
    } as EnvConfig;
}

export const config = loadConfig();
