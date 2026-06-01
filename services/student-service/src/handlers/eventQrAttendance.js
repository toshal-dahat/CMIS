const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { requireAuth, verifyToken } = require("../lib/jwt");
const jwt = require("jsonwebtoken");
const QRCode = require("qrcode");

const EVENTS_TABLE = process.env.EVENTS_TABLE || "Events-dev";
const RSVP_TABLE = process.env.RSVP_TABLE || "EventRsvps-dev";
/** Sentinel stored when attendee checks in without a prior RSVP row (UI shows as N/A). */
const RSVP_DETAIL_NA = "NA";
const QR_SIGNING_SECRET = process.env.QR_SIGNING_SECRET || "dev-qr-secret-change-me";

/**
 * Best-effort email from a Cognito ID token payload (self check-in only).
 * @param {Record<string, unknown> | undefined} claims
 * @returns {string} trimmed email or "" if none
 */
function emailFromCognitoClaims(claims) {
  if (!claims || typeof claims !== "object") return "";
  const email = claims.email;
  if (typeof email === "string" && email.trim()) return email.trim();
  const username = claims["cognito:username"];
  if (typeof username === "string" && username.includes("@") && username.trim()) {
    return username.trim();
  }
  if (typeof username === "string" && username.trim()) return username.trim();
  return "";
}
/** IANA zone used to compare “today” vs event calendar day (strict same day). */
const CHECKIN_TIMEZONE = process.env.CHECKIN_TIMEZONE || "America/Chicago";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

