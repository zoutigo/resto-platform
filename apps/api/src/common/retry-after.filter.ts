import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

/** Ajoute l'en-tête `Retry-After` aux réponses 429 qui portent `retryAfter`. */
@Catch(HttpException)
export class RetryAfterFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const body = exception.getResponse();
    if (exception.getStatus() === 429 && typeof body === 'object' && 'retryAfter' in body) {
      res.setHeader('Retry-After', String(body.retryAfter));
    }
    res.status(exception.getStatus()).json(body);
  }
}
