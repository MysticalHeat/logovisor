import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@Controller()
@ApiTags('system')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'API health check' })
  @ApiOkResponse({
    description: 'API health response.',
    schema: {
      type: 'string',
      example: 'logovisor api is running',
    },
  })
  getHello(): string {
    return this.appService.getHello();
  }
}
