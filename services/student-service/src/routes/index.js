const express = require("express");
const HomeController = require("../controllers/HomeController");

const router = express.Router();

// Health check endpoint
router.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "student-service",
    timestamp: new Date().toISOString(),
    version: "1.0.0"
  });
});

// Home route
router.get("/", HomeController.index);

// Helper: bridge Express req → Lambda-style event → Express res
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

