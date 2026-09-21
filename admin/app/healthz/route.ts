// Liveness probe for the platform health check.
// Railway's health check path for this service is /healthz (inherited from the
// old root railway.json). Next.js has no such route by default, so a healthy
// container was being marked FAILED. This makes the app self-sufficient: it
// answers the probe regardless of how the platform is configured.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok', service: 'admin' });
}
