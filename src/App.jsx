import { useState } from 'react'
import './App.css'
import { UserStateProvider } from './contexts/UserStateContext'
import { PlannerProvider } from './contexts/PlannerContext'
import FilmsView from './components/FilmsView'
import ScheduleView from './components/ScheduleView'
import MyPlanView from './components/MyPlanView'
import PlannerView from './components/PlannerView'

function App() {
  const [currentView, setCurrentView] = useState('films')

  return (
    <UserStateProvider>
      <PlannerProvider>
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
              className={`nav-button ${currentView === 'planner' ? 'active' : ''}`}
              onClick={() => setCurrentView('planner')}
            >
              Plan My Festival
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
            {currentView === 'planner' && <PlannerView />}
            {currentView === 'plan' && <MyPlanView />}
          </main>
        </div>
      </PlannerProvider>
    </UserStateProvider>
  )
}

export default App
