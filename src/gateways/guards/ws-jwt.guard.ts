import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedSocket } from '../types/socket.types';

interface JwtPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

/**
 * WebSocket JWT Guard
 * 
 * Validates JWT token from Socket.IO handshake auth
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      // Get socket from WebSocket context
      const client = context.switchToWs().getClient<AuthenticatedSocket>();
      
      // Extract token from handshake auth or query
      const token = this.extractToken(client);

      if (!token) {
        this.logger.warn('WebSocket connection rejected: No token provided');
        return false;
      }

      // Verify token
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.get<string>('jwt.secret'),
      });

      // Attach user data to socket
      client.data.user = {
        id: payload.sub,
        email: payload.email,
      };

      return true;

    } catch (error) {
      this.logger.warn(`WebSocket auth failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Extract JWT token from socket handshake
   */
  private extractToken(client: AuthenticatedSocket): string | null {
    try {
      // Try to get from auth object (Socket.IO v3+)
      const auth = client.handshake.auth;
      if (auth?.token) {
        return this.cleanToken(auth.token);
      }

      // Try to get from query params
      const query = client.handshake.query;
      if (query?.token) {
        const token = Array.isArray(query.token) ? query.token[0] : query.token;
        return this.cleanToken(token);
      }

      // Try to get from headers
      const headers = client.handshake.headers;
      const authHeader = headers?.authorization;
      if (authHeader) {
        return this.cleanToken(authHeader);
      }

      return null;

    } catch (error) {
      this.logger.error(`Error extracting token: ${error.message}`);
      return null;
    }
  }

  /**
   * Clean token string (remove Bearer prefix)
   */
  private cleanToken(token: string): string | null {
    if (!token) return null;
    return token.replace(/^Bearer\s+/i, '').trim();
  }
}
