import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OperatorAuthGuard } from './operator-auth.guard';

@Module({
  controllers: [AuthController],
  providers: [AuthService, OperatorAuthGuard],
  exports: [AuthService, OperatorAuthGuard],
})
export class AuthModule {}
