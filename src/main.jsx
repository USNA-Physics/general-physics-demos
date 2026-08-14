import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ThemeProvider } from './shared/ThemeContext';
import App from './App';
import PasswordGate from './shell/PasswordGate';
import RouteAnalytics from './shell/RouteAnalytics';
import { initAnalytics } from './analytics';
import { installTouchActivity } from './shared/lib/touchActivity';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import './index.css';

initAnalytics();
installTouchActivity();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <ThemeProvider>
        <PasswordGate>
          <RouteAnalytics />
          <App />
        </PasswordGate>
      </ThemeProvider>
    </HashRouter>
  </React.StrictMode>,
);
