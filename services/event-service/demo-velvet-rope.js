/**
 * Velvet Rope Proof of Concept - PM Demo Script
 * 
 * Instructions:
 * 1. Ensure `node server.js` is running in another terminal.
 * 2. Create your event live in the demo (via UI or Postman).
 * 3. Copy the Event ID that gets created.
 * 4. Run this script: node demo-velvet-rope.js <YOUR_EVENT_ID>
 */

const BASE_URL = 'http://localhost:3005/api/events';

// Grab eventId from command line args
const eventId = process.argv[2];

if (!eventId) {
    console.error("❌ Error: You must provide an Event ID.");
    console.error("👉 Usage: node demo-velvet-rope.js <EVENT_ID_FROM_YOUR_DEMO>");
    process.exit(1);
}

// Simulates sending an RSVP as a specific user with a pseudo JWT (locally, any token is accepted)
async function sendRsvp(eventId, email) {
    console.log(`\n======================================================`);
    console.log(`👉 Attempting to RSVP as: ${email}`);
    
    const fakeJwtPayload = Buffer.from(JSON.stringify({ 
        email: email, 
        username: email.split('@')[0], 
        'cognito:groups': [] 
    })).toString('base64');
    
    const token = `fakeHeader.${fakeJwtPayload}.fakeSignature`;

    try {
        const res = await fetch(`${BASE_URL}/${eventId}/rsvp`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await res.json();
        
        if (res.ok) {
            console.log(`✅ SUCCESS [200]: Seat Secured! (Status: ${data.status})`);
        } else if (res.status === 403) {
            console.log(`🚫 DENIED [403]: Velvet Rope time gate activated!`);
            console.log(`   Message from Backend: "${data.message}"`);
        } else if (res.status === 404) {
            console.log(`❌ ERROR [404]: Event not found. Make sure you passed the correct Event ID!`);
        } else if (res.status === 409) {
            console.log(`⚠️ ERROR [409]: User already RSVP'd to this event!`);
        } else {
            console.log(`⚠️ ERROR [${res.status}]:`, data);
        }
    } catch (err) {
        console.error("Network Error:", err.message);
    }
}

async function runDemo() {
    console.log(`\n🎬 RUNNING VELVET ROPE DEMO ON EVENT: ${eventId}`);
    console.log(`Checking against Team Howdy Config (Gold=48h, Silver=24h, Standard=0h)...`);

    // Wait a second for readability
    await new Promise(r => setTimeout(r, 1000));

    console.log(`\n--- Test 1: Silver Partner (24h early access) ---`);
    await sendRsvp(eventId, "vp@silverpartner.com");
    
    await new Promise(r => setTimeout(r, 1500));

    console.log(`\n--- Test 2: Standard User (0h early access) ---`);
    await sendRsvp(eventId, "john.doe@standard.com");

    await new Promise(r => setTimeout(r, 1500));

    console.log(`\n--- Test 3: Gold Partner (48h early access) ---`);
    await sendRsvp(eventId, "ceo@goldpartner.com");
}

runDemo();
