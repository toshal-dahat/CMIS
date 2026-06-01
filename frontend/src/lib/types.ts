/** Profile shape used in stores and API */
export interface Profile {
  name: string;
  email: string;
  uin: string;
  degree: string;
  major: string;
  classYear: string;
  gradDate: string;
  linkedinUrl: string;
  resumeFileName: string;
  resumeS3Key: string;
}

/** Current view route */
export type ViewName =
  | 'landing'
  | 'profile-form'
  | 'events'
  | 'mentorship'
  | 'case-competitions'
  | 'students-connect';

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
    name?: string;
    email?: string;
    uin?: string;
    degree?: string;
    major?: string;
    gradDate?: string;
    linkedInUrl?: string;
    linkedinUrl?: string;
  }>;
}

/** Create profile request body */
export interface CreateProfileBody {
  name: string;
  email: string;
  uin: string;
  degree?: string;
  major: string;
  gradDate: string;
  linkedInUrl?: string;
  resumeS3Key?: string | null;
}

/** Update profile (partial) */
export interface UpdateProfileBody {
  name?: string;
  email?: string;
  uin?: string;
  degree?: string;
  major?: string;
  gradDate?: string;
  linkedInUrl?: string;
  resumeS3Key?: string;
}

/** Option for select dropdowns */
export interface SelectOption {
  value: string;
  label: string;
}
