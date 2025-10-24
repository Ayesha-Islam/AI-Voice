// src/types/express.ts
import { Request } from 'express';

export interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        role: string;
    };
}

export interface WebhookRequest extends Request {
    rawBody?: string;
}