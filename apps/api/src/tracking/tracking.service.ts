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
      where: {
        userId_gmailThreadId: {
          userId: user.id,
          gmailThreadId,
        },
      },
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
    metadata: { userAgent?: string; ip?: string; referer?: string; isSelf?: boolean; sessionUserId?: string }
  ): Promise<void> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const tokenHashLog = tokenHash.slice(0, 12);

    if (this.openRateLimitCache.has(token)) {
      // Ignored due to rate limit threshold (2-second window)
      return;
    }
    this.openRateLimitCache.set(token, Date.now());
    setTimeout(() => {
      this.openRateLimitCache.delete(token);
    }, 2000);

    // 1. Locate recipient and load the thread owner's ID
    const recipient = await this.prisma.trackedRecipient.findUnique({
      where: { trackingToken: token },
      include: {
        trackedMessage: {
          include: {
            trackedThread: true,
          },
        },
      },
    });

    if (!recipient) {
      console.warn(`[INVALID_TRACKING_TOKEN] TokenHash: ${tokenHashLog}`);
      throw new NotFoundException('Invalid tracking token');
    }

    // 2. Determine open telemetry source
    let source: 'GOOGLE_PROXY' | 'DIRECT' | 'UNKNOWN' = 'UNKNOWN';
    if (metadata.userAgent && (metadata.userAgent.includes('GoogleImageProxy') || metadata.userAgent.includes('ggpht.com'))) {
      source = 'GOOGLE_PROXY';
    } else if (metadata.userAgent) {
      source = 'DIRECT';
    }

    // 3. Determine classification (DETECTED_OPEN, SELF_OPEN, UNKNOWN_OPEN)
    // Classify as SELF_OPEN if the session user matches the thread owner (authenticated context).
    // Do NOT trust metadata.isSelf (?sender=true) without authenticated context.
    let classification: 'DETECTED_OPEN' | 'SELF_OPEN' | 'UNKNOWN_OPEN' = 'UNKNOWN_OPEN';
    const belongsToSender = metadata.sessionUserId && recipient.trackedMessage.trackedThread.userId === metadata.sessionUserId;

    if (belongsToSender) {
      classification = 'SELF_OPEN';
    } else if (metadata.isSelf) {
      // ?sender=true query parameter replayed without authenticated context
      classification = 'UNKNOWN_OPEN';
    } else if (source === 'GOOGLE_PROXY') {
      classification = 'DETECTED_OPEN';
    } else if (source === 'DIRECT') {
      classification = 'DETECTED_OPEN';
    }

    // Map classification to backward-compatible category (RECIPIENT_OPEN, SELF_OPEN, UNKNOWN_OPEN)
    let category: OpenCategory = 'UNKNOWN_OPEN';
    if (classification === 'SELF_OPEN') {
      category = 'SELF_OPEN';
    } else if (classification === 'DETECTED_OPEN') {
      category = 'RECIPIENT_OPEN';
    }

    // 4. Hash the IP address to preserve privacy
    let ipHash: string | null = null;
    if (metadata.ip) {
      ipHash = crypto.createHash('sha256').update(metadata.ip).digest('hex');
    }

    const now = new Date();

    // 5. Create tracking event log
    await this.prisma.trackingEvent.create({
      data: {
        trackedRecipientId: recipient.id,
        type: 'OPEN',
        category,
        source,
        classification,
        timestamp: now,
        userAgent: metadata.userAgent || null,
        ipHash,
        referer: metadata.referer || null,
      },
    });

    console.log(`[TRACKING_EVENT_RECEIVED] TokenHash: ${tokenHashLog} Classification: ${classification} Source: ${source} Recipient: ${recipient.email}`);

    // 6. Update recipient summary statistics (Only increment open counts for DETECTED_OPENs)
    if (classification === 'DETECTED_OPEN') {
      await this.prisma.trackedRecipient.update({
        where: { id: recipient.id },
        data: {
          openCount: { increment: 1 },
          firstOpenedAt: recipient.firstOpenedAt ? undefined : now,
          lastOpenedAt: now,
        },
      });
    }
  }
}
