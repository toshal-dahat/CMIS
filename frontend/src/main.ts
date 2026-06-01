import { mount } from 'svelte';
import './app.css';
// Load auth first so Amplify is configured and OAuth callback can complete on redirect
import './lib/auth';
import App from './App.svelte';

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
