import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { google } from 'googleapis';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const ALGORITHM = 'aes-256-gcm';

@Injectable()
export class GmailService {
  private readonly encryptionKey: string;

  constructor(private readonly prisma: PrismaService) {
    const key = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    if (!key) {
      throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY is required but not configured.');
    }
    this.encryptionKey = key;
  }

  /**
   * Encrypts sensitive OAuth tokens for storage at rest.
   */
  encryptToken(token: string): string {
    try {
      const iv = crypto.randomBytes(12); // GCM standard IV size is 12 bytes
      const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(this.encryptionKey, 'hex'), iv);
      let encrypted = cipher.update(token, 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const authTag = cipher.getAuthTag();
      return iv.toString('hex') + ':' + encrypted.toString('hex') + ':' + authTag.toString('hex');
    } catch (error) {
      throw new InternalServerErrorException('Token encryption failed');
    }
  }

  /**
   * Decrypts sensitive OAuth tokens for application use.
   */
  decryptToken(encryptedToken: string): string {
    try {
      const parts = encryptedToken.split(':');
      const iv = Buffer.from(parts[0] || '', 'hex');
      const encrypted = Buffer.from(parts[1] || '', 'hex');
      const authTag = Buffer.from(parts[2] || '', 'hex');
      const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(this.encryptionKey, 'hex'), iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      return decrypted.toString('utf8');
    } catch (error) {
      throw new InternalServerErrorException('Token decryption failed');
    }
  }

  /**
   * Creates an authenticated Gmail API client instance for a given user account.
   */
  async getGmailClient(userId: string, accountEmail: string) {
    const account = await this.prisma.gmailAccount.findFirst({
      where: { userId, email: accountEmail },
    });

    if (!account) {
      return null;
    }

    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_CALLBACK_URL
    );

    const decryptedAccessToken = this.decryptToken(account.accessToken);
    const decryptedRefreshToken = this.decryptToken(account.refreshToken);

    oAuth2Client.setCredentials({
      access_token: decryptedAccessToken,
      refresh_token: decryptedRefreshToken,
      expiry_date: account.tokenExpiry.getTime(),
    });

