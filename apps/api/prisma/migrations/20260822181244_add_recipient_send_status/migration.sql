-- CreateEnum
CREATE TYPE "RecipientType" AS ENUM ('TO', 'CC', 'BCC');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "TrackingEventType" AS ENUM ('OPEN', 'CLICK');

-- CreateEnum
CREATE TYPE "OpenCategory" AS ENUM ('RECIPIENT_OPEN', 'SELF_OPEN', 'UNKNOWN_OPEN');

-- CreateEnum
CREATE TYPE "TrackingEventSource" AS ENUM ('GOOGLE_PROXY', 'DIRECT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TrackingEventClassification" AS ENUM ('DETECTED_OPEN', 'SELF_OPEN', 'UNKNOWN_OPEN');

-- CreateEnum
CREATE TYPE "SendStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "googleId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "picture" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiry" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedThread" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gmailThreadId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedMessage" (
    "id" TEXT NOT NULL,
    "trackedThreadId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "gmailThreadId" TEXT NOT NULL,
    "messageIdHeader" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "subject" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedRecipient" (
    "id" TEXT NOT NULL,
    "trackedMessageId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "recipientType" "RecipientType" NOT NULL,
    "trackingToken" TEXT NOT NULL,
    "gmailMessageId" TEXT,
    "sendStatus" "SendStatus" NOT NULL DEFAULT 'PENDING',
    "sendError" TEXT,
    "sentAt" TIMESTAMP(3),
    "firstOpenedAt" TIMESTAMP(3),
    "lastOpenedAt" TIMESTAMP(3),
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" TEXT NOT NULL,
    "trackedRecipientId" TEXT NOT NULL,
    "type" "TrackingEventType" NOT NULL,
    "category" "OpenCategory" NOT NULL,
    "source" "TrackingEventSource" NOT NULL DEFAULT 'UNKNOWN',
    "classification" "TrackingEventClassification" NOT NULL DEFAULT 'UNKNOWN_OPEN',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "referer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoffToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoffToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtensionSession" (
    "jti" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "browser" TEXT,
    "version" TEXT,

    CONSTRAINT "ExtensionSession_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "GmailAccount_userId_idx" ON "GmailAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GmailAccount_userId_email_key" ON "GmailAccount"("userId", "email");

-- CreateIndex
CREATE INDEX "TrackedThread_gmailThreadId_idx" ON "TrackedThread"("gmailThreadId");

-- CreateIndex
CREATE INDEX "TrackedThread_userId_idx" ON "TrackedThread"("userId");

-- CreateIndex
CREATE INDEX "TrackedThread_createdAt_idx" ON "TrackedThread"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedThread_userId_gmailThreadId_key" ON "TrackedThread"("userId", "gmailThreadId");

-- CreateIndex
CREATE INDEX "TrackedMessage_gmailMessageId_idx" ON "TrackedMessage"("gmailMessageId");

-- CreateIndex
CREATE INDEX "TrackedMessage_trackedThreadId_idx" ON "TrackedMessage"("trackedThreadId");

-- CreateIndex
CREATE INDEX "TrackedMessage_gmailThreadId_idx" ON "TrackedMessage"("gmailThreadId");

-- CreateIndex
CREATE INDEX "TrackedMessage_createdAt_idx" ON "TrackedMessage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedRecipient_trackingToken_key" ON "TrackedRecipient"("trackingToken");

-- CreateIndex
CREATE INDEX "TrackedRecipient_trackedMessageId_idx" ON "TrackedRecipient"("trackedMessageId");

-- CreateIndex
CREATE INDEX "TrackedRecipient_gmailMessageId_idx" ON "TrackedRecipient"("gmailMessageId");

-- CreateIndex
CREATE INDEX "TrackedRecipient_trackingToken_idx" ON "TrackedRecipient"("trackingToken");

-- CreateIndex
CREATE INDEX "TrackedRecipient_email_idx" ON "TrackedRecipient"("email");

-- CreateIndex
CREATE INDEX "TrackedRecipient_createdAt_idx" ON "TrackedRecipient"("createdAt");

-- CreateIndex
CREATE INDEX "TrackingEvent_trackedRecipientId_idx" ON "TrackingEvent"("trackedRecipientId");

-- CreateIndex
CREATE INDEX "TrackingEvent_createdAt_idx" ON "TrackingEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HandoffToken_tokenHash_key" ON "HandoffToken"("tokenHash");

-- CreateIndex
CREATE INDEX "HandoffToken_tokenHash_idx" ON "HandoffToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ExtensionSession_userId_idx" ON "ExtensionSession"("userId");

-- AddForeignKey
ALTER TABLE "GmailAccount" ADD CONSTRAINT "GmailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedThread" ADD CONSTRAINT "TrackedThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedMessage" ADD CONSTRAINT "TrackedMessage_trackedThreadId_fkey" FOREIGN KEY ("trackedThreadId") REFERENCES "TrackedThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedRecipient" ADD CONSTRAINT "TrackedRecipient_trackedMessageId_fkey" FOREIGN KEY ("trackedMessageId") REFERENCES "TrackedMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_trackedRecipientId_fkey" FOREIGN KEY ("trackedRecipientId") REFERENCES "TrackedRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
