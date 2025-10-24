// src/utils/errors.ts
export class AppError extends Error {
    public statusCode: number;
    public isOperational: boolean;
    public details?: any;

    constructor(message: string, statusCode: number = 500, isOperational: boolean = true, details?: any) {
        super(message);
        this.message = message;
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.details = details;
        Object.setPrototypeOf(this, AppError.prototype);
        Error.captureStackTrace(this, this.constructor);
    }
}

export class ValidationError extends AppError {
    constructor(message: string, details?: any) {
        super(message, 400, true, details);
    }
}

export class NotFoundError extends AppError {
    constructor(resource: string, id?: string) {
        super(`${resource}${id ? ` with id ${id}` : ''} not found`, 404);
    }
}

export class ConflictError extends AppError {
    constructor(message: string, details?: any) {
        super(message, 409, true, details);
    }
}

export class UnauthorizedError extends AppError {
    constructor(message: string = 'Unauthorized') {
        super(message, 401);
    }
}

export class ForbiddenError extends AppError {
    constructor(message: string = 'Forbidden') {
        super(message, 403);
    }
}

export class ExternalServiceError extends AppError {
    constructor(service: string, details?: any) {
        super(`Service ${service} is temporarily unavailable`, 503, true, details);
    }
}