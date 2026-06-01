import { writable } from 'svelte/store';
import type { Profile } from '../types';

function defaultProfile(): Profile {
  return {
    name: '',
    email: '',
    uin: '',
    staffId: '',
    university: '',
    degree: '',
    major: '',
    classYear: '',
    gradDate: '',
    linkedinUrl: '',
    resumeFileName: '',
    resumeS3Key: '',
    profileGpa: undefined,
    profileEducation: undefined,
    profileSkillKeys: undefined,
    reminderOptIn: false,
  };
}

export const profile = writable<Profile>(defaultProfile());

export function resetProfile(): void {
  profile.set(defaultProfile());
}
