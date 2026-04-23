import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Equa — DRE',
  description: 'Modelo financeiro dinâmico. Altere premissas, OKRs ou milestones para ver DRE, caixa e cenários em tempo real.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
