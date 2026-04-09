import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { APIProvider } from '@vis.gl/react-google-maps';
import { AnimatePresence } from 'framer-motion';
import { Toaster } from 'sonner';
import { Navbar } from './components/layout/Navbar';
import { ScrollToTop } from './components/ScrollToTop';
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
import { MissionsInfo } from './pages/MissionsInfo';
import { FleetInfo } from './pages/FleetInfo';
import { Technology } from './pages/Technology';
import { SafetyInfo } from './pages/SafetyInfo';
import { Resources } from './pages/Resources';
import { Contact } from './pages/Contact';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useSettings } from './hooks/useSettings';
import { useTheme } from './hooks/useTheme';
import { MissionProvider } from './context/MissionContext';

const CUSTOM_HEADER_PATHS = new Set([
  '/', '/login', '/signup', '/verify-email', '/status',
  '/dashboard', '/deploy', '/fleet', '/logs', '/analytics', '/simulation', '/settings',
  '/missions', '/fleet-info', '/technology', '/safety', '/resources', '/contact',
]);

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  useTheme(settings.display.darkMode);
  return <>{children}</>;
}

function AppRoutes() {
  const location = useLocation();
  const hideNavbar = CUSTOM_HEADER_PATHS.has(location.pathname);

  return (
    <>
      {!hideNavbar && <Navbar />}
      <AnimatePresence mode="wait">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/status" element={<Status />} />
          {/* Public info pages */}
          <Route path="/missions" element={<MissionsInfo />} />
          <Route path="/fleet-info" element={<FleetInfo />} />
          <Route path="/technology" element={<Technology />} />
          <Route path="/safety" element={<SafetyInfo />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/contact" element={<Contact />} />
          {/* Protected app pages */}
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
            <ScrollToTop />
            <AppRoutes />
            <Toaster theme="dark" richColors position="bottom-right" />
          </ThemeProvider>
        </MissionProvider>
      </BrowserRouter>
    </APIProvider>
  );
}

export default App;
