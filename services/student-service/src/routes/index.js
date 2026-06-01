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

// Home route - Hello World
router.get("/", HomeController.index);

module.exports = router;

