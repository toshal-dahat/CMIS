'use strict';

/**
 * Calendar service test script — zero dependencies, no Jest required.
 * Mocks the AWS SDK via Module._load interception before calendarService is loaded.
 *
 * Usage:
 *   node test-calendar.js
 *
 * Expected output:
 *   Scenario 1 — Single-event happy path
 *     ✓  returns valid .ics string containing the event's UID and SUMMARY
 *     ✓  404 error is thrown when the event does not exist
 *
 *   Scenario 2 — User schedule with multiple confirmed RSVPs
 *     ✓  .ics contains one VEVENT per confirmed RSVP
 *     ✓  only CONFIRMED RSVPs are queried (FilterExpression targets status=CONFIRMED)
 *
 *   Scenario 3 — User with no RSVPs
 *     ✓  returns a valid empty VCALENDAR (no error, no VEVENTs)
 *
 *   Scenario 4 — Event with malformed date
 *     ✓  skips the bad event and still produces a valid calendar (no 500)
 *
 *   ────────────────────────────────────────
 *   7 passed, 0 failed
 */

// ─── 1. AWS SDK MOCK (must happen before requiring calendarService) ────────────

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
      GetCommand:   class GetCommand   { constructor(i) { this.input = i; } },
      QueryCommand: class QueryCommand { constructor(i) { this.input = i; } },
    };
  }
  return _originalLoad.apply(this, arguments);
};

// ─── 2. ENV VARS ──────────────────────────────────────────────────────────────

process.env.EVENTS_TABLE = 'Events-dev';
process.env.RSVP_TABLE   = 'EventRsvps-dev';

// ─── 3. LOAD SERVICES UNDER TEST ──────────────────────────────────────────────

const calendarService = require('./src/services/calendarService');
const { buildICS }    = require('./src/lib/icsBuilder');

// ─── 4. TEST HELPERS ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  _sendImpl = null;
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

// ─── FIXTURE FACTORIES ────────────────────────────────────────────────────────

const EVENT_ID_A = 'event-aaa';
const EVENT_ID_B = 'event-bbb';
const USER_ID    = 'user-xyz';

function makeEvent(overrides = {}) {
  return {
    eventId: EVENT_ID_A,
    title: 'Test Event Alpha',
    date: '2026-09-01T18:00:00.000Z',
    location: 'Wehner 110',
    description: 'A great event.',
    ...overrides,
  };
}

function makeRsvp(eventId, overrides = {}) {
  return {
    eventId,
    userId: USER_ID,
    userEmail: 'test@tamu.edu',
    status: 'CONFIRMED',
    rsvpAt: '2026-08-01T10:00:00.000Z',
    ...overrides,
  };
}

// ─── SCENARIOS ────────────────────────────────────────────────────────────────

