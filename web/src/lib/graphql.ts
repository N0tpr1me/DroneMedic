import { supabase } from './supabase';

/**
 * Execute a GraphQL query against Supabase's pg_graphql endpoint.
 * pg_graphql auto-generates a GraphQL API from the database schema.
 */
export async function graphqlQuery<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'apikey': anonKey,
  };

  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  const res = await fetch(`${supabaseUrl}/graphql/v1`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`GraphQL error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  if (json.errors?.length) {
    throw new Error(`GraphQL: ${json.errors[0].message}`);
  }

  return json.data as T;
}

// Example queries for Analytics page
export const MISSION_WITH_DELIVERIES_QUERY = `
  query MissionDetails($id: String!) {
    missionsCollection(filter: { id: { eq: $id } }) {
      edges {
        node {
          id
          status
          droneId
          plannedRoute
          routeDistance
          batteryUsage
          estimatedTimeSec
          createdAt
          completedAt
          deliveriesCollection {
            edges {
              node {
                id
                destination
                supply
                priority
                status
                deliveredAt
              }
            }
          }
          waypointsCollection(orderBy: [{ sequence: AscNullsLast }]) {
            edges {
              node {
                locationName
                sequence
                reached
                reachedAt
                etaSeconds
              }
            }
          }
        }
      }
    }
  }
`;
