const CRLF = '\r\n';

function formatDate(dateInput) {
    const d = new Date(dateInput);
    const pad = (n) => String(n).padStart(2, '0');
    return (
        d.getUTCFullYear() +
        pad(d.getUTCMonth() + 1) +
        pad(d.getUTCDate()) +
        'T' +
        pad(d.getUTCHours()) +
        pad(d.getUTCMinutes()) +
        pad(d.getUTCSeconds()) +
        'Z'
    );
}

function escapeText(str) {
    if (!str) return '';
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

/**
 * Converts an array of event objects from DynamoDB into a valid .ics string (RFC 5545).
 * @param {Array} events - event objects with at least: eventId, title, date (ISO string)
 * @returns {string} iCalendar format string with CRLF line endings
 */
function buildICS(events) {
    const now = formatDate(new Date());
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//CMIS Platform//Event Service//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
    ];

    for (const event of events) {
        try {
            const startMs = new Date(event.date).getTime();
            if (isNaN(startMs)) throw new Error(`invalid date value: "${event.date}"`);

            const dtstart = formatDate(event.date);
            const dtend = event.endDate
                ? formatDate(event.endDate)
                : formatDate(new Date(startMs + 60 * 60 * 1000));

            lines.push('BEGIN:VEVENT');
            lines.push(`UID:${event.eventId}@cmis-platform`);
            lines.push(`DTSTAMP:${now}`);
            lines.push(`DTSTART:${dtstart}`);
            lines.push(`DTEND:${dtend}`);
            lines.push(`SUMMARY:${escapeText(event.title)}`);
            if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
            if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
            lines.push('END:VEVENT');
        } catch (err) {
            console.warn(`[icsBuilder] Skipping event ${event.eventId}: ${err.message}`);
        }
    }

    lines.push('END:VCALENDAR');
    return lines.join(CRLF) + CRLF;
}

module.exports = { buildICS };

if (require.main === module) {
    const ics = buildICS([
        {
            eventId: 'test-123',
            title: 'CMIS Info Session',
            date: '2026-05-01T18:00:00.000Z',
            location: 'Wehner 110',
            description: 'Come meet us!\nFree food provided.',
        },
        {
            eventId: 'test-456',
            title: 'Career Fair, Part Two',
            date: '2026-06-15T14:00:00.000Z',
        },
    ]);

    console.log(ics);

    const lines = ics.split('\r\n');
    console.assert(lines[0] === 'BEGIN:VCALENDAR', 'starts with BEGIN:VCALENDAR');
    console.assert(lines[lines.length - 1] === '', 'ends with trailing CRLF');
    console.assert(lines[lines.length - 2] === 'END:VCALENDAR', 'ends with END:VCALENDAR');
    console.assert(ics.includes('UID:test-123@cmis-platform'), 'has UID for event 1');
    console.assert(ics.includes('DTSTART:20260501T180000Z'), 'date formatted correctly');
    console.assert(ics.includes('SUMMARY:CMIS Info Session'), 'title present');
    console.assert(ics.includes('SUMMARY:Career Fair\\, Part Two'), 'comma escaped');
    console.assert(ics.includes('DESCRIPTION:Come meet us!\\nFree food provided.'), 'newline escaped');
    console.assert(!ics.includes('\r\n\r\n'), 'no double CRLF');
    console.log('All assertions passed.');
}
