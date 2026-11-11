import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../http/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';

class HealthResponse {
  @ApiProperty({ example: 'ok' })
  status!: string;
}

@ApiTags('health')
@Public()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ operationId: 'getLiveness', summary: 'The process is running' })
  @ApiOkResponse({ type: HealthResponse })
  live(): HealthResponse {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ operationId: 'getReadiness', summary: 'The API can reach its database' })
  @ApiOkResponse({ type: HealthResponse })
  @ApiServiceUnavailableResponse({ description: 'A dependency is unavailable' })
  async ready(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database is unavailable');
    }
    return { status: 'ok' };
  }
}
