import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { timingSafeEqual, scryptSync } from 'node:crypto';
import jwt, { type Secret, type SignOptions } from 'jsonwebtoken';

export interface OperatorIdentity {
  username: string;
}

const COOKIE_NAME = 'logovisor_operator_session';

@Injectable()
export class AuthService {
  constructor(private readonly configService: ConfigService) {}

  login(
    username: string,
    password: string,
    response: Response,
  ): OperatorIdentity {
    const configuredUsername =
      this.configService.get<string>('LOGOVISOR_OPERATOR_USERNAME') ?? 'admin';

    if (username !== configuredUsername || !this.isPasswordValid(password)) {
      throw new UnauthorizedException('invalid operator credentials');
    }

    const identity = { username };
    const signOptions: SignOptions = {
      expiresIn: Number(
        this.configService.get<string>(
          'LOGOVISOR_OPERATOR_JWT_EXPIRES_IN_SECONDS',
        ) ?? '28800',
      ),
      subject: username,
    };
    const token = jwt.sign(identity, this.getJwtSecret(), signOptions);

    response.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure:
        (this.configService.get<string>('LOGOVISOR_OPERATOR_COOKIE_SECURE') ??
          'false') === 'true',
      path: '/',
    });

    return identity;
  }

  logout(response: Response): void {
    response.clearCookie(COOKIE_NAME, { path: '/' });
  }

  verifyCookieToken(token: string | undefined): OperatorIdentity {
    if (!token) {
      throw new UnauthorizedException('missing operator session');
    }

    const payload = jwt.verify(token, this.getJwtSecret());
    if (!isRecord(payload) || typeof payload.username !== 'string') {
      throw new UnauthorizedException('invalid operator session');
    }

    return { username: payload.username };
  }

  cookieName(): string {
    return COOKIE_NAME;
  }

  private isPasswordValid(password: string): boolean {
    const hash = this.configService.get<string>(
      'LOGOVISOR_OPERATOR_PASSWORD_HASH',
    );
    const plain = this.configService.get<string>('LOGOVISOR_OPERATOR_PASSWORD');

    if (hash) {
      const parts = hash.split(':');
      if (parts.length !== 3 || parts[0] !== 'scrypt') {
        throw new Error(
          'LOGOVISOR_OPERATOR_PASSWORD_HASH must be scrypt:<salt>:<hash>',
        );
      }

      const derived = scryptSync(password, parts[1], 64).toString('hex');
      return timingSafeEqual(Buffer.from(derived), Buffer.from(parts[2]));
    }

    if (!plain) {
      throw new Error(
        'LOGOVISOR_OPERATOR_PASSWORD or LOGOVISOR_OPERATOR_PASSWORD_HASH is required',
      );
    }

    return timingSafeEqual(Buffer.from(password), Buffer.from(plain));
  }

  private getJwtSecret(): Secret {
    const secret = this.configService.get<string>(
      'LOGOVISOR_OPERATOR_JWT_SECRET',
    );
    if (!secret) {
      throw new Error('LOGOVISOR_OPERATOR_JWT_SECRET is required');
    }

    return secret;
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
