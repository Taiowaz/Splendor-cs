import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { GROUND_KEY, applyGround, FC_KEY, applyFc, DEFAULT_GROUND, DEFAULT_FC } from './components/DebugPanel.jsx'
import './index.css'

applyGround(localStorage.getItem(GROUND_KEY) || DEFAULT_GROUND)
applyFc(localStorage.getItem(FC_KEY) || DEFAULT_FC)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
