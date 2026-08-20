import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service';
import { AuthController } from './auth/auth.controller';
import { TrackingController } from './tracking/tracking.controller';
import { TrackingService } from './tracking/tracking.service';
import { ThreadController } from './tracking/thread.controller';
import { ThreadService } from './tracking/thread.service';
import { GmailModule } from './gmail/gmail.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    GmailModule,
  ],
  controllers: [AuthController, TrackingController, ThreadController],
  providers: [PrismaService, TrackingService, ThreadService],
})
export class AppModule {}
