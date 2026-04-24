import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'Equa — DRE',
  description: 'Modelo financeiro dinâmico. Altere premissas, OKRs ou milestones para ver DRE, caixa e cenários em tempo real.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <Script 
          src="https://cdn.plot.ly/plotly-2.32.0.min.js" 
          strategy="beforeInteractive"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
