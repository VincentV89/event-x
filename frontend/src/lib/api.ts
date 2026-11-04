import { loadConfig } from './config';
import { getAccessToken } from './auth';

export interface EventSummary {
  eventId: string;
  name: string;
  tagline?: string;
  description: string;
  startDate: string;
  endDate: string;
  venue: string;
  city?: string;
  capacity: number;
  registeredCount: number;
  availableSeats: number;
  capacityPercent: number;
  highlights?: string[];
}

export interface Registration {
  confirmationId: string;
  eventId: string;
  name: string;
  email: string;
  organization: string;
  status: 'CONFIRMED' | 'CANCELLED';
  createdAt: string;
  cancelledAt?: string;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, string>) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}, auth = false): Promise<T> {
  const cfg = await loadConfig();
  const headers: Record<string, string> = { ...(init.body ? { 'content-type': 'application/json' } : {}) };
  if (auth) {
    const token = getAccessToken();
    if (!token) throw new ApiError(401, 'UNAUTHENTICATED', 'Your session has expired. Please sign in again.');
    headers.authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${cfg.apiUrl}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Network error - please check your connection and try again.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = body?.error ?? {};
    const message = res.status === 401 ? 'Your session has expired. Please sign in again.' : e.message ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, e.code ?? 'ERROR', message, e.details);
  }
  return body as T;
}

export const api = {
  listEvents: () => request<{ events: EventSummary[] }>('/events').then((r) => r.events),
  getEvent: (id: string) => request<{ event: EventSummary }>(`/events/${encodeURIComponent(id)}`).then((r) => r.event),
  register: (id: string, input: { name: string; email: string; organization: string }) =>
    request<{ confirmationId: string; registeredAt: string; event: { availableSeats: number } }>(
      `/events/${encodeURIComponent(id)}/registrations`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  adminEvents: () => request<{ events: EventSummary[] }>('/admin/events', {}, true).then((r) => r.events),
  adminRegistrations: (id: string) =>
    request<{ event: EventSummary; registrations: Registration[] }>(`/admin/events/${encodeURIComponent(id)}/registrations`, {}, true),
  cancel: (id: string, confirmationId: string) =>
    request<{ event: EventSummary }>(
      `/admin/events/${encodeURIComponent(id)}/registrations/${encodeURIComponent(confirmationId)}`,
      { method: 'DELETE' },
      true,
    ),
};

export function formatDateRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const md: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };
  if (start === end) return s.toLocaleDateString('en-SG', { ...md, year: 'numeric' });
  return `${s.toLocaleDateString('en-SG', md)} – ${e.toLocaleDateString('en-SG', { ...md, year: 'numeric' })}`;
}
