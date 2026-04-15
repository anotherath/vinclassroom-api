import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: keyof any | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    let result = user;

    // Add token to user object if available (without mutating request.user)
    if (user) {
      const authHeader = request.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        result = { ...user, token: authHeader.substring(7) };
      }
    }

    return data ? result?.[data] : result;
  },
);
