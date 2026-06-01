const express = require("express");
const HomeController = require("../controllers/HomeController");

// Purpose: Central route registry for local Express runtime.
// Logic: Keep lightweight health/home routes here; Lambda-style API handlers are bridged separately.
// Edge cases: Additional routes should preserve this file as orchestration-only (not business logic).
const router = express.Router();

// Purpose: Liveness probe used by local checks and quick smoke tests.
// Logic: Returns static service metadata and current timestamp.
// Edge cases: No downstream dependencies, so it should remain stable during partial outages.
router.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "student-service",
    timestamp: new Date().toISOString(),
    version: "1.0.0"
  });
});

// Purpose: Root route for simple service landing response.
// Logic: Delegate output to controller for separation of concerns.
// Edge cases: Controller errors are handled by Express error middleware chain.
router.get("/", HomeController.index);

// Purpose: Adapt Express request objects to Lambda-style handler signatures.
// Logic: Serialize request into API Gateway-like event shape and replay Lambda response into Express.
// Edge cases: Binary payloads are not handled here; this bridge is intended for JSON/text flows.
function bridge(handler) {
  return (req, res, next) =>
    handler({
      httpMethod: req.method,
      path: req.path,
      headers: req.headers,
      queryStringParameters: req.query ?? {},
      body: req.body ? JSON.stringify(req.body) : null,
    })
      .then((r) => res.status(r.statusCode).set(r.headers).send(r.body))
      .catch(next);
}

module.exports = router;

