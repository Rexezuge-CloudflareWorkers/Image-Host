import React, { useEffect, useState } from 'react';

type Image = { id: number; slug: string; file_name: string; view_count: number };

export default function App() {
  const [images, setImages] = useState<Image[]>([]);
  const [status, setStatus] = useState('');

  async function load() {
    const res = await fetch('/user/images');
    const data = await res.json();
    setImages(data.data || []);
  }

  useEffect(() => { load(); }, []);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const res = await fetch('/user/images', { method: 'POST', body: data });
    const result = await res.json();
    setStatus(JSON.stringify(result));
    form.reset();
    await load();
  }

  async function remove(id: number) {
    await fetch('/user/images/' + id, { method: 'DELETE' });
    await load();
  }

  return (
    <main style={{ maxWidth: 900, margin: '2rem auto', fontFamily: 'system-ui' }}>
      <h1>Image Host</h1>
      <section style={{ border: '1px solid #ddd', borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h2>Upload</h2>
        <form onSubmit={upload}>
          <input type="file" name="file" required />
          <button type="submit">Upload</button>
        </form>
        <pre>{status}</pre>
      </section>
      <section style={{ border: '1px solid #ddd', borderRadius: 12, padding: 16 }}>
        <h2>My Images</h2>
        <button onClick={load}>Refresh</button>
        <ul>
          {images.map((img) => (
            <li key={img.id}>
              <a href={'/i/' + img.slug}>{img.slug}</a> - {img.file_name} ({img.view_count} views)
              {' '}
              <button onClick={() => remove(img.id)}>Delete</button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}