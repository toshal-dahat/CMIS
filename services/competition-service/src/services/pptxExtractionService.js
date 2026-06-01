const https = require("node:https");
const { defaultProvider } = require("@aws-sdk/credential-provider-node");
const { SignatureV4 } = require("@smithy/signature-v4");
const { Hash } = require("@smithy/hash-node");
const { HttpRequest } = require("@smithy/protocol-http");

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const extractorFunctionName = (process.env.PPTX_EXTRACTOR_FUNCTION_NAME || "").trim();

const signer = new SignatureV4({
  credentials: defaultProvider(),
  region,
  service: "lambda",
  sha256: Hash.bind(null, "sha256"),
});

function sendSignedRequest(request) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: request.protocol,
        hostname: request.hostname,
        method: request.method,
        path: request.path,
        headers: request.headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 500,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    req.on("error", reject);
    req.write(request.body || "");
    req.end();
  });
}

async function extractPptx({ bucket, s3Key, competitionId, teamId }) {
  if (!extractorFunctionName) {
    const err = new Error("PPTX extractor Lambda is not configured.");
    err.statusCode = 500;
    throw err;
  }

  const payload = JSON.stringify({
    bucket,
    s3Key,
    competitionId,
    teamId,
  });

  const hostname = `lambda.${region}.amazonaws.com`;
  const path = `/2015-03-31/functions/${encodeURIComponent(extractorFunctionName)}/invocations`;

  const signedRequest = await signer.sign(
    new HttpRequest({
      protocol: "https:",
      hostname,
      method: "POST",
      path,
      headers: {
        "content-type": "application/json",
        host: hostname,
      },
      body: payload,
    })
  );

  const response = await sendSignedRequest(signedRequest);
  const functionError = response.headers["x-amz-function-error"];

  if (response.statusCode >= 300 || functionError) {
    const err = new Error(`PPTX extractor invocation failed with status ${response.statusCode}.`);
    err.statusCode = 502;
    err.details = response.body;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(response.body || "{}");
  } catch (parseErr) {
    const err = new Error("PPTX extractor returned invalid JSON.");
    err.statusCode = 502;
    err.details = parseErr.message;
    throw err;
  }

  if (!parsed.ok || !parsed.extraction) {
    const err = new Error(parsed.error || "PPTX extractor returned an empty payload.");
    err.statusCode = 422;
    throw err;
  }

  return parsed.extraction;
}

module.exports = {
  extractPptx,
};