function jsonResponse(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function htmlResponse(statusCode, html) {
  return {
    statusCode,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
    body: html,
  };
}

function preflightResponse() {
  return {
    statusCode: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
    body: "",
  };
}

function isAdmin(claims) {
  const groups = claims?.["cognito:groups"] || [];
  return groups.some((g) =>
    ["admins", "admin", "Admin", "ADMIN", "SuperAdmin", "superadmin", "SUPERADMIN"].includes(g)
  );
}

function parseEventIdFromPath(path = "") {
  const match = path.match(/\/student\/api\/events\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getHeader(event, name) {
  const headers = event?.headers || {};
  return headers[name] || headers[name.toLowerCase()] || "";
}

function todayCalendarDateInCheckinTz(timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch (_) {
    return null;
  }
}

/**
 * Calendar YYYY-MM-DD for an event’s stored `date` field.
 * Datetime strings without Z/offset (e.g. datetime-local) use the date prefix; UTC/offset strings use the instant in timeZone.
 */
function eventCalendarDateForCheckin(storedDate, timeZone) {
  const s = String(storedDate ?? "").trim();
  if (!s) return null;
  const hasOffsetOrZ = /[zZ]$|[+-]\d{2}:\d{2}$|[+-]\d{4}$/.test(s);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const localLikeDatetime = /^\d{4}-\d{2}-\d{2}T/.test(s) && !hasOffsetOrZ;
  if (dateOnly || localLikeDatetime) {
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  }
}

function assertCheckinAllowedCalendarDay(eventItem) {
  const eventCal = eventCalendarDateForCheckin(eventItem.date, CHECKIN_TIMEZONE);
  const todayCal = todayCalendarDateInCheckinTz(CHECKIN_TIMEZONE);
  if (!eventCal || !todayCal) {
    return {
      ok: false,
      response: jsonResponse(500, {
        error: "INTERNAL_ERROR",
        message: "Unable to resolve calendar dates for check-in.",
      }),
    };
  }
  if (todayCal !== eventCal) {
    return {
      ok: false,
      response: jsonResponse(403, {
        status: "WRONG_CHECKIN_DAY",
        message: `Check-in is only available on the event day (${eventCal}, ${CHECKIN_TIMEZONE}). Today is ${todayCal}.`,
        eventCalendarDate: eventCal,
        todayCalendarDate: todayCal,
      }),
    };
  }
  return { ok: true, eventCal, todayCal };
}

/**
 * @returns {{ type: "empty" } | { type: "jwt", token: string } | { type: "eventIdFromUrl", eventId: string } | { type: "raw", raw: string }}
 */
function classifyScanInputForEvent(payload) {
  const rawInput = String(payload?.scannedText || payload?.scanValue || payload?.eventCode || "").trim();
  if (!rawInput) return { type: "empty" };
  if (/^https?:\/\//i.test(rawInput)) {
    try {
      const u = new URL(rawInput);
      const urlToken = String(u.searchParams.get("checkinToken") || "").trim();
      const urlEventId = String(u.searchParams.get("eventId") || "").trim();
      if (urlToken) return { type: "jwt", token: urlToken };
      if (urlEventId) return { type: "eventIdFromUrl", eventId: urlEventId };
    } catch (_) {
      // ignore
    }
  }
  return { type: "raw", raw: rawInput };
}

function decodeEventCheckinToken(jwtPart) {
  const raw = String(jwtPart || "").trim();
  if (!raw || raw.split(".").length !== 3) return null;
  try {
    const decoded = jwt.verify(raw, QR_SIGNING_SECRET, {
      algorithms: ["HS256"],
    });
    const tokenType = String(decoded?.typ || "").toLowerCase();
    const eventId = String(decoded?.eventId || "").trim();
    if (!((tokenType === "event-checkin" || !tokenType) && eventId)) return null;
    const evtDate =
      decoded.evtDate != null && String(decoded.evtDate).trim()
        ? String(decoded.evtDate).trim()
        : null;
    return { eventId, evtDate };
  } catch (_) {
    return null;
  }
}

function decodeEventCheckinTokenFromPayload(payload) {
  const c = classifyScanInputForEvent(payload);
  if (c.type === "jwt") return decodeEventCheckinToken(c.token);
  if (c.type === "raw") return decodeEventCheckinToken(c.raw);
  return null;
}

function deriveFrontendOrigin(event) {
  const explicitOrigin = String(getHeader(event, "origin") || "").trim();
  if (explicitOrigin) return explicitOrigin.replace(/\/+$/, "");

  const referer = String(getHeader(event, "referer") || "").trim();
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch (_) {
      // ignore invalid referer
    }
  }
  return "";
}

async function extractUserIdFromScan(payload) {
  const explicit = (payload?.userId || "").trim();
  if (explicit) return explicit;

  const raw = String(payload?.scannedText || payload?.scanValue || "").trim();
  if (!raw) return "";

  try {
    const asJson = JSON.parse(raw);
    if (typeof asJson?.userId === "string" && asJson.userId.trim()) {
      return asJson.userId.trim();
    }
  } catch (_) {
    // not JSON; continue
  }

  // If a JWT-like string is scanned, verify token before extracting identity.
  if (raw.split(".").length === 3) {
    // 1) try custom signed QR user token first
    try {
      const decoded = jwt.verify(raw, QR_SIGNING_SECRET, {
        algorithms: ["HS256"],
      });
      const tokenType = String(decoded?.typ || "").toLowerCase();
      if (tokenType && tokenType !== "user-checkin") {
        return "";
      }
      const uid = String(decoded?.userId || decoded?.sub || "").trim();
      if (uid) return uid;
    } catch (_) {
      // ignore, try Cognito token path
    }

    // 2) allow Cognito ID token scans (verified against user pool)
    try {
      const decoded = await verifyToken(raw);
      const uid = String(decoded?.sub || "").trim();
      if (uid) return uid;
    } catch (_) {
      // ignore verification failure; fall through
    }
  }

  return raw;
}

async function extractEventIdFromScan(payload) {
  const c = classifyScanInputForEvent(payload);
  if (c.type === "empty") return "";
  if (c.type === "eventIdFromUrl") return c.eventId;
  const jwtStr = c.type === "jwt" ? c.token : c.raw;
  const claims = decodeEventCheckinToken(jwtStr);
  if (claims?.eventId) return claims.eventId;
  return jwtStr;
}

async function verifyEventExists(eventId) {
  const eventRes = await docClient.send(
    new GetCommand({
      TableName: EVENTS_TABLE,
      Key: { eventId },
    })
  );
  return eventRes.Item || null;
}

/**
 * Records check-in for an event attendee. Works with or without an existing RSVP row:
 * existing RSVP fields are preserved; walk-ins get placeholder RSVP detail fields.
 * @param {string} [walkInUserEmail] — for new rows with no `userEmail`, set this instead of the NA sentinel (e.g. self check-in from JWT).
 * @returns {Promise<{ kind: "success"; checkedInAt: string; rsvpAt?: string; rsvpStatus?: string } | { kind: "already"; checkedInAt: string | null } | { kind: "error"; statusCode: number; message: string }>}
 */
async function recordEventCheckIn({ eventId, attendeeUserId, checkedInByUserId, checkInSource, walkInUserEmail }) {
  const existing = await docClient.send(
    new GetCommand({
      TableName: RSVP_TABLE,
      Key: { eventId, userId: attendeeUserId },
    })
  );

  if (existing.Item?.checkedInAt || existing.Item?.checkedIn === true) {
    return {
      kind: "already",
      checkedInAt: existing.Item.checkedInAt || null,
      rsvpAt: existing.Item.rsvpAt,
      rsvpStatus: existing.Item.status,
    };
  }

  const userEmailDefault =
    typeof walkInUserEmail === "string" && walkInUserEmail.trim()
      ? walkInUserEmail.trim()
      : RSVP_DETAIL_NA;

  const checkedInAt = new Date().toISOString();
  try {
    await docClient.send(
      new UpdateCommand({
        TableName: RSVP_TABLE,
        Key: { eventId, userId: attendeeUserId },
        UpdateExpression:
          "SET checkedIn = :trueVal, checkedInAt = :checkedInAt, checkedInBy = :checkedInBy, checkInSource = :source, attendanceStatus = :attendanceStatus, userEmail = if_not_exists(userEmail, :userEmailDefault), rsvpAt = if_not_exists(rsvpAt, :naDetail), #status = if_not_exists(#status, :walkInStatus)",
        ConditionExpression: "attribute_not_exists(checkedInAt)",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":trueVal": true,
          ":checkedInAt": checkedInAt,
          ":checkedInBy": checkedInByUserId,
          ":source": checkInSource,
          ":attendanceStatus": "CHECKED_IN",
          ":userEmailDefault": userEmailDefault,
          ":naDetail": RSVP_DETAIL_NA,
          ":walkInStatus": "WALK_IN",
        },
      })
    );
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") {
      const latest = await docClient.send(
        new GetCommand({
          TableName: RSVP_TABLE,
          Key: { eventId, userId: attendeeUserId },
        })
      );
      if (latest.Item?.checkedInAt || latest.Item?.checkedIn === true) {
        return {
          kind: "already",
          checkedInAt: latest.Item.checkedInAt || null,
          rsvpAt: latest.Item.rsvpAt,
          rsvpStatus: latest.Item.status,
        };
      }
      return {
        kind: "error",
        statusCode: 409,
        message: "Check-in could not be completed. Please try again.",
      };
    }
    throw err;
  }

  const after = await docClient.send(
    new GetCommand({
      TableName: RSVP_TABLE,
      Key: { eventId, userId: attendeeUserId },
    })
  );
  const item = after.Item || {};
  return {
    kind: "success",
    checkedInAt,
    rsvpAt: item.rsvpAt,
    rsvpStatus: item.status,
  };
}

