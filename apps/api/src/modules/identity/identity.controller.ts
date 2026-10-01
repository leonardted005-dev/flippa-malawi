import { Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { deriveRequestMeta } from '../../common/http/request-meta';
import { RateLimit, RateLimitGuard } from '../../common/http/rate-limit.guard';
import { CurrentUser, Public, type AuthenticatedUser } from '../../common/security/decorators';
import { ZodBody } from '../../common/validation/zod.pipe';
import {
  emailRequestSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  tokenConfirmSchema,
  type EmailRequestDto,
  type LoginDto,
  type RefreshDto,
  type RegisterDto,
  type ResetPasswordDto,
  type TokenConfirmDto,
} from './identity.dto';
import { IdentityService } from './identity.service';

@Controller('auth')
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @Post('register')
  register(@ZodBody(registerSchema) dto: RegisterDto, @Req() req: Request) {
    return this.identity.register(dto, deriveRequestMeta(req));
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@ZodBody(loginSchema) dto: LoginDto, @Req() req: Request) {
    return this.identity.login(dto, deriveRequestMeta(req));
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  refresh(@ZodBody(refreshSchema) dto: RefreshDto, @Req() req: Request) {
    return this.identity.refresh(dto.refreshToken, deriveRequestMeta(req));
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@ZodBody(refreshSchema) dto: RefreshDto, @Req() req: Request): Promise<void> {
    await this.identity.logout(dto.refreshToken, deriveRequestMeta(req));
  }

  @HttpCode(HttpStatus.OK)
  @Post('logout-all')
  logoutAll(@CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.identity.logoutAll(user.id, deriveRequestMeta(req));
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.identity.me(user.id);
  }

  @HttpCode(HttpStatus.ACCEPTED)
  @Post('email/verify/request')
  async requestEmailVerification(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<{ requested: true }> {
    await this.identity.requestEmailVerification(user.id, deriveRequestMeta(req));
    return { requested: true };
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @HttpCode(HttpStatus.OK)
  @Post('email/verify/confirm')
  confirmEmailVerification(@ZodBody(tokenConfirmSchema) dto: TokenConfirmDto, @Req() req: Request) {
    return this.identity.confirmEmailVerification(dto.token, deriveRequestMeta(req));
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 5, windowMs: 60_000 })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('password/forgot')
  async forgotPassword(
    @ZodBody(emailRequestSchema) dto: EmailRequestDto,
    @Req() req: Request,
  ): Promise<{ accepted: true }> {
    await this.identity.forgotPassword(dto.email, deriveRequestMeta(req));
    return { accepted: true };
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 5, windowMs: 60_000 })
  @HttpCode(HttpStatus.OK)
  @Post('password/reset')
  async resetPassword(
    @ZodBody(resetPasswordSchema) dto: ResetPasswordDto,
    @Req() req: Request,
  ): Promise<{ reset: true }> {
    await this.identity.resetPassword(dto, deriveRequestMeta(req));
    return { reset: true };
  }
}
