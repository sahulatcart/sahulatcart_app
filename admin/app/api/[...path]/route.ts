// Runtime proxy → backend. Reads BACKEND_URL at REQUEST time (route handlers are dynamic),
// so it works regardless of build-time env — unlike next.config rewrites which bake at build.
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const backend = (): string => process.env.BACKEND_URL || 'http://localhost:8080';

async function proxy(req: NextRequest, ctx: { params: { path: string[] } }): Promise<Response> {
  const url = `${backend()}/api/${ctx.params.path.join('/')}${req.nextUrl.search}`;
  const headers = new Headers();
  for (const [k, v] of req.headers) {
    if (['host', 'connection', 'content-length'].includes(k.toLowerCase())) continue;
    headers.set(k, v);
  }
  const init: RequestInit = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') init.body = await req.text();

  try {
    const res = await fetch(url, init);
    const body = await res.arrayBuffer();
    return new Response(body, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') || 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: { code: 'PROXY', message: (e as Error).message } }), { status: 502, headers: { 'content-type': 'application/json' } });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
