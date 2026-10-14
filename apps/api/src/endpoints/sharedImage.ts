import { incrementViewCount } from '@image-host/backend-data';
import { fetchTelegramFile } from '../lib/telegram';
import type { Env } from '../types';

export async function handleSharedImage(c: any): Promise<Response> {
  const env = c.env as Env;
  const url = new URL(c.req.url);
  const path = url.pathname;

  if (path.startsWith('/i/')) {
    const slug = c.req.param('slug');
    if (!slug) return Response.json({ success: false, message: 'Not found' }, { status: 404 });
    const db = env.ImageHostDB as any;
    let row: any = null;
    try {
      row = await db.prepare(`SELECT * FROM images WHERE slug = ?`).bind(slug).first();
    } catch (error) {
      return Response.json({ success: false, message: 'Storage unavailable' }, { status: 500 });
    }
    if (!row || row.deleted_at || row.blocked) {
      return Response.json({ success: false, message: 'Not found' }, { status: 404 });
    }
    c.executionCtx.waitUntil(
      incrementViewCount(db, slug).catch(() => undefined),
    );
    const referer = c.req.header('referer') || 'direct';
    c.executionCtx.waitUntil(
      db
        .prepare(`INSERT INTO image_views (image_id, referer, ip, viewed_at) VALUES (?, ?, ?, ?)`)
        .bind(row.id, referer, c.req.header('cf-connecting-ip') || 'unknown', new Date().toISOString())
        .run()
        .catch(() => undefined),
    );
    return fetchTelegramFile(env, row.file_id, row.file_name);
  }

  if (path.startsWith('/api/cfile/')) {
    const name = c.req.param('name');
    if (!name) return Response.json({ success: false, message: 'Not found' }, { status: 404 });
    return fetchTelegramFile(env, name, name);
  }

  if (path.startsWith('/api/file/')) {
    const name = c.req.param('name');
    if (!name) return Response.json({ success: false, message: 'Not found' }, { status: 404 });
    const upstream = await fetch(`https://telegra.ph/file/${name}`);
    if (!upstream.ok || !upstream.body) {
      return Response.json({ success: false, message: 'Not found' }, { status: 404 });
    }
    const headers = new Headers(upstream.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  return Response.json({ success: false, message: 'Not found' }, { status: 404 });
}