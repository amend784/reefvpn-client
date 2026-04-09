export interface User {
  id: string;
  account_number: string;
  telegram_id?: number;
  email?: string;
  is_admin?: boolean;
  vpn_uuid: string;
  referral_code?: string;
  assigned_node_id?: string;
  preferred_country?: string;
  preferred_city?: string;
  node_assigned_at?: string;
  created_at: string;
  expires_at?: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

export interface RegisterResponse {
  account_number: string;
  token: string;
}

export interface TelegramAuthResponse {
  token: string;
  account_number: string;
  is_new: boolean;
  user: User;
}

export interface Node {
  id: string;
  name: string;
  host: string;
  port: number;
  country: string;
  city: string;
  protocols: Protocol[];
  load: number;
  is_active: boolean;
  auto_disabled?: boolean;
  drain_reason?: string;
  latency_ms?: number;
  packet_loss?: number;
  xray_server_name?: string;
  xray_grpc_port?: number;
  xray_grpc_service_name?: string;
  xray_xhttp_port?: number;
  xray_xhttp_path?: string;
  xray_xhttp_mode?: string;
  wg_public_key?: string;
  wg_port?: number;
  wg_ipv4_cidr?: string;
  wg_dns?: string;
  supports_wireguard?: boolean;
}

export interface NodeLocation {
  country: string;
  city: string;
  node_count: number;
  active_count: number;
  avg_load: number;
  avg_latency_ms: number;
}

export interface Protocol {
  name: string;
  transports: string[];
}

export interface Preset {
  id: string;
  name: string;
  mode: string;
  rules: Rule[];
  default_action: string;
  is_builtin: boolean;
}

export interface Rule {
  type: string;
  value: string;
  action: string;
}

export interface VPNConfig {
  mode?: string;
  protocol: string;
  config: string;
  node_name: string;
  country: string;
  transport?: string;
}

export interface ConnectionProfile {
  mode: string;
  label: string;
  description: string;
}

export interface ProfilesResponse {
  profiles: ConnectionProfile[];
  recommended: string;
}

export interface GenerateConfigInput {
  mode?: string;
  node_id?: string;
  country?: string;
  city?: string;
  protocol?: string;
  transport?: string;
  device_name?: string;
  device_type?: string;
  client_public_key?: string;
  client_private_key?: string;
}

export interface Subscription {
  subscription: {
    id: string;
    plan: string;
    status: string;
    started_at: string;
    expires_at: string;
  };
  is_active: boolean;
}

export interface PaymentMethod {
  id: string;
  name: string;
  currencies: string[];
}

export interface Invoice {
  id: string;
  plan: string;
  amount: number;
  currency: string;
  method: string;
  pay_url?: string;
  address?: string;
  pay_amount?: number;
  status: string;
  expires_at: string;
}

export interface Device {
  id: string;
  user_id: string;
  name: string;
  device_type: string;
  approval_code?: string;
  is_approved: boolean;
  last_seen_at?: string;
  created_at: string;
}

export interface ReferralCodeResponse {
  code: string;
}

export interface ReferralApplyResponse {
  message: string;
}

export interface ReferralStats {
  total_referrals: number;
  total_bonus_days: number;
}

export interface Pricing {
  monthly: number;
  yearly: number;
}

export interface AdminStats {
  total_users: number;
  active_subscriptions: number;
  total_revenue: number;
  active_connections: number;
}

export interface AdminUser {
  id: string;
  account_number: string;
  email: string;
  telegram_id: string | null;
  is_admin: boolean;
  device_count: number;
  created_at: string;
}

export interface AdminUsersResponse {
  users: AdminUser[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminPayment {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  created_at: string;
}

export interface AdminNode {
  id: string;
  name: string;
  host: string;
  port: number;
  country: string;
  city: string;
  load: number;
  is_active: boolean;
  auto_disabled?: boolean;
  drain_reason?: string;
  active_connections: number;
  latency_ms?: number;
  packet_loss?: number;
  protocols?: Protocol[];
  xray_public_key?: string;
  xray_short_id?: string;
  xray_server_name?: string;
  xray_grpc_port?: number;
  xray_grpc_service_name?: string;
  xray_xhttp_port?: number;
  xray_xhttp_path?: string;
  xray_xhttp_mode?: string;
  wg_public_key?: string;
  wg_port?: number;
  wg_ipv4_cidr?: string;
  wg_dns?: string;
  supports_wireguard?: boolean;
  last_health_check: string;
}

export interface CreateAdminNodeInput {
  name: string;
  host: string;
  port: number;
  country: string;
  city: string;
  protocols?: Protocol[];
  xray_public_key?: string;
  xray_short_id?: string;
  xray_server_name?: string;
  xray_grpc_port?: number;
  xray_grpc_service_name?: string;
  xray_xhttp_port?: number;
  xray_xhttp_path?: string;
  xray_xhttp_mode?: string;
  wg_public_key?: string;
  wg_port?: number;
  wg_ipv4_cidr?: string;
  wg_dns?: string;
  supports_wireguard?: boolean;
}

export interface UpdateAdminNodeInput {
  name?: string;
  host?: string;
  port?: number;
  country?: string;
  city?: string;
  protocols?: Protocol[];
  is_active?: boolean;
  xray_public_key?: string;
  xray_short_id?: string;
  xray_server_name?: string;
  xray_grpc_port?: number;
  xray_grpc_service_name?: string;
  xray_xhttp_port?: number;
  xray_xhttp_path?: string;
  xray_xhttp_mode?: string;
  wg_public_key?: string;
  wg_port?: number;
  wg_ipv4_cidr?: string;
  wg_dns?: string;
  supports_wireguard?: boolean;
}

export interface NodeEvent {
  id: string;
  node_id: string;
  node_name: string;
  country: string;
  city: string;
  event_type: string;
  message: string;
  created_at: string;
}

export interface NodeLocationAnalytics {
  country: string;
  city: string;
  drain_count: number;
  recover_count: number;
  manual_count: number;
  total_events: number;
}

export interface FlappingNode {
  node_id: string;
  node_name: string;
  country: string;
  city: string;
  event_count: number;
  drain_count: number;
  recover_count: number;
}

export interface NodeAlert {
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  country?: string;
  city?: string;
  node_id?: string;
  node_name?: string;
  event_count?: number;
  healthy_nodes?: number;
}

export interface NodeAnalytics {
  hours: number;
  locations: NodeLocationAnalytics[];
  flapping_nodes: FlappingNode[];
  alerts: NodeAlert[];
}
