import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';

function validateConfig() {
  const required = [
    'DATABASE_URL',
    'PORT',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_CALLBACK_URL',
    'GOOGLE_TOKEN_ENCRYPTION_KEY',
    'SESSION_SECRET',
    'API_PUBLIC_URL',
    'FRONTEND_URL',
    'CORS_ORIGIN'
  ];

  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Configuration Error: Missing required environment variables: ${missing.join(', ')}`);
  }

  // Validate GOOGLE_TOKEN_ENCRYPTION_KEY must be a valid 32-byte hex string (64 characters)
  const encryptionKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey!)) {
    throw new Error(`Configuration Error: GOOGLE_TOKEN_ENCRYPTION_KEY must be a 64-character hex string representing 32 bytes.`);
  }

  // Validate SESSION_SECRET must not be short/insecure or using the default placeholder
  const sessionSecret = process.env.SESSION_SECRET;
  const insecureSecrets = [
    'dev-session-secret-key-123',
    'dev-session-secret-key-123456789',
    'your-super-secret-jwt-session-key',
    'change-me-in-production-1234567890'
  ];
  if (insecureSecrets.includes(sessionSecret!) || sessionSecret!.length < 16) {
    throw new Error(`Configuration Error: SESSION_SECRET is missing, insecure, or using a known default key.`);
  }
}

async function bootstrap() {
  validateConfig();
  const app = await NestFactory.create(AppModule);

  // Enable CORS for our next.js frontend and extension to send credentials/cookies
  app.enableCors({
    origin: (origin, callback) => {
      const allowedOrigins = [
        process.env.FRONTEND_URL || 'http://localhost:3000',
        ...(process.env.CORS_ORIGIN || 'http://localhost:3000').split(',').map(s => s.trim()),
      ];
      // Also allow requests from Chrome extension origins (chrome-extension://)
      if (!origin || allowedOrigins.includes(origin) || origin.startsWith('chrome-extension://')) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Enable cookie parsing middleware
  app.use(cookieParser());

  // Set the global API prefix
  app.setGlobalPrefix('api');

  // Enforce validation pipes for payload formats
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    })
  );

  // Configure Swagger Documentation Setup
  const config = new DocumentBuilder()
    .setTitle('Gmail Email Tracker API')
    .setDescription(
      'REST services supporting logical thread grouping, recipient-specific tracking pixel injections, and email telemetry query logs.'
    )
    .setVersion('1.0.0')
    .addTag('auth', 'Google OAuth authorization session endpoints')
    .addTag('gmail', 'Gmail composer orchestration split sending')
    .addTag('tracking', '1x1 tracking pixel services')
    .addTag('threads', 'Logical thread analytics and timeline feeds')
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}/api`);
  console.log(`Swagger documentation is available at: http://localhost:${port}/api/docs`);
}
bootstrap();