(async () => {

  // ── Scenario 1: Single-event happy path ────────────────────────────────────
  console.log('\nScenario 1 — Single-event happy path');

  await test('returns valid .ics string containing the event\'s UID and SUMMARY', async () => {
    const event = makeEvent();

    setSend(async (cmd) => {
      if (cmd.constructor.name === 'GetCommand') return { Item: event };
      throw new Error(`Unexpected command: ${cmd.constructor.name}`);
    });

    const ics = await calendarService.getEventCalendar(EVENT_ID_A);

    assert(typeof ics === 'string',                              'result should be a string');
    assert(ics.includes('BEGIN:VCALENDAR'),                      'missing BEGIN:VCALENDAR');
    assert(ics.includes('END:VCALENDAR'),                        'missing END:VCALENDAR');
    assert(ics.includes(`UID:${EVENT_ID_A}@cmis-platform`),      'missing UID for event');
    assert(ics.includes('SUMMARY:Test Event Alpha'),             'missing SUMMARY');
    assert(ics.includes('DTSTART:20260901T180000Z'),             'date formatted incorrectly');
    assert(ics.includes('BEGIN:VEVENT'),                         'missing VEVENT block');
  });

  await test('404 error is thrown when the event does not exist', async () => {
    setSend(async (cmd) => {
      if (cmd.constructor.name === 'GetCommand') return { Item: undefined };
      throw new Error(`Unexpected command: ${cmd.constructor.name}`);
    });

    try {
      await calendarService.getEventCalendar('no-such-event');
      assert(false, 'should have thrown');
    } catch (err) {
      assert(err.statusCode === 404, `expected statusCode 404, got ${err.statusCode}`);
    }
  });


  // ── Scenario 2: User schedule with multiple confirmed RSVPs ────────────────
  console.log('\nScenario 2 — User schedule with multiple confirmed RSVPs');

  await test('.ics contains one VEVENT per confirmed RSVP', async () => {
    const rsvps   = [makeRsvp(EVENT_ID_A), makeRsvp(EVENT_ID_B, { eventId: EVENT_ID_B })];
    const eventA  = makeEvent({ eventId: EVENT_ID_A, title: 'Event Alpha' });
    const eventB  = makeEvent({ eventId: EVENT_ID_B, title: 'Event Beta', date: '2026-10-15T14:00:00.000Z' });

    setSend(async (cmd) => {
      if (cmd.constructor.name === 'QueryCommand') return { Items: rsvps };
      if (cmd.constructor.name === 'GetCommand') {
        const id = cmd.input.Key.eventId;
        if (id === EVENT_ID_A) return { Item: eventA };
        if (id === EVENT_ID_B) return { Item: eventB };
      }
      throw new Error(`Unexpected command: ${cmd.constructor.name}`);
    });

    const ics = await calendarService.getUserSchedule(USER_ID);

    const veventCount = (ics.match(/BEGIN:VEVENT/g) || []).length;
    assert(veventCount === 2,                            `expected 2 VEVENTs, got ${veventCount}`);
    assert(ics.includes('SUMMARY:Event Alpha'),          'missing Event Alpha');
    assert(ics.includes('SUMMARY:Event Beta'),           'missing Event Beta');
    assert(ics.includes(`UID:${EVENT_ID_A}@cmis-platform`), 'missing UID for event A');
    assert(ics.includes(`UID:${EVENT_ID_B}@cmis-platform`), 'missing UID for event B');
  });

  await test('only CONFIRMED RSVPs are queried (FilterExpression targets status=CONFIRMED)', async () => {
    let capturedQuery = null;

    setSend(async (cmd) => {
      if (cmd.constructor.name === 'QueryCommand') {
        capturedQuery = cmd.input;
        return { Items: [] }; // empty result is fine — we're only checking the query shape
      }
      throw new Error(`Unexpected command: ${cmd.constructor.name}`);
    });

    await calendarService.getUserSchedule(USER_ID);

    assert(capturedQuery !== null,                         'QueryCommand was never called');
    assert(
      capturedQuery.FilterExpression !== undefined,
      'FilterExpression is missing — waitlisted RSVPs would be included'
    );
    assert(
      JSON.stringify(capturedQuery.ExpressionAttributeValues).includes('CONFIRMED'),
      'FilterExpression does not filter for CONFIRMED status'
    );
  });


  // ── Scenario 3: User with no RSVPs ─────────────────────────────────────────
  console.log('\nScenario 3 — User with no RSVPs');

  await test('returns a valid empty VCALENDAR (no error, no VEVENTs)', async () => {
    setSend(async (cmd) => {
      if (cmd.constructor.name === 'QueryCommand') return { Items: [] };
      throw new Error(`Unexpected command: ${cmd.constructor.name}`);
    });

    const ics = await calendarService.getUserSchedule(USER_ID);

    assert(typeof ics === 'string',              'result should be a string');
    assert(ics.includes('BEGIN:VCALENDAR'),      'missing BEGIN:VCALENDAR');
    assert(ics.includes('END:VCALENDAR'),        'missing END:VCALENDAR');
    const veventCount = (ics.match(/BEGIN:VEVENT/g) || []).length;
    assert(veventCount === 0,                    `expected 0 VEVENTs, got ${veventCount}`);
  });


  // ── Scenario 4: Event with malformed date ───────────────────────────────────
  console.log('\nScenario 4 — Event with malformed date');

  await test('skips the bad event and still produces a valid calendar (no 500)', async () => {
    // buildICS is called directly here since malformed-date handling lives in icsBuilder.
    // Suppress the expected console.warn so test output stays clean.
    const originalWarn = console.warn;
    let warnCalled = false;
    console.warn = (...args) => {
      if (String(args[0]).includes('[icsBuilder]')) warnCalled = true;
    };

    let ics;
    try {
      ics = buildICS([
        { eventId: 'bad-event', title: 'Bad Date Event', date: 'not-a-date' },
        makeEvent({ eventId: 'good-event', title: 'Good Event' }),
      ]);
    } finally {
      console.warn = originalWarn;
    }

    assert(warnCalled,                             'expected a console.warn for the bad event');
    assert(ics.includes('BEGIN:VCALENDAR'),        'missing BEGIN:VCALENDAR');
    assert(ics.includes('END:VCALENDAR'),          'missing END:VCALENDAR');
    assert(!ics.includes('bad-event'),             'bad event should have been skipped');
    assert(ics.includes('SUMMARY:Good Event'),     'good event should still appear');
    const veventCount = (ics.match(/BEGIN:VEVENT/g) || []).length;
    assert(veventCount === 1,                      `expected 1 VEVENT, got ${veventCount}`);
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
