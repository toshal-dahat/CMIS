'use strict';

/**
 * Waitlist and RSVP Logic Integration Tests
 * 
 * This script performs a zero-dependency integration test for the RSVP service.
 * It mocks the AWS SDK and external fetch calls using Module._load interception
 * to simulate DynamoDB and Admin API responses.
 *
 * Scenarios Tested:
 * 1. Normal RSVP (Capacity Available): Confirms seat is granted.
 * 2. Waitlist (Event Full): Confirms user is queued with correct position.
 * 3. Cancel & Promotion: Confirms that cancelling a confirmed RSVP automatically
 *    promotes the next person in line without changing net RSVP count.
 * 4. Empty Waitlist Cancel: Confirms capacity is freed when no one is waiting.
 * 5. Duplicate Prevention: Prevents multiple RSVPs from the same user.
 * 6. Velvet Rope (Early Access): Verifies domain-based time gating for partners.
 *
 * Scenarios covered:
 *   1. Normal RSVP (capacity available)         — happy path, returns CONFIRMED
 *   2. Waitlist (event full)                    — auto-waitlists and returns position + queue size
 *   3. Cancel + auto-promote (3 assertions)     — promotes next-in-line, verifies net-zero seat count,
 *                                                  and verifies decrement when waitlist is empty
 *   4. Duplicate prevention (2 assertions)      — 409 when already confirmed; 409 when full and
 *                                                  already has any entry (confirmed or waitlisted)
 *   5. Velvet Rope partner gating (2 assertions) — 403 before early-access window; allowed after
 *
 * Usage:
 *   node test-waitlist.js
 *
 * Note: Scenario 2 prints a "Velvet Rope: failed to fetch partner rank" warning to stderr.
 * This is expected — the student email (@tamu.edu) triggers an attempted tier lookup that
 * has no fetch mock set; rsvpService catches the error and falls back to default rank 99
 * (no VIP priority). The test still passes.
 *
 * Expected output (warnings aside):
 *   Scenario 1 — Normal RSVP (capacity available)
 *     ✓  returns status CONFIRMED when a seat is available
 *
 *   Scenario 2 — Waitlist (event full)
 *     ✓  adds user to waitlist and returns position 1
 *
 *   Scenario 3 — Cancel + auto-promote
 *     ✓  promotes next waitlisted user when a confirmed RSVP is cancelled
 *     ✓  does NOT change currentRsvps during cancel+promote (net zero)
 *     ✓  decrements currentRsvps when cancelled with an empty waitlist
 *
 *   Scenario 4 — Duplicate prevention
 *     ✓  returns 409 when user already has a confirmed RSVP
 *     ✓  returns 409 when event is full AND user already has an entry
 *
 *   Scenario 5 — Velvet Rope still applies to partners
 *     ✓  rejects partner RSVP before early access window opens (403)
 *     ✓  allows partner RSVP once inside the early access window
 *
 *   ────────────────────────────────────────
 *   9 passed, 0 failed
 */

// ─── 1. AWS SDK MOCK (must happen before requiring rsvpService) ───────────────

let _sendImpl = null;
const setSend = (fn) => { _sendImpl = fn; };

const Module = require('module');
const _originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (request === '@aws-sdk/client-dynamodb') {
    return {
      DynamoDBClient: class DynamoDBClient { constructor() {} },
    };
  }
  if (request === '@aws-sdk/lib-dynamodb') {
    return {
      DynamoDBDocumentClient: {
        from: () => ({
          send: (cmd) => {
            if (!_sendImpl) throw new Error(`Unexpected DynamoDB call (no mock set): ${cmd.constructor.name}`);
            return _sendImpl(cmd);
          },
        }),
      },
      // Named classes so cmd.constructor.name is readable in mocks
      TransactWriteCommand: class TransactWriteCommand { constructor(i) { this.input = i; } },
      QueryCommand:         class QueryCommand         { constructor(i) { this.input = i; } },
      GetCommand:           class GetCommand           { constructor(i) { this.input = i; } },
      PutCommand:           class PutCommand           { constructor(i) { this.input = i; } },
      DeleteCommand:        class DeleteCommand        { constructor(i) { this.input = i; } },
    };
  }
  return _originalLoad.apply(this, arguments);
};

// ─── 2. ENV VARS (read as constants at module load, must be set first) ────────

process.env.DOMAIN_API_URL = 'https://mock-admin-api/domain';
process.env.CONFIG_API_URL = 'https://mock-admin-api/config';

