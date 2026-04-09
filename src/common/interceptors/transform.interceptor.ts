import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Response<T> {
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
  timestamp: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, Response<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<Response<T>> {
    return next.handle().pipe(
      map((data) => {
        // If data already has meta, use it
        if (data && typeof data === 'object' && 'meta' in data) {
          return {
            data: data.data,
            meta: data.meta,
            timestamp: new Date().toISOString(),
          };
        }

        return {
          data,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
