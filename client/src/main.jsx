import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { GROUND_KEY, applyGround } from './components/DebugPanel.jsx'
import './index.css'

const savedGround = localStorage.getItem(GROUND_KEY)
if (savedGround) applyGround(savedGround)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
