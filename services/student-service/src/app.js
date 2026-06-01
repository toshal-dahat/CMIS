const express = require("express");
const routes = require("./routes");

const app = express();

// Basic middleware (can expand later)
app.use(express.json());

// Register routes
app.use("/", routes);

module.exports = app;

