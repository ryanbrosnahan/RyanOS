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

## Production Operations

- Read `docs/HOME_SERVER_RECOVERY.md` before changing production networking,
  Docker state, the churn guard, or host services on the Lenovo server.
- You MAY run read-only production diagnostics without approval.
- You MUST obtain explicit user approval immediately before restarting
  NetworkManager or Tailscale, rebooting the host, removing a churn-guard trip
  marker, or performing another action that can sever remote access.
- When the churn guard has paused Docker, keep Docker paused until
  NetworkManager is responsive and no new D-Bus pending-reply saturation has
  appeared during the recovery observation window.
- Run remote network recovery as a detached systemd unit so it survives an SSH
  disconnect. Do not rely on the interactive SSH shell to finish recovery.
- Do not build production Docker images on the Lenovo server. Build and test
  them locally, then use `scripts/deploy-lenovo.sh`.
- If recovery validation fails, leave Docker paused, report the evidence and
  commands attempted, and request local intervention or approval for a
  controlled reboot.

## Checklist

- Does this change add a new account, API key, hosted dashboard, cloud resource,
  paid plan, or external data processor?
- Can RyanOS keep running if the third party disappears, changes pricing, or
  removes a free tier?
- Is there a self-hosted or well-trusted internal implementation that meets the
  current phase goals?
- Are secrets and user data kept out of client-side code and logs?
- For production host changes, did you follow the recovery runbook and preserve
  a safe path if SSH disconnects?
