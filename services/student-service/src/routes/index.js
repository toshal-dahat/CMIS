const express = require("express");
const HomeController = require("../controllers/HomeController");

const router = express.Router();

// Home route - Hello World
router.get("/", HomeController.index);

module.exports = router;

