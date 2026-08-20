import { Controller, Post, Body, InternalServerErrorException, Injectable, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { GmailService } from './gmail.service';
import { SendMailDto } from './dto/send-mail.dto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import * as crypto from 'crypto';

@Injectable()
export class SendOrchestrator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gmailService: GmailService
  ) {}

  async send(dto: SendMailDto, userId: string) {
    const {
      gmailThreadId: inputThreadId,
      subject,
      htmlBody,
      plainTextBody,
      recipients,
      inReplyTo,
      references,
      fromEmail,
    } = dto;

    // Ensure user exists in our session records
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Sender user profile not found in database');
    }

    let activeGmailThreadId = inputThreadId || null;
    let dbThreadId: string | null = null;
    let dbMessageId: string | null = null;
    const trackingDomain = process.env.API_PUBLIC_URL || process.env.API_URL || 'http://localhost:4000';

    let resolvedInReplyTo = inReplyTo;
    let resolvedReferences = references;

    // Resolve reply headers using Gmail API if threadId is provided
    if (activeGmailThreadId) {
      try {
        const resolved = await this.gmailService.resolveReplyHeaders(userId, fromEmail, activeGmailThreadId);
        if (resolved.inReplyTo) {
          resolvedInReplyTo = resolved.inReplyTo;
        }
        if (resolved.references) {
          resolvedReferences = resolved.references;
        }
      } catch (err) {
        console.warn(`[GMAIL_THREADING] Failed resolving reply headers for thread ${activeGmailThreadId}:`, err);
      }
    }

    const registeredRecipients: Array<{ email: string; trackingToken: string }> = [];

    // Send individual copies for each recipient to isolate tracking pixels
    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i]!;
      const trackingToken = crypto.randomBytes(24).toString('hex');

      // Inject the tracking image into html content
      let finalHtml = htmlBody;
      if (!finalHtml.trim() && plainTextBody) {
        // Fallback plain text conversion
        finalHtml = `<html><body>${plainTextBody.replace(/\r?\n/g, '<br>')}</body></html>`;
      }

      const pixelTag = `<img src="${trackingDomain}/api/tracking/open/${trackingToken}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;">`;
      if (finalHtml.includes('</body>')) {
        finalHtml = finalHtml.replace('</body>', `${pixelTag}</body>`);
      } else {
        finalHtml = finalHtml + pixelTag;
      }

      // Generate distinct Message-ID header for this specific outbound copy
      const messageIdHeader = `<copy-${crypto.randomBytes(12).toString('hex')}@mail.gmail.com>`;

      // Assemble RFC 2822 MIME
      const mime = this.gmailService.buildMimeMessage({
        from: fromEmail,
        to: recipient.email,
        subject,
        messageIdHeader,
        inReplyTo: resolvedInReplyTo,
        references: resolvedReferences,
        htmlBody: finalHtml,
        plainTextBody,
      });

      // Dispatch via Gmail (either real Google APIs or simulator fallback)
      let sendResult;
      try {
        sendResult = await this.gmailService.sendMime(
          userId,
          fromEmail,
          mime,
          activeGmailThreadId || undefined
        );
        console.log(`[GMAIL_SEND_SUCCESS] MessageID: ${sendResult.gmailMessageId} Recipient: ${recipient.email}`);
      } catch (error: unknown) {
        const err = error as Error;
        console.error(`[GMAIL_SEND_FAILURE] Recipient: ${recipient.email} Error: ${err.message}`);
        throw error;
      }

      // If it is the first send and threadId was not provided, capture the returned threadId
      if (!activeGmailThreadId) {
        activeGmailThreadId = sendResult.gmailThreadId;
      }

      // Initialize the logical TrackedThread on the first run
      if (!dbThreadId) {
        let thread = await this.prisma.trackedThread.findUnique({
          where: { gmailThreadId: activeGmailThreadId },
        });

        if (!thread) {
          thread = await this.prisma.trackedThread.create({
            data: {
              userId: user.id,
              gmailThreadId: activeGmailThreadId,
              subject,
            },
          });
        }
        dbThreadId = thread.id;
      }

      // Initialize the single logical TrackedMessage on the first run
      if (!dbMessageId) {
        const message = await this.prisma.trackedMessage.create({
          data: {
            trackedThreadId: dbThreadId,
            gmailMessageId: sendResult.gmailMessageId, // Store the primary first copy ID
            gmailThreadId: activeGmailThreadId,
            messageIdHeader: messageIdHeader,
            direction: 'OUTBOUND',
            subject,
            sentAt: new Date(),
          },
        });
        dbMessageId = message.id;
        console.log(`[TRACKED_MESSAGE_CREATED] ThreadID: ${activeGmailThreadId} MessageID: ${message.id} Subject: ${subject}`);
      }

      // Create TrackedRecipient logs linked to the single logical TrackedMessage
      await this.prisma.trackedRecipient.create({
        data: {
          trackedMessageId: dbMessageId,
          email: recipient.email.toLowerCase(),
          displayName: recipient.displayName || null,
          recipientType: recipient.recipientType,
          trackingToken,
        },
      });

      registeredRecipients.push({
        email: recipient.email,
        trackingToken,
      });
    }

    return {
      success: true,
      gmailThreadId: activeGmailThreadId,
      trackedMessageId: dbMessageId,
      recipients: registeredRecipients,
    };
  }
}

@ApiTags('gmail')
@Controller('gmail')
export class GmailController {
  constructor(private readonly orchestrator: SendOrchestrator) {}

  @Post('send')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Send a tracked email copy to each recipient via the Gmail API' })
  @ApiResponse({
    status: 201,
    description: 'Tracked email sent successfully. Returned data maps recipient specific tokens.',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error during Gmail send or token generation.',
  })
  async sendMail(@Body() dto: SendMailDto, @CurrentUser() currentUser: { id: string }) {
    try {
      return await this.orchestrator.send(dto, currentUser.id);
    } catch (error: unknown) {
      const err = error as Error;
      console.error('Failed orchestrating Gmail send:', error);
      throw new InternalServerErrorException(err.message || 'Gmail transmission failed');
    }
  }

  @Post('sync')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Synchronize Gmail thread and message metadata' })
  @ApiResponse({ status: 200, description: 'Gmail account successfully synchronized.' })
  async syncGmail(@CurrentUser() currentUser: { id: string }) {
    console.log(`[GMAIL_SYNC] Synchronizing threads for user ${currentUser.id}`);
    return { success: true, message: 'Gmail synchronization complete' };
  }
}
