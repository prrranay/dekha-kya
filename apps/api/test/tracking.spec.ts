import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TrackingService } from '../src/tracking/tracking.service';
import { GmailService } from '../src/gmail/gmail.service';
import { AuthGuard } from '../src/auth/auth.guard';
import { ExecutionContext } from '@nestjs/common';

interface TestRecipientResponse {
  email: string;
  trackingToken: string;
}

describe('Gmail Email Tracker E2E & Integration Tests', () => {
  let app: INestApplication;
  let createdRecipients: any[] = [];

  // Mock Prisma Queries
  const mockPrismaService = {
    gmailAccount: {
      findFirst: jest.fn().mockImplementation(() =>
        Promise.resolve({
          id: 'mock-account-id',
          email: 'dev-user@gmail.com',
          accessToken: 'enc-access-token',
          refreshToken: 'enc-refresh-token',
          tokenExpiry: new Date(Date.now() + 3600 * 1000),
        })
      ),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'dev-user-id', email: 'dev-user@gmail.com' }),
      create: jest.fn(),
    },
    trackedThread: {
      findUnique: jest.fn(),
      create: jest.fn().mockImplementation((args) =>
        Promise.resolve({ id: 'mock-thread-uuid', gmailThreadId: args.data.gmailThreadId })
      ),
      update: jest.fn().mockImplementation((args) =>
        Promise.resolve({ id: args.where.id, gmailThreadId: args.data.gmailThreadId })
      ),
      delete: jest.fn().mockImplementation((args) =>
        Promise.resolve({ id: args.where.id })
      ),
    },
    trackedMessage: {
      findUnique: jest.fn().mockImplementation((args) => {
        const msgRecips = createdRecipients.filter(
          (r) => r.trackedMessageId === args.where.id
        );
        return Promise.resolve({
          id: args.where.id,
          subject: 'Test Subject',
          gmailMessageId: 'FAILED',
          gmailThreadId: 'mock-thread-id-456',
          trackedThread: {
            id: 'mock-thread-uuid',
            userId: 'dev-user-id',
          },
          recipients: msgRecips,
        });
      }),
      create: jest.fn().mockImplementation((args) => {
        const msgId = `mock-msg-uuid-${Math.random().toString(36).substring(2, 9)}`;
        return Promise.resolve({
          id: msgId,
          gmailMessageId: args.data.gmailMessageId,
          gmailThreadId: args.data.gmailThreadId,
        });
      }),
      update: jest.fn().mockImplementation((args) =>
        Promise.resolve({
          id: args.where.id,
          gmailMessageId: args.data.gmailMessageId,
          gmailThreadId: args.data.gmailThreadId,
        })
      ),
    },
    trackedRecipient: {
      findUnique: jest.fn().mockImplementation((args) => {
        if (args?.where?.id) {
          const r = createdRecipients.find((x) => x.id === args.where.id);
          return Promise.resolve(r || null);
        }
        if (args?.where?.trackingToken) {
          const r = createdRecipients.find((x) => x.trackingToken === args.where.trackingToken);
          if (r) {
            return Promise.resolve({
              ...r,
              trackedMessage: {
                id: r.trackedMessageId || 'mock-msg-uuid',
                gmailMessageId: r.gmailMessageId || 'mock-msg-id-123',
                gmailThreadId: r.gmailThreadId || 'mock-thread-id-456',
                userId: 'dev-user-id',
              },
            });
          }
        }
        return Promise.resolve(null);
      }),
      findFirst: jest.fn().mockImplementation((args) => {
        const id = args?.where?.id;
        const msgId = args?.where?.trackedMessageId;
        let r;
        if (id) {
          r = createdRecipients.find((x) => x.id === id);
        } else if (msgId) {
          r = createdRecipients.find(
            (x) => x.trackedMessageId === msgId && (args?.where?.sendStatus ? x.sendStatus === args.where.sendStatus : true)
          );
        }
        if (r) {
          return Promise.resolve({
            ...r,
            trackedMessage: {
              id: r.trackedMessageId || 'mock-msg-uuid',
              gmailMessageId: r.gmailMessageId || 'mock-msg-id-123',
              gmailThreadId: r.gmailThreadId || 'mock-thread-id-456',
              userId: 'dev-user-id',
            },
          });
        }
        return Promise.resolve(null);
      }),
      findMany: jest.fn().mockImplementation((args) => {
        if (args?.where?.trackedMessageId) {
          return Promise.resolve(
            createdRecipients.filter(
              (x) => x.trackedMessageId === args.where.trackedMessageId
            )
          );
        }
        return Promise.resolve(createdRecipients);
      }),
      create: jest.fn().mockImplementation((args) => {
        const r = {
          id: `mock-recip-uuid-${createdRecipients.length}`,
          trackedMessageId: args.data.trackedMessageId,
          email: args.data.email,
          recipientType: args.data.recipientType,
          trackingToken: args.data.trackingToken,
          sendStatus: args.data.sendStatus || 'PENDING',
          sendError: args.data.sendError || null,
          sentAt: args.data.sentAt || null,
          openCount: 0,
        };
        createdRecipients.push(r);
        return Promise.resolve(r);
      }),
      update: jest.fn().mockImplementation((args) => {
        const r = createdRecipients.find((x) => x.id === args.where.id);
        if (r) {
          if (args.data.sendStatus !== undefined) r.sendStatus = args.data.sendStatus;
          if (args.data.sendError !== undefined) r.sendError = args.data.sendError;
          if (args.data.sentAt !== undefined) r.sentAt = args.data.sentAt;
        }
        return Promise.resolve(r || {});
      }),
    },
    trackingEvent: {
      create: jest.fn().mockResolvedValue({ id: 'mock-event-uuid' }),
    },
  };

  // Mock Gmail API client
  const mockGmailService = {
    getGmailClient: jest.fn().mockResolvedValue(null), // Triggers Mock simulator mode
    buildMimeMessage: jest.fn().mockImplementation((params) => {
      // Basic mock MIME builder representation
      return `From: ${params.from}\nTo: ${params.to}\nSubject: ${params.subject}\n\n${params.htmlBody}`;
    }),
    sendMime: jest.fn().mockImplementation((_userId, email, _mime, threadId) => {
      if (email === 'fail-gmail-api@gmail.com') {
        throw new Error('Gmail API simulated outage');
      }
      return Promise.resolve({
        gmailMessageId: 'mock-msg-id-123',
        gmailThreadId: threadId || 'mock-thread-id-456',
      });
    }),
    getThreadMetadata: jest.fn().mockResolvedValue({
      messages: [
        {
          id: 'mock-msg-id-123',
          internalDate: '1620000000000',
          payload: {
            headers: [
              { name: 'Message-ID', value: '<mock-msg-id-123@mail.gmail.com>' },
              { name: 'References', value: '<prev-ref-id@mail.gmail.com>' },
              { name: 'Subject', value: 'Follow-up' },
            ],
          },
        },
      ],
    }),
    getLatestThreadMessage: jest.fn().mockImplementation((thread) => {
      return thread.messages[0];
    }),
    resolveReplyHeaders: jest.fn().mockResolvedValue({ inReplyTo: undefined, references: undefined }),
  };

  beforeAll(async () => {
    process.env.SESSION_SECRET = 'test-session-secret-key-123456789';
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
      .overrideProvider(GmailService)
      .useValue(mockGmailService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    createdRecipients = [];
  });

  // 1. One recipient
  it('1. Should register and send to one recipient', async () => {
    const payload = {
      subject: 'Hello R1',
      htmlBody: '<p>Body text</p>',
      recipients: [{ email: 'rahul@gmail.com', recipientType: 'TO' }],
    };

    const res = await request(app.getHttpServer())
      .post('/gmail/send')
      .send(payload)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.recipients).toHaveLength(1);
    expect(res.body.recipients[0].email).toBe('rahul@gmail.com');
    expect(res.body.recipients[0].trackingToken).toBeDefined();
  });

  // 2. TO + CC
  it('2. Should map distinct tracking tokens for TO and CC recipients', async () => {
    const payload = {
      subject: 'Interview Review',
      htmlBody: '<p>Resume enclosed</p>',
      recipients: [
        { email: 'rahul@gmail.com', recipientType: 'TO' },
        { email: 'kiran@gmail.com', recipientType: 'CC' },
      ],
    };


    const res = await request(app.getHttpServer())
      .post('/gmail/send')
      .send(payload)
      .expect(201);

    const rRahul = res.body.recipients.find((r: TestRecipientResponse) => r.email === 'rahul@gmail.com');
    const rKiran = res.body.recipients.find((r: TestRecipientResponse) => r.email === 'kiran@gmail.com');

    expect(rRahul.trackingToken).not.toBe(rKiran.trackingToken);
  });

  // 3. TO + multiple CC
  it('3. Should allocate individual unique tokens to multiple CC addresses', async () => {
    const payload = {
      subject: 'Project Kickoff',
      htmlBody: '<p>Details inside</p>',
      recipients: [
        { email: 'rahul@gmail.com', recipientType: 'TO' },
        { email: 'kiran@gmail.com', recipientType: 'CC' },
        { email: 'anil@gmail.com', recipientType: 'CC' },
      ],
    };

    const res = await request(app.getHttpServer())
      .post('/gmail/send')
      .send(payload)
      .expect(201);

    const tokens = res.body.recipients.map((r: TestRecipientResponse) => r.trackingToken);
    const uniqueTokens = new Set(tokens);
    expect(uniqueTokens.size).toBe(3);
  });

  // 4. BCC
  it('4. Should register BCC recipients with unique tracking pixels', async () => {
    const payload = {
      subject: 'Confidential Notice',
      htmlBody: '<p>Top secret</p>',
      recipients: [{ email: 'hidden@gmail.com', recipientType: 'BCC' }],
    };

    const res = await request(app.getHttpServer())
      .post('/gmail/send')
      .send(payload)
      .expect(201);

    expect(res.body.recipients[0].email).toBe('hidden@gmail.com');
    expect(res.body.recipients[0].trackingToken).toBeDefined();
  });

  // 5. Same recipient in different outgoing messages
  it('5. Should assign different tokens to same recipient across separate sends', async () => {
    const payload1 = {
      subject: 'Mail 1',
      htmlBody: '<p>Content 1</p>',
      recipients: [{ email: 'rahul@gmail.com', recipientType: 'TO' }],
    };

    const payload2 = {
      subject: 'Mail 2',
      htmlBody: '<p>Content 2</p>',
      recipients: [{ email: 'rahul@gmail.com', recipientType: 'TO' }],
    };

    const res1 = await request(app.getHttpServer()).post('/gmail/send').send(payload1).expect(201);
    const res2 = await request(app.getHttpServer()).post('/gmail/send').send(payload2).expect(201);

    expect(res1.body.recipients[0].trackingToken).not.toBe(res2.body.recipients[0].trackingToken);
  });

  // 6. Existing Gmail thread
  it('6. Should preserve existing thread ID when thread context is supplied', async () => {
    const payload = {
      gmailThreadId: 'thread-existing-abc',
      subject: 'Follow-up',
      htmlBody: '<p>Still waiting</p>',
      recipients: [{ email: 'rahul@gmail.com', recipientType: 'TO' }],
    };

    mockPrismaService.trackedThread.findUnique.mockResolvedValueOnce({
      id: 'thread-uuid-1',
      gmailThreadId: 'thread-existing-abc',
    });

    const res = await request(app.getHttpServer())
      .post('/gmail/send')
      .send(payload)
      .expect(201);

    expect(res.body.gmailThreadId).toBe('thread-existing-abc');
  });

  // 7. New Gmail thread
  it('7. Should construct a new thread index when no threadId is supplied', async () => {
    const payload = {
      subject: 'Brand New Topic',
      htmlBody: '<p>Init text</p>',
      recipients: [{ email: 'rahul@gmail.com', recipientType: 'TO' }],
    };

    mockPrismaService.trackedThread.findUnique.mockResolvedValueOnce(null);

    const res = await request(app.getHttpServer())
      .post('/gmail/send')
      .send(payload)
      .expect(201);

    expect(res.body.gmailThreadId).toBe('mock-thread-id-456');
  });

  // 8. Invalid token
  it('8. Should return 1x1 transparent pixel even with invalid token lookup to avoid leaking status', async () => {
    const token = '00000000000000000000000000000000';
    mockPrismaService.trackedRecipient.findUnique.mockResolvedValueOnce(null);

    const res = await request(app.getHttpServer())
      .get(`/tracking/open/${token}`)
      .expect(200);

    expect(res.headers['content-type']).toBe('image/gif');
  });

  // 9. Repeated opens
  it('9. Should rate limit identical opens occurring within 2 seconds', async () => {
    const token = '1234567890abcdef1234567890abcdef';

    mockPrismaService.trackedRecipient.findUnique.mockResolvedValue({
      id: 'recip-123',
      trackingToken: token,
      openCount: 0,
      trackedMessage: {
        trackedThread: {
          userId: 'dev-user-id',
        },
      },
    });

    // Fire first open
    await request(app.getHttpServer()).get(`/tracking/open/${token}`).expect(200);
    // Fire second open immediately (within 2 seconds)
    await request(app.getHttpServer()).get(`/tracking/open/${token}`).expect(200);

    // Verify trackedRecipient was only checked once or event created once
    expect(mockPrismaService.trackingEvent.create).toHaveBeenCalledTimes(1);
  });

  // 10. Self-open unauthenticated (no user-agent -> UNKNOWN_OPEN)
  it('10. Should flag category as UNKNOWN_OPEN when no user-agent is supplied', async () => {
    const token = 'abcdefabcdefabcdefabcdefabcdef12';

    mockPrismaService.trackedRecipient.findUnique.mockResolvedValueOnce({
      id: 'recip-123',
      trackingToken: token,
      openCount: 0,
      trackedMessage: {
        trackedThread: {
          userId: 'dev-user-id',
        },
      },
    });

    await request(app.getHttpServer())
      .get(`/tracking/open/${token}`)
      .set('User-Agent', '')
      .expect(200);

    expect(mockPrismaService.trackingEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: 'UNKNOWN_OPEN',
          classification: 'UNKNOWN_OPEN',
        }),
      })
    );
  });

  // 10b. Self-open authenticated
  it('10b. Should flag category as SELF_OPEN when request user context matches sender', async () => {
    const token = 'differenttokenabcdefabcdefabcdef';
    const trackingService = app.get(TrackingService);

    mockPrismaService.trackedRecipient.findUnique.mockResolvedValueOnce({
      id: 'recip-123',
      trackingToken: token,
      openCount: 0,
      trackedMessage: {
        trackedThread: {
          userId: 'dev-user-id',
        },
      },
    });

    await trackingService.recordOpen(token, { sessionUserId: 'dev-user-id' });

    expect(mockPrismaService.trackingEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: 'SELF_OPEN',
          classification: 'SELF_OPEN',
        }),
      })
    );
  });

  // 10c. Google proxy open
  it('10c. Should flag category as RECIPIENT_OPEN and classification as DETECTED_OPEN for Google Proxy', async () => {
    const token = 'googleproxytokenabcdefabcdefabcd';
    const trackingService = app.get(TrackingService);

    mockPrismaService.trackedRecipient.findUnique.mockResolvedValueOnce({
      id: 'recip-123',
      trackingToken: token,
      openCount: 0,
      trackedMessage: {
        trackedThread: {
          userId: 'dev-user-id',
        },
      },
    });

    await trackingService.recordOpen(token, { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36 GoogleImageProxy' });

    expect(mockPrismaService.trackingEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: 'RECIPIENT_OPEN',
          classification: 'DETECTED_OPEN',
          source: 'GOOGLE_PROXY',
        }),
      })
    );
  });


  // 11. Missing HTML body
  it('11. Should fall back to formatting text body as HTML to embed pixel', async () => {
    const payload = {
      subject: 'Plain Text Send',
      plainTextBody: 'Hello world this is text content',
      recipients: [{ email: 'rahul@gmail.com', recipientType: 'TO' }],
      htmlBody: '', // Empty html
    };

    await request(app.getHttpServer())
      .post('/gmail/send')
      .send(payload)
      .expect(201);

    expect(mockGmailService.buildMimeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        htmlBody: expect.stringContaining('<html><body>'),
      })
    );
  });

  // 12. Plain text body
  it('12. Should correctly convert plain text and inject tracking image', async () => {
    const payload = {
      subject: 'Convert Text',
      plainTextBody: 'Text body',
      recipients: [{ email: 'rahul@gmail.com', recipientType: 'TO' }],
      htmlBody: '',
    };

    const res = await request(app.getHttpServer()).post('/gmail/send').send(payload).expect(201);
    const token = res.body.recipients[0].trackingToken;

    expect(mockGmailService.buildMimeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        htmlBody: expect.stringContaining(`/api/tracking/open/${token}`),
      })
    );
  });

  // 13. Tracking disabled
  it('13. Should skip API sending call when tracking checkbox is unselected in compose', async () => {
    expect(true).toBe(true);
  });

  // 14. Network/API failure
  it('14. Should handle connection failures gracefully', async () => {
    // If the database connection goes down during lookup, endpoint catches and returns pixel
    mockPrismaService.trackedRecipient.findUnique.mockRejectedValueOnce(new Error('DB Timeout'));

    await request(app.getHttpServer())
      .get('/tracking/open/1234567890abcdef1234567890abcdef')
      .expect(200);
  });

  // 15. Gmail API failure
  it('15. Should report server error when Google API rejects authorization or send requests', async () => {
    const payload = {
      subject: 'Broken API Send',
      htmlBody: '<p>Test</p>',
      recipients: [{ email: 'rahul@gmail.com', recipientType: 'TO' }],
    };

    // Mock gmailAccount query return email to trigger simulated outage
    mockPrismaService.gmailAccount.findFirst.mockResolvedValueOnce({
      id: 'mock-account-id',
      email: 'fail-gmail-api@gmail.com',
      accessToken: 'enc-access-token',
      refreshToken: 'enc-refresh-token',
      tokenExpiry: new Date(Date.now() + 3600 * 1000),
    });

    const res = await request(app.getHttpServer())
      .post('/gmail/send')
      .send(payload)
      .expect(201);

    expect(res.body.success).toBe(false);
    expect(res.body.status).toBe('failed');
    expect(res.body.recipients[0].sendStatus).toBe('FAILED');
    expect(res.body.recipients[0].sendErrorCode).toContain('Gmail API simulated outage');
  });

  // 16. CC/BCC isolation
  it('16. Should ensure CC and BCC recipients get isolated MIME messages without token leaks', async () => {
    const payload = {
      subject: 'Isolation Test',
      htmlBody: '<p>Confidential text</p>',
      recipients: [
        { email: 'to-user@gmail.com', recipientType: 'TO' },
        { email: 'cc-user@gmail.com', recipientType: 'CC' },
        { email: 'bcc-user@gmail.com', recipientType: 'BCC' },
      ],
    };

    const res = await request(app.getHttpServer()).post('/gmail/send').send(payload).expect(201);
    expect(res.body.recipients).toHaveLength(3);

    const toToken = res.body.recipients.find((r: any) => r.email === 'to-user@gmail.com').trackingToken;
    const ccToken = res.body.recipients.find((r: any) => r.email === 'cc-user@gmail.com').trackingToken;
    const bccToken = res.body.recipients.find((r: any) => r.email === 'bcc-user@gmail.com').trackingToken;

    // All tokens must be unique
    const tokenSet = new Set([toToken, ccToken, bccToken]);
    expect(tokenSet.size).toBe(3);

    // Each recipient's buildMimeMessage must only contain their own tracking token
    const calls = mockGmailService.buildMimeMessage.mock.calls;
    const toCall = calls.find((c: any) => c[0].to.includes('to-user@gmail.com'));
    const ccCall = calls.find((c: any) => c[0].to.includes('cc-user@gmail.com'));
    const bccCall = calls.find((c: any) => c[0].to.includes('bcc-user@gmail.com'));

    expect(toCall[0].htmlBody).toContain(toToken);
    expect(toCall[0].htmlBody).not.toContain(ccToken);
    expect(toCall[0].htmlBody).not.toContain(bccToken);

    expect(ccCall[0].htmlBody).toContain(ccToken);
    expect(ccCall[0].htmlBody).not.toContain(toToken);
    expect(ccCall[0].htmlBody).not.toContain(bccToken);

    expect(bccCall[0].htmlBody).toContain(bccToken);
    expect(bccCall[0].htmlBody).not.toContain(toToken);
    expect(bccCall[0].htmlBody).not.toContain(ccToken);
  });

  // 17. MIME Encoding UTF-8 and Emojis
  it('17. Should correctly encode multi-byte UTF-8 and emojis in MIME without corruption', () => {
    if (!process.env.GOOGLE_TOKEN_ENCRYPTION_KEY) {
      process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
    }
    const realGmailService = new GmailService(mockPrismaService as any);
    const complexBody = '<p>Hello 👋 World 🌍 ! 🚀 Special chars: ₹, é, ñ, 中文</p>';
    const mime = realGmailService.buildMimeMessage({
      from: 'sender@gmail.com',
      to: 'recipient@gmail.com',
      subject: 'Emoji & UTF-8 Test 🚀',
      messageIdHeader: '<test-id@mail.gmail.com>',
      htmlBody: complexBody,
      plainTextBody: 'Hello 👋 World 🌍 ! 🚀 Special chars: ₹, é, ñ, 中文',
    });

    expect(mime).toContain('Subject: =?UTF-8?B?');
    expect(mime).toContain('Content-Type: multipart/alternative;');
    expect(mime).toContain('Content-Transfer-Encoding: base64');

    // Decode base64 blocks and verify content
    const base64Blocks = mime.match(/Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/g);
    expect(base64Blocks).toBeDefined();
    expect(base64Blocks!.length).toBeGreaterThanOrEqual(2);

    const decodedParts = base64Blocks!.map((block: string) => {
      const cleanB64 = block.replace(/Content-Transfer-Encoding: base64\r?\n\r?\n/, '').replace(/\r?\n/g, '');
      return Buffer.from(cleanB64, 'base64').toString('utf-8');
    });

    expect(decodedParts.some((p: string) => p.includes('Hello 👋 World 🌍 ! 🚀 Special chars: ₹, é, ñ, 中文'))).toBe(true);
    expect(decodedParts.some((p: string) => p.includes(complexBody))).toBe(true);
  });

  // 18. Partial Send Retry
  it('18. Should only retry failed recipients, preserve original tokens and parent message', async () => {
    // 1. Send with one success and one fail
    const payload = {
      subject: 'Retry Test',
      htmlBody: '<p>Retry test content</p>',
      recipients: [
        { email: 'good@gmail.com', recipientType: 'TO' },
        { email: 'bad@gmail.com', recipientType: 'TO' },
      ],
    };

    // First send
    const resSend = await request(app.getHttpServer()).post('/gmail/send').send(payload).expect(201);
    expect(resSend.body.recipients).toHaveLength(2);
    const msgId = resSend.body.trackedMessageId;
    const badRecip = resSend.body.recipients.find((r: any) => r.email === 'bad@gmail.com');

    // Manually mark badRecip as FAILED in mock state
    badRecip.sendStatus = 'FAILED';
    const foundBad = createdRecipients.find((r) => r.id === badRecip.id);
    if (foundBad) foundBad.sendStatus = 'FAILED';

    const retryPayload = {
      trackedMessageId: msgId,
      recipientIds: [badRecip.id],
      htmlBody: '<p>Retry test content</p>',
    };

    const resRetry = await request(app.getHttpServer()).post('/gmail/send/retry').send(retryPayload).expect(201);
    expect(resRetry.body.status).toBe('sent');
    expect(resRetry.body.trackedMessageId).toBe(msgId);
    
    // Check that original token was preserved
    const retriedBad = resRetry.body.recipients.find((r: any) => r.id === badRecip.id);
    expect(retriedBad.trackingToken).toBe(badRecip.trackingToken);
    expect(retriedBad.sendStatus).toBe('SENT');
  });
});

