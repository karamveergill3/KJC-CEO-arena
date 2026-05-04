import '../styles/globals.css';
import { SpeedInsights } from '@vercel/speed-insights/react';

export default function App({ Component, pageProps }) {
  return (
    <>
      <Component {...pageProps} />
      <SpeedInsights />
    </>
  );
}
