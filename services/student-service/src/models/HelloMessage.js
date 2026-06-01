/**
 * Very minimal "model" that could later be replaced
 * with database access, business logic, etc.
 */
class HelloMessage {
  static getMessage() {
    return "Hello World from Node MVC!";
  }
}

module.exports = HelloMessage;

