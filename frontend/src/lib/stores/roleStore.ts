import { writable } from 'svelte/store';
import type { UserRole } from '../types';

/** Current user role: student | admin */
export const currentRole = writable<UserRole>('students');
