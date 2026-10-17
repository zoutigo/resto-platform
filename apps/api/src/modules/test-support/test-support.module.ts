import { Module } from '@nestjs/common';
import { TestSupportController } from './test-support.controller.js';

@Module({ controllers: [TestSupportController] })
export class TestSupportModule {}
