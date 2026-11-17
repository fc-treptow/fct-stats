import LoginButton from "./LoginButton";

const ERRORS: Record<string, string> = {
  domain: "Zugang nur mit einem @fc-treptow.de Konto.",
  failed: "Anmeldung fehlgeschlagen. Bitte erneut versuchen.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="login">
      <div className="card login-card">
        <h1>FC Treptow Statistik</h1>
        <p className="muted">Einsätze, Karten und Tore aller Teams aus DFBnet.</p>
        {error && <p className="alert">{ERRORS[error] ?? ERRORS.failed}</p>}
        <LoginButton />
        <p className="muted small">Nur für Konten mit @fc-treptow.de.</p>
      </div>
    </main>
  );
}
