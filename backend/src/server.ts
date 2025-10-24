import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import { logger, requestLogger } from './utils/logger';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { requireHTTPS } from './middleware/auth.middleware';
import mainRouter from './routes';

export function createServer() {
    const app = express();

    // Security middleware
    app.use(helmet({
        crossOriginResourcePolicy: { policy: "cross-origin" },
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                scriptSrc: ["'self'"],
                imgSrc: ["'self'", "data:", "https:"],
            },
        }
    }));

    // CORS configuration (MUST be early)
    app.use(cors({
        origin: process.env.ALLOWED_ORIGINS?.split(',') || true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
    }));

    // Request logging
    app.use(morgan('combined', {
        stream: {
            write: (message: string) => requestLogger.info(message.trim())
        }
    }));

    // Body parsing middleware (MUST be before routes)
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Force HTTPS in production
    if (config.NODE_ENV === 'production') {
        app.use(requireHTTPS);
    }

    // ============= HEALTH CHECK (before main routes) =============
    app.get('/health', (_req, res) => {
        res.status(200).json({
            status: 'OK',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            environment: config.NODE_ENV,
            port: config.PORT
        });
    });

    // ============= ROOT ENDPOINT =============
    app.get('/', (_req, res) => {
        res.json({
            success: true,
            message: 'Healthcare Voice API - Server is up and running',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            documentation: 'http://localhost:8080/'
        });
    });

    // ============= API ROUTES (includes /api/voice/*) =============
    app.use('/api', mainRouter);

    // ============= 404 & ERROR HANDLING =============
    app.use(notFoundHandler);
    app.use(errorHandler);

    // ============= DEBUG: Print registered routes =============
    printRegisteredRoutes(app);

    return app;
}

// Helper function to print all registered routes
function printRegisteredRoutes(app: any) {
    console.log('\n🔍 === REGISTERED ROUTES ===');

    const printRoutes = (stack: any, prefix = '') => {
        stack.forEach((middleware: any) => {
            if (middleware.route) {
                // Direct route
                const method = Object.keys(middleware.route.methods)[0].toUpperCase();
                const path = prefix + middleware.route.path;
                console.log(`📍 ${method.padEnd(6)} ${path}`);
            } else if (middleware.name === 'router' && middleware.handle.stack) {
                // Nested router
                const routerPath = middleware.regexp
                    .source
                    .replace('\\/', '/')
                    .replace('(?:', '')
                    .replace(')?', '')
                    .replace('\\', '')
                    .replace(/\$/g, '')
                    .replace(/^\^/, '');

                printRoutes(middleware.handle.stack, prefix + routerPath);
            }
        });
    };

    printRoutes(app._router.stack);
    console.log('🔍 === END ROUTES ===\n');
}

export async function startServer(port?: number): Promise<void> {
    const app = createServer();
    const serverPort = port || config.PORT;

    const server = app.listen(serverPort, () => {
        logger.info(`🚀 Server running on port ${serverPort}`);
        logger.info(`📊 Environment: ${config.NODE_ENV}`);
        logger.info(`🔗 Webhook Base URL: ${config.WEBHOOK_BASE_URL}`);
        logger.info(`🏥 Health check: http://localhost:${serverPort}/health`);
        logger.info(`📚 API docs: http://localhost:${serverPort}/`);
        logger.info(`📞 Voice webhook: ${config.WEBHOOK_BASE_URL}/api/voice/webhook`);
    });

    // Handle port already in use
    server.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
            logger.error(`❌ Port ${serverPort} is already in use. Trying alternative port...`);
            // Try alternative port
            const alternativePort = serverPort + 1;
            const alternativeServer = app.listen(alternativePort, () => {
                logger.info(`🚀 Server running on alternative port ${alternativePort}`);
                logger.info(`🏥 Health check: http://localhost:${alternativePort}/health`);
            });
            // Apply graceful shutdown to alternative server
            setupGracefulShutdown(alternativeServer);
        } else {
            logger.error('Server error:', error);
            process.exit(1);
        }
    });

    setupGracefulShutdown(server);
}

function setupGracefulShutdown(server: any) {
    const gracefulShutdown = async (signal: string) => {
        logger.info(`Received ${signal}, starting graceful shutdown...`);
        server.close(async (err: any) => {
            if (err) {
                logger.error('Error during server shutdown:', err);
                process.exit(1);
            }
            try {
                // Close DI container and services
                const { container } = await import('./di/container');
                await container.destroy();
                logger.info('✅ Server shut down gracefully');
                process.exit(0);
            } catch (error) {
                logger.error('Error during service cleanup:', error);
                process.exit(1);
            }
        });

        // Force close after 10 seconds
        setTimeout(() => {
            logger.error('Forced shutdown after timeout');
            process.exit(1);
        }, 10000);
    };

    // Handle termination signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
        logger.error('Uncaught Exception:', error);
        process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
        process.exit(1);
    });
}