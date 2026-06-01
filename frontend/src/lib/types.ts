/** One education line (matches resume extraction + profile storage) */
export interface EducationRow {
  institution: string;
  degreeDiploma: string;
  specialization: string;
  gpa: string;
  dates: string;
  details: string;
}

/** One experience line */
export interface ExperienceRow {
  company: string;
  title: string;
  dates: string;
  highlights: string;
}

/** Profile shape used in stores and API */
export interface Profile {
  name: string;
  email: string;
  uin: string;
  staffId: string;
  university: string;
  degree: string;
  major: string;
  classYear: string;
  gradDate: string;
  linkedinUrl: string;
  resumeFileName: string;
  resumeS3Key: string;
  role?: string;
  /** Most recent GPA (optional; from resume or manual) */
  gpa?: string;
  education?: EducationRow[];
  skillIds?: string[];
  experience?: ExperienceRow[];
  resumeExtra?: {
    projects?: unknown[];
    extracurricular?: string[];
    achievements?: string[];
    other?: string[];
  };
}

/** Current view route */
export type ViewName =
  | 'landing'
  | 'profile-form'
  | 'graduation-handover'
  | 'events'
  | 'mentorship'
  | 'case-competitions'
  | 'students-connect'
  | 'admins'             // Admin dashboard (companies, tiers, theme)
  | 'manage-users'       // Manage users page (list users and roles)
  | 'judge-dashboard';   // Judge dashboard (case competition grading)

/** User role type */
export type UserRole = 'students' | 'admins';

/** API result with optional error */
export interface ApiResult<T = object> {
  ok: boolean;
  error?: string;
  data?: T;
  status?: number;
}

/** Profile list API result */
export interface ListProfilesResult extends ApiResult {
  profiles?: Array<{
    userId?: string;
    name?: string;
    email?: string;
    uin?: string;
    degree?: string;
    major?: string;
    gradDate?: string;
    linkedInUrl?: string;
    linkedinUrl?: string;
    role?: string;
  }>;
}

/** Create profile request body */
export interface CreateProfileBody {
  name: string;
  email: string;
  uin?: string;
  staffId?: string;
  university?: string;
  degree?: string;
  major?: string;
  gradDate?: string;
  linkedInUrl?: string;
  resumeS3Key?: string | null;
  role?: string;
  gpa?: string | null;
  education?: EducationRow[];
  skillIds?: string[];
  experience?: ExperienceRow[];
  resumeExtra?: Profile['resumeExtra'];
}

/** Update profile (partial) */
export interface UpdateProfileBody {
  name?: string;
  email?: string;
  uin?: string;
  staffId?: string;
  university?: string;
  degree?: string;
  major?: string;
  gradDate?: string;
  linkedInUrl?: string;
  resumeS3Key?: string;
  role?: string;
  gpa?: string | null;
  education?: EducationRow[];
  skillIds?: string[];
  experience?: ExperienceRow[];
  resumeExtra?: Profile['resumeExtra'] | null;
}

/** Option for select dropdowns */
export interface SelectOption {
  value: string;
  label: string;
}

/** Company data structure */
export interface Company {
  companyId: string;
  name: string;
  domain: string;
  tierId: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Tier data structure */
export interface Tier {
  tierId: string;
  name: string;
  rank: number;
  earlyAccessHours: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Theme as returned by the API (uses logoURL).
 * Use NormalizedTheme from api/theme.ts in all frontend components.
 */
export interface Theme {
  primaryColor: string;
  secondaryColor: string;
  logoURL: string;      // API field name — use NormalizedTheme.logoUrl in components
  updatedAt?: string;
}