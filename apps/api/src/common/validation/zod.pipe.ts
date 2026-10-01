import {
  BadRequestException,
  Body,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Validates request payloads with Zod at the API boundary. Database constraints
 * remain the second line of defense.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        problems: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}

/** Sugar: `@ZodBody(schema) dto: RegisterDto` */
export function createZodBodyDecorator(schema: ZodSchema): ParameterDecorator {
  return (
    target: object,
    propertyKey: string | symbol | undefined,
    parameterIndex: number,
  ): void => {
    Body(new ZodValidationPipe(schema))(target, propertyKey, parameterIndex);
  };
}

export const ZodBody = createZodBodyDecorator;
