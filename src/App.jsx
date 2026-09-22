import { useState } from 'react'
import './App.css'
import { UserStateProvider } from './contexts/UserStateContext'
import FilmsView from './components/FilmsView'
import ScheduleView from './components/ScheduleView'
import MyPlanView from './components/MyPlanView'

function App() {
  const [currentView, setCurrentView] = useState('films')

  return (
    <UserStateProvider>
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
          {currentView === 'films' && <FilmsView />}
          {currentView === 'schedule' && <ScheduleView />}
          {currentView === 'plan' && <MyPlanView />}
        </main>
      </div>
    </UserStateProvider>
  )
}

export default App
