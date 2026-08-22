import { Controller, Get, Query, Res, Req, UseGuards, UnauthorizedException, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response, Request } from 'express';
import { google } from 'googleapis';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GmailService } from '../gmail/gmail.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';

export class ExchangeTokenDto {
  handoffToken!: string;
}

export class ExtensionHeartbeatDto {
  browser?: string;
  version?: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gmailService: GmailService
  ) {}

  /**
   * Generates a secure random OAuth state, stores it in an HTTP-only cookie,
   * and builds the Google consent authorization URL.
   */
  createGoogleAuthorizationUrl(res: Response): string {
    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_CALLBACK_URL
    );

    const scopes = [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.metadata',
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ];

    const state = crypto.randomBytes(32).toString('hex');
    const isProd = process.env.NODE_ENV === 'production';
    
    // Store state temporarily in a secure HTTP-only cookie with short 10-minute expiry
    res.cookie('oauth_state', state, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 10 * 60 * 1000, // 10 minutes
    });

    return oAuth2Client.generateAuthUrl({
      access_type: 'offline', // Demands refresh token
      prompt: 'consent', // Enforces consent to ensure refresh token is returned
      scope: scopes,
      state: state,
    });
  }

  @Get('google')
  @ApiOperation({ summary: 'Redirect the browser to Google OAuth 2.0 Login Screen' })
  async redirectToGoogle(@Res() res: Response) {
    const url = this.createGoogleAuthorizationUrl(res);
    return res.redirect(url);
  }

  @Get('google/callback')
  @ApiOperation({ summary: 'Exchange authentication code for user session and credentials' })
  async handleGoogleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response
  ) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const savedState = req.cookies?.oauth_state;
    const isProd = process.env.NODE_ENV === 'production';

    // Clear state cookie immediately
    res.clearCookie('oauth_state', {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
    });

    if (!state || !savedState || state !== savedState) {
      console.error('[OAUTH_FAILURE] Google OAuth state validation failed');
      return res.redirect(`${frontendUrl}/settings?connected=false`);
    }

    if (!code) {
      console.error('[OAUTH_FAILURE] Code parameter missing from Google redirect callback');
      return res.redirect(`${frontendUrl}/settings?connected=false`);
    }

    try {
      const oAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_CALLBACK_URL
      );

      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);

      const oauth2 = google.oauth2({ version: 'v2', auth: oAuth2Client });
      const userInfo = await oauth2.userinfo.get();

      const email = userInfo.data.email!;
      const name = userInfo.data.name!;
      const picture = userInfo.data.picture || null;
      const googleId = userInfo.data.id!;

      // 1. Check if user already exists or create it
      let user = await this.prisma.user.findUnique({
        where: { googleId },
      });

      if (!user) {
        user = await this.prisma.user.create({
          data: {
            googleId,
            email,
            name,
            picture,
          },
        });
      } else {
        user = await this.prisma.user.update({
          where: { googleId },
          data: { name, picture },
        });
      }

      // 2. Encrypt access/refresh tokens
      const encryptedAccess = tokens.access_token ? this.gmailService.encryptToken(tokens.access_token) : null;
      let encryptedRefresh = tokens.refresh_token ? this.gmailService.encryptToken(tokens.refresh_token) : null;
      const expiryDate = tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600 * 1000);

      // If refresh_token was NOT returned (since it's a re-login with existing permissions),
      // look up the existing refresh token in the database
      if (!encryptedRefresh) {
        const existingAccount = await this.prisma.gmailAccount.findUnique({
          where: {
            userId_email: { userId: user.id, email },
          },
        });
        if (existingAccount && existingAccount.refreshToken) {
          encryptedRefresh = existingAccount.refreshToken;
        }
      }

      // If we STILL don't have a refresh token (neither from Google nor the database),
      // we must force consent so Google returns it.
      if (!encryptedRefresh) {
        console.warn(`[OAUTH_WARNING] Refresh token missing and not found in database for user ${email}. Redirecting to force consent.`);
        const url = this.createGoogleAuthorizationUrl(res);
        return res.redirect(url);
      }

      // 3. Upsert Google account credentials
      await this.prisma.gmailAccount.upsert({
        where: {
          userId_email: { userId: user.id, email },
        },
        update: {
          accessToken: encryptedAccess || undefined,
          refreshToken: encryptedRefresh,
          tokenExpiry: expiryDate,
        },
        create: {
          userId: user.id,
          email,
          accessToken: encryptedAccess || '',
          refreshToken: encryptedRefresh,
          tokenExpiry: expiryDate,
        },
      });

      // 4. Create signed JWT session
      const secret = process.env.SESSION_SECRET;
      if (!secret) {
        throw new Error('SESSION_SECRET environment variable is missing.');
      }
      const sessionToken = jwt.sign({ userId: user.id }, secret, { expiresIn: '7d' });

      // 5. Save in httpOnly cookie
      res.cookie('session', sessionToken, {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      console.log(`[OAUTH_SUCCESS] Logged in user: ${email}`);

      // 6. Redirect browser back to the Next.js settings page
      return res.redirect(`${frontendUrl}/settings?connected=true`);
    } catch (err: unknown) {
      const error = err as Error;
      console.error('[OAUTH_FAILURE] Failed exchanging auth code:', error.message);
      return res.redirect(`${frontendUrl}/settings?connected=false`);
    }
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Retrieve the active Google OAuth user session profile' })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully.',
  })
  async getMe(@CurrentUser() currentUser: { id: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: currentUser.id },
    });

    if (!user) {
      throw new UnauthorizedException('Session user not found in database');
    }

    const gmailStatus = await this.gmailService.verifyGmailConnection(currentUser.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture || null,
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
      gmail: gmailStatus,
    };
  }

  @Get('status')
  @ApiOperation({ summary: 'Check if the user is authenticated from the Chrome extension context' })
  async getStatus(@Req() req: Request) {
    let token = req.cookies?.session || req.cookies?.jwt;

    if (!token) {
      const authHeader = req.headers['authorization'];
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      return { api: true, authenticated: false };
    }

    try {
      const secret = process.env.SESSION_SECRET;
      if (!secret) {
        throw new Error('SESSION_SECRET is required but not configured.');
      }

      const decoded = jwt.verify(token, secret) as { userId?: string; sub?: string; type?: string; jti?: string };
      const userId = decoded.type === 'extension' ? decoded.sub : decoded.userId;

      if (!userId) {
        return { api: true, authenticated: false };
      }

      if (decoded.type === 'extension' && decoded.jti) {
        const session = await this.prisma.extensionSession.findUnique({
          where: { jti: decoded.jti },
        });
        if (!session || session.revokedAt) {
          return { api: true, authenticated: false };
        }
      }

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return { api: true, authenticated: false };
      }

      return {
        api: true,
        authenticated: true,
        email: user.email,
      };
    } catch (error) {
      return { api: true, authenticated: false };
    }
  }

  @Get('logout')
  @ApiOperation({ summary: 'Clear the session cookie and log out the user' })
  async logout(@Res() res: Response) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const isProd = process.env.NODE_ENV === 'production';

    // Clear the session cookie
    res.clearCookie('session', {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
    });

    console.log('[AUTH] User logged out, session cookie cleared.');

    return res.redirect(frontendUrl);
  }

  @Post('extension/handoff')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Generate a secure one-time extension handoff token' })
  async generateHandoff(@CurrentUser() currentUser: { id: string }) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    
    // Hash is stored in database with a 60-second expiration window
    await this.prisma.handoffToken.create({
      data: {
        tokenHash,
        userId: currentUser.id,
        expiresAt: new Date(Date.now() + 60 * 1000), // 60 seconds
      },
    });

    const tokenHashLog = tokenHash.slice(0, 12);
    console.log(`[HANDOFF_GENERATED] HandoffToken hash: ${tokenHashLog} for user ${currentUser.id}`);

    return { rawToken };
  }

  @Post('extension/token')
  @ApiOperation({ summary: 'Exchange handoff token for a short-lived extension access token' })
  async exchangeToken(@Body() dto: ExchangeTokenDto) {
    const { handoffToken } = dto;
    if (!handoffToken || typeof handoffToken !== 'string') {
      throw new UnauthorizedException('Invalid handoff token format');
    }

    const tokenHash = crypto.createHash('sha256').update(handoffToken).digest('hex');
    const tokenHashLog = tokenHash.slice(0, 12);
    const now = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      // Perform atomic transaction consumption
      const updateResult = await tx.handoffToken.updateMany({
        where: {
          tokenHash,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          consumedAt: now,
        },
      });

      if (updateResult.count !== 1) {
        throw new UnauthorizedException('Handoff token is invalid, expired, or already consumed');
      }

      const handoff = await tx.handoffToken.findUnique({
        where: { tokenHash },
      });

      if (!handoff) {
        throw new UnauthorizedException('Handoff token lookup failed');
      }

      const secret = process.env.SESSION_SECRET;
      if (!secret) {
        throw new Error('SESSION_SECRET is required but not configured.');
      }

      const jti = crypto.randomUUID();
      const expiresInSeconds = 15 * 60; // 15 minutes

      // Track extension session inside the transaction
      await tx.extensionSession.create({
        data: {
          jti,
          userId: handoff.userId,
          expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
        },
      });

      return {
        userId: handoff.userId,
        jti,
        expiresInSeconds,
      };
    }).catch((err) => {
      if (err instanceof UnauthorizedException) {
        console.warn(`[HANDOFF_EXCHANGE_FAILURE] Token ${tokenHashLog} not found, expired, or already consumed`);
      } else {
        console.error(`[HANDOFF_EXCHANGE_ERROR] Unexpected error during transaction for ${tokenHashLog}:`, err.message);
      }
      throw err;
    });

    const secret = process.env.SESSION_SECRET!;
    const accessToken = jwt.sign(
      {
        sub: result.userId,
        type: 'extension',
      },
      secret,
      {
        expiresIn: result.expiresInSeconds,
        jwtid: result.jti,
      }
    );

    console.log(`[HANDOFF_EXCHANGE_SUCCESS] User ${result.userId} session ${result.jti} created`);

    return {
      accessToken,
      expiresAt: Date.now() + result.expiresInSeconds * 1000,
    };
  }

  @Post('extension/heartbeat')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Register Chrome extension activity heartbeat' })
  async heartbeat(
    @CurrentUser() currentUser: { id: string; jti?: string },
    @Body() dto: ExtensionHeartbeatDto
  ) {
    if (!currentUser.jti) {
      throw new UnauthorizedException('Heartbeat requires a valid extension session');
    }

    await this.prisma.extensionSession.updateMany({
      where: {
        jti: currentUser.jti,
        revokedAt: null,
      },
      data: {
        lastSeenAt: new Date(),
        browser: dto.browser || null,
        version: dto.version || null,
      },
    });

    return { success: true };
  }
}

