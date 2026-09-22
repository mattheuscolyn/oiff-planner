import { useState } from 'react'
import './App.css'
import FilmsView from './components/FilmsView'
import ScheduleView from './components/ScheduleView'
import MyPlanView from './components/MyPlanView'

function App() {
  const [currentView, setCurrentView] = useState('films')
  const [refreshKey, setRefreshKey] = useState(0)

  const forceRefresh = () => {
    setRefreshKey(prev => prev + 1)
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <h1 className="app-title">OIFF Planner</h1>
          <p className="app-subtitle">Orcas Island Film Festival 2026</p>
        </div>
      </header>

      <nav className="app-nav">
        <button
          className={`nav-button ${currentView === 'films' ? 'active' : ''}`}
          onClick={() => setCurrentView('films')}
        >
          Films
        </button>
        <button
          className={`nav-button ${currentView === 'schedule' ? 'active' : ''}`}
          onClick={() => setCurrentView('schedule')}
        >
          Schedule
        </button>
        <button
          className={`nav-button ${currentView === 'plan' ? 'active' : ''}`}
          onClick={() => setCurrentView('plan')}
        >
          My Plan
        </button>
      </nav>

      <main className="app-main">
        {currentView === 'films' && <FilmsView key={refreshKey} onUpdate={forceRefresh} />}
        {currentView === 'schedule' && <ScheduleView key={refreshKey} onUpdate={forceRefresh} />}
        {currentView === 'plan' && <MyPlanView key={refreshKey} onUpdate={forceRefresh} />}
      </main>
    </div>
  )
}

export default App
