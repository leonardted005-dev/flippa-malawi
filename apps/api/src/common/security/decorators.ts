import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  roles: Role[];
}

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Marks a route as accessible without authentication. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

export type RequiredRole = 'BUYER' | 'SELLER' | 'ADMIN';

/**
 * Requires the caller to hold at least one of the given roles.
 *
 * Prisma’s generated `Role` is a runtime union-like value only after client
 * generation, so this accepts the known role values directly.
 */
export function Roles(...roles: Array<Role | RequiredRole>): MethodDecorator & ClassDecorator {
  return SetMetadata(ROLES_KEY, roles);
}

/**
 * Reads normalized role metadata. Returning an empty array means the route
 * only requires authentication rather than a specific role.
 */
export function getRequiredRoles(
  reflector: Reflector,
  context: ExecutionContext,
): Array<RequiredRole> {
  const configured = reflector.getAllAndOverride<unknown>(ROLES_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);

  if (configured === undefined || configured === null) {
    return [];
  }

  const values = Array.isArray(configured) ? configured : [configured];
  return values.map((value) => {
    if (value === 'BUYER' || value === 'SELLER' || value === 'ADMIN') {
      return value;
    }
    throw new Error(`Unsupported role: ${String(value)}`);
  });
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user) {
      throw new Error('CurrentUser used on a route without JwtAuthGuard');
    }
    return request.user;
  },
);
