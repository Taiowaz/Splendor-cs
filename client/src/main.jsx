import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { GROUND_KEY, applyGround, FC_KEY, applyFc } from './components/DebugPanel.jsx'
import './index.css'

const savedGround = localStorage.getItem(GROUND_KEY)
if (savedGround) applyGround(savedGround)
const savedFc = localStorage.getItem(FC_KEY)
if (savedFc) applyFc(savedFc)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
