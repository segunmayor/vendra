import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => issue.path.join('.') || 'body');
      throw new BadRequestException(`Invalid request: ${[...new Set(fields)].join(', ')}`);
    }
    return parsed.data;
  }
}
