import type { Env } from '../types';

export function handleHealth(c: any): Response {
  return Response.json({ status: 'ok', service: 'image-host' });
}