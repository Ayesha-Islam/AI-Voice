// src/middleware/validation.middleware.ts
import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../utils/errors';

export function validatePhoneNumber(phone: string): boolean {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phone);
}

export function validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

export function validateRequestBody(requiredFields: string[]) {
    return (req: Request, _res: Response, next: NextFunction) => {
        const missingFields = requiredFields.filter(field => !req.body[field]);

        if (missingFields.length > 0) {
            throw new ValidationError(`Missing required fields: ${missingFields.join(', ')}`);
        }

        next();
    };
}

export function validateQueryParams(requiredParams: string[]) {
    return (req: Request, _res: Response, next: NextFunction) => {
        const missingParams = requiredParams.filter(param => !req.query[param]);

        if (missingParams.length > 0) {
            throw new ValidationError(`Missing required query parameters: ${missingParams.join(', ')}`);
        }

        next();
    };
}

export function sanitizeInput(req: Request, _res: Response, next: NextFunction) {
    // Basic input sanitization
    if (req.body) {
        Object.keys(req.body).forEach(key => {
            if (typeof req.body[key] === 'string') {
                req.body[key] = req.body[key].trim();
            }
        });
    }

    next();
}