const HelloMessage = require("../models/HelloMessage");

/**
 * Simple controller demonstrating the "C" in MVC.
 */
exports.index = (req, res) => {
  const message = HelloMessage.getMessage();
  res.json({ message });
};

