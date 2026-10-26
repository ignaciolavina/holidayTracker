import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type {
  BalanceDto,
  HolidayCalendarDto,
  NotificationDto,
  OrgNode,
  OutDto,
  RequestInput,
  RequestPreview,
  Settings,
  TeamCalendarDto,
  UserCalendarDto,
  UserSummary,
  VacationRequestDto,
} from '@ht/shared';
import { api, qs } from './api';

export const useBalance = (year?: number) =>
  useQuery({ queryKey: ['balance', 'me', year], queryFn: () => api.get<BalanceDto>(`/balances/me${qs({ year })}`) });

export const useRequests = (params: { status?: string; year?: number }) =>
  useQuery({ queryKey: ['requests', params], queryFn: () => api.get<VacationRequestDto[]>(`/requests${qs(params)}`) });

export const useRequest = (id: string | null) =>
  useQuery({ queryKey: ['request', id], enabled: !!id, queryFn: () => api.get<VacationRequestDto>(`/requests/${id}`) });

export const useOut = (from: string, to: string) =>
  useQuery({ queryKey: ['out', from, to], queryFn: () => api.get<OutDto>(`/calendar/out${qs({ from, to })}`) });

export const useCalendar = (year: number, userId?: string) =>
  useQuery({
    queryKey: ['calendar', userId ?? 'me', year],
    queryFn: () => api.get<UserCalendarDto>(userId ? `/calendar/user/${userId}${qs({ year })}` : `/calendar/me${qs({ year })}`),
  });

export const useTeamCalendar = (p: { month: string; scope: string; managerId?: string }) =>
  useQuery({
    queryKey: ['team', p],
    queryFn: () => api.get<TeamCalendarDto>(`/calendar/team${qs(p)}`),
    placeholderData: keepPreviousData,
  });

export const useSettings = () =>
  useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings'), staleTime: 10 * 60_000 });

export const useUsers = (enabled = true) =>
  useQuery({ queryKey: ['users'], enabled, queryFn: () => api.get<UserSummary[]>('/users'), staleTime: 5 * 60_000 });

export const useOrgTree = () => useQuery({ queryKey: ['org'], queryFn: () => api.get<OrgNode[]>('/org/tree'), staleTime: 5 * 60_000 });

export const useHolidayCalendars = () =>
  useQuery({ queryKey: ['holiday-calendars'], queryFn: () => api.get<HolidayCalendarDto[]>('/holiday-calendars'), staleTime: 10 * 60_000 });

export interface NotificationsResponse {
  items: NotificationDto[];
  unread: number;
}
export const useNotifications = () =>
  useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<NotificationsResponse>('/notifications'),
    refetchInterval: 60_000,
  });

export const usePreview = (input: RequestInput | null) =>
  useQuery({
    queryKey: ['preview', input],
    enabled: !!input,
    queryFn: () => api.post<RequestPreview>('/requests/preview', input),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
  });

/** Zona horaria / calendario completo: invalida todo lo que depende de solicitudes y saldos. */
export const REQUEST_DEPENDENT_KEYS = ['requests', 'request', 'balance', 'calendar', 'team', 'out', 'notifications'] as const;
