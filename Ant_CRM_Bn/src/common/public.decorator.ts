import { SetMetadata } from '@nestjs/common';

// marca uma rota como isenta do JwtAuthGuard global (ex: POST /auth/login)
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
