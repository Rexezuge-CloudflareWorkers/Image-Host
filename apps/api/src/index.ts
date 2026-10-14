import { Hono } from 'hono';
import { handleHealth } from './endpoints/health';
import { handleSharedImage } from './endpoints/sharedImage';
import { handleCompatTgChannel } from './endpoints/compatTgChannel';
import {
  handleListImages,
  handleUploadImage,
  handleDeleteImage,
  handleBlockImage,
} from './endpoints/userImages';
import { getZeroTrustEmail, unauthorizedResponse } from './middleware/zeroTrust';
import type { Env } from './types';

const SPA_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Image Host</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
      main { display: grid; gap: 1.5rem; }
      .card { border: 1px solid #ddd; border-radius: 12px; padding: 1rem; }
      label { display: block; margin: .5rem 0; }
      input, button { padding: .5rem; }
    </style>
  </head>
  <body>
    <h1>Image Host</h1>
    <main>
      <section class="card">
        <h2>Upload</h2>
        <form id="uploadForm">
          <input type="file" name="file" required />
          <button type="submit">Upload</button>
        </form>
        <div id="uploadResult"></div>
      </section>
      <section class="card">
        <h2>My Images</h2>
        <button id="refresh">Refresh</button>
        <div id="images"></div>
      </section>
    </main>
    <script type="module">
      const api = (path, init) => fetch(path, init).then(r => r.json());
      document.getElementById('uploadForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = new FormData(e.target);
        const result = await fetch('/user/images', { method: 'POST', body: data }).then(r => r.json());
        document.getElementById('uploadResult').textContent = JSON.stringify(result);
        await loadImages();
      });
      async function loadImages() {
        const result = await api('/user/images');
        const root = document.getElementById('images');
        root.innerHTML = '';
        (result.data || []).forEach((img) => {
          const row = document.createElement('div');
          row.textContent = img.slug + ' - ' + img.file_name;
          const del = document.createElement('button');
          del.textContent = 'Delete';
          del.onclick = async () => {
            await fetch('/user/images/' + img.id, { method: 'DELETE' });
            await loadImages();
          };
          row.appendChild(del);
          root.appendChild(row);
        });
      }
      document.getElementById('refresh').addEventListener('click', loadImages);
      loadImages();
    </script>
  </body>
</html>`;

const app = new Hono<{ Bindings: Env; Variables: { userEmail: string } }>();

app.use('*', async (c, next) => {
  await next();
  c.res.headers.set('Cache-Control', 'no-store');
});

async function requireZeroTrust(c: any, next: any) {
  const env = c.env as Env;
  const email = await getZeroTrustEmail(c.req.raw, env);
  if (!email) return unauthorizedResponse();
  c.set('userEmail', email);
  await next();
}

app.use('/user/*', requireZeroTrust);
app.use('/api/enableauthapi/*', requireZeroTrust);

app.get('/health', (c) => handleHealth(c));
app.get('/i/:slug', (c) => handleSharedImage(c));
app.get('/api/cfile/:name', (c) => handleSharedImage(c));
app.get('/api/file/:name', (c) => handleSharedImage(c));
app.post('/api/enableauthapi/tgchannel', (c) => handleCompatTgChannel(c));

app.get('/user/images', (c) => handleListImages(c));
app.post('/user/images', (c) => handleUploadImage(c));
app.delete('/user/images/:id', (c) => handleDeleteImage(c));
app.put('/user/images/:id/block', (c) => handleBlockImage(c));

app.get('*', (c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/user/')) return c.html(SPA_HTML);
  return c.notFound();
});

export default {
  fetch: (request: Request, env: Env, ctx: any) => app.fetch(request, env, ctx),
};