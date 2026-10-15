/**
 * What an anonymous visitor sees.
 *
 * Deliberately *not* an upload form. The server already refuses an anonymous
 * upload — the route is behind Zero Trust — so offering the control would produce
 * a failure the visitor did not cause and could not have predicted. The one thing
 * they can do is sign in, and the link points at `/user/` because that is the
 * path Cloudflare Access is configured to intercept.
 */
export function PublicView() {
  return (
    <>
      <section className="panel">
        <h2>Public Image Host</h2>
        <p className="lede">
          Images uploaded here are stored in a Telegram group and served from a shareable link. Anyone with the link can view the image;
          only the account that uploaded it can list, block or delete it.
        </p>
        <p className="lede">
          Uploading requires a signed-in account. This host uses Cloudflare Zero Trust, so there is no password to create or remember here.
        </p>
        <p style={{ marginTop: '1.25rem', marginBottom: 0 }}>
          <a className="primary-link" href="/user/">
            <button type="button">Sign in to upload</button>
          </a>
        </p>
      </section>

      <section className="panel">
        <h2>How sharing works</h2>
        <p className="lede">
          Every upload gets a link of the form <code>/i/&lt;slug&gt;</code>. The slug is random and unguessable, so the link is the only
          thing that grants access. Links stay valid until the owner deletes or blocks the image.
        </p>
      </section>
    </>
  );
}
