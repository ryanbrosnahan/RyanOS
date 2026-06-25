# RyanOS Agent Instructions

## Decision Rules

- Before introducing, replacing, or expanding any third-party service, hosted
  platform, SaaS dependency, paid API, managed auth provider, analytics service,
  email/SMS provider, storage provider, AI provider, payment provider, or
  deployment platform, you MUST start a discussion with the user.
- The discussion MUST cover the service role, why an external service is needed,
  self-hosted or library-only alternatives, pricing and scale risk, vendor
  lock-in, data exposure, secret handling, operational burden, and the exit plan.
- Pure code libraries that run entirely inside RyanOS can be proposed normally,
  but if a library has an optional hosted product or account-based service, call
  that out before adopting it.
- Do not convert a local/self-hosted design into a managed-service dependency
  without explicit user approval.

## Checklist

- Does this change add a new account, API key, hosted dashboard, cloud resource,
  paid plan, or external data processor?
- Can RyanOS keep running if the third party disappears, changes pricing, or
  removes a free tier?
- Is there a self-hosted or well-trusted internal implementation that meets the
  current phase goals?
- Are secrets and user data kept out of client-side code and logs?
