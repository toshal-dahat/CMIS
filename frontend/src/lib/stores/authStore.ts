import { writable } from 'svelte/store';
import type { AuthUser } from 'aws-amplify/auth';

export const authUser = writable<AuthUser | null>(null);