// ─── 3. FETCH MOCK ────────────────────────────────────────────────────────────

let _fetchImpl = null;
global.fetch = (url) => {
  if (!_fetchImpl) throw new Error(`Unexpected fetch call (no mock set): ${url}`);
  return _fetchImpl(url);
};

// ─── 4. LOAD SERVICE UNDER TEST ───────────────────────────────────────────────

const rsvpService = require('./src/services/rsvpService');

// ─── 5. TEST HELPERS ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  // Reset mocks before each test so uncovered calls throw clearly
  _sendImpl = null;
  _fetchImpl = null;
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

// Fake a DynamoDB TransactionCanceledException with per-item reason codes.
// Each entry maps to one TransactItem in order: reasons[0] = Events table, reasons[1] = RSVP table.
function txCancelled(...codes) {
  const err = new Error('Transaction cancelled');
  err.name = 'TransactionCanceledException';
  err.CancellationReasons = codes.map((code) => ({ Code: code }));
  return err;
}

// ─── FIXTURE FACTORIES ────────────────────────────────────────────────────────

const EVENT_ID        = 'event-abc';
const USER_CONFIRMED  = 'user-confirmed';
const USER_WAITLISTED = 'user-waitlisted';
const USER_NEW        = 'user-new';

function makeEvent(overrides = {}) {
  return {
    eventId: EVENT_ID,
    title: 'Test Event',
    date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days out
    capacity: 2,
    currentRsvps: 0,
    createdBy: 'admin-1',
    version: 1,
    ...overrides,
  };
}

function makeConfirmedRsvp(overrides = {}) {
  return {
    eventId: EVENT_ID,
    userId: USER_CONFIRMED,
    userEmail: 'confirmed@tamu.edu',
    status: 'CONFIRMED',
    rsvpAt: new Date(Date.now() - 120_000).toISOString(),
    ...overrides,
  };
}

