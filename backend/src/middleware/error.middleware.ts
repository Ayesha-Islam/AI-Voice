// src/middleware/error.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { sendError } from '../utils/helpers';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export function errorHandler(
    error: Error,
    req: Request,
    res: Response,
    next: NextFunction
): void {
    logger.error('Error occurred:', {
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method,
        ip: req.ip
    });

    if (error instanceof AppError) {
        sendError(res, error);
    } else {
        // Generic error for security (don't leak implementation details)
        const genericError = new AppError('Internal server error', 500);
        sendError(res, genericError);
    }
    next();

}

export function notFoundHandler(req: Request, res: Response): void {
    res.status(404).json({
        success: false,
        error: {
            message: `Route ${req.method} ${req.path} not found`,
            code: 'NOT_FOUND'
        },
        meta: {
            timestamp: new Date().toISOString(),
            version: '1.0'
        }
    });
}

export function asyncHandler(fn: Function) {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}