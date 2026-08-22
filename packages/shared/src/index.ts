export type RecipientType = 'TO' | 'CC' | 'BCC';

export type TrackingEventType = 'OPEN' | 'CLICK';

export type OpenCategory = 'RECIPIENT_OPEN' | 'SELF_OPEN' | 'UNKNOWN_OPEN';

export type TrackingEventSource = 'GOOGLE_PROXY' | 'DIRECT' | 'UNKNOWN';

export type TrackingEventClassification = 'DETECTED_OPEN' | 'SELF_OPEN' | 'UNKNOWN_OPEN';

export type MessageDirection = 'INBOUND' | 'OUTBOUND';

export interface RegisterMessageRecipient {
  email: string;
  displayName?: string;
  recipientType: RecipientType;
}

export interface RegisterMessageRequest {
  gmailThreadId: string;
  gmailMessageId: string;
  messageIdHeader: string;
  subject: string;
  recipients: RegisterMessageRecipient[];
}

export interface RegisteredRecipientResponse {
  email: string;
  trackingToken: string;
}

export interface RegisterMessageResponse {
  trackedMessageId: string;
  recipients: RegisteredRecipientResponse[];
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GmailAccountDto {
  id: string;
  userId: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackedThreadDto {
  id: string;
  userId: string;
  gmailThreadId: string;
  subject: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrackedMessageDto {
  id: string;
  trackedThreadId: string;
  gmailMessageId: string;
  gmailThreadId: string;
  messageIdHeader: string;
  direction: MessageDirection;
  subject: string;
  sentAt: string;
  createdAt: string;
}

export interface TrackedRecipientDto {
  id: string;
  trackedMessageId: string;
  email: string;
  displayName: string | null;
  recipientType: RecipientType;
  trackingToken: string;
  gmailMessageId: string | null;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  openCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TrackingEventDto {
  id: string;
  trackedRecipientId: string;
  type: TrackingEventType;
  category: OpenCategory;
  source: TrackingEventSource;
  classification: TrackingEventClassification;
  timestamp: string;
  userAgent: string | null;
  ipHash: string | null;
  referer: string | null;
  createdAt: string;
}

