import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';

async function bootstrap() {
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
