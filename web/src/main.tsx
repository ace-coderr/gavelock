import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './fonts/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/motion.css';
import { App } from './App.tsx';
import { WalletProvider } from './lib/wallet.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <WalletProvider>
      <App />
    </WalletProvider>
  </StrictMode>,
);
