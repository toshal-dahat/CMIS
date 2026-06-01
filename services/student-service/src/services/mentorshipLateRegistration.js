/**
 * Fire-and-forget async invoke of external-service Lambda to run single-mentee matching.
 * Disabled when MENTORSHIP_EXTERNAL_LAMBDA_NAME is unset.
 */

const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");

const lambda = new LambdaClient({});

function fireAndForgetMentorshipMatching(menteeUserId) {
  const name = (process.env.MENTORSHIP_EXTERNAL_LAMBDA_NAME || "").trim();
  const uid = (menteeUserId || "").trim();
  if (!name || !uid) {
    return Promise.resolve();
  }
  const payload = {
    source: "cmis.mentorship.late-registration",
    menteeUserId: uid,
  };
  return lambda
    .send(
      new InvokeCommand({
        FunctionName: name,
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify(payload), "utf8"),
      })
    )
    .catch((err) => {
      console.warn("[mentorship] late-registration invoke failed:", err?.message || err);
    });
}

module.exports = {
  fireAndForgetMentorshipMatching,
};
