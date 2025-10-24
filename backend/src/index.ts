import dotenv from 'dotenv';

dotenv.config();

import { config } from './config';
import { logger } from './utils/logger';
import { container } from './di/container';


async function bootstrap() {
  try {
    logger.info('🚀 Starting Healthcare Voice API...');

    // Validate environment
    if (!config.DATABASE_URL) {
      throw new Error('DATABASE_URL is required');
    }

    // Initialize dependency injection container
    await container.initialize();
    console.log('🔍 Debug: After container init');

    // Start the server on port 8080 for ngrok
    const { startServer } = await import('./server');
    await startServer(8080); // Force port 8080

  } catch (error) {
    console.log('🔍 Debug: Bootstrap error', error);
    logger.error('❌ Failed to start application:', error);
    process.exit(1);
  }
}

// Handle port conflicts by trying alternative ports
async function startWithPortRetry() {
  try {
    await bootstrap();
  } catch (error: any) {
    if (error.code === 'EADDRINUSE') {
      logger.info('🔄 Port 8080 in use, trying 8081...');
      const { startServer } = await import('./server');
      await startServer(8081); // Try port 8081
    } else {
      throw error;
    }
  }
}

startWithPortRetry();