async function generateEventQr(event) {
  try {
    if (event.httpMethod === "OPTIONS") return preflightResponse();
    const { claims } = await requireAuth(event);
    if (!isAdmin(claims)) {
      return jsonResponse(403, { error: "FORBIDDEN", message: "Admin access required." });
    }

    const eventId = event.pathParameters?.eventId || parseEventIdFromPath(event.path);
    if (!eventId) {
      return jsonResponse(400, { error: "BAD_REQUEST", message: "eventId is required." });
    }

    const eventItem = await verifyEventExists(eventId);
    if (!eventItem) {
      return jsonResponse(404, { error: "NOT_FOUND", message: "Event not found." });
    }

    const eventCal = eventCalendarDateForCheckin(eventItem.date, CHECKIN_TIMEZONE);
    if (!eventCal) {
      return jsonResponse(400, {
        error: "BAD_REQUEST",
        message: "Event has no valid date; cannot generate QR.",
      });
    }

    // Stable per-event token: deterministic payload + no iat/exp/jti (evtDate = strict check-in calendar day).
    const tokenPayload = {
      typ: "event-checkin",
      eventId,
      evtDate: eventCal,
    };

    const signedToken = jwt.sign(tokenPayload, QR_SIGNING_SECRET, {
      algorithm: "HS256",
      noTimestamp: true,
    });
    const frontendOrigin = deriveFrontendOrigin(event);
    const checkInUrl = frontendOrigin
      ? `${frontendOrigin}/?checkinToken=${encodeURIComponent(signedToken)}&eventId=${encodeURIComponent(eventId)}`
      : "";
    const qrScanPayload = checkInUrl || signedToken;

    const qrCodeDataUrl = await QRCode.toDataURL(qrScanPayload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
    });

    return jsonResponse(200, {
      eventId,
      eventTitle: eventItem.title || "",
      signedEventCode: signedToken,
      checkInUrl: checkInUrl || null,
      qrCodeDataUrl,
      stablePerEvent: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return jsonResponse(statusCode, {
      error: err.code || "INTERNAL_ERROR",
      message: err.message || "Internal server error",
    });
  }
}

async function checkInAttendance(event) {
  if ((event?.path || "").includes("/student/api/events/check-in/self")) {
    return selfCheckInAttendance(event);
  }
  try {
    if (event.httpMethod === "OPTIONS") return preflightResponse();
    const { userId: scannerUserId, claims } = await requireAuth(event);
    if (!isAdmin(claims)) {
      return jsonResponse(403, { error: "FORBIDDEN", message: "Admin access required." });
    }

    const eventId = event.pathParameters?.eventId || parseEventIdFromPath(event.path);
    if (!eventId) {
      return jsonResponse(400, { error: "BAD_REQUEST", message: "eventId is required." });
    }

    const body = JSON.parse(event.body || "{}");
    const scannedUserId = await extractUserIdFromScan(body);
    if (!scannedUserId) {
      return jsonResponse(400, { error: "BAD_REQUEST", message: "userId/scannedText is required." });
    }

    const eventItem = await verifyEventExists(eventId);
    if (!eventItem) {
      return jsonResponse(404, { error: "NOT_FOUND", message: "Event not found." });
    }

    const dayGate = assertCheckinAllowedCalendarDay(eventItem);
    if (!dayGate.ok) return dayGate.response;

    const checkInResult = await recordEventCheckIn({
      eventId,
      attendeeUserId: scannedUserId,
      checkedInByUserId: scannerUserId,
      checkInSource: "MOBILE_WEB_SCANNER",
    });

    if (checkInResult.kind === "error") {
      return jsonResponse(checkInResult.statusCode, {
        status: "CHECKIN_FAILED",
        eventId,
        userId: scannedUserId,
        message: checkInResult.message,
      });
    }

    if (checkInResult.kind === "already") {
      return jsonResponse(200, {
        status: "ALREADY_CHECKED_IN",
        eventId,
        userId: scannedUserId,
        checkedInAt: checkInResult.checkedInAt,
        rsvpAt: checkInResult.rsvpAt,
        rsvpStatus: checkInResult.rsvpStatus,
        message: "User already checked in.",
      });
    }

    return jsonResponse(200, {
      status: "CHECKED_IN",
      eventId,
      userId: scannedUserId,
      checkedInAt: checkInResult.checkedInAt,
      rsvpAt: checkInResult.rsvpAt,
      rsvpStatus: checkInResult.rsvpStatus,
      message: "Check-in successful.",
    });
  } catch (err) {
    if (err instanceof SyntaxError && err.message.includes("JSON")) {
      return jsonResponse(400, { error: "BAD_REQUEST", message: "Invalid JSON body." });
    }
    const statusCode = err.statusCode || 500;
    return jsonResponse(statusCode, {
      error: err.code || "INTERNAL_ERROR",
      message: err.message || "Internal server error",
    });
  }
}

async function selfCheckInAttendance(event) {
  try {
    if (event.httpMethod === "OPTIONS") return preflightResponse();
    const { userId, claims } = await requireAuth(event);
    const attendeeEmail = emailFromCognitoClaims(claims);
    const body = JSON.parse(event.body || "{}");
    const eventId = await extractEventIdFromScan(body);
    const expectedEventId = String(body?.expectedEventId || "").trim();
    if (!eventId) {
      return jsonResponse(400, {
        error: "BAD_REQUEST",
        message: "A valid event QR code is required.",
      });
    }
    if (expectedEventId && expectedEventId !== eventId) {
      return jsonResponse(409, {
        status: "EVENT_MISMATCH",
        expectedEventId,
        scannedEventId: eventId,
        message: "Scanned QR belongs to a different event.",
      });
    }

    const eventItem = await verifyEventExists(eventId);
    if (!eventItem) {
      return jsonResponse(404, { error: "NOT_FOUND", message: "Event not found." });
    }

    const dayGate = assertCheckinAllowedCalendarDay(eventItem);
    if (!dayGate.ok) return dayGate.response;

    const tokenClaims = decodeEventCheckinTokenFromPayload(body);
    if (tokenClaims?.evtDate) {
      const eventCal = eventCalendarDateForCheckin(eventItem.date, CHECKIN_TIMEZONE);
      if (eventCal && tokenClaims.evtDate !== eventCal) {
        return jsonResponse(409, {
          status: "QR_DATE_MISMATCH",
          message:
            "This QR code does not match the current event schedule. Ask an admin to regenerate the event QR.",
          tokenDate: tokenClaims.evtDate,
          eventCalendarDate: eventCal,
        });
      }
    }

    const checkInResult = await recordEventCheckIn({
      eventId,
      attendeeUserId: userId,
      checkedInByUserId: userId,
      checkInSource: "SELF_QR_SCAN",
      walkInUserEmail: attendeeEmail,
    });

    if (checkInResult.kind === "error") {
      return jsonResponse(checkInResult.statusCode, {
        status: "CHECKIN_FAILED",
        eventId,
        userId,
        message: checkInResult.message,
      });
    }

    if (checkInResult.kind === "already") {
      return jsonResponse(200, {
        status: "ALREADY_CHECKED_IN",
        eventId,
        userId,
        checkedInAt: checkInResult.checkedInAt,
        rsvpAt: checkInResult.rsvpAt,
        rsvpStatus: checkInResult.rsvpStatus,
        message: "You are already checked in.",
      });
    }

    return jsonResponse(200, {
      status: "CHECKED_IN",
      eventId,
      userId,
      checkedInAt: checkInResult.checkedInAt,
      rsvpAt: checkInResult.rsvpAt,
      rsvpStatus: checkInResult.rsvpStatus,
      message: "Check-in successful.",
    });
  } catch (err) {
    if (err instanceof SyntaxError && err.message.includes("JSON")) {
      return jsonResponse(400, { error: "BAD_REQUEST", message: "Invalid JSON body." });
    }
    const statusCode = err.statusCode || 500;
    return jsonResponse(statusCode, {
      error: err.code || "INTERNAL_ERROR",
      message: err.message || "Internal server error",
    });
  }
}

async function scannerPage(event) {
  try {
    if (event.httpMethod === "OPTIONS") return preflightResponse();
    const tokenFromQuery = String(event?.queryStringParameters?.token || "").trim();
    const authHeader = event.headers?.Authorization ?? event.headers?.authorization;
    const effectiveEvent =
      !authHeader && tokenFromQuery
        ? {
            ...event,
            headers: {
              ...(event.headers || {}),
              Authorization: `Bearer ${tokenFromQuery}`,
            },
          }
        : event;
    // Keep scanner page protected so only authenticated users can access it.
    await requireAuth(effectiveEvent);

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Event QR Scanner</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: Arial, sans-serif; background: #f6f7fb; color: #111; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 1rem; }
    .card { background: #fff; border-radius: 12px; padding: 1rem; box-shadow: 0 4px 14px rgba(0,0,0,0.08); }
    h1 { margin: 0 0 0.5rem; font-size: 1.25rem; }
    .row { display: grid; gap: 0.5rem; margin-bottom: 0.8rem; }
    label { font-size: 0.9rem; color: #333; font-weight: 600; }
    input, button { font-size: 1rem; padding: 0.65rem 0.75rem; border-radius: 8px; border: 1px solid #ccc; }
    button { border: none; background: #5d1f1f; color: #fff; font-weight: 600; }
    button:disabled { opacity: 0.6; }
    #reader { width: 100%; border-radius: 8px; overflow: hidden; }
    .status { margin-top: 0.75rem; padding: 0.75rem; border-radius: 8px; font-weight: 600; }
    .ok { background: #e8f7ee; color: #0f6b34; }
    .bad { background: #fdecea; color: #8a1c1c; }
    .small { font-size: 0.82rem; color: #666; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>Mobile Attendance Scanner</h1>
      <p class="small">Enter Event ID, then scan attendee QR/User ID codes.</p>
      <div class="row">
        <label for="eventId">Event ID</label>
        <input id="eventId" placeholder="Paste Event ID" />
      </div>
      <div class="row">
        <label for="apiBase">Student API Base URL</label>
        <input id="apiBase" placeholder="https://<api>.execute-api.<region>.amazonaws.com" />
      </div>
      <div class="row">
        <button id="startBtn">Start Scanner</button>
      </div>
      <div id="reader"></div>
      <div id="result"></div>
    </div>
  </div>

  <script src="https://unpkg.com/html5-qrcode"></script>
  <script>
    const params = new URLSearchParams(window.location.search);
    const resultEl = document.getElementById("result");
    const eventIdEl = document.getElementById("eventId");
    const apiBaseEl = document.getElementById("apiBase");
    const startBtn = document.getElementById("startBtn");
    const mode = (params.get("mode") || "admin").toLowerCase();
    const expectedEventId = params.get("eventId") || "";
    const tokenFromUrl = params.get("token") || "";
    const apiBaseFromUrl = params.get("apiBase") || "";
    if (apiBaseFromUrl) {
      apiBaseEl.value = apiBaseFromUrl.replace(/\\/$/, "");
    }
    if (mode === "self") {
      eventIdEl.closest(".row").style.display = "none";
      apiBaseEl.closest(".row").style.display = "none";
      startBtn.textContent = "Start Check-in Scanner";
    }

    function renderStatus(message, ok) {
      resultEl.className = "status " + (ok ? "ok" : "bad");
      resultEl.textContent = message;
    }

    async function sendCheckIn(scannedText) {
      const apiBase = apiBaseEl.value.trim().replace(/\\/$/, "");
      if (!apiBase) {
        renderStatus("API Base URL is required.", false);
        return;
      }
      const token =
        tokenFromUrl ||
        localStorage.getItem("idToken") ||
        localStorage.getItem("accessToken");
      if (!token) {
        renderStatus("Missing auth token. Open scanner from the Events page after signing in.", false);
        return;
      }

      const endpoint = mode === "self"
        ? apiBase + "/student/api/events/check-in/self"
        : apiBase + "/student/api/events/" + encodeURIComponent(eventIdEl.value.trim()) + "/check-in";
      if (mode !== "self" && !eventIdEl.value.trim()) {
        renderStatus("Event ID is required.", false);
        return;
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify(
          mode === "self"
            ? { scannedText, expectedEventId }
            : { scannedText }
        )
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        renderStatus((body && body.message) || "Check-in failed.", false);
        return;
      }

      const msg = body.status + ": " + ((body && body.message) || "Processed");
      renderStatus(msg, body.status === "CHECKED_IN" || body.status === "ALREADY_CHECKED_IN");
    }

    startBtn.addEventListener("click", async () => {
      startBtn.disabled = true;
      const qr = new Html5Qrcode("reader");
      try {
        await qr.start(
          { facingMode: "environment" },
          { fps: 8, qrbox: { width: 250, height: 250 } },
          async (decodedText) => {
            await qr.pause(true);
            try {
              await sendCheckIn(decodedText);
            } finally {
              setTimeout(() => qr.resume(), 800);
            }
          }
        );
      } catch (e) {
        renderStatus("Unable to start camera: " + (e && e.message ? e.message : e), false);
      } finally {
        startBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
    return htmlResponse(200, html);
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return jsonResponse(statusCode, {
      error: err.code || "INTERNAL_ERROR",
      message: err.message || "Unable to load scanner page.",
    });
  }
}

module.exports = {
  generateEventQr,
  checkInAttendance,
  selfCheckInAttendance,
  scannerPage,
};
