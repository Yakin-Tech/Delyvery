import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n';
import './styles/reset.css';
import './styles/variables.css';
import './styles/global.css';
import App from './App';
import { applyTheme, readStoredTheme } from './theme';

// Applied before the first paint so there's no flash of the default theme
// before AuthContext loads the signed-in user's saved preference.
applyTheme(readStoredTheme());

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
