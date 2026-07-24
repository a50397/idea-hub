import 'express-session';
import { Role } from '@prisma/client';

declare module 'express-session' {
  interface SessionData {
    userId: string;
    email: string;
    name: string;
    role: Role;
    // Present only for SSO logins: the OIDC ID token, kept solely to pass as
    // id_token_hint to the IdP end-session endpoint on RP-initiated logout.
    // Never logged and never sent to the browser except inside the composed
    // end-session URL.
    idToken?: string;
  }
}
