/**
 * Purpose: Compose the Student Service Express app.
 * Logic: Register shared middleware first, then mount all route handlers.
 * Edge cases: Middleware order matters; route mounting after middleware keeps request parsing consistent.
 */
const express = require("express");
const routes = require("./routes");

const app = express();

// Purpose: Parse JSON request bodies for all API endpoints.
// Logic: Express rejects malformed JSON before route handlers execute.
// Edge cases: Requests without JSON bodies still pass through unchanged.
app.use(express.json());

// Purpose: Mount router tree at service root.
// Logic: Individual handlers define full endpoint paths under this base.
// Edge cases: Unknown paths fall through to Express default 404 behavior.
app.use("/", routes);

module.exports = app;

