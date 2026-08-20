import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ThreadQueryDto } from './dto/thread-query.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ThreadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves all logical tracked threads matching the filters, including search and status.
   */
  async listThreads(dto: ThreadQueryDto, userId: string) {
    const { search, status, startDate, endDate } = dto;

    // Build the query where parameters
    const whereClause: Prisma.TrackedThreadWhereInput = {
      userId,
    };

    if (search) {
      whereClause.OR = [
        { subject: { contains: search, mode: 'insensitive' } },
        {
          messages: {
            some: {
              recipients: {
                some: {
                  email: { contains: search, mode: 'insensitive' },
                },
              },
            },
          },
        },
      ];
    }

    if (startDate || endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);
      whereClause.createdAt = dateFilter;
    }

    // Retrieve all matching threads with their child messages and recipients
    const threads = await this.prisma.trackedThread.findMany({
      where: whereClause,
      include: {
        messages: {
          include: {
            recipients: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    // Map and aggregate stats for each thread
    const mappedThreads = threads.map((thread) => {
      let totalOpens = 0;
      const recipientEmails = new Set<string>();
      let lastActivityDate: Date = thread.updatedAt;

      thread.messages.forEach((msg) => {
        msg.recipients.forEach((recip) => {
          totalOpens += recip.openCount;
          recipientEmails.add(recip.email.toLowerCase());
          if (recip.lastOpenedAt && recip.lastOpenedAt > lastActivityDate) {
            lastActivityDate = recip.lastOpenedAt;
          }
        });
      });

      let calculatedStatus: 'Opened' | 'Unopened' | 'Partial' = 'Unopened';
      if (totalOpens > 0) {
        // If all distinct recipients opened, it's Opened; if some, it's Partial
        const hasUnopened = thread.messages.some((msg) =>
          msg.recipients.some((r) => r.openCount === 0)
        );
        calculatedStatus = hasUnopened ? 'Partial' : 'Opened';
      }

      return {
        id: thread.id,
        subject: thread.subject,
        gmailThreadId: thread.gmailThreadId,
        sentDate: thread.createdAt,
        lastActivity: totalOpens > 0 ? lastActivityDate : null,
        openCount: totalOpens,
        totalRecipients: recipientEmails.size,
        status: calculatedStatus,
        messagesCount: thread.messages.length,
      };
    });

    // Apply the status filter on our aggregated results
    if (status) {
      return mappedThreads.filter((t) => {
        if (status === 'opened') return t.openCount > 0;
        if (status === 'not-detected') return t.openCount === 0;
        return true;
      });
    }

    return mappedThreads;
  }

  /**
   * Retrieves full details for a single Thread, including messages and recipient-level metrics.
   */
  async getThreadDetails(threadId: string, userId: string) {
    const thread = await this.prisma.trackedThread.findFirst({
      where: { id: threadId, userId },
      include: {
        messages: {
          include: {
            recipients: {
              include: {
                events: {
                  orderBy: { timestamp: 'desc' },
                },
              },
            },
          },
          orderBy: {
            sentAt: 'asc',
          },
        },
      },
    });

    if (!thread) {
      throw new NotFoundException('Thread not found');
    }

    // Aggregate statistics at the thread header level
    let totalOpens = 0;
    const recipientEmails = new Set<string>();
    let lastActivityDate: Date | null = null;

    const messages = thread.messages.map((msg) => {
      const recipients = msg.recipients.map((recip) => {
        totalOpens += recip.openCount;
        recipientEmails.add(recip.email.toLowerCase());
        if (recip.lastOpenedAt && (!lastActivityDate || recip.lastOpenedAt > lastActivityDate)) {
          lastActivityDate = recip.lastOpenedAt;
        }

        return {
          id: recip.id,
          email: recip.email,
          displayName: recip.displayName,
          recipientType: recip.recipientType,
          openCount: recip.openCount,
          firstOpenedAt: recip.firstOpenedAt,
          lastOpenedAt: recip.lastOpenedAt,
        };
      });

      return {
        id: msg.id,
        gmailMessageId: msg.gmailMessageId,
        subject: msg.subject,
        sentAt: msg.sentAt,
        direction: msg.direction,
        recipients,
      };
    });

    return {
      id: thread.id,
      gmailThreadId: thread.gmailThreadId,
      subject: thread.subject,
      totalRecipients: recipientEmails.size,
      openCount: totalOpens,
      lastActivity: lastActivityDate,
      messages,
    };
  }

  /**
   * Retrieves the event history logs for a specific recipient, hiding raw IP configurations.
   */
  async getRecipientEvents(recipientId: string) {
    const recipient = await this.prisma.trackedRecipient.findUnique({
      where: { id: recipientId },
      include: {
        events: {
          orderBy: { timestamp: 'desc' },
        },
      },
    });

    if (!recipient) {
      throw new NotFoundException('Recipient not found');
    }

    // Format events - omit raw IP addresses/sensitive details to preserve privacy
    const events = recipient.events.map((event) => ({
      id: event.id,
      type: event.type,
      category: event.category,
      timestamp: event.timestamp,
      userAgent: event.userAgent,
      referer: event.referer,
    }));

    return {
      recipientId: recipient.id,
      email: recipient.email,
      displayName: recipient.displayName,
      events,
    };
  }

  /**
   * Retrieves summary count metrics and live activity logs for the dashboard home feed.
   */
  async getDashboardStats(userId: string) {
    const threads = await this.prisma.trackedThread.findMany({
      where: { userId },
      include: {
        messages: {
          include: {
            recipients: true,
          },
        },
      },
    });

    let totalTracked = 0;
    let openedThreadsCount = 0;
    let totalOpens = 0;

    threads.forEach((thread) => {
      let threadOpens = 0;
      thread.messages.forEach((msg) => {
        totalTracked++;
        msg.recipients.forEach((recip) => {
          threadOpens += recip.openCount;
          totalOpens += recip.openCount;
        });
      });
      if (threadOpens > 0) {
        openedThreadsCount++;
      }
    });

    // Fetch the 5 most recent tracking events across all user emails
    const recentEvents = await this.prisma.trackingEvent.findMany({
      where: {
        trackedRecipient: {
          trackedMessage: {
            trackedThread: {
              userId,
            },
          },
        },
      },
      include: {
        trackedRecipient: {
          include: {
            trackedMessage: true,
          },
        },
      },
      orderBy: {
        timestamp: 'desc',
      },
      take: 5,
    });

    const mappedRecent = recentEvents.map((evt) => ({
      id: evt.id,
      recipientEmail: evt.trackedRecipient.email,
      recipientName: evt.trackedRecipient.displayName || evt.trackedRecipient.email,
      subject: evt.trackedRecipient.trackedMessage.subject,
      timestamp: evt.timestamp,
      category: evt.category,
    }));

    return {
      totalTracked,
      openedEmails: openedThreadsCount,
      totalDetectedOpens: totalOpens,
      recentEvents: mappedRecent,
    };
  }
}
