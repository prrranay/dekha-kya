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
    let resolvedInReplyTo = inReplyTo;
    let resolvedReferences = references;
    let activeSubject = subject;

    // Resolve reply headers using Gmail API if threadId is provided
    if (activeGmailThreadId) {
      const thread = await this.gmailService.getThreadMetadata(userId, authoritativeFromEmail, activeGmailThreadId);
      if (!thread || !thread.messages || thread.messages.length === 0) {
        throw new HttpException(
          `Failed to resolve Gmail thread with ID: ${activeGmailThreadId}. The thread may not exist or does not belong to this account.`,
          HttpStatus.BAD_REQUEST
        );
      }

      const lastMsg = this.gmailService.getLatestThreadMessage(thread);
      if (!lastMsg) {
        throw new HttpException(
          `No messages found in Gmail thread with ID: ${activeGmailThreadId}. Thread cannot be replied to.`,
          HttpStatus.BAD_REQUEST
        );
      }

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

    // 1. Initialize DB records BEFORE sending to enable tracking of partial failures
    let dbThread = null;
    if (activeGmailThreadId) {
      dbThread = await this.prisma.trackedThread.findUnique({
        where: {
          userId_gmailThreadId: {
            userId: user.id,
            gmailThreadId: activeGmailThreadId,
          },
        },
      });
    }

    if (!dbThread && activeGmailThreadId) {
      dbThread = await this.prisma.trackedThread.create({
        data: {
          userId: user.id,
          gmailThreadId: activeGmailThreadId,
          subject: activeSubject,
        },
      });
    }

    const trackedMessage = await this.prisma.trackedMessage.create({
      data: {
        trackedThreadId: dbThread ? dbThread.id : 'PENDING_THREAD_LINK',
        gmailMessageId: 'PENDING',
        gmailThreadId: activeGmailThreadId || 'PENDING',
        messageIdHeader: 'PENDING',
        direction: 'OUTBOUND',
        subject: activeSubject,
        sentAt: new Date(),
      },
    });

    const dbRecipients = [];
    const trackingDomain = process.env.API_PUBLIC_URL || process.env.API_URL || 'http://localhost:4000';

    for (const recipient of activeRecipients) {
      const trackingToken = crypto.randomBytes(24).toString('hex');
      const dbRecip = await this.prisma.trackedRecipient.create({
        data: {
          trackedMessageId: trackedMessage.id,
          email: recipient.email.toLowerCase(),
          displayName: recipient.displayName || null,
          recipientType: recipient.recipientType,
          trackingToken,
          sendStatus: 'PENDING',
        },
      });
      dbRecipients.push(dbRecip);
    }

    let sentCount = 0;
    let failedCount = 0;
    let lastError: Error | null = null;

    // 2. Loop and send each recipient-specific MIME copy
    for (const recipient of dbRecipients) {
      let finalHtml = htmlBody;
      if (!finalHtml.trim() && plainTextBody) {
        finalHtml = `<html><body>${escapeHtml(plainTextBody).replace(/\r?\n/g, '<br>')}</body></html>`;
      }

      const pixelTag = `<img src="${trackingDomain}/api/tracking/open/${recipient.trackingToken}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;">`;
      if (finalHtml.includes('</body>')) {
        finalHtml = finalHtml.replace('</body>', `${pixelTag}</body>`);
      } else {
        finalHtml = finalHtml + pixelTag;
      }

      const messageIdHeader = `<copy-${crypto.randomBytes(12).toString('hex')}@mail.gmail.com>`;
      const toHeader = recipient.displayName
        ? `${recipient.displayName} <${recipient.email}>`
        : recipient.email;

      const mime = this.gmailService.buildMimeMessage({
        from: authoritativeFromEmail,
        to: toHeader,
        subject: activeSubject,
        messageIdHeader,
        inReplyTo: resolvedInReplyTo || undefined,
        references: resolvedReferences || undefined,
        htmlBody: finalHtml,
        plainTextBody,
      });

      try {
        const sendResult = await this.gmailService.sendMime(
          userId,
          authoritativeFromEmail,
          mime,
          activeGmailThreadId || undefined
        );

        sentCount++;
        if (!activeGmailThreadId) {
          activeGmailThreadId = sendResult.gmailThreadId;
        }

        await this.prisma.trackedRecipient.update({
          where: { id: recipient.id },
          data: {
            sendStatus: 'SENT',
            sentAt: new Date(),
            gmailMessageId: sendResult.gmailMessageId,
          },
        });

        const tokenHashLog = crypto.createHash('sha256').update(recipient.trackingToken).digest('hex').slice(0, 12);
        console.log(`[GMAIL_SEND_SUCCESS] MessageID: ${sendResult.gmailMessageId} Recipient: ${recipient.email} TokenHash: ${tokenHashLog}`);
      } catch (error: unknown) {
        lastError = error as Error;
        failedCount++;
        const err = error as Error;
        console.error(`[GMAIL_SEND_FAILURE] Recipient: ${recipient.email} Error: ${err.message}`);

        await this.prisma.trackedRecipient.update({
          where: { id: recipient.id },
          data: {
            sendStatus: 'FAILED',
            sendError: err.message || 'Gmail transmission failed',
          },
        });
      }
    }

    if (sentCount === 0 && lastError) {
      throw new HttpException(
        lastError.message || 'Gmail transmission failed completely',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    // 3. Post-send cleanup of thread/message pointers
    if (sentCount > 0 && activeGmailThreadId) {
      if (!dbThread) {
        dbThread = await this.prisma.trackedThread.findUnique({
          where: {
            userId_gmailThreadId: {
              userId: user.id,
              gmailThreadId: activeGmailThreadId,
            },
          },
        });

        if (!dbThread) {
          dbThread = await this.prisma.trackedThread.create({
            data: {
              userId: user.id,
              gmailThreadId: activeGmailThreadId,
              subject: activeSubject,
            },
          });
        }
      }

      const firstSent = await this.prisma.trackedRecipient.findFirst({
        where: { trackedMessageId: trackedMessage.id, sendStatus: 'SENT' },
      });

      await this.prisma.trackedMessage.update({
        where: { id: trackedMessage.id },
        data: {
          trackedThreadId: dbThread.id,
          gmailThreadId: activeGmailThreadId,
          gmailMessageId: firstSent?.gmailMessageId || 'FAILED_ALL',
          messageIdHeader: `<copy-primary@mail.gmail.com>`,
        },
      });
    } else {
      await this.prisma.trackedMessage.update({
        where: { id: trackedMessage.id },
        data: {
          trackedThreadId: dbThread ? dbThread.id : 'FAILED',
          gmailThreadId: 'FAILED',
          gmailMessageId: 'FAILED',
          messageIdHeader: 'FAILED',
        },
      });
    }

    const recipientsList = await this.prisma.trackedRecipient.findMany({
      where: { trackedMessageId: trackedMessage.id },
      select: {
        id: true,
        email: true,
        recipientType: true,
        sendStatus: true,
        sendError: true,
        trackingToken: true,
      },
    });

    const mappedRecipients = recipientsList.map((r) => ({
      id: r.id,
      email: r.email,
      recipientType: r.recipientType,
      sendStatus: r.sendStatus,
      sendErrorCode: r.sendError || undefined,
      trackingToken: r.trackingToken,
    }));

    let finalStatus: 'sent' | 'partial' | 'failed' = 'failed';
    if (failedCount === 0) {
      finalStatus = 'sent';
    } else if (sentCount > 0) {
      finalStatus = 'partial';
    }

    return {
      success: sentCount > 0,
      status: finalStatus,
      sentCount,
      failedCount,
      recipients: mappedRecipients,
      gmailThreadId: activeGmailThreadId || undefined,
      trackedMessageId: trackedMessage.id,
    };
  }

  async retry(dto: { trackedMessageId: string; recipientIds: string[]; htmlBody: string; plainTextBody?: string }, userId: string) {
    const { trackedMessageId, recipientIds, htmlBody, plainTextBody } = dto;

    const message = await this.prisma.trackedMessage.findUnique({
      where: { id: trackedMessageId },
      include: {
        trackedThread: true,
        recipients: true,
      },
    });

    if (!message) {
      throw new HttpException('Tracked message not found', HttpStatus.NOT_FOUND);
    }

    if (message.trackedThread.userId !== userId) {
      throw new UnauthorizedException('You do not own this tracked message');
    }

    const gmailAccount = await this.prisma.gmailAccount.findFirst({
      where: { userId },
    });

    if (!gmailAccount) {
      throw new HttpException('Gmail is not connected', HttpStatus.CONFLICT);
    }

    const authoritativeFromEmail = gmailAccount.email;
    const trackingDomain = process.env.API_PUBLIC_URL || process.env.API_URL || 'http://localhost:4000';

    let sentCount = 0;
    let failedCount = 0;

    const targets = message.recipients.filter(
      (r) => recipientIds.includes(r.id) && r.sendStatus === 'FAILED'
    );

    for (const recipient of targets) {
      let finalHtml = htmlBody;
      if (!finalHtml.trim() && plainTextBody) {
        finalHtml = `<html><body>${escapeHtml(plainTextBody).replace(/\r?\n/g, '<br>')}</body></html>`;
      }

      const pixelTag = `<img src="${trackingDomain}/api/tracking/open/${recipient.trackingToken}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;">`;
      if (finalHtml.includes('</body>')) {
        finalHtml = finalHtml.replace('</body>', `${pixelTag}</body>`);
      } else {
        finalHtml = finalHtml + pixelTag;
      }

      const messageIdHeader = `<copy-${crypto.randomBytes(12).toString('hex')}@mail.gmail.com>`;
      const toHeader = recipient.displayName
        ? `${recipient.displayName} <${recipient.email}>`
        : recipient.email;

      const mime = this.gmailService.buildMimeMessage({
        from: authoritativeFromEmail,
        to: toHeader,
        subject: message.subject,
        messageIdHeader,
        htmlBody: finalHtml,
        plainTextBody,
      });

      try {
        const sendResult = await this.gmailService.sendMime(
          userId,
          authoritativeFromEmail,
          mime,
          message.gmailThreadId || undefined
        );

        sentCount++;

        await this.prisma.trackedRecipient.update({
          where: { id: recipient.id },
          data: {
            sendStatus: 'SENT',
            sentAt: new Date(),
            gmailMessageId: sendResult.gmailMessageId,
            sendError: null,
          },
        });

        const tokenHashLog = crypto.createHash('sha256').update(recipient.trackingToken).digest('hex').slice(0, 12);
        console.log(`[GMAIL_RETRY_SUCCESS] MessageID: ${sendResult.gmailMessageId} Recipient: ${recipient.email} TokenHash: ${tokenHashLog}`);
      } catch (error: unknown) {
        failedCount++;
        const err = error as Error;
        console.error(`[GMAIL_RETRY_FAILURE] Recipient: ${recipient.email} Error: ${err.message}`);

        await this.prisma.trackedRecipient.update({
          where: { id: recipient.id },
          data: {
            sendStatus: 'FAILED',
            sendError: err.message || 'Gmail transmission failed',
          },
        });
      }
    }

    if (sentCount > 0 && (message.gmailMessageId === 'FAILED' || message.gmailMessageId === 'PENDING')) {
      const firstSent = await this.prisma.trackedRecipient.findFirst({
        where: { trackedMessageId: message.id, sendStatus: 'SENT' },
      });
      if (firstSent) {
        await this.prisma.trackedMessage.update({
          where: { id: message.id },
          data: {
            gmailMessageId: firstSent.gmailMessageId || 'FAILED_ALL',
          },
        });
      }
    }

    const recipientsList = await this.prisma.trackedRecipient.findMany({
      where: { trackedMessageId: message.id },
      select: {
        id: true,
        email: true,
        recipientType: true,
        sendStatus: true,
        sendError: true,
        trackingToken: true,
      },
    });

    const mappedRecipients = recipientsList.map((r) => ({
      id: r.id,
      email: r.email,
      recipientType: r.recipientType,
      sendStatus: r.sendStatus,
      sendErrorCode: r.sendError || undefined,
      trackingToken: r.trackingToken,
    }));

    const totalSent = recipientsList.filter((r) => r.sendStatus === 'SENT').length;
    const totalFailed = recipientsList.filter((r) => r.sendStatus === 'FAILED').length;

    let finalStatus: 'sent' | 'partial' | 'failed' = 'failed';
    if (totalFailed === 0) {
      finalStatus = 'sent';
    } else if (totalSent > 0) {
      finalStatus = 'partial';
    }

    return {
      success: totalSent > 0,
      status: finalStatus,
      sentCount: totalSent,
      failedCount: totalFailed,
      recipients: mappedRecipients,
      gmailThreadId: message.gmailThreadId,
      trackedMessageId: message.id,
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

  @Post('send/retry')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Retry sending to failed recipients for a tracked message' })
  async retryMail(
    @Body() dto: { trackedMessageId: string; recipientIds: string[]; htmlBody: string; plainTextBody?: string },
    @CurrentUser() currentUser: { id: string }
  ) {
    return this.orchestrator.retry(dto, currentUser.id);
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
