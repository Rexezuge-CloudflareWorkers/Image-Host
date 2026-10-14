import { makeSlug } from '@image-host/shared';
import { uploadToTelegramGroup, mimeForFileName } from '../lib/telegram';
import { listImagesByOwner, insertImage, softDeleteImage, blockImage } from '@image-host/backend-data';
import type { Env } from '../types';

function originOf(c: any): string {
  return new URL(c.req.url).origin;
}

export async function handleListImages(c: any): Promise<Response> {
  const env = c.env as Env;
  const email = c.get('userEmail') as string;
  const url = new URL(c.req.url);
  const page = Number(url.searchParams.get('page') || '0');
  const query = url.searchParams.get('q') || undefined;
  const db = env.ImageHostDB;
  try {
    const { rows, total } = await listImagesByOwner(db, email, page, 20, query);
    return Response.json({ success: true, data: rows, page, total });
  } catch (error: any) {
    return Response.json({ success: false, message: error?.message || 'Unable to list images' }, { status: 500 });
  }
}

export async function handleUploadImage(c: any): Promise<Response> {
  const env = c.env as Env;
  const email = c.get('userEmail') as string;
  const origin = originOf(c);
  const max = Number(env.MAX_UPLOAD_BYTES || '20971520');

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return Response.json({ success: false, message: 'Invalid form data' }, { status: 400 });
  }
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return Response.json({ success: false, message: 'Missing file' }, { status: 400 });
  }
  if (file.size > max) {
    return Response.json({ success: false, message: 'File too large' }, { status: 413 });
  }

  try {
    const uploaded = await uploadToTelegramGroup(env, file);
    const slug = makeSlug(16);
    const db = env.ImageHostDB;
    await insertImage(db, slug, email, uploaded.fileId, uploaded.fileName, file.type || mimeForFileName(uploaded.fileName), file.size);
    return Response.json({
      success: true,
      slug,
      url: `${origin}/i/${slug}`,
      compatUrl: `${origin}/api/cfile/${uploaded.fileId}`,
      fileId: uploaded.fileId,
      fileName: uploaded.fileName,
    }, { status: 201 });
  } catch (error: any) {
    return Response.json({ success: false, message: error?.message || 'Upload failed' }, { status: 500 });
  }
}

export async function handleDeleteImage(c: any): Promise<Response> {
  const env = c.env as Env;
  const email = c.get('userEmail') as string;
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) {
    return Response.json({ success: false, message: 'Invalid id' }, { status: 400 });
  }
  const db = env.ImageHostDB;
  try {
    const ok = await softDeleteImage(db, id, email);
    if (!ok) return Response.json({ success: false, message: 'Not found or not owned by you' }, { status: 404 });
    return Response.json({ success: true });
  } catch (error: any) {
    return Response.json({ success: false, message: error?.message || 'Delete failed' }, { status: 500 });
  }
}

export async function handleBlockImage(c: any): Promise<Response> {
  const env = c.env as Env;
  const email = c.get('userEmail') as string;
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) {
    return Response.json({ success: false, message: 'Invalid id' }, { status: 400 });
  }
  let body: any = {};
  try { body = await c.req.json(); } catch {}
  const blocked = Boolean(body?.blocked);
  const db = env.ImageHostDB;
  try {
    const ok = await blockImage(db, id, email, blocked);
    if (!ok) return Response.json({ success: false, message: 'Not found or not owned by you' }, { status: 404 });
    return Response.json({ success: true });
  } catch (error: any) {
    return Response.json({ success: false, message: error?.message || 'Update failed' }, { status: 500 });
  }
}