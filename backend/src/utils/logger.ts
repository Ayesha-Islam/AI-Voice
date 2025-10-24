// src/utils/logger.ts
import winston from 'winston';
import { config } from '../config';

const logFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

export const logger = winston.createLogger({
    level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    format: logFormat,
    defaultMeta: { service: 'healthcare-voice-api' },
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
    ],
});

if (config.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

export const requestLogger = winston.createLogger({
    level: 'info',
    format: logFormat,
    defaultMeta: { service: 'http-requests' },
    transports: [
        new winston.transports.File({ filename: 'logs/requests.log' }),
    ],
});