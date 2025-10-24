// src/middleware/auth.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '../utils/errors';
import { logger } from '../utils/logger';

export function authenticateAPIKey(req: Request, _res: Response, next: NextFunction) {
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    // In production, validate against your API key store
    const validApiKey = process.env.API_KEY;

    if (!validApiKey) {
        // If no API key is configured, allow all requests (for development)
        return next();
    }

    if (!apiKey || apiKey !== validApiKey) {
        logger.warn('Invalid API key attempt:', { ip: req.ip, path: req.path });
        throw new UnauthorizedError('Invalid API key');
    }

    next();
}

export function requireHTTPS(req: Request, res: Response, next: NextFunction) {
    if (process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] !== 'https') {
        return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
}