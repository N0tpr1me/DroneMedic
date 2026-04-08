import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { APIProvider } from '@vis.gl/react-google-maps';
import { AnimatePresence } from 'framer-motion';
import { Navbar } from './components/layout/Navbar';
import { Landing } from './pages/Landing';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Dashboard } from './pages/Dashboard';
import { Deploy } from './pages/Deploy';
import { Fleet } from './pages/Fleet';
import { Logs } from './pages/Logs';
import { Analytics } from './pages/Analytics';
import { Settings } from './pages/Settings';
import { Simulation } from './pages/Simulation';
import { Status } from './pages/Status';
import { VerifyEmail } from './pages/VerifyEmail';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useSettings } from './hooks/useSettings';
import { useTheme } from './hooks/useTheme';
import { MissionProvider } from './context/MissionContext';

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  useTheme(settings.display.darkMode);
  return <>{children}</>;
}

function AppRoutes() {
  const location = useLocation();
  const isLanding = location.pathname === '/';
  const isAuth = location.pathname === '/login' || location.pathname === '/signup' || location.pathname === '/verify-email';
  const isStatus = location.pathname === '/status';
  const isDashboard = location.pathname === '/dashboard';
  const isDeploy = location.pathname === '/deploy';
  const isFleet = location.pathname === '/fleet';
  const isAnalytics = location.pathname === '/analytics';
  const isLogs = location.pathname === '/logs';
  const isSimulation = location.pathname === '/simulation';
  const isSettings = location.pathname === '/settings';

  return (
    <>
      {/* Landing, login/signup, dashboard, deploy, fleet, logs, and settings have their own headers */}
      {!isLanding && !isAuth && !isDashboard && !isDeploy && !isFleet && !isLogs && !isAnalytics && !isSimulation && !isSettings && !isStatus && <Navbar />}
      <AnimatePresence mode="wait">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/status" element={<Status />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/deploy" element={<ProtectedRoute><Deploy /></ProtectedRoute>} />
          <Route path="/fleet" element={<ProtectedRoute><Fleet /></ProtectedRoute>} />
          <Route path="/logs" element={<ProtectedRoute><Logs /></ProtectedRoute>} />
          <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
          <Route path="/simulation" element={<ProtectedRoute><Simulation /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        </Routes>
      </AnimatePresence>
    </>
  );
}

function App() {
  return (
    <APIProvider apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? ''} libraries={['marker']}>
      <BrowserRouter>
        <MissionProvider>
          <ThemeProvider>
            <AppRoutes />
          </ThemeProvider>
        </MissionProvider>
      </BrowserRouter>
    </APIProvider>
  );
}

export default App;
