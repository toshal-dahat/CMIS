/** Education line item (matches resume extraction / profile merge) */
export interface ProfileEducationEntry {
  institution?: string;
  degree?: string;
  field?: string;
  dates?: string;
  details?: string;
  gpa?: number | null;
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
  /** Optional; merged from resume extraction, user-editable */
  profileGpa?: number | null;
  profileEducation?: ProfileEducationEntry[];
  profileSkillKeys?: string[];
  /** Whether the user wants to participate in the mentorship program (always editable). */
  mentorshipInterested?: boolean;
  /** When opted in: mentee or mentor. */
  mentorship?: 'mentee' | 'mentor' | null;
  /** When mentorship is mentor: number of mentees (1–10). */
  mentorCapacity?: number | null;
  /** Mentor onboarding details used for matching. */
  mentorSkills?: string[];
  mentorIndustries?: string[];
  mentorCompany?: string | null;
  mentorJobTitle?: string | null;
  mentorYearsExperience?: number | null;
  /** Career goals for mentees; improves semantic matching to mentors. */
  mentorshipGoals?: string | null;
  /** Mentor Matcher: what the student wants from mentorship (used for matching). */
  studentGoals?: string | null;
  /** Mentor Matcher: mentor's background/expertise bio (used for matching). */
  mentorBio?: string | null;
  /** Mentor-only: server pause end date (YYYY-MM-DD); from StudentProfiles. */
  mentorshipMentorPauseUntil?: string | null;
}

/** Current view route */
export type ViewName =
  | 'landing'
  | 'profile-form'
  | 'graduation-handover'
  | 'events'
  | 'event-checkin-scanner'
  | 'event-checkin-entry'
  | 'event-checkin-result'
  | 'student-engagement-analytics'
  | 'mentorship'
  | 'mentorship-operator'
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
  profileGpa?: number | null;
  profileEducation?: ProfileEducationEntry[];
  profileSkillKeys?: string[];
  mentorshipInterested?: boolean;
  mentorship?: 'mentee' | 'mentor' | null;
  mentorCapacity?: number | null;
  mentorSkills?: string[];
  mentorIndustries?: string[];
  mentorCompany?: string | null;
  mentorJobTitle?: string | null;
  mentorYearsExperience?: number | null;
  mentorshipGoals?: string | null;
  studentGoals?: string | null;
  mentorBio?: string | null;
  /** Server-side mentor "remind me later" pause end date (YYYY-MM-DD); set via external-service. */
  mentorshipMentorPauseUntil?: string | null;
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
  profileGpa?: number | null;
  profileEducation?: ProfileEducationEntry[];
  profileSkillKeys?: string[];
  mentorshipInterested?: boolean;
  mentorship?: 'mentee' | 'mentor' | null;
  mentorCapacity?: number | null;
  mentorSkills?: string[];
  mentorIndustries?: string[];
  mentorCompany?: string | null;
  mentorJobTitle?: string | null;
  mentorYearsExperience?: number | null;
  mentorshipGoals?: string | null;
  studentGoals?: string | null;
  mentorBio?: string | null;
  mentorshipMentorPauseUntil?: string | null;
}

/** Master skill row from GET /student/api/skills */
export interface MasterSkill {
  normalizedKey: string;
  canonicalName: string;
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
