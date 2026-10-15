import { useCurrentUser } from './hooks/useCurrentUser';
import { PublicView } from './components/PublicView';
import { ConsoleView } from './components/ConsoleView';

/**
 * The one document, rendered three ways.
 *
 * The worker serves this same shell to everyone — that is what lets `/` be a
 * public landing page *and* the console without the server picking between two
 * documents. The choice is made here, from the answer to a single probe:
 *
 * - `authorized === null` → nothing. Rendering the anonymous view while the probe
 *   is in flight would flash the wrong page on every authenticated load.
 * - `authorized === false` → the landing page.
 * - `authorized === true` → the console.
 */
export default function App() {
  const { user, authorized } = useCurrentUser();

  return (
    <main className="shell">
      <header className="masthead">
        <h1>Image Host</h1>
        {authorized === true && user && <span className="identity">{user.email}</span>}
      </header>

      {authorized === null && <p className="empty">Checking your session…</p>}
      {authorized === false && <PublicView />}
      {authorized === true && user && <ConsoleView email={user.email} />}
    </main>
  );
}
