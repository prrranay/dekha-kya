import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

export interface AuthenticatedRequest extends Request {
  user: {
    id: string;
  };
  cookies: Record<string, string>;
}

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
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
      const secret = process.env.SESSION_SECRET || 'dev-session-secret-key-123456789';
      const decoded = jwt.verify(token, secret) as { userId: string };
      
      // 2. Attach the user structure to request context
      request.user = { id: decoded.userId };
      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired authentication session token');
    }
  }
}
