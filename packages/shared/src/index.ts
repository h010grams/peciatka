import { z } from 'zod';

// Сообщения валидации — это ключи i18n (`v.*`), фронт переводит их сам.

export const LOCALES = ['sk', 'en', 'uk'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

export const ROLES = ['OWNER', 'STAFF'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

const email = z.string().trim().toLowerCase().max(254).email('v.email');
const password = z.string().min(8, 'v.password_min').max(200, 'v.too_long');
const personName = z.string().trim().min(1, 'v.required').max(100, 'v.too_long');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'v.too_long')
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional();

// ───────── Auth ─────────

export const registerSchema = z.object({
  salonName: z.string().trim().min(2, 'v.required').max(80, 'v.too_long'),
  name: personName,
  email,
  password,
  locale: localeSchema.default('sk'),
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'v.required').max(200),
});
export type LoginInput = z.input<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(200),
  password,
});
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;

export const updateMeSchema = z.object({
  name: personName.optional(),
  locale: localeSchema.optional(),
});

export const switchSalonSchema = z.object({ salonId: z.string().uuid() });

// ───────── Salon ─────────

export const updateSalonSchema = z.object({
  name: z.string().trim().min(2, 'v.required').max(80, 'v.too_long').optional(),
  address: optionalText(200),
  phone: optionalText(40),
  defaultLocale: localeSchema.optional(),
});
export type UpdateSalonInput = z.input<typeof updateSalonSchema>;

// ───────── Staff ─────────

export const createInviteSchema = z.object({
  email,
  role: roleSchema.default('STAFF'),
});
export type CreateInviteInput = z.input<typeof createInviteSchema>;

export const updateMemberSchema = z.object({
  role: roleSchema.optional(),
  active: z.boolean().optional(),
});

export const acceptInviteSchema = z.object({
  name: personName.optional(),
  password: password.optional(),
});
export type AcceptInviteInput = z.input<typeof acceptInviteSchema>;

// ───────── Response DTOs ─────────

export interface MeResponse {
  user: { id: string; name: string; email: string; locale: Locale };
  salons: { id: string; name: string; role: Role }[];
  currentSalonId: string | null;
}

export interface SalonDto {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  defaultLocale: Locale;
  timezone: string;
}

export interface StaffResponse {
  members: {
    membershipId: string;
    userId: string;
    name: string;
    email: string;
    role: Role;
    active: boolean;
    isMe: boolean;
  }[];
  invites: { id: string; email: string; role: Role; expiresAt: string }[];
}

export interface InviteInfoResponse {
  salonName: string;
  email: string;
  role: Role;
  userExists: boolean;
}

export interface ApiErrorBody {
  error: { code: string; issues?: { path: string; message: string }[] };
}

// ───────── Программа лояльности ─────────

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'v.color');

export const programSchema = z.object({
  name: z.string().trim().min(1, 'v.required').max(40, 'v.too_long'),
  stampsRequired: z.coerce.number().int('v.int').min(2, 'v.stamps_range').max(30, 'v.stamps_range'),
  rewardText: z.string().trim().min(1, 'v.required').max(60, 'v.too_long'),
  cooldownHours: z.coerce.number().int('v.int').min(0, 'v.cooldown_range').max(168, 'v.cooldown_range'),
  bgColor: hexColor,
  fgColor: hexColor,
  labelColor: hexColor,
});
export type ProgramInput = z.input<typeof programSchema>;

export interface ProgramDto {
  id: string;
  name: string;
  stampsRequired: number;
  rewardText: string;
  cooldownHours: number;
  bgColor: string;
  fgColor: string;
  labelColor: string;
  logoUrl: string | null;
}

// ───────── Публичная регистрация клиентки ─────────

/** Версия текста согласия; меняйте при изменении текста — сохраняется у каждого клиента. */
export const CONSENT_VERSION = '2026-10-v1';

export const joinSchema = z
  .object({
    name: z.string().trim().min(1, 'v.required').max(80, 'v.too_long'),
    phone: z.string().trim().max(30, 'v.too_long').optional().default(''),
    email: z.union([z.literal(''), z.string().trim().toLowerCase().max(254).email('v.email')]).optional().default(''),
    consent: z.literal(true, { errorMap: () => ({ message: 'v.consent' }) }),
    locale: localeSchema.default('sk'),
  })
  .refine((v) => v.phone !== '' || v.email !== '', { message: 'v.contact_required', path: ['phone'] });
export type JoinInput = z.input<typeof joinSchema>;

export interface PublicSalonDto {
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  program: Omit<ProgramDto, 'id' | 'cooldownHours'> | null;
}

export interface PublicCardDto {
  serial: string;
  qrValue: string;
  salonName: string;
  salonSlug: string;
  customerName: string;
  programName: string;
  stampCount: number;
  stampsRequired: number;
  rewardsAvailable: number;
  rewardText: string;
  bgColor: string;
  fgColor: string;
  labelColor: string;
  logoUrl: string | null;
  nextAppointmentAt: string | null;
  timezone: string;
  wallet: { apple: boolean; google: boolean };
}

// ───────── Мастер: карта клиента ─────────

export interface StaffCardDto {
  id: string;
  customer: { id: string; name: string; phone: string | null; email: string | null };
  stampCount: number;
  stampsRequired: number;
  rewardsAvailable: number;
  rewardText: string;
  totalVisits: number;
  lastStampAt: string | null;
  /** null — штамп можно ставить сейчас */
  nextStampAllowedAt: string | null;
  /** последний штамп, который ещё можно отменить */
  revocable: { eventId: string; until: string } | null;
  nextAppointmentAt: string | null;
  timezone: string;
}

export interface StampResultDto {
  card: StaffCardDto;
  rewardEarned: boolean;
}

export const appointmentSchema = z.object({
  // локальное время салона из <input type="datetime-local">: 2026-10-20T14:30
  startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'v.datetime'),
});

// ───────── Клиенты, статистика, журнал ─────────

export interface CustomerListItem {
  id: string;
  cardId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  totalVisits: number;
  stampCount: number;
  rewardsAvailable: number;
  lastVisitAt: string | null;
  createdAt: string;
}

export interface CustomerListResponse {
  items: CustomerListItem[];
  total: number;
}

export interface HistoryItem {
  id: string;
  type: 'STAMP' | 'STAMP_REVOKED' | 'REWARD_EARNED' | 'REWARD_REDEEMED';
  at: string;
  actorName: string | null;
}

export interface CustomerDetailDto extends CustomerListItem {
  locale: Locale;
  consentAt: string;
  consentVersion: string;
  history: HistoryItem[];
}

export const STATS_PERIODS = ['7d', '30d', '90d'] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

export interface StatsDto {
  period: StatsPeriod;
  from: string;
  to: string;
  newCustomers: number;
  visits: number;
  /** разные клиенты, которые пришли в периоде повторно (у них был визит раньше) */
  returningCustomers: number;
  activeCustomers: number;
  rewardsEarned: number;
  rewardsRedeemed: number;
  totalCustomers: number;
  daily: { date: string; visits: number }[];
}

export interface AuditItem {
  id: string;
  action: string;
  actorName: string | null;
  entityType: string;
  entityId: string;
  payload: unknown;
  createdAt: string;
}
