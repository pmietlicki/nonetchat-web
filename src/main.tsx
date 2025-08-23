import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initI18n } from './i18n';

const root = createRoot(document.getElementById('root')!);

(async () => {
  await initI18n('fr');
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
})();
