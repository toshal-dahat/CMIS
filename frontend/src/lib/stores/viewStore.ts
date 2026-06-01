import { writable } from 'svelte/store';
import type { ViewName } from '../types';

/** Current view: landing | profile-form | events | mentorship | case-competitions | students-connect */
export const currentView = writable<ViewName>('landing');
