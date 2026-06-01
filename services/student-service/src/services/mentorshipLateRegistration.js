/**
 * Fire-and-forget async invoke of external-service Lambda to run single-mentee matching.
 * Disabled when EXTERNAL_SERVICE_LAMBDA_NAME is unset.
 */

const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");

const lambda = new LambdaClient({});

function fireAndForgetMentorshipMatching(menteeUserId) {
  const name = (process.env.EXTERNAL_SERVICE_LAMBDA_NAME || "").trim();
  const uid = (menteeUserId || "").trim();
  if (!name || !uid) {
    return Promise.resolve();
  }
  const payload = {
    source: "late-registration",
    menteeUserId: uid,
    batchType: "late-registration",
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

function fireAndForgetMentorshipEmbeddingPrecompute(userId) {
  const name = (process.env.EXTERNAL_SERVICE_LAMBDA_NAME || "").trim();
  const uid = (userId || "").trim();
  if (!name || !uid) {
    return Promise.resolve();
  }
  const payload = {
    source: "cmis.mentorship.profile-saved",
    userId: uid,
    batchType: "profile-saved-embeddings",
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
      console.warn("[mentorship] profile embedding precompute invoke failed:", err?.message || err);
    });
}

module.exports = {
  fireAndForgetMentorshipMatching,
  fireAndForgetMentorshipEmbeddingPrecompute,
};
