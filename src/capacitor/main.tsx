import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../renderer/App';
import '../renderer/app.css';

const rootElement = document.getElementById('root');

if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
} else {
  console.error('Failed to find the root element.');
}
