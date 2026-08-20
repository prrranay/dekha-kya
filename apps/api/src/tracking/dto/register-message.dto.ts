import { IsString, IsNotEmpty, IsArray, ValidateNested, IsEnum, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { RegisterMessageRecipient, RegisterMessageRequest, RecipientType } from '@gmail-tracker/shared';

export class RegisterMessageRecipientDto implements RegisterMessageRecipient {
  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsOptional()
  displayName?: string;

  @IsEnum(['TO', 'CC', 'BCC'])
  recipientType!: RecipientType;
}

export class RegisterMessageDto implements RegisterMessageRequest {
  @IsString()
  @IsNotEmpty()
  gmailThreadId!: string;

  @IsString()
  @IsNotEmpty()
  gmailMessageId!: string;

  @IsString()
  @IsNotEmpty()
  messageIdHeader!: string;

  @IsString()
  @IsNotEmpty()
  subject!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegisterMessageRecipientDto)
  recipients!: RegisterMessageRecipientDto[];
}
