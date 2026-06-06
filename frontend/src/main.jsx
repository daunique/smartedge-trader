import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Clear old localStorage keys that might cause conflicts
try {
  const keysToRemove = ['smartedge-store', 'smartedge-v1', 'smartedge-v2']
  keysToRemove.forEach(k => localStorage.removeItem(k))
} catch(e) {}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    console.error('App crashed:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', background: '#080B14', color: '#E8F0FF',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', fontFamily: 'monospace', padding: '20px'
        }}>
          <div style={{ color: '#00D4FF', fontSize: '24px', marginBottom: '16px' }}>⚡ SmartEdge</div>
          <div style={{ color: '#FF3D6B', marginBottom: '8px' }}>Something went wrong</div>
          <div style={{ color: '#7B8FAB', fontSize: '12px', marginBottom: '24px', textAlign: 'center' }}>
            {this.state.error?.message}
          </div>
          <button
            onClick={() => { localStorage.clear(); window.location.reload() }}
            style={{
              background: '#00D4FF20', border: '1px solid #00D4FF40',
              color: '#00D4FF', padding: '10px 24px', borderRadius: '8px',
              cursor: 'pointer', fontFamily: 'monospace'
            }}>
            Clear Cache & Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
