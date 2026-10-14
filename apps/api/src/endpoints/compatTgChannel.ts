import { uploadToTelegramGroup } from '../lib/telegram';
import { insertImage } from '@image-host/backend-data';
import type { Env } from '../types';

export async function handleCompatTgChannel(c: any): Promise<Response> {
  const env = c.env as Env;
  const email = (c.get('userEmail') as string) || '';
  const origin = new URL(c.req.url).origin;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) {
    return Response.json({ status: 500, message: 'TG_BOT_TOKEN or TG_CHAT_ID is not set', success: false }, { status: 500, headers: corsHeaders });
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return Response.json({ status: 400, message: 'Invalid form data', success: false }, { status: 400, headers: corsHeaders });
  }
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return Response.json({ status: 400, message: 'Missing file', success: false }, { status: 400, headers: corsHeaders });
  }

  const max = Number(env.MAX_UPLOAD_BYTES || '20971520');
  if (file.size > max) {
    return Response.json({ status: 413, message: 'File too large', success: false }, { status: 413, headers: corsHeaders });
  }

  try {
    const uploaded = await uploadToTelegramGroup(env, file);
    const db = env.ImageHostDB;
    try {
      await insertImage(db, uploaded.fileId, email, uploaded.fileId, uploaded.fileName, file.type || 'application/octet-stream', file.size);
    } catch (error) {
      // Record failure should not break the compatibility link.
    }
    const data = {
      url: `${origin}/api/cfile/${uploaded.fileId}`,
      code: 200,
      name: uploaded.fileId,
    };
    return Response.json({ ...data, msg: '2' }, { status: 200, headers: corsHeaders });
  } catch (error: any) {
    return Response.json({ status: 500, message: error?.message || 'Upload failed', success: false }, { status: 500, headers: corsHeaders });
  }
}