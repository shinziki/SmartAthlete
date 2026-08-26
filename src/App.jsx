import { useState } from 'react'
import Login from './pages/Login'
import Register from './pages/Register'

function App() {
  const [page, setPage] = useState('login')

  const togglePage = () => {
    setPage((prev) => (prev === 'login' ? 'register' : 'login'))
  }

  return page === 'login'
    ? <Login onToggle={togglePage} />
    : <Register onToggle={togglePage} />
}

export default App
