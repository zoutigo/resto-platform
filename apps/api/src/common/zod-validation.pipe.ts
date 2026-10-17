import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/** Erreur 400 uniforme : `issues[].path` désigne le champ, `message` est une clé i18n. */
export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'ValidationError',
      message: 'validation.failed',
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

/** Pipe unique de validation : les schémas Zod viennent de `@resto/shared`. */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    return parseOrThrow(this.schema, value);
  }
}
