import { Controller, Post, Body, Get, Param, Res, Req, HttpStatus, UseGuards } from '@nestjs/common';
import { Response, Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { TrackingService } from './tracking.service';
import { RegisterMessageDto } from './dto/register-message.dto';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('tracking')
@Controller('tracking')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Post('register-message')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Register a logical message for tracking (manual registry / testing)' })
  @ApiResponse({ status: 201, description: 'Message tracked successfully.' })
  async registerMessage(
    @Body() dto: RegisterMessageDto,
    @CurrentUser() currentUser: { id: string }
  ) {
    return this.trackingService.registerMessage(dto, currentUser.id);
  }

  @Get('open/:token')
  @ApiOperation({ summary: 'Serve the 1x1 transparent tracking pixel and log recipient opens' })
  @ApiParam({ name: 'token', description: 'Unique recipient tracking token' })
  @ApiResponse({ status: 200, description: 'Tracking pixel GIF file returned.' })
  async trackOpen(
    @Param('token') token: string,
    @Req() req: Request,
    @Res() res: Response
  ) {
    // 1x1 Transparent GIF base64 encoding
    const pixel = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64'
    );

    // Apply strict non-caching headers so client browsers always request the pixel
    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // 1. Validate token format (must be 32-64 hex chars)
    if (!token || !/^[0-9a-fA-F]{32,64}$/.test(token)) {
      return res.status(HttpStatus.OK).send(pixel);
    }

    const userAgent = req.headers['user-agent'];
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    const referer = req.headers['referer'];

    // 2. Extract sessionUserId from cookie or authorization/x-session-token header to evaluate SELF_OPEN heuristic
    let sessionUserId: string | undefined = undefined;
    let sessionToken = req.cookies?.session || req.cookies?.jwt;
    if (!sessionToken) {
      const authHeader = req.headers['authorization'] as string || req.headers['x-session-token'] as string;
      if (authHeader) {
        sessionToken = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
      }
    }

    if (sessionToken) {
      try {
        const secret = process.env.SESSION_SECRET;
        if (secret) {
          const decoded = jwt.verify(sessionToken, secret) as { userId: string };
          sessionUserId = decoded.userId;
        }
      } catch (e) {
        // Ignore invalid session token in tracking pixel request
      }
    }


    // 3. Await database operation to ensure pixel tracking reliability.
    // Suppress exceptions to avoid leaking token status or breaking image rendering.
    try {
      await this.trackingService.recordOpen(token, { userAgent, ip, referer, sessionUserId });
    } catch (err) {
      const tokenHashLog = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
      console.error(`[INVALID_TRACKING_TOKEN] Failed open for token hash=${tokenHashLog}:`, (err as Error).message);
    }

    return res.status(HttpStatus.OK).send(pixel);
  }
}
