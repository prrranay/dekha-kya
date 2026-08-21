import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthGuard } from '../src/auth/auth.guard';

import { ExecutionContext } from '@nestjs/common';

describe('Thread & Message-Level Query and Dashboard E2E Tests', () => {
  let app: INestApplication;

  const mockPrismaService = {
    trackedThread: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    trackedRecipient: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    trackingEvent: {
      findMany: jest.fn(),
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          req.user = { id: 'dev-user-id' };
          return true;
        },
      })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Scenario 1: Thread with one tracked outgoing message
  it('1. Should return thread details with one tracked message', async () => {
    const mockThread = {
      id: 'thread-1',
      gmailThreadId: 't-123',
      subject: 'Interview Follow-up',
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [
        {
          id: 'msg-1',
          gmailMessageId: 'm-123',
          subject: 'Interview Follow-up',
          sentAt: new Date(),
          direction: 'OUTBOUND',
          recipients: [
            {
              id: 'r-1',
              email: 'rahul@gmail.com',
              displayName: 'Rahul',
              recipientType: 'TO',
              openCount: 3,
              firstOpenedAt: new Date(),
              lastOpenedAt: new Date(),
              events: [],
            },
          ],
        },
      ],
    };

    mockPrismaService.trackedThread.findFirst.mockResolvedValueOnce(mockThread);

    const res = await request(app.getHttpServer())
      .get('/threads/thread-1')
      .expect(200);

    expect(res.body.id).toBe('thread-1');
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0].recipients[0].openCount).toBe(3);
  });

  // Scenario 2: Thread with two tracked outgoing messages (Verify NO LEAKS)
  it('2. Should prevent statistics leaking between different messages in the same thread', async () => {
    const mockThreadWithTwoMessages = {
      id: 'thread-1',
      gmailThreadId: 't-123',
      subject: 'Interview Follow-up',
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [
        {
          id: 'msg-1',
          gmailMessageId: 'm-123',
          subject: 'Interview Follow-up',
          sentAt: new Date(Date.now() - 3600000), // 1 hour ago
          direction: 'OUTBOUND',
          recipients: [
            {
              id: 'r-rahul-msg1',
              email: 'rahul@gmail.com',
              displayName: 'Rahul',
              recipientType: 'TO',
              openCount: 3, // Rahul has 3 opens on Msg 1
              firstOpenedAt: new Date(),
              lastOpenedAt: new Date(),
              events: [],
            },
            {
              id: 'r-kiran-msg1',
              email: 'kiran@gmail.com',
              displayName: 'Kiran',
              recipientType: 'CC',
              openCount: 1, // Kiran has 1 open on Msg 1
              firstOpenedAt: new Date(),
              lastOpenedAt: new Date(),
              events: [],
            },
          ],
        },
        {
          id: 'msg-2',
          gmailMessageId: 'm-456',
          subject: 'Re: Interview Follow-up',
          sentAt: new Date(),
          direction: 'OUTBOUND',
          recipients: [
            {
              id: 'r-rahul-msg2',
              email: 'rahul@gmail.com',
              displayName: 'Rahul',
              recipientType: 'TO',
              openCount: 1, // Rahul has 1 open on Msg 2
              firstOpenedAt: new Date(),
              lastOpenedAt: new Date(),
              events: [],
            },
            {
              id: 'r-kiran-msg2',
              email: 'kiran@gmail.com',
              displayName: 'Kiran',
              recipientType: 'CC',
              openCount: 0, // Kiran has 0 opens on Msg 2
              firstOpenedAt: null,
              lastOpenedAt: null,
              events: [],
            },
          ],
        },
      ],
    };

interface TestRecipient {
  id: string;
  email: string;
  openCount: number;
}

interface TestMessage {
  id: string;
  recipients: TestRecipient[];
}

    mockPrismaService.trackedThread.findFirst.mockResolvedValueOnce(mockThreadWithTwoMessages);

    const res = await request(app.getHttpServer())
      .get('/threads/thread-1')
      .expect(200);

    expect(res.body.messages).toHaveLength(2);

    const msg1 = res.body.messages.find((m: TestMessage) => m.id === 'msg-1');
    const msg2 = res.body.messages.find((m: TestMessage) => m.id === 'msg-2');

    const rahulMsg1 = msg1.recipients.find((r: TestRecipient) => r.email === 'rahul@gmail.com');
    const rahulMsg2 = msg2.recipients.find((r: TestRecipient) => r.email === 'rahul@gmail.com');

    const kiranMsg1 = msg1.recipients.find((r: TestRecipient) => r.email === 'kiran@gmail.com');
    const kiranMsg2 = msg2.recipients.find((r: TestRecipient) => r.email === 'kiran@gmail.com');

    // ASSERT NO LEAKS: stats must remain isolated per message instance
    expect(rahulMsg1.openCount).toBe(3);
    expect(rahulMsg2.openCount).toBe(1);

    expect(kiranMsg1.openCount).toBe(1);
    expect(kiranMsg2.openCount).toBe(0);
  });

  // Scenario 3: Aggregated thread statistics
  it('3. Should correctly calculate aggregated thread statistics', async () => {
    const mockThread = {
      id: 'thread-1',
      gmailThreadId: 't-123',
      subject: 'Partnership Offer',
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [
        {
          id: 'msg-1',
          gmailMessageId: 'm-1',
          recipients: [
            { email: 'rahul@gmail.com', openCount: 2, lastOpenedAt: new Date(Date.now() - 10000) },
            { email: 'kiran@gmail.com', openCount: 1, lastOpenedAt: new Date() },
          ],
        },
      ],
    };

    mockPrismaService.trackedThread.findMany.mockResolvedValueOnce([mockThread]);

    const res = await request(app.getHttpServer())
      .get('/threads')
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].openCount).toBe(3); // Sum of openCount (2 + 1)
    expect(res.body[0].totalRecipients).toBe(2); // Count of unique emails
  });

  // Scenario 4: Event history timeline query
  it('4. Should retrieve recipient events timeline omitting raw IPs', async () => {
    const mockRecipient = {
      id: 'r-123',
      email: 'rahul@gmail.com',
      displayName: 'Rahul',
      events: [
        {
          id: 'e-1',
          type: 'OPEN',
          category: 'RECIPIENT_OPEN',
          timestamp: new Date(),
          userAgent: 'Chrome',
          ipHash: 'hashed-ip-123', // Raw IP is already hashed, verify we don't return it
          referer: 'https://mail.google.com',
        },
      ],
    };

    mockPrismaService.trackedRecipient.findFirst.mockResolvedValueOnce(mockRecipient);

    const res = await request(app.getHttpServer())
      .get('/recipients/r-123/events')
      .expect(200);

    expect(res.body.email).toBe('rahul@gmail.com');
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].id).toBe('e-1');
    // Ensure raw IP addresses or hash structures are hidden from users
    expect(res.body.events[0].ipHash).toBeUndefined();
    expect(res.body.events[0].userAgent).toBe('Chrome');
  });

  // Scenario 5: Filtering threads by status 'not-detected'
  it('5. Should filter unopened threads correctly', async () => {
    const mockUnopenedThread = {
      id: 'thread-unopened',
      subject: 'Unopened Subject',
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [
        {
          id: 'm-unopened',
          recipients: [{ email: 'rahul@gmail.com', openCount: 0 }],
        },
      ],
    };

    mockPrismaService.trackedThread.findMany.mockResolvedValueOnce([mockUnopenedThread]);

    const res = await request(app.getHttpServer())
      .get('/threads?status=not-detected')
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].openCount).toBe(0);
  });
});
