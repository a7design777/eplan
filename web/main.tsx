import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Не знайдено кореневий елемент #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Офлайн-оболонка. Реєструємо після завантаження, щоб не змагатись за мережу
// з тим, що потрібно намалювати екран просто зараз.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Без service worker застосунок працює як звичайний сайт.
    });
  });
}
