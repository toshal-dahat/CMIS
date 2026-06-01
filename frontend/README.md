## Team Reveille – Student Profile Frontend

This project is a **Svelte + Vite** frontend for the TAMU CMIS / Team Reveille Student Core.  
The current focus is the **Student Profile form**, which captures basic student identity information that will later be persisted via backend services.

### Tech Stack

- **Framework**: Svelte (created with `npm create vite@latest` – Svelte template)
- **Bundler/Dev server**: Vite
- **Language**: JavaScript

### High-level Architecture

- `main.js` – Vite entry point. Mounts the root Svelte component into `index.html`:
  - Imports `App.svelte`
  - Calls `mount(App, { target: document.getElementById('app') })`
- `App.svelte` – Root component for the app:
  - Imports and renders the `ProfileForm` component.
- `lib/ProfileForm.svelte` – Core UI for the **Student Profile**:
  - Svelte component holding form state in local `let` variables.
  - Styled with a **TAMU maroon** theme and responsive card layout.

### ProfileForm Component Details

`src/lib/ProfileForm.svelte` contains:

- **Fields**
  - `Name` – text, required
  - `Major` – text, required
  - `Class Year` – text, required (e.g., `'26`)
  - `Grad Date` – month input, required
  - `LinkedIn URL` – URL input, required
- **State & behavior**
  - Each input is bound to a local variable via `bind:value={...}`.
  - `on:submit={handleSubmit}` prevents default submit and marks the form as “submitted” on the client.
  - A simple success message confirms that the data has been captured **on the frontend only** (no backend calls yet).
- **Styling**
  - The form is presented in a centered card with:
    - Top border and primary accents in **TAMU maroon** (`#500000`).
    - Soft background, shadows, and focus outlines.
    - Mobile-friendly spacing and typography.

This component is intentionally **frontend-only** for now; integration with Cognito, S3 presigned URLs, and DynamoDB references will happen in the backend or separate services.

### How It Works End-to-End (Current Frontend Only)

1. **Vite dev server** serves `index.html`.
2. `index.html` loads `src/main.js`.
3. `main.js` mounts `<App />` into the `#app` div.
4. `App.svelte` renders `<ProfileForm />` as the main page content.
5. `ProfileForm.svelte`:
   - Renders TAMU-themed fields for the student profile.
   - Maintains field values in Svelte component state.
   - On submit, prevents page reload and shows a success banner to indicate the data was captured in-memory.

No data is persisted yet; this is strictly the UI building block for the broader Student Identity and Profile system.

### Running the App Locally

Prerequisites:

- Node.js (LTS recommended)
- npm

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Open the URL from the terminal (typically `http://localhost:5173/`) to view the Student Profile form.

### Building for Production

```bash
npm run build
```

This outputs a production build in the `dist` folder, which can be served by any static file host.
