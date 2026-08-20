import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';
import {
  RegisterMessageRequest,
  RegisterMessageResponse,
  OpenCategory,
} from '@gmail-tracker/shared';

@Injectable()
export class TrackingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registers an outgoing email message and its recipients, setting up
   * logical threads and individual tracking tokens for each recipient.
   */
  async registerMessage(dto: RegisterMessageRequest, userId: string): Promise<RegisterMessageResponse> {
    const { gmailThreadId, gmailMessageId, messageIdHeader, subject, recipients } = dto;

    // Ensure the User exists in our session database records
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Sender user profile not found in database');
    }

    let thread = await this.prisma.trackedThread.findUnique({
      where: { gmailThreadId },
    });

    if (!thread) {
      thread = await this.prisma.trackedThread.create({
        data: {
          userId: user.id,
          gmailThreadId,
          subject,
        },
      });
    }

    // 2. Create the TrackedMessage
    const message = await this.prisma.trackedMessage.create({
      data: {
        trackedThreadId: thread.id,
        gmailMessageId,
        gmailThreadId,
        messageIdHeader,
        direction: 'OUTBOUND',
        subject,
        sentAt: new Date(),
      },
    });

    // 3. Create TrackedRecipient records with cryptographically random tokens
    const createdRecipients = [];
    for (const recipient of recipients) {
      // Generate cryptographically random 32-byte token to ensure unguessability
      const trackingToken = crypto.randomBytes(24).toString('hex');

      const dbRecipient = await this.prisma.trackedRecipient.create({
        data: {
          trackedMessageId: message.id,
          email: recipient.email.toLowerCase(),
          displayName: recipient.displayName || null,
          recipientType: recipient.recipientType,
          trackingToken,
        },
      });

      createdRecipients.push({
        email: dbRecipient.email,
        trackingToken: dbRecipient.trackingToken,
      });
    }

    return {
      trackedMessageId: message.id,
      recipients: createdRecipients,
    };
  }

  private readonly openRateLimitCache = new Map<string, number>();

  /**
   * Tracks an email open event using the recipient's secure token.
   * Performs self-open filtering and logs details.
   */
  async recordOpen(
    token: string,
    metadata: { userAgent?: string; ip?: string; referer?: string; isSelf?: boolean }
  ): Promise<void> {
    const nowTime = Date.now();
    const lastOpenTime = this.openRateLimitCache.get(token);

    if (lastOpenTime && nowTime - lastOpenTime < 2000) {
      // Ignored due to rate limit threshold
      return;
    }
    this.openRateLimitCache.set(token, nowTime);

    // 1. Locate recipient
    const recipient = await this.prisma.trackedRecipient.findUnique({
      where: { trackingToken: token },
    });

    if (!recipient) {
      console.warn(`[INVALID_TRACKING_TOKEN] Token: ${token}`);
      throw new NotFoundException('Invalid tracking token');
    }

    // 2. Determine open category (RECIPIENT_OPEN, SELF_OPEN, UNKNOWN_OPEN)
    let category: OpenCategory = 'RECIPIENT_OPEN';
    if (metadata.isSelf) {
      category = 'SELF_OPEN';
    } else if (!metadata.userAgent) {
      category = 'UNKNOWN_OPEN';
    }

    // 3. Hash the IP address to preserve privacy
    let ipHash: string | null = null;
    if (metadata.ip) {
      ipHash = crypto.createHash('sha256').update(metadata.ip).digest('hex');
    }

    const now = new Date();

    // 4. Create tracking event log
    await this.prisma.trackingEvent.create({
      data: {
        trackedRecipientId: recipient.id,
        type: 'OPEN',
        category,
        timestamp: now,
        userAgent: metadata.userAgent || null,
        ipHash,
        referer: metadata.referer || null,
      },
    });

    console.log(`[TRACKING_EVENT_RECEIVED] Token: ${token} Category: ${category} Recipient: ${recipient.email}`);

    // 5. Update recipient summary statistics (Only increment open counts for RECIPIENT_OPENs)
    if (category === 'RECIPIENT_OPEN') {
      await this.prisma.trackedRecipient.update({
        where: { id: recipient.id },
        data: {
          openCount: { increment: 1 },
          firstOpenedAt: recipient.firstOpenedAt || now,
          lastOpenedAt: now,
        },
      });
    }
  }
}
