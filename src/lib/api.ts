import { APIClient } from '@vpn-service/api-client';

const API_URL = 'https://api.reefvpn.net';
export const api = new APIClient(API_URL);

// Restore token from localStorage on startup
const savedToken = localStorage.getItem('vpn_token');
if (savedToken) {
  api.setToken(savedToken);
}

export function saveToken(token: string) {
  localStorage.setItem('vpn_token', token);
  api.setToken(token);
}

export function clearAuth() {
  localStorage.removeItem('vpn_token');
  localStorage.removeItem('vpn_account');
  api.setToken(null);
}
