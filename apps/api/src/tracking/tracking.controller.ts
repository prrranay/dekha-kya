import { Controller, Post, Body, Get, Param, Res, Req, Query, HttpStatus, UseGuards } from '@nestjs/common';
import { Response, Request } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
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
  @ApiQuery({ name: 'sender', required: false, description: 'True if client self-preview open, logs as SELF_OPEN' })
  @ApiResponse({ status: 200, description: 'Tracking pixel GIF file returned.' })
  async trackOpen(
    @Param('token') token: string,
    @Query('sender') senderQuery: string,
    @Req() req: Request,
    @Res() res: Response
  ) {
    const userAgent = req.headers['user-agent'];
    const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    const referer = req.headers['referer'];
    const isSelf = senderQuery === 'true';

    // Track in background without blocking the pixel transmission
    this.trackingService
      .recordOpen(token, { userAgent, ip, referer, isSelf })
      .catch((err) => {
        // Log errors to avoid failing the response to user's client
        console.error(`Failed to record open for token ${token}:`, err.message);
      });

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

    return res.status(HttpStatus.OK).send(pixel);
  }
}
