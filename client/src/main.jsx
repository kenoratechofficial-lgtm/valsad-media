import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './PublicApp.jsx';
import './styles.css';
import './responsive.css';
if (window.location.pathname === '/') window.history.replaceState(null, '', '/en' + window.location.search + window.location.hash);
createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><App /></BrowserRouter></React.StrictMode>);
