import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'r3ad — volume',
  description: 'A book whose thickness is computed from its text',
};

export const viewport: Viewport = {
  themeColor: '#100d0a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
