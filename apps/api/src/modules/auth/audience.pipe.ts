import { NotFoundException, PipeTransform } from '@nestjs/common';
import type { Audience } from './token.service.js';

/** Valide le segment d'URL `:audience` ; toute autre valeur donne 404. */
export class AudiencePipe implements PipeTransform<string, Audience> {
  transform(value: string): Audience {
    if (value === 'staff' || value === 'customer') return value;
    throw new NotFoundException();
  }
}
