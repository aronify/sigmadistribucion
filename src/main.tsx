import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'
import { AuthProvider } from './lib/auth'
import './lib/i18n' // Initialize i18n

// Disable StrictMode to prevent double initialization of Supabase client
// StrictMode intentionally double-renders components in development, which causes multiple client instances
ReactDOM.createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </AuthProvider>
)

// Mark body as loaded to prevent FOUC
document.body.classList.add('loaded')
