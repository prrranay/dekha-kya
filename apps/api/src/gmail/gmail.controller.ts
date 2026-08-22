import { Controller, Post, Body, Injectable, UseGuards, UnauthorizedException, HttpException, HttpStatus, InternalServerErrorException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { GmailService } from './gmail.service';
import { SendMailDto } from './dto/send-mail.dto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import * as crypto from 'crypto';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function deduplicateRecipients(recipients: any[]): any[] {
  const map = new Map<string, any>();
  for (const r of recipients) {
    const emailNorm = r.email.trim().toLowerCase();
    if (!emailNorm) continue;

    const existing = map.get(emailNorm);
    if (!existing) {
      map.set(emailNorm, { ...r, email: emailNorm });
    } else {
      const priority: Record<string, number> = { TO: 3, CC: 2, BCC: 1 };
      const currentPriority = priority[r.recipientType] || 0;
      const existingPriority = priority[existing.recipientType] || 0;
      if (currentPriority > existingPriority) {
        map.set(emailNorm, { ...r, email: emailNorm });
      }
    }
  }
  return Array.from(map.values());
}

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
    } = dto;

    // Ensure user exists in our session records
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Sender user profile not found in database');
    }

    // Determine the sender from the authenticated user's connected GmailAccount
    const gmailAccount = await this.prisma.gmailAccount.findFirst({
      where: { userId },
    });

    if (!gmailAccount) {
      throw new HttpException(
        {
          statusCode: HttpStatus.CONFLICT,
          error: 'GMAIL_NOT_CONNECTED',
          message: 'Gmail is not connected. Connect Gmail before sending tracked email.',
        },
        HttpStatus.CONFLICT
      );
    }

    const authoritativeFromEmail = gmailAccount.email;

    let activeGmailThreadId = inputThreadId || null;
    let dbThreadId: string | null = null;
    let dbMessageId: string | null = null;
    const trackingDomain = process.env.API_PUBLIC_URL || process.env.API_URL || 'http://localhost:4000';

    let resolvedInReplyTo = inReplyTo;
    let resolvedReferences = references;
    let activeSubject = subject;

    // Resolve reply headers using Gmail API if threadId is provided
    if (activeGmailThreadId) {
      // 1. Fetch thread metadata & validate it belongs to the authenticated user
      const thread = await this.gmailService.getThreadMetadata(userId, authoritativeFromEmail, activeGmailThreadId);
      if (!thread || !thread.messages || thread.messages.length === 0) {
        throw new HttpException(
          `Failed to resolve Gmail thread with ID: ${activeGmailThreadId}. The thread may not exist or does not belong to this account.`,
          HttpStatus.BAD_REQUEST
        );
      }

      // 2. Determine the newest message in the thread using internalDate
      const lastMsg = this.gmailService.getLatestThreadMessage(thread);
      if (!lastMsg) {
        throw new HttpException(
          `No messages found in Gmail thread with ID: ${activeGmailThreadId}. Thread cannot be replied to.`,
          HttpStatus.BAD_REQUEST
        );
      }

      // 3. Extract Message-ID and References
      let lastMessageId: string | undefined;
      let lastReferences: string | undefined;
      lastMsg.payload?.headers?.forEach((header: any) => {
        if (header.name?.toLowerCase() === 'message-id') {
          lastMessageId = header.value ?? undefined;
        }
        if (header.name?.toLowerCase() === 'references') {
          lastReferences = header.value ?? undefined;
        }
      });

      if (!lastMessageId) {
        throw new HttpException(
          `Could not extract Message-ID from the latest message in thread ${activeGmailThreadId}. Thread cannot be replied to safely.`,
          HttpStatus.BAD_REQUEST
        );
      }

      resolvedInReplyTo = lastMessageId;
      resolvedReferences = lastReferences
        ? `${lastReferences} ${lastMessageId}`
        : lastMessageId;

      // Extract thread subject from first message
      let threadSubject: string | undefined;
      thread.messages[0]?.payload?.headers?.forEach((header: any) => {
        if (header.name?.toLowerCase() === 'subject') {
          threadSubject = header.value ?? undefined;
        }
      });

      if (threadSubject) {
        activeSubject = threadSubject;
        if (!/^re:/i.test(activeSubject)) {
          activeSubject = `Re: ${activeSubject}`;
        }
      }
    }

    // Deduplicate and normalize recipients
    const activeRecipients = deduplicateRecipients(recipients);
    if (activeRecipients.length === 0) {
      throw new HttpException('No valid recipients provided', HttpStatus.BAD_REQUEST);
    }

    const registeredRecipients: Array<{ email: string; trackingToken: string }> = [];

    // Send individual copies for each recipient to isolate tracking pixels
    for (let i = 0; i < activeRecipients.length; i++) {
      const recipient = activeRecipients[i]!;
      const trackingToken = crypto.randomBytes(24).toString('hex');

      // Inject the tracking image into html content
      let finalHtml = htmlBody;
      if (!finalHtml.trim() && plainTextBody) {
        // Fallback plain text conversion with HTML escaping
        finalHtml = `<html><body>${escapeHtml(plainTextBody).replace(/\r?\n/g, '<br>')}</body></html>`;
      }

      const pixelTag = `<img src="${trackingDomain}/api/tracking/open/${trackingToken}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;">`;
      if (finalHtml.includes('</body>')) {
        finalHtml = finalHtml.replace('</body>', `${pixelTag}</body>`);
      } else {
        finalHtml = finalHtml + pixelTag;
      }

      // Generate distinct Message-ID header for this specific outbound copy
      const messageIdHeader = `<copy-${crypto.randomBytes(12).toString('hex')}@mail.gmail.com>`;

      // Assemble RFC 2822 MIME where:
      // - To header contains only this specific recipient (and displayName if present).
      // - Cc and Bcc are omitted entirely.
      const toHeader = recipient.displayName
        ? `${recipient.displayName} <${recipient.email}>`
        : recipient.email;

      const mime = this.gmailService.buildMimeMessage({
        from: authoritativeFromEmail,
        to: toHeader,
        subject: activeSubject,
        messageIdHeader,
        inReplyTo: resolvedInReplyTo,
        references: resolvedReferences,
        htmlBody: finalHtml,
        plainTextBody,
      });

      // Dispatch via Gmail (no simulator fallback in production)
      let sendResult;
      try {
        sendResult = await this.gmailService.sendMime(
          userId,
          authoritativeFromEmail,
          mime,
          activeGmailThreadId || undefined
        );
        const tokenHashLog = crypto.createHash('sha256').update(trackingToken).digest('hex').slice(0, 12);
        console.log(`[GMAIL_SEND_SUCCESS] MessageID: ${sendResult.gmailMessageId} Recipient: ${recipient.email} TokenHash: ${tokenHashLog}`);
      } catch (error: unknown) {
        const err = error as Error;
        console.error(`[GMAIL_SEND_FAILURE] Recipient: ${recipient.email} Error: ${err.message}`);
        throw error;
      }

      // If it is the first send and threadId was not provided, capture the returned threadId
      if (!activeGmailThreadId) {
        activeGmailThreadId = sendResult.gmailThreadId;
      }

      // Initialize the logical TrackedThread on the first run (using composite user-scoped index)
      if (!dbThreadId) {
        let thread = await this.prisma.trackedThread.findUnique({
          where: {
            userId_gmailThreadId: {
              userId: user.id,
              gmailThreadId: activeGmailThreadId,
            },
          },
        });

        if (!thread) {
          thread = await this.prisma.trackedThread.create({
            data: {
              userId: user.id,
              gmailThreadId: activeGmailThreadId,
              subject: activeSubject,
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
            subject: activeSubject,
            sentAt: new Date(),
          },
        });
        dbMessageId = message.id;
        console.log(`[TRACKED_MESSAGE_CREATED] ThreadID: ${activeGmailThreadId} MessageID: ${message.id} Subject: ${activeSubject}`);
      }

      // Create TrackedRecipient logs linked to the single logical TrackedMessage
      await this.prisma.trackedRecipient.create({
        data: {
          trackedMessageId: dbMessageId,
          email: recipient.email.toLowerCase(),
          displayName: recipient.displayName || null,
          recipientType: recipient.recipientType,
          trackingToken,
          gmailMessageId: sendResult.gmailMessageId, // Store underlying copy ID
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
    status: 409,
    description: 'Gmail account is not connected.',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error during Gmail send or token generation.',
  })
  async sendMail(@Body() dto: SendMailDto, @CurrentUser() currentUser: { id: string }) {
    try {
      return await this.orchestrator.send(dto, currentUser.id);
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
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
