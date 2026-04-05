import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

type UserRole = 'operator' | 'admin' | 'viewer';

interface UseRoleResult {
  role: UserRole;
  loading: boolean;
}

export function useRole(): UseRoleResult {
  const [role, setRole] = useState<UserRole>('operator');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchRole() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user && !cancelled) {
          // profiles table may not be in generated types yet — use raw fetch
          const { data, error } = await supabase
            .from('profiles' as any)
            .select('role')
            .eq('id', user.id)
            .single();

          if (!error && data && (data as any).role && !cancelled) {
            setRole((data as any).role as UserRole);
          }
        }
      } catch {
        // Supabase unavailable or no profile table -- default to 'operator'
      }

      if (!cancelled) {
        setLoading(false);
      }
    }

    fetchRole();

    return () => {
      cancelled = true;
    };
  }, []);

  return { role, loading };
}

export type { UserRole };
