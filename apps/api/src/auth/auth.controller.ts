import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { ApiStandardErrorResponses } from '../shared/error-response';
import { AuthService } from './auth.service';
import { OperatorAuthGuard } from './operator-auth.guard';

class LoginDto {
  @ApiProperty({ example: 'admin' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ example: 'change-me' })
  @IsString()
  @IsNotEmpty()
  password: string;
}

class AuthResponseDto {
  @ApiProperty({ example: 'admin' })
  username: string;
}

@Controller('auth')
@ApiTags('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login operator and set JWT cookie' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiStandardErrorResponses(400, 401)
  login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): AuthResponseDto {
    return this.authService.login(body.username, body.password, response);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Clear operator session cookie' })
  @ApiOkResponse({ type: AuthResponseDto })
  logout(@Res({ passthrough: true }) response: Response): AuthResponseDto {
    this.authService.logout(response);
    return { username: '' };
  }

  @Get('me')
  @UseGuards(OperatorAuthGuard)
  @ApiCookieAuth('operator-session')
  @ApiOperation({ summary: 'Get current operator identity' })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiStandardErrorResponses(401)
  me(@Req() request: Request): AuthResponseDto {
    return { username: request.operator!.username };
  }
}