    // Handle token refresh automatically
    oAuth2Client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        const encryptedAccess = this.encryptToken(tokens.access_token);
        const updateData: { accessToken: string; tokenExpiry?: Date } = { accessToken: encryptedAccess };
        if (tokens.expiry_date) {
          updateData.tokenExpiry = new Date(tokens.expiry_date);
        }
        await this.prisma.gmailAccount.update({
          where: { id: account.id },
          data: updateData,
        });
      }
    });

    return google.gmail({ version: 'v1', auth: oAuth2Client });
  }

  private sanitizeHeader(value: string | undefined): string | undefined {
    if (!value) return undefined;
    if (value.includes('\r') || value.includes('\n')) {
      throw new Error('Header injection detected: CR/LF characters are not allowed in headers.');
    }
    return value;
  }

  /**
   * Constructs a standard raw email MIME body complying with RFC 2822 formatting.
   * Handles both html and plain text fallback injection with sanitization.
   */
  buildMimeMessage(params: {
    from: string;
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    messageIdHeader: string;
    inReplyTo?: string;
    references?: string;
    htmlBody: string;
    plainTextBody?: string;
  }): string {
    const { from, to, cc, bcc, subject, messageIdHeader, inReplyTo, references, htmlBody, plainTextBody } = params;

    const cleanFrom = this.sanitizeHeader(from)!;
    const cleanTo = this.sanitizeHeader(to)!;
    const cleanCc = this.sanitizeHeader(cc);
    const cleanBcc = this.sanitizeHeader(bcc);
    const cleanSubject = this.sanitizeHeader(subject)!;
    const cleanMessageIdHeader = this.sanitizeHeader(messageIdHeader)!;
    const cleanInReplyTo = this.sanitizeHeader(inReplyTo);
    const cleanReferences = this.sanitizeHeader(references);

    const boundary = `----=_Part_${crypto.randomBytes(8).toString('hex')}`;

    const headers: string[] = [
      `From: ${cleanFrom}`,
      `To: ${cleanTo}`,
    ];

    if (cleanCc) headers.push(`Cc: ${cleanCc}`);
    if (cleanBcc) headers.push(`Bcc: ${cleanBcc}`);

    const hasNonAscii = /[^\x00-\x7F]/.test(cleanSubject);
    const encodedSubject = hasNonAscii
      ? `=?UTF-8?B?${Buffer.from(cleanSubject, 'utf8').toString('base64')}?=`
      : cleanSubject;
    headers.push(`Subject: ${encodedSubject}`);
    headers.push(`Message-ID: ${cleanMessageIdHeader}`);

    if (cleanInReplyTo) {
      headers.push(`In-Reply-To: ${cleanInReplyTo}`);
    }
    if (cleanReferences) {
      headers.push(`References: ${cleanReferences}`);
    }

    headers.push('MIME-Version: 1.0');
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    headers.push('');

    const body: string[] = [];

    // Plain text content part
    const plain = plainTextBody || this.stripHtmlTags(htmlBody);
    const plainBase64 = Buffer.from(plain, 'utf8').toString('base64');
    const formattedPlain = plainBase64.replace(/(.{76})/g, '$1\r\n');

    body.push(`--${boundary}`);
    body.push('Content-Type: text/plain; charset=UTF-8');
    body.push('Content-Transfer-Encoding: base64');
    body.push('');
    body.push(formattedPlain);
    body.push('');

    // HTML content part
    const htmlBase64 = Buffer.from(htmlBody, 'utf8').toString('base64');
    const formattedHtml = htmlBase64.replace(/(.{76})/g, '$1\r\n');

    body.push(`--${boundary}`);
    body.push('Content-Type: text/html; charset=UTF-8');
    body.push('Content-Transfer-Encoding: base64');
    body.push('');
    body.push(formattedHtml);
    body.push('');

    body.push(`--${boundary}--`);

    return [...headers, ...body].join('\r\n');
  }

  /**
   * Helper to strip html tags for plain-text headers.
   */
  private stripHtmlTags(html: string): string {
    return html.replace(/<[^>]*>/g, '');
  }

  /**
   * Dispatches a raw MIME message copy to Google Gmail API.
   * NEVER silently falls back to a simulator.
   */
  async sendMime(
    userId: string,
    accountEmail: string,
    mimeString: string,
    gmailThreadId?: string
  ): Promise<{ gmailMessageId: string; gmailThreadId: string }> {
    const gmail = await this.getGmailClient(userId, accountEmail);

    if (!gmail) {
      throw new Error('Gmail is not connected. Connect Gmail before sending tracked email.');
    }

    const base64EncodedMime = Buffer.from(mimeString)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: base64EncodedMime,
        threadId: gmailThreadId,
      },
    });

    return {
      gmailMessageId: res.data.id || '',
      gmailThreadId: res.data.threadId || '',
    };
  }

  /**
   * Retrieves metadata headers for a specific Gmail thread.
   */
  async getThreadMetadata(userId: string, accountEmail: string, gmailThreadId: string) {
    const gmail = await this.getGmailClient(userId, accountEmail);
    if (!gmail) {
      return null;
    }
    const res = await gmail.users.threads.get({
      userId: 'me',
      id: gmailThreadId,
      format: 'metadata',
      metadataHeaders: ['Message-ID', 'References', 'Subject'],
    });
    return res.data;
  }

  /**
   * Selects the actual newest message in a thread by sorting based on internalDate.
   */
  getLatestThreadMessage(thread: any) {
    if (!thread || !thread.messages || thread.messages.length === 0) {
      return null;
    }
    const sorted = [...thread.messages].sort((a, b) => {
      const timeA = parseInt(a.internalDate || '0', 10);
      const timeB = parseInt(b.internalDate || '0', 10);
      return timeB - timeA; // Descending (newest first)
    });
    return sorted[0] || null;
  }

  /**
   * Resolves the proper In-Reply-To, References, and Subject headers for replying to an existing thread.
   */
  async resolveReplyHeaders(userId: string, accountEmail: string, gmailThreadId: string) {
    const thread = await this.getThreadMetadata(userId, accountEmail, gmailThreadId);
    if (!thread) {
      return { inReplyTo: undefined, references: undefined, subject: undefined };
    }

    const lastMsg = this.getLatestThreadMessage(thread);
    if (!lastMsg) {
      return { inReplyTo: undefined, references: undefined, subject: undefined };
    }
    
    // Find Message-ID and References headers
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

    // Also get the Subject from the first message of the thread to preserve it
    let threadSubject: string | undefined;
    thread?.messages?.[0]?.payload?.headers?.forEach((header: any) => {
      if (header.name?.toLowerCase() === 'subject') {
        threadSubject = header.value ?? undefined;
      }
    });

    if (!lastMessageId) {
      return { inReplyTo: undefined, references: undefined, subject: threadSubject };
    }

    // New In-Reply-To is the Message-ID of the last message
    const inReplyTo = lastMessageId;

    // New References is previous references + previous Message-ID
    const references = lastReferences
      ? `${lastReferences} ${lastMessageId}`
      : lastMessageId;

    return { inReplyTo, references, subject: threadSubject };
  }

  async verifyGmailConnection(userId: string): Promise<{ connected: boolean; email?: string; reason?: string }> {
    const account = await this.prisma.gmailAccount.findFirst({
      where: { userId },
    });

    if (!account) {
      return { connected: false };
    }

    try {
      const oAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_CALLBACK_URL
      );

      const decryptedAccessToken = this.decryptToken(account.accessToken);
      const decryptedRefreshToken = this.decryptToken(account.refreshToken);

      oAuth2Client.setCredentials({
        access_token: decryptedAccessToken,
        refresh_token: decryptedRefreshToken,
        expiry_date: account.tokenExpiry.getTime(),
      });

      // Execute a lightweight getProfile request to test access/refresh credentials
      const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
      await gmail.users.getProfile({ userId: 'me' });

      // Save refreshed credentials if oAuth2Client triggered a tokens refresh
      const currentCredentials = oAuth2Client.credentials;
      if (currentCredentials.access_token && currentCredentials.access_token !== decryptedAccessToken) {
        const encryptedAccess = this.encryptToken(currentCredentials.access_token);
        const updateData: { accessToken: string; tokenExpiry?: Date } = { accessToken: encryptedAccess };
        if (currentCredentials.expiry_date) {
          updateData.tokenExpiry = new Date(currentCredentials.expiry_date);
        }
        await this.prisma.gmailAccount.update({
          where: { id: account.id },
          data: updateData,
        });
      }

      return { connected: true, email: account.email };
    } catch (error) {
      console.warn(`[GMAIL_CONNECTION_VERIFY_FAILURE] User ID ${userId}:`, (error as Error).message);
      return { connected: false, reason: 'RECONNECT_REQUIRED' };
    }
  }
}
