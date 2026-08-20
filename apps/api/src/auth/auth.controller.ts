import { Controller, Get, Query, Res, Req, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { UserDto } from '@gmail-tracker/shared';
import { Response, Request } from 'express';
import { google } from 'googleapis';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';
import { GmailService } from '../gmail/gmail.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gmailService: GmailService
  ) {}

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Retrieve the active Google OAuth user session profile' })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully.',
  })
  async getMe(@CurrentUser() currentUser: { id: string }): Promise<UserDto & { gmailConnected: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: currentUser.id },
      include: {
        accounts: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Session user not found in database');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture || null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      gmailConnected: user.accounts.length > 0,
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
      return { authenticated: false };
    }

    try {
      const secret = process.env.SESSION_SECRET || 'dev-session-secret-key-123456789';
      const decoded = jwt.verify(token, secret) as { userId: string };
      const user = await this.prisma.user.findUnique({
        where: { id: decoded.userId },
        include: { accounts: true },
      });

      if (!user) {
        return { authenticated: false };
      }

      return {
        authenticated: true,
        email: user.email,
      };
    } catch (error) {
      return { authenticated: false };
    }
  }

  @Get('google')
  @ApiOperation({ summary: 'Redirect the browser to Google OAuth 2.0 Login Screen' })
  async redirectToGoogle(@Res() res: Response) {
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

    const url = oAuth2Client.generateAuthUrl({
      access_type: 'offline', // Demands refresh token
      prompt: 'consent', // Enforces consent to ensure refresh token is returned
      scope: scopes,
    });

    return res.redirect(url);
  }

  @Get('google/callback')
  @ApiOperation({ summary: 'Exchange authentication code for user session and credentials' })
  async handleGoogleCallback(@Query('code') code: string, @Res() res: Response) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

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
        const oAuth2ClientForce = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_CALLBACK_URL
        );
        const url = oAuth2ClientForce.generateAuthUrl({
          access_type: 'offline',
          prompt: 'consent',
          scope: [
            'https://www.googleapis.com/auth/gmail.send',
            'https://www.googleapis.com/auth/gmail.metadata',
            'openid',
            'https://www.googleapis.com/auth/userinfo.email',
            'https://www.googleapis.com/auth/userinfo.profile',
          ],
        });
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
      const secret = process.env.SESSION_SECRET || 'dev-session-secret-key-123456789';
      const sessionToken = jwt.sign({ userId: user.id }, secret, { expiresIn: '7d' });

      // 5. Save in httpOnly cookie
      res.cookie('session', sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
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
  @Get('logout')
  @ApiOperation({ summary: 'Clear the session cookie and log out the user' })
  async logout(@Res() res: Response) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    // Clear the session cookie
    res.clearCookie('session', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    console.log('[AUTH] User logged out, session cookie cleared.');

    return res.redirect(frontendUrl);
  }
}
