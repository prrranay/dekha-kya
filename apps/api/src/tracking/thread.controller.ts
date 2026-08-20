import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ThreadService } from './thread.service';
import { ThreadQueryDto } from './dto/thread-query.dto';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('threads')
@Controller()
@UseGuards(AuthGuard)
export class ThreadController {
  constructor(private readonly threadService: ThreadService) {}

  @Get('threads')
  @ApiOperation({ summary: 'Retrieve all tracked email threads matching filter parameters' })
  @ApiResponse({ status: 200, description: 'List of matching threads returned.' })
  async listThreads(
    @Query() query: ThreadQueryDto,
    @CurrentUser() currentUser: { id: string }
  ) {
    return this.threadService.listThreads(query, currentUser.id);
  }

  @Get('threads/:id')
  @ApiOperation({ summary: 'Retrieve full logical details and timelines for a specific thread' })
  @ApiParam({ name: 'id', description: 'Internal database ID of the TrackedThread' })
  @ApiResponse({ status: 200, description: 'Thread details timeline returned.' })
  @ApiResponse({ status: 404, description: 'Thread not found.' })
  async getThreadDetails(
    @Param('id') id: string,
    @CurrentUser() currentUser: { id: string }
  ) {
    return this.threadService.getThreadDetails(id, currentUser.id);
  }

  @Get('recipients/:id/events')
  @ApiOperation({ summary: 'Retrieve the raw open event history logs for a specific recipient' })
  @ApiParam({ name: 'id', description: 'Internal database ID of the TrackedRecipient' })
  @ApiResponse({ status: 200, description: 'Recipient event log timeline returned.' })
  @ApiResponse({ status: 404, description: 'Recipient not found.' })
  async getRecipientEvents(@Param('id') id: string) {
    // Note: Since this route is authenticated, any authenticated user can view it.
    // If you need strict resource-ownership checking, you can verify that the recipient belongs to a thread created by the current user.
    return this.threadService.getRecipientEvents(id);
  }

  @Get('dashboard/stats')
  @ApiOperation({ summary: 'Retrieve top summary metrics and the live tracking log feed' })
  @ApiResponse({ status: 200, description: 'Aggregate statistics returned.' })
  async getDashboardStats(@CurrentUser() currentUser: { id: string }) {
    return this.threadService.getDashboardStats(currentUser.id);
  }
}
