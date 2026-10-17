import { Global, Module } from '@nestjs/common';
import { EMAIL_CHANNEL, createEmailChannel } from './email.channel.js';

@Global()
@Module({
  providers: [{ provide: EMAIL_CHANNEL, useFactory: () => createEmailChannel() }],
  exports: [EMAIL_CHANNEL],
})
export class NotificationsModule {}
