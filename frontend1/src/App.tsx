import { Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import DefaultLayout from './layouts/DefaultLayout'
import HomePageDemo from './pages/HomePageDemo'
import ResultsPage from './pages/ResultsPage'
import ResultsBatchPage from './pages/ResultsBatchPage'
import RetrainPage from './pages/RetrainPage'
import PicClickerCapturePage from './pages/PicClickerCapturePage'

function App() {
  return (
    <>
      <Routes>
        <Route element={<DefaultLayout />}>
          <Route path='/home'            element={<HomePage />} />
          <Route path='/'                element={<HomePageDemo />} />
          <Route path='/capture-images'  element={<PicClickerCapturePage />} />
          <Route path='/results'         element={<ResultsPage />} />
          <Route path='/results-batch'   element={<ResultsBatchPage />} />
          <Route path='/retrain'         element={<RetrainPage />} />
        </Route>
        <Route path='/login' element={<LoginPage />} />
      </Routes>
    </>
  )
}

export default App