import 'express-session';
import { Role } from '@prisma/client';

declare module 'express-session' {
  interface SessionData {
    userId: string;
    email: string;
    name: string;
    role: Role;
  }
}
