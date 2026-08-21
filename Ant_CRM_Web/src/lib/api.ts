import axios from 'axios';
import { clearToken, getToken } from './auth';

// baseURL relativo: em dev o Vite (vite.config.ts) faz proxy de /api -> :3002;
// em produção o Caddy faz o mesmo roteamento.
export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearToken();
      if (location.pathname !== '/login') {
        location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export interface InstanceSummary {
  instanceId: string;
  status: 'connecting' | 'qr_code' | 'connected' | 'disconnected';
  warmupLevel: 'cold' | 'warm' | 'hot';
  warmupAgeDays: number | null;
}

export interface InstanceUsage {
  warmupLevel: 'cold' | 'warm' | 'hot';
  ageDays: number | null;
  limits: { perMinute: number; perHour: number; perDay: number };
  used: { minute: number; hour: number; day: number };
}

export type WarmupLevel = 'cold' | 'warm' | 'hot';

export interface AntibanConfig {
  warmupDaysToWarm: number;
  warmupDaysToHot: number;
  globalDailyLimit: number;
  trustedInstances: string[];
  limits: Record<WarmupLevel, { perMinute: number; perHour: number; perDay: number }>;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  tags: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportContactsResult {
  received: number;
  imported: number;
  duplicates: number;
  invalid: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CampaignProgress {
  pending: number;
  sent: number;
  failed: number;
}

export interface Campaign {
  id: string;
  name: string;
  text: string;
  lastDispatchedAt: string | null;
  createdAt: string;
  updatedAt: string;
  progress: CampaignProgress;
}

export type UserRole = 'admin' | 'user';

export interface CrmUser {
  id: string;
  name: string;
  username: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MessageStatus = 'pending' | 'sent' | 'failed';
export type DispatchMode = 'auto' | 'direct';

export interface MessageLog {
  id: string;
  instanceId: string;
  to: string;
  text: string;
  status: MessageStatus;
  sentAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  campaign: { id: string; name: string } | null;
  contact: { id: string; name: string; phone: string } | null;
  dispatchMode: DispatchMode;
}

export interface TrafficPoint {
  hour: string;
  sent: number;
  failed: number;
  pending: number;
}

export interface QueueDepth {
  active: number;
  completed: number;
  delayed: number;
  failed: number;
  paused: number;
  prioritized: number;
  waiting: number;
  'waiting-children': number;
}

export interface WaitTimeBucket {
  label: string;
  count: number;
}

export interface WarmupOverviewItem {
  instanceId: string;
  status: string;
  warmupLevel: WarmupLevel;
  ageDays: number | null;
  limits: { perMinute: number; perHour: number; perDay: number };
  used: { minute: number; hour: number; day: number };
}

export interface CurrentUser {
  id: string;
  name: string;
  username: string;
  email: string;
  role: UserRole;
}
