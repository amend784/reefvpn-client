import type {
  LoginResponse, RegisterResponse, User, Node, Preset,
  VPNConfig, Subscription, PaymentMethod, Invoice,
  AdminNode, AdminPayment, AdminStats, AdminUsersResponse, CreateAdminNodeInput,
  NodeLocation, GenerateConfigInput, UpdateAdminNodeInput, NodeEvent, NodeAnalytics,
  Device, ReferralApplyResponse, ReferralCodeResponse, ReferralStats, Pricing,
  ProfilesResponse
} from './types';

interface ApiResponse<T> {
  data: T;
  error?: string;
}

export class APIClient {
  private baseURL: string;
  private token: string | null = null;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  getToken(): string | null {
    return this.token;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${this.baseURL}${path}`, { ...options, headers });
    const json = await res.json() as ApiResponse<T>;
    if (!res.ok) {
      throw new Error(json.error || `API error: ${res.status}`);
    }
    return json.data;
  }

  // Auth
  async register(): Promise<RegisterResponse> {
    return this.request('/api/v1/auth/register', { method: 'POST' });
  }

  async login(accountNumber: string): Promise<LoginResponse> {
    const data = await this.request<LoginResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ account_number: accountNumber }),
    });
    this.token = data.token;
    return data;
  }

  async registerWithEmail(email: string, password: string): Promise<RegisterResponse & { user: User }> {
    const data = await this.request<RegisterResponse & { user: User }>('/api/v1/auth/register/email', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.token = data.token;
    return data;
  }

  async loginWithEmail(email: string, password: string): Promise<LoginResponse> {
    const data = await this.request<LoginResponse>('/api/v1/auth/login/email', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.token = data.token;
    return data;
  }

  async getMe(): Promise<User> {
    return this.request('/api/v1/auth/me');
  }

  // Nodes
  async listNodes(country?: string): Promise<Node[]> {
    const query = country ? `?country=${country}` : '';
    return this.request(`/api/v1/nodes${query}`);
  }

  async listCountries(): Promise<string[]> {
    return this.request('/api/v1/nodes/countries');
  }

  async listLocations(country?: string): Promise<NodeLocation[]> {
    const query = country ? `?country=${country}` : '';
    return this.request(`/api/v1/nodes/locations${query}`);
  }

  async getBestNode(country?: string, city?: string, protocol?: string): Promise<Node> {
    const params = new URLSearchParams();
    if (country) params.set('country', country);
    if (city) params.set('city', city);
    if (protocol) params.set('protocol', protocol);
    const query = params.toString() ? `?${params}` : '';
    return this.request(`/api/v1/nodes/best${query}`);
  }

  // VPN Config
  async getConnectionProfiles(): Promise<ProfilesResponse> {
    return this.request('/api/v1/config/profiles');
  }

  async generateConfig(input: GenerateConfigInput): Promise<VPNConfig> {
    return this.request('/api/v1/config/generate', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async getSubscriptionURL(): Promise<{ subscription_content: string; node_count: number }> {
    return this.request('/api/v1/config/subscription-url');
  }

  // Presets
  async listBuiltinPresets(): Promise<Preset[]> {
    return this.request('/api/v1/presets/builtins');
  }

  async listUserPresets(): Promise<Preset[]> {
    return this.request('/api/v1/presets');
  }

  async createPreset(name: string, mode: string, rules: any[], defaultAction: string): Promise<Preset> {
    return this.request('/api/v1/presets', {
      method: 'POST',
      body: JSON.stringify({ name, mode, rules, default_action: defaultAction }),
    });
  }

  async deletePreset(id: string): Promise<void> {
    return this.request(`/api/v1/presets/${id}`, { method: 'DELETE' });
  }

  async copyPreset(id: string): Promise<Preset> {
    return this.request(`/api/v1/presets/${id}/copy`, { method: 'POST' });
  }

  // Subscription
  async getSubscription(): Promise<Subscription> {
    return this.request('/api/v1/subscription');
  }

  // Payments
  async listPaymentMethods(): Promise<PaymentMethod[]> {
    return this.request('/api/v1/payment/methods');
  }

  async getPricing(): Promise<Pricing> {
    return this.request('/api/v1/payment/pricing');
  }

  async createInvoice(input: {
    plan: string;
    method: string;
    currency?: string;
    asset?: string;
  }): Promise<Invoice> {
    return this.request('/api/v1/payment/invoice', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  // Devices
  async listDevices(): Promise<Device[]> {
    return this.request('/api/v1/devices');
  }

  async registerDevice(name: string, deviceType: string): Promise<Device> {
    return this.request('/api/v1/devices/register', {
      method: 'POST',
      body: JSON.stringify({ name, device_type: deviceType }),
    });
  }

  async removeDevice(id: string): Promise<{ removed: boolean }> {
    return this.request(`/api/v1/devices/${id}`, { method: 'DELETE' });
  }

  async getReferralCode(): Promise<ReferralCodeResponse> {
    return this.request('/api/v1/referral/code');
  }

  async applyReferral(code: string): Promise<ReferralApplyResponse> {
    return this.request('/api/v1/referral/apply', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  }

  async getReferralStats(): Promise<ReferralStats> {
    return this.request('/api/v1/referral/stats');
  }

  // Admin
  async getAdminStats(): Promise<AdminStats> {
    return this.request('/api/v1/admin/stats');
  }

  async listAdminUsers(page = 1, limit = 20): Promise<AdminUsersResponse> {
    return this.request(`/api/v1/admin/users?page=${page}&limit=${limit}`);
  }

  async listPendingPayments(): Promise<AdminPayment[]> {
    return this.request('/api/v1/admin/payments/pending');
  }

  async confirmPayment(id: string): Promise<string> {
    return this.request(`/api/v1/admin/payments/${id}/confirm`, { method: 'POST' });
  }

  async listAdminNodes(): Promise<AdminNode[]> {
    return this.request('/api/v1/admin/nodes');
  }

  async createAdminNode(input: CreateAdminNodeInput): Promise<AdminNode> {
    return this.request('/api/v1/admin/nodes', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async updateAdminNode(id: string, input: UpdateAdminNodeInput): Promise<AdminNode> {
    return this.request(`/api/v1/admin/nodes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  }

  async listNodeEvents(limit = 20): Promise<NodeEvent[]> {
    return this.request(`/api/v1/admin/nodes/events?limit=${limit}`);
  }

  async getNodeAnalytics(hours = 1): Promise<NodeAnalytics> {
    return this.request(`/api/v1/admin/nodes/analytics?hours=${hours}`);
  }
}
