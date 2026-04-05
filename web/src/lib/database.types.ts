export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      deliveries: {
        Row: {
          assigned_drone: string | null
          created_at: string
          delivered_at: string | null
          destination: string
          id: string
          mission_id: string | null
          priority: Database["public"]["Enums"]["delivery_priority"]
          status: Database["public"]["Enums"]["delivery_status"]
          supply: string
          time_window_minutes: number | null
          user_id: string | null
        }
        Insert: {
          assigned_drone?: string | null
          created_at?: string
          delivered_at?: string | null
          destination: string
          id: string
          mission_id?: string | null
          priority?: Database["public"]["Enums"]["delivery_priority"]
          status?: Database["public"]["Enums"]["delivery_status"]
          supply?: string
          time_window_minutes?: number | null
          user_id?: string | null
        }
        Update: {
          assigned_drone?: string | null
          created_at?: string
          delivered_at?: string | null
          destination?: string
          id?: string
          mission_id?: string | null
          priority?: Database["public"]["Enums"]["delivery_priority"]
          status?: Database["public"]["Enums"]["delivery_status"]
          supply?: string
          time_window_minutes?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_assigned_drone_fkey"
            columns: ["assigned_drone"]
            isOneToOne: false
            referencedRelation: "drones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
        ]
      }
      drones: {
        Row: {
          altitude: number
          battery: number
          created_at: string
          current_location: string | null
          current_mission_id: string | null
          id: string
          lat: number | null
          lon: number | null
          payload: string | null
          position_x: number
          position_y: number
          position_z: number
          speed: number
          status: Database["public"]["Enums"]["drone_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          altitude?: number
          battery?: number
          created_at?: string
          current_location?: string | null
          current_mission_id?: string | null
          id: string
          lat?: number | null
          lon?: number | null
          payload?: string | null
          position_x?: number
          position_y?: number
          position_z?: number
          speed?: number
          status?: Database["public"]["Enums"]["drone_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          altitude?: number
          battery?: number
          created_at?: string
          current_location?: string | null
          current_mission_id?: string | null
          id?: string
          lat?: number | null
          lon?: number | null
          payload?: string | null
          position_x?: number
          position_y?: number
          position_z?: number
          speed?: number
          status?: Database["public"]["Enums"]["drone_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_drones_current_mission"
            columns: ["current_mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string
          data: Json
          drone_id: string | null
          id: string
          mission_id: string | null
          source: Database["public"]["Enums"]["event_source"]
          type: Database["public"]["Enums"]["event_type"]
          user_id: string | null
        }
        Insert: {
          created_at?: string
          data?: Json
          drone_id?: string | null
          id: string
          mission_id?: string | null
          source?: Database["public"]["Enums"]["event_source"]
          type: Database["public"]["Enums"]["event_type"]
          user_id?: string | null
        }
        Update: {
          created_at?: string
          data?: Json
          drone_id?: string | null
          id?: string
          mission_id?: string | null
          source?: Database["public"]["Enums"]["event_source"]
          type?: Database["public"]["Enums"]["event_type"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_drone_id_fkey"
            columns: ["drone_id"]
            isOneToOne: false
            referencedRelation: "drones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities: {
        Row: {
          created_at: string
          description: string | null
          facility_type: string
          id: string
          is_active: boolean
          is_depot: boolean
          lat: number
          lon: number
          name: string
          sim_x: number
          sim_y: number
          sim_z: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          facility_type?: string
          id?: string
          is_active?: boolean
          is_depot?: boolean
          lat: number
          lon: number
          name: string
          sim_x?: number
          sim_y?: number
          sim_z?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          facility_type?: string
          id?: string
          is_active?: boolean
          is_depot?: boolean
          lat?: number
          lon?: number
          name?: string
          sim_x?: number
          sim_y?: number
          sim_z?: number
        }
        Relationships: []
      }
      missions: {
        Row: {
          battery_usage: number
          completed_at: string | null
          created_at: string
          current_waypoint_index: number
          drone_id: string | null
          estimated_time_sec: number
          failed_reason: string | null
          id: string
          planned_route: string[]
          reroute_count: number
          route_distance: number
          started_at: string | null
          status: Database["public"]["Enums"]["mission_status"]
          user_id: string | null
        }
        Insert: {
          battery_usage?: number
          completed_at?: string | null
          created_at?: string
          current_waypoint_index?: number
          drone_id?: string | null
          estimated_time_sec?: number
          failed_reason?: string | null
          id: string
          planned_route?: string[]
          reroute_count?: number
          route_distance?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["mission_status"]
          user_id?: string | null
        }
        Update: {
          battery_usage?: number
          completed_at?: string | null
          created_at?: string
          current_waypoint_index?: number
          drone_id?: string | null
          estimated_time_sec?: number
          failed_reason?: string | null
          id?: string
          planned_route?: string[]
          reroute_count?: number
          route_distance?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["mission_status"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "missions_drone_id_fkey"
            columns: ["drone_id"]
            isOneToOne: false
            referencedRelation: "drones"
            referencedColumns: ["id"]
          },
        ]
      }
      no_fly_zones: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          polygon_geo: Json
          polygon_sim: Json
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          polygon_geo: Json
          polygon_sim: Json
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          polygon_geo?: Json
          polygon_sim?: Json
        }
        Relationships: []
      }
      telemetry: {
        Row: {
          altitude: number
          battery: number
          drone_id: string
          id: string
          lat: number | null
          lon: number | null
          mission_id: string | null
          position_x: number
          position_y: number
          position_z: number
          recorded_at: string
          speed: number
        }
        Insert: {
          altitude?: number
          battery?: number
          drone_id: string
          id?: string
          lat?: number | null
          lon?: number | null
          mission_id?: string | null
          position_x?: number
          position_y?: number
          position_z?: number
          recorded_at?: string
          speed?: number
        }
        Update: {
          altitude?: number
          battery?: number
          drone_id?: string
          id?: string
          lat?: number | null
          lon?: number | null
          mission_id?: string | null
          position_x?: number
          position_y?: number
          position_z?: number
          recorded_at?: string
          speed?: number
        }
        Relationships: [
          {
            foreignKeyName: "telemetry_drone_id_fkey"
            columns: ["drone_id"]
            isOneToOne: false
            referencedRelation: "drones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telemetry_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
        ]
      }
      waypoints: {
        Row: {
          eta_seconds: number | null
          id: string
          is_depot: boolean
          lat: number | null
          location_name: string
          lon: number | null
          mission_id: string
          reached: boolean
          reached_at: string | null
          sequence: number
          sim_x: number | null
          sim_y: number | null
          sim_z: number | null
        }
        Insert: {
          eta_seconds?: number | null
          id?: string
          is_depot?: boolean
          lat?: number | null
          location_name: string
          lon?: number | null
          mission_id: string
          reached?: boolean
          reached_at?: string | null
          sequence: number
          sim_x?: number | null
          sim_y?: number | null
          sim_z?: number | null
        }
        Update: {
          eta_seconds?: number | null
          id?: string
          is_depot?: boolean
          lat?: number | null
          location_name?: string
          lon?: number | null
          mission_id?: string
          reached?: boolean
          reached_at?: string | null
          sequence?: number
          sim_x?: number | null
          sim_y?: number | null
          sim_z?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "waypoints_mission_id_fkey"
            columns: ["mission_id"]
            isOneToOne: false
            referencedRelation: "missions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      delivery_analytics: {
        Row: {
          avg_delivery_time_sec: number | null
          delivered: number | null
          failed: number | null
          high_priority: number | null
          total_deliveries: number | null
          user_id: string | null
        }
        Relationships: []
      }
      mission_analytics: {
        Row: {
          active: number | null
          avg_battery_usage: number | null
          avg_distance: number | null
          avg_reroutes: number | null
          avg_time_sec: number | null
          completed: number | null
          failed: number | null
          last_completed_at: string | null
          total_missions: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_mission_details: { Args: { p_mission_id: string }; Returns: Json }
    }
    Enums: {
      delivery_priority: "high" | "normal"
      delivery_status:
        | "pending"
        | "assigned"
        | "in_transit"
        | "delivering"
        | "delivered"
        | "failed"
        | "cancelled"
      drone_status:
        | "idle"
        | "preflight"
        | "takeoff"
        | "en_route"
        | "hovering"
        | "paused"
        | "delivering"
        | "rerouting"
        | "returning"
        | "landing"
        | "landed"
        | "emergency"
        | "offline"
      event_source: "system" | "manual" | "scenario"
      event_type:
        | "mission_created"
        | "mission_started"
        | "mission_paused"
        | "mission_resumed"
        | "mission_completed"
        | "mission_failed"
        | "mission_aborted"
        | "mission_reassigned"
        | "drone_status_changed"
        | "drone_position_updated"
        | "drone_battery_low"
        | "delivery_created"
        | "delivery_assigned"
        | "delivery_completed"
        | "delivery_failed"
        | "waypoint_reached"
        | "reroute_requested"
        | "reroute_completed"
        | "weather_alert"
        | "geofence_violation"
        | "obstacle_detected"
        | "scenario_triggered"
      mission_status:
        | "planning"
        | "preflight"
        | "in_progress"
        | "paused"
        | "rerouting"
        | "completing"
        | "completed"
        | "failed"
        | "aborted"
        | "reassigned"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  TableName extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]),
> = (DefaultSchema["Tables"] & DefaultSchema["Views"])[TableName] extends {
  Row: infer R
}
  ? R
  : never

export type TablesInsert<
  TableName extends keyof DefaultSchema["Tables"],
> = DefaultSchema["Tables"][TableName] extends {
  Insert: infer I
}
  ? I
  : never

export type TablesUpdate<
  TableName extends keyof DefaultSchema["Tables"],
> = DefaultSchema["Tables"][TableName] extends {
  Update: infer U
}
  ? U
  : never

export type Enums<
  EnumName extends keyof DefaultSchema["Enums"],
> = DefaultSchema["Enums"][EnumName]
