/**
 * Purpose: Local development bootstrap for running Student Service without Lambda.
 * Logic: Start the Express app on a configurable port for manual/API testing.
 * Edge cases: PORT conflicts fail process startup; default port 3000 is used when unset.
 */
const app = require("./app");

const PORT = process.env.PORT || 3000;

// Purpose: Start HTTP listener for local dev/testing workflows.
// Logic: Bind app to configured port and emit startup URL for quick verification.
// Edge cases: Runtime exceptions in handlers still surface per-request after startup.
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

