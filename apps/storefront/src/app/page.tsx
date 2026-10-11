import { formatXAF } from '@resto/shared';

export default function Home() {
  return (
    <main style={{ padding: 24 }}>
      <h1>Vitrine</h1>
      <p>Exemple de prix : {formatXAF(2500)}</p>
    </main>
  );
}
