// Minimal OIDC identity provider for E2E, backed by oauth2-mock-server (ESM,
// hoisted at the workspace root). It auto-approves authorize requests (no login
// form) and injects the identity claims the SSO spec asserts via the
// `beforeTokenSigning` event. Started by Playwright's webServer as:
//   node e2e/support/mock-idp.mjs
//
// The issuer advertises http://localhost:<port> (oauth2-mock-server always uses
// `localhost`), which the backend's SSO_ISSUER_URL points at for discovery.
import { OAuth2Server } from 'oauth2-mock-server';

const port = Number(process.env.MOCK_IDP_PORT || 8099);

const identity = {
  email: process.env.SSO_USER_EMAIL || 'sso.user@example.com',
  name: process.env.SSO_USER_NAME || 'SSO User',
  roles: (process.env.SSO_USER_ROLES || 'ideahub-power').split(',').map((r) => r.trim()),
  org: process.env.SSO_USER_ORG || 'QA',
};

const server = new OAuth2Server();
await server.issuer.keys.generate('RS256');

// Inject claims into every signed token (id_token / access_token). openid-client
// reads the id_token claims on the backend callback.
server.service.on('beforeTokenSigning', (token) => {
  token.payload.email = identity.email;
  token.payload.name = identity.name;
  token.payload.roles = identity.roles;
  token.payload.org = identity.org;
});

await server.start(port, 'localhost');
console.log(`[mock-idp] issuer ready at ${server.issuer.url}`);
console.log(`[mock-idp] asserting identity ${identity.email} roles=${identity.roles.join(',')} org=${identity.org}`);

async function shutdown() {
  try {
    await server.stop();
  } finally {
    process.exit(0);
  }
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
