import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthService, OperatorIdentity } from './auth.service';

declare module 'express-serve-static-core' {
  interface Request {
    operator?: OperatorIdentity;
  }
}

@Injectable()
export class OperatorAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const identity = this.authService.verifyCookieToken(
      request.cookies?.[this.authService.cookieName()],
    );
    request.operator = identity;
    return true;
  }
}
