import { IsString, IsNotEmpty, IsArray, ValidateNested, IsOptional, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RecipientType } from '@gmail-tracker/shared';

export class SendMailRecipientDto {
  @ApiProperty({ description: 'The email address of the recipient', example: 'rahul@gmail.com' })
  @IsString()
  @IsNotEmpty()
  email!: string;

  @ApiPropertyOptional({ description: 'Optional display name of the recipient', example: 'Rahul Kumar' })
  @IsString()
  @IsOptional()
  displayName?: string;

  @ApiProperty({ description: 'Type of recipient', enum: ['TO', 'CC', 'BCC'], example: 'TO' })
  @IsEnum(['TO', 'CC', 'BCC'])
  recipientType!: RecipientType;
}

export class SendMailDto {
  @ApiPropertyOptional({ description: 'Optional Gmail thread ID to thread-group outbound replies', example: 'thread-id-123' })
  @IsString()
  @IsOptional()
  gmailThreadId?: string;

  @ApiProperty({ description: 'Subject of the email', example: 'Interview Follow-up' })
  @IsString()
  @IsNotEmpty()
  subject!: string;

  @ApiProperty({ description: 'HTML content of the email body', example: '<p>Hi Rahul, details enclosed.</p>' })
  @IsString()
  htmlBody!: string;

  @ApiPropertyOptional({ description: 'Optional plain-text alternative body', example: 'Hi Rahul, details enclosed.' })
  @IsString()
  @IsOptional()
  plainTextBody?: string;

  @ApiProperty({ description: 'List of recipients (TO, CC, BCC)', type: [SendMailRecipientDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SendMailRecipientDto)
  recipients!: SendMailRecipientDto[];

  @ApiPropertyOptional({ description: 'Optional RFC 2822 In-Reply-To header matching reply thread target' })
  @IsString()
  @IsOptional()
  inReplyTo?: string;

  @ApiPropertyOptional({ description: 'Optional RFC 2822 References header' })
  @IsString()
  @IsOptional()
  references?: string;
}

