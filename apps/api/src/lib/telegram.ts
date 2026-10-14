import type { Env } from '../types';

export interface TelegramUploadResult {
  fileId: string;
  fileName: string;
}

function endpointForMime(mime: string): { endpoint: string; field: string } {
  if (mime.startsWith('image/')) return { endpoint: 'sendPhoto', field: 'photo' };
  if (mime.startsWith('video/')) return { endpoint: 'sendVideo', field: 'video' };
  if (mime.startsWith('audio/')) return { endpoint: 'sendAudio', field: 'audio' };
  return { endpoint: 'sendDocument', field: 'document' };
}

function extractFile(data: any): TelegramUploadResult | null {
  try {
    const get = (file: any) => ({ fileId: file.file_id, fileName: file.file_name || file.file_unique_id });
    if (data.result?.photo) {
      const largest = data.result.photo.reduce((p: any, c: any) => (p.file_size > c.file_size ? p : c));
      return get(largest);
    }
    if (data.result?.video) return get(data.result.video);
    if (data.result?.document) return get(data.result.document);
    if (data.result?.audio) return get(data.result.audio);
    return null;
  } catch {
    return null;
  }
}

export async function uploadToTelegramGroup(env: Env, file: File): Promise<TelegramUploadResult> {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) {
    throw new Error('TG_BOT_TOKEN or TG_CHAT_ID is not set');
  }
  const { endpoint, field } = endpointForMime(file.type || 'application/octet-stream');
  const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/${endpoint}`;
  const form = new FormData();
  form.append('chat_id', env.TG_CHAT_ID);
  form.append(field, file, file.name);

  const res = await fetch(url, { method: 'POST', body: form });
  const data: any = await res.json();
  if (!data?.ok) throw new Error(data?.description || 'Telegram upload failed');
  const extracted = extractFile(data);
  if (!extracted) throw new Error('Telegram response missing file id');
  return extracted;
}

export async function getTelegramFilePath(env: Env, fileId: string): Promise<string> {
  const url = `https://api.telegram.org/bot${env.TG_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`;
  const res = await fetch(url);
  const data: any = await res.json();
  if (!data?.ok || !data?.result?.file_path) throw new Error('Unable to resolve Telegram file path');
  return data.result.file_path;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', mov: 'video/quicktime',
  pdf: 'application/pdf', txt: 'text/plain', json: 'application/json',
};

export function mimeForFileName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

export async function fetchTelegramFile(env: Env, fileId: string, fileName: string): Promise<Response> {
  const filePath = await getTelegramFilePath(env, fileId);
  const url = `https://api.telegram.org/file/bot${env.TG_BOT_TOKEN}/${filePath}`;
  const upstream = await fetch(url);
  if (!upstream.ok || !upstream.body) {
    return Response.json({ success: false, message: 'Unable to fetch file from Telegram' }, { status: 502 });
  }
  const headers = new Headers();
  headers.set('Content-Type', mimeForFileName(fileName));
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(upstream.body, { status: 200, headers });
}