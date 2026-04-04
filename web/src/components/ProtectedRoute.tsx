import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();

  // Allow demo mode (set via "Skip login" on the login page)
  const isDemo = sessionStorage.getItem('dronemedic-demo') === 'true';

  if (loading) {
    return (
      <div style={{ height: '100vh', background: '#0f1418', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '2px solid #b3c5ff', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  // Demo mode bypasses auth
  if (isDemo) {
    return <>{children}</>;
  }

  // No user — redirect to login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // User exists but email not confirmed — redirect to verify page
  if (!user.email_confirmed_at) {
    return <Navigate to="/verify-email" replace />;
  }

  return <>{children}</>;
}
