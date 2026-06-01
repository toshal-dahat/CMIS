const { handler } = require('./index');

const mockEvent = {
  Records: [{
    eventSource: 'aws:dynamodb',
    eventName: 'INSERT',
    dynamodb: {
      NewImage: {
        userEmail: { S: "abhishek.patil@tamu.edu" },
        eventId: { S: "test-event-123" }
      }
    }
  }]
};

console.log("Mocking DynamoDB Stream trigger...");
handler(mockEvent, {}).then((res) => {
    console.log("Test finished! Result:", res);
}).catch(console.error);
