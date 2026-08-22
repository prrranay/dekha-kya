import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    jti?: string;
  };
  cookies: Record<string, string>;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // 1. Retrieve the token from either "session" cookie or authorization header
    let token = request.cookies?.session || request.cookies?.jwt;

    if (!token) {
      const authHeader = request.headers instanceof Headers
        ? request.headers.get('authorization')
        : (request.headers as Record<string, string>)['authorization'];

      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      throw new UnauthorizedException('Authentication session token is missing');
    }

    try {
      const secret = process.env.SESSION_SECRET;
      if (!secret) {
        throw new Error('SESSION_SECRET environment variable is missing.');
      }

      const decoded = jwt.verify(token, secret) as { userId?: string; sub?: string; type?: string; jti?: string };
      
      if (decoded.type === 'extension') {
        if (!decoded.sub || !decoded.jti) {
          throw new UnauthorizedException('Malformed extension authentication token');
        }

        // Validate that the session has not been revoked
        const session = await this.prisma.extensionSession.findUnique({
          where: { jti: decoded.jti },
        });

        if (!session) {
          throw new UnauthorizedException('Extension session not found');
        }

        if (session.revokedAt) {
          throw new UnauthorizedException('Extension session has been revoked');
        }

        // Attach the user structure to request context
        request.user = { id: decoded.sub, jti: decoded.jti };
      } else {
        if (!decoded.userId) {
          throw new UnauthorizedException('Malformed user session token');
        }
        // Attach the user structure to request context
        request.user = { id: decoded.userId };
      }

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired authentication session token');
    }
  }
}

