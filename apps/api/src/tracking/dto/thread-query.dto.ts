import { IsOptional, IsString, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ThreadQueryDto {
  @ApiPropertyOptional({ description: 'Filter threads by subject or recipient email', example: 'Interview' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter threads by interaction status', enum: ['opened', 'not-detected'], example: 'opened' })
  @IsEnum(['opened', 'not-detected'])
  @IsOptional()
  status?: 'opened' | 'not-detected';

  @ApiPropertyOptional({ description: 'Start date filter (ISO format)', example: '2026-08-01T00:00:00.000Z' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date filter (ISO format)', example: '2026-08-20T23:59:59.000Z' })
  @IsString()
  @IsOptional()
  endDate?: string;
}