function makeWaitlistEntry(overrides = {}) {
  return {
    eventId: EVENT_ID,
    userId: USER_WAITLISTED,
    userEmail: 'waitlisted@tamu.edu',
    status: 'WAITLISTED',
    waitlistedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

const STUDENT_GROUPS  = ['students'];
const INVESTOR_GROUPS = ['investors'];

// ─── SCENARIOS ────────────────────────────────────────────────────────────────

(async () => {

  // ── Scenario 1: Normal RSVP ─────────────────────────────────────────────────
  console.log('\nScenario 1 — Normal RSVP (capacity available)');

  await test('returns status CONFIRMED when a seat is available', async () => {
    const event = makeEvent({ capacity: 2, currentRsvps: 0 });

    setSend(async (cmd) => {
      if (cmd.constructor.name === 'GetCommand')           return { Item: event };
      if (cmd.constructor.name === 'TransactWriteCommand') return {};
      throw new Error(`Unexpected command: ${cmd.constructor.name}`);
    });

    const result = await rsvpService.rsvpToEvent(EVENT_ID, USER_NEW, 'new@tamu.edu', STUDENT_GROUPS);

    assert(result.status === 'CONFIRMED', `expected CONFIRMED, got "${result.status}"`);
    assert(result.eventId === EVENT_ID,   `expected eventId ${EVENT_ID}, got "${result.eventId}"`);
    assert(result.userId  === USER_NEW,   `expected userId ${USER_NEW}, got "${result.userId}"`);
  });


  // ── Scenario 2: Waitlist ─────────────────────────────────────────────────────
  console.log('\nScenario 2 — Waitlist (event full)');

  await test('adds user to waitlist and returns position 1', async () => {
    const event        = makeEvent({ capacity: 2, currentRsvps: 2 });
    const waitlistEntry = makeWaitlistEntry({ userId: USER_NEW }); // the freshly-added entry

    setSend(async (cmd) => {
      if (cmd.constructor.name === 'GetCommand') {
        return { Item: event };
      }
      if (cmd.constructor.name === 'TransactWriteCommand') {
        // reasons[0] = capacity full; reasons[1] = None (no duplicate RSVP)
        throw txCancelled('ConditionalCheckFailed', 'None');
      }
      if (cmd.constructor.name === 'PutCommand') {
        return {}; // waitlist insert succeeds
      }
      if (cmd.constructor.name === 'QueryCommand') {
        // getWaitlistPosition — return the one entry just added
        return { Items: [waitlistEntry] };
      }
      throw new Error(`Unexpected command: ${cmd.constructor.name}`);
    });

    const result = await rsvpService.rsvpToEvent(EVENT_ID, USER_NEW, 'new@tamu.edu', STUDENT_GROUPS);

    assert(result.status   === 'WAITLISTED', `expected WAITLISTED, got "${result.status}"`);
    assert(result.position === 1,            `expected position 1, got ${result.position}`);
    assert(result.queueSize === 1,           `expected queueSize 1, got ${result.queueSize}`);
    assert(result.message.toLowerCase().includes('waitlist'), 'expected message to mention waitlist');
  });


  // ── Scenario 3: Cancel + auto-promote ───────────────────────────────────────
  console.log('\nScenario 3 — Cancel + auto-promote');

  await test('promotes next waitlisted user when a confirmed RSVP is cancelled', async () => {
    let capturedTransact = null;

    setSend(async (cmd) => {
      if (cmd.constructor.name === 'GetCommand') {
        return { Item: makeConfirmedRsvp() };
      }
      if (cmd.constructor.name === 'QueryCommand') {
        return { Items: [makeWaitlistEntry()] };
      }
      if (cmd.constructor.name === 'TransactWriteCommand') {
        capturedTransact = cmd.input;
        return {};
      }
      throw new Error(`Unexpected command: ${cmd.constructor.name}`);
    });

    const result = await rsvpService.cancelRsvp(EVENT_ID, USER_CONFIRMED);

    assert(result.status   === 'cancelled',      `expected cancelled, got "${result.status}"`);
    assert(result.promoted === USER_WAITLISTED,  `expected promoted=${USER_WAITLISTED}, got "${result.promoted}"`);

    // Verify who the transaction targeted
    const items      = capturedTransact.TransactItems;
    const deleteItem = items.find((i) => i.Delete);
    const updateItem = items.find((i) => i.Update);

    assert(deleteItem?.Delete?.Key?.userId === USER_CONFIRMED,  'TransactWrite should delete the confirmed user');
    assert(updateItem?.Update?.Key?.userId === USER_WAITLISTED, 'TransactWrite should promote the waitlisted user');
  });

  await test('does NOT change currentRsvps during cancel+promote (net zero)', async () => {
    let capturedTransact = null;

    setSend(async (cmd) => {
      if (cmd.constructor.name === 'GetCommand')           return { Item: makeConfirmedRsvp() };
      if (cmd.constructor.name === 'QueryCommand')         return { Items: [makeWaitlistEntry()] };
      if (cmd.constructor.name === 'TransactWriteCommand') { capturedTransact = cmd.input; return {}; }
      throw new Error(`Unexpected command: ${cmd.constructor.name}`);
    });

    await rsvpService.cancelRsvp(EVENT_ID, USER_CONFIRMED);

    const items = capturedTransact.TransactItems;
    const touchesCurrentRsvps = items.some(
      (i) => i.Update?.TableName?.toLowerCase().includes('event') &&
              i.Update?.UpdateExpression?.includes('currentRsvps')
    );
    assert(!touchesCurrentRsvps, 'currentRsvps must NOT be modified when promotion fills the freed seat');
  });

  await test('decrements currentRsvps when cancelled with an empty waitlist', async () => {
    let capturedTransact = null;

    setSend(async (cmd) => {
      if (cmd.constructor.name === 'GetCommand')           return { Item: makeConfirmedRsvp() };
      if (cmd.constructor.name === 'QueryCommand')         return { Items: [] }; // no one waiting
      if (cmd.constructor.name === 'TransactWriteCommand') { capturedTransact = cmd.input; return {}; }
      throw new Error(`Unexpected command: ${cmd.constructor.name}`);
    });

    const result = await rsvpService.cancelRsvp(EVENT_ID, USER_CONFIRMED);

    assert(result.status === 'cancelled', `expected cancelled, got "${result.status}"`);
    assert(!result.promoted,              'promoted should be absent when no one is waiting');

    const items = capturedTransact.TransactItems;
    const decrement = items.some(
      (i) => i.Update?.UpdateExpression?.includes('currentRsvps - :one')
    );
    assert(decrement, 'currentRsvps must be decremented when no promotion occurs');
  });


  // ── Scenario 4: Duplicate prevention ────────────────────────────────────────
  console.log('\nScenario 4 — Duplicate prevention');

  await test('returns 409 when user already has a confirmed RSVP (event not full)', async () => {
    setSend(async (cmd) => {
      if (cmd.constructor.name === 'GetCommand') return { Item: makeEvent({ currentRsvps: 1 }) };
      if (cmd.constructor.name === 'TransactWriteCommand') {
        // capacity check passed (None), RSVP Put failed because record exists
        throw txCancelled('None', 'ConditionalCheckFailed');
      }
      throw new Error(`Unexpected command: ${cmd.constructor.name}`);
    });

    try {
      await rsvpService.rsvpToEvent(EVENT_ID, USER_CONFIRMED, 'confirmed@tamu.edu', STUDENT_GROUPS);
      assert(false, 'should have thrown a 409');
    } catch (err) {
      assert(err.statusCode === 409, `expected statusCode 409, got ${err.statusCode}`);
    }
  });

  await test('returns 409 when event is full AND user already has an entry', async () => {
    setSend(async (cmd) => {
      if (cmd.constructor.name === 'GetCommand') return { Item: makeEvent({ currentRsvps: 2 }) };
      if (cmd.constructor.name === 'TransactWriteCommand') {
        // Both conditions fail — capacity full AND existing RSVP/waitlist entry
        throw txCancelled('ConditionalCheckFailed', 'ConditionalCheckFailed');
      }
      throw new Error(`Unexpected command: ${cmd.constructor.name}`);
    });

    try {
      await rsvpService.rsvpToEvent(EVENT_ID, USER_CONFIRMED, 'confirmed@tamu.edu', STUDENT_GROUPS);
      assert(false, 'should have thrown a 409');
    } catch (err) {
      // reasons[1] failing takes priority over the waitlist path
      assert(err.statusCode === 409, `expected statusCode 409, got ${err.statusCode}`);
    }
  });


  // ── Scenario 5: Velvet Rope ──────────────────────────────────────────────────
  console.log('\nScenario 5 — Velvet Rope still applies to partners');

  await test('rejects partner RSVP before early access window opens (403)', async () => {
    // Gold tier: earlyAccessHours = 48. Event is 10 days away.
    // Window opens at (event - 48h) = ~8.9 days from now → still locked.
    const farFuture = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const event = makeEvent({ date: farFuture, capacity: 10, currentRsvps: 0 });

    setSend(async (cmd) => {
      if (cmd.constructor.name === 'GetCommand') return { Item: event };
      throw new Error(`Unexpected command: ${cmd.constructor.name}`);
    });

    _fetchImpl = async (url) => {
      if (url.includes('/domain/')) {
        return { ok: true, status: 200, json: async () => ({ companyId: 'c001', tierId: 'gold' }) };
      }
      if (url.includes('/config')) {
        return {
          ok: true, status: 200,
          json: async () => ({ tiers: [{ tierId: 'gold', earlyAccessHours: 48 }] }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    try {
      await rsvpService.rsvpToEvent(EVENT_ID, 'partner-1', 'p@exxonmobil.com', INVESTOR_GROUPS);
      assert(false, 'should have been rejected by the time gate');
    } catch (err) {
      assert(err.statusCode === 403,                        `expected 403, got ${err.statusCode}`);
      assert(err.message.includes('cannot RSVP'),          `expected time-gate message, got: "${err.message}"`);
    }
  });

  await test('allows partner RSVP once inside the early access window', async () => {
    // Gold tier: earlyAccessHours = 48. Event is 24h away → window opened 24h ago → allowed.
    const nearFuture = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const event = makeEvent({ date: nearFuture, capacity: 10, currentRsvps: 0 });

    setSend(async (cmd) => {
      if (cmd.constructor.name === 'GetCommand')           return { Item: event };
      if (cmd.constructor.name === 'TransactWriteCommand') return {};
      throw new Error(`Unexpected command: ${cmd.constructor.name}`);
    });

    _fetchImpl = async (url) => {
      if (url.includes('/domain/')) {
        return { ok: true, status: 200, json: async () => ({ companyId: 'c001', tierId: 'gold' }) };
      }
      if (url.includes('/config')) {
        return {
          ok: true, status: 200,
          json: async () => ({ tiers: [{ tierId: 'gold', earlyAccessHours: 48 }] }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const result = await rsvpService.rsvpToEvent(EVENT_ID, 'partner-1', 'p@exxonmobil.com', INVESTOR_GROUPS);
    assert(result.status === 'CONFIRMED', `expected CONFIRMED, got "${result.status}"`);
  });


  // ── Results ──────────────────────────────────────────────────────────────────
  const divider = '─'.repeat(42);
  console.log(`\n${divider}`);
  if (failed === 0) {
    console.log(`  ${passed} passed, ${failed} failed`);
  } else {
    console.error(`  ${passed} passed, ${failed} failed`);
    process.exit(1);
  }

})();
