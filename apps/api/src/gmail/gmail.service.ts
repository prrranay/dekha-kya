import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { google } from 'googleapis';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const ALGORITHM = 'aes-256-gcm';

@Injectable()
export class GmailService {
  private readonly encryptionKey: string;

  constructor(private readonly prisma: PrismaService) {
    // Read the 32-byte encryption key from GOOGLE_TOKEN_ENCRYPTION_KEY environment variable
    const key = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
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
      // Return null to signify that we should run in Mock mode (for local tests/without live credentials)
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

  /**
   * Constructs a standard raw email MIME body complying with RFC 2822 formatting.
   * Handles both html and plain text fallback injection.
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
    const boundary = `----=_Part_${crypto.randomBytes(8).toString('hex')}`;

    const headers: string[] = [
      `From: ${from}`,
      `To: ${to}`,
    ];

    if (cc) headers.push(`Cc: ${cc}`);
    if (bcc) headers.push(`Bcc: ${bcc}`);

    headers.push(`Subject: ${subject}`);
    headers.push(`Message-ID: ${messageIdHeader}`);

    if (inReplyTo) {
      headers.push(`In-Reply-To: ${inReplyTo}`);
    }
    if (references) {
      headers.push(`References: ${references}`);
    }

    headers.push('MIME-Version: 1.0');
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    headers.push('');

    const body: string[] = [];

    // Plain text content part
    const plain = plainTextBody || this.stripHtmlTags(htmlBody);
    body.push(`--${boundary}`);
    body.push('Content-Type: text/plain; charset="UTF-8"');
    body.push('Content-Transfer-Encoding: 7bit');
    body.push('');
    body.push(plain);
    body.push('');

    // HTML content part
    body.push(`--${boundary}`);
    body.push('Content-Type: text/html; charset="UTF-8"');
    body.push('Content-Transfer-Encoding: 7bit');
    body.push('');
    body.push(htmlBody);
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
   * Dispatches a raw MIME message copy to Google Gmail API or falls back to simulated mocks.
   */
  async sendMime(
    userId: string,
    accountEmail: string,
    mimeString: string,
    gmailThreadId?: string
  ): Promise<{ gmailMessageId: string; gmailThreadId: string }> {
    const gmail = await this.getGmailClient(userId, accountEmail);

    if (!gmail) {
      // Mock flow when OAuth is not linked locally
      console.log('--- GMAIL API SIMULATOR ---');
      console.log('Sending raw MIME:\n', mimeString);
      console.log('Gmail Thread ID:', gmailThreadId);
      console.log('---------------------------');

      return {
        gmailMessageId: 'mock-msg-' + crypto.randomBytes(8).toString('hex'),
        gmailThreadId: gmailThreadId || 'mock-thread-' + crypto.randomBytes(8).toString('hex'),
      };
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
   * Resolves the proper In-Reply-To and References headers for replying to an existing thread.
   */
  async resolveReplyHeaders(userId: string, accountEmail: string, gmailThreadId: string) {
    const thread = await this.getThreadMetadata(userId, accountEmail, gmailThreadId);
    if (!thread || !thread.messages || thread.messages.length === 0) {
      return { inReplyTo: undefined, references: undefined };
    }

    // Get the last message in the thread
    const lastMsg = thread.messages[thread.messages.length - 1]!;
    
    // Find Message-ID and References headers
    let lastMessageId: string | undefined;
    let lastReferences: string | undefined;

    lastMsg.payload?.headers?.forEach((header) => {
      if (header.name?.toLowerCase() === 'message-id') {
        lastMessageId = header.value ?? undefined;
      }
      if (header.name?.toLowerCase() === 'references') {
        lastReferences = header.value ?? undefined;
      }
    });

    if (!lastMessageId) {
      return { inReplyTo: undefined, references: undefined };
    }

    // New In-Reply-To is the Message-ID of the last message
    const inReplyTo = lastMessageId;

    // New References is previous references + previous Message-ID
    const references = lastReferences
      ? `${lastReferences} ${lastMessageId}`
      : lastMessageId;

    return { inReplyTo, references };
  }
}
