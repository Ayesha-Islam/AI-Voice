// src/utils/helpers.ts
import { Response } from 'express';
import { AppError } from './errors';
import { logger } from './logger';

export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: {
        message: string;
        code?: string;
        details?: any;
    };
    meta?: {
        timestamp: string;
        version: string;
    };
}

export function sendSuccess<T>(res: Response, data: T, statusCode: number = 200): void {
    const response: ApiResponse<T> = {
        success: true,
        data,
        meta: {
            timestamp: new Date().toISOString(),
            version: '1.0'
        }
    };
    res.status(statusCode).json(response);
}

export function sendError(res: Response, error: Error | AppError): void {
    const isAppError = error instanceof AppError;
    const statusCode = isAppError ? error.statusCode : 500;
    const message = isAppError ? error.message : 'Internal server error';

    const response: ApiResponse = {
        success: false,
        error: {
            message,
            code: isAppError ? error.constructor.name : 'INTERNAL_ERROR',
            details: isAppError ? error.details : undefined
        },
        meta: {
            timestamp: new Date().toISOString(),
            version: '1.0'
        }
    };

    // Log unexpected errors
    if (!isAppError || !error.isOperational) {
        logger.error('Unhandled error:', error);
    }

    res.status(statusCode).json(response);
}

export function handleAsync(fn: Function) {
    return (req: any, res: any, next: any) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}