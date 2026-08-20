import { Module } from '@nestjs/common';
import { GmailService } from './gmail.service';
import { GmailController, SendOrchestrator } from './gmail.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [GmailController],
  providers: [GmailService, SendOrchestrator, PrismaService],
  exports: [GmailService],
})
export class GmailModule {}
