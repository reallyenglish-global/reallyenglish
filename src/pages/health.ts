import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = () => new Response(JSON.stringify({ status: 'ok' }), {
  status: 200,
  headers: { 'Content-Type': 'application/health+json', 'Cache-Control': 'no-store' },
});
