import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'Equa — Business',
  description: 'Plataforma de modelagem financeira e planejamento estratégico da Equa.',
  openGraph: {
    title: 'Equa — Business',
    description: 'Plataforma de modelagem financeira e planejamento estratégico da Equa.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Equa — Business',
    description: 'Plataforma de modelagem financeira e planejamento estratégico da Equa.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
