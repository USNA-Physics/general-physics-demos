import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ThemeProvider } from './shared/ThemeContext';
import App from './App';
import PasswordGate from './shell/PasswordGate';
import RouteAnalytics from './shell/RouteAnalytics';
import TapDebug from './shell/TapDebug';
import { initAnalytics } from './analytics';
import { installTapFix } from './shell/tapFix';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import './index.css';

initAnalytics();
installTapFix();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <ThemeProvider>
        <PasswordGate>
          <RouteAnalytics />
          <TapDebug />
          <App />
        </PasswordGate>
      </ThemeProvider>
    </HashRouter>
  </React.StrictMode>,
);
