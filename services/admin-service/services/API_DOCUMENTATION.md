# API Documentation

## Base URL
```
https://kxqvafya37.execute-api.us-east-1.amazonaws.com/test
```

---

## Config API

### GET /config
**Purpose:** Aggregates theme and tiers data for the frontend in a single call.

**Response:**
```json
{
  "theme": {
    "primaryColor": "#500000",
    "secondaryColor": "#FFFFFF",
    "logoURL": "https://cdn.cmis.tamu.edu/logo.png",
    "updatedAt": "2026-02-14T10:00:00Z"
  },
  "tiers": [
    {
      "tierId": "gold",
      "name": "Gold",
      "rank": 1,
      "earlyAccessHours": 48,
      "createdAt": "2026-02-14T10:00:00Z",
      "updatedAt": "2026-02-16T07:29:19.356Z"
    }
  ],
  "timestamp": "2026-02-16T07:37:39.554Z"
}
```

**Features:**
- Single endpoint to fetch both theme and tiers
- Reduces API calls for initial page load
- Tiers are pre-sorted by rank

---

## Theme API

### GET /theme
**Purpose:** Fetches platform branding (colors and logo).

**Response:**
```json
{
  "primaryColor": "#500000",
  "secondaryColor": "#FFFFFF",
  "logoURL": "https://cdn.cmis.tamu.edu/logo.png",
  "updatedAt": "2026-02-14T10:00:00Z"
}
```

### PUT /theme
**Purpose:** Updates platform branding.

**Request Body:**
```json
{
  "primaryColor": "#500000",
  "secondaryColor": "#FFFFFF",
  "logoUrl": "https://cdn.cmis.tamu.edu/logo.png"
}
```

**Response:**
```json
{
  "primaryColor": "#500000",
  "secondaryColor": "#FFFFFF",
  "logoURL": "https://cdn.cmis.tamu.edu/logo.png",
  "updatedAt": "2026-02-16T08:00:00.000Z"
}
```

**Features:**
- Super Admin can customize platform appearance
- Updates are reflected immediately across the platform

---

## Tiers API

### GET /tiers
**Purpose:** Lists all membership tiers sorted by rank.

**Response:**
```json
[
  {
    "tierId": "gold",
    "name": "Gold",
    "rank": 1,
    "earlyAccessHours": 48,
    "createdAt": "2026-02-14T10:00:00Z",
    "updatedAt": "2026-02-16T07:29:19.356Z"
  },
  {
    "tierId": "silver",
    "name": "Silver",
    "rank": 2,
    "earlyAccessHours": 24,
    "createdAt": "2026-02-14T10:00:00Z",
    "updatedAt": "2026-02-16T07:29:07.934Z"
  }
]
```

### POST /tiers
**Purpose:** Creates a new membership tier.

**Request Body:**
```json
{
  "tierId": "bronze",
  "name": "Bronze",
  "rank": 3,
  "earlyAccessHours": 12
}
```

**Response:**
```json
{
  "tierId": "bronze",
  "name": "Bronze",
  "rank": 3,
  "earlyAccessHours": 12,
  "createdAt": "2026-02-16T08:00:00.000Z",
  "updatedAt": "2026-02-16T08:00:00.000Z"
}
```

### PUT /tiers/{tierId}
**Purpose:** Updates an existing tier.

**Request Body:**
```json
{
  "name": "Gold Plus",
  "rank": 1,
  "earlyAccessHours": 72
}
```

**Response:**
```json
{
  "tierId": "gold",
  "name": "Gold Plus",
  "rank": 1,
  "earlyAccessHours": 72,
  "createdAt": "2026-02-14T10:00:00Z",
  "updatedAt": "2026-02-16T08:00:00.000Z"
}
```

### DELETE /tiers/{tierId}
**Purpose:** Deletes a tier (with safety checks).

**Response (Success):**
```json
{
  "message": "Tier deleted"
}
```

**Response (Conflict - 409):**
```json
{
  "message": "Cannot delete: Tier is assigned to active companies."
}
```

**Features:**
- Flexible tier system - admins define names and hierarchy
- Lower rank = more exclusive (Gold = 1, Silver = 2)
- Early access hours used by Velvet Rope API for event RSVP control
- Safety check prevents deletion if companies are using the tier

---

## Companies API

### GET /companies
**Purpose:** Lists all partner companies.

**Response:**
```json
[
  {
    "companyId": "550e8400-e29b-41d4-a716-446655440000",
    "name": "ExxonMobil",
    "domain": "exxonmobil.com",
    "tierId": "gold",
    "createdAt": "2026-02-14T10:00:00Z",
    "updatedAt": "2026-02-14T10:00:00Z"
  }
]
```

### GET /companies/{companyId}
**Purpose:** Fetches a single company (for pre-filling edit forms).

**Response:**
```json
{
  "companyId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "ExxonMobil",
  "domain": "exxonmobil.com",
  "tierId": "gold",
  "createdAt": "2026-02-14T10:00:00Z",
  "updatedAt": "2026-02-14T10:00:00Z"
}
```

### GET /companies/domain/{domain}
**Purpose:** Domain lookup for Team Gig 'Em's registration system.

**Response (Found):**
```json
{
  "companyId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "ExxonMobil",
  "domain": "exxonmobil.com",
  "tierId": "gold"
}
```

**Response (Not Found - 404):**
```json
{
  "message": "Not a partner"
}
```

### POST /companies
**Purpose:** Registers a new partner company.

**Request Body:**
```json
{
  "name": "ExxonMobil",
  "domain": "exxonmobil.com",
  "tierId": "gold"
}
```

**Response:**
```json
{
  "companyId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "ExxonMobil",
  "domain": "exxonmobil.com",
  "tierId": "gold",
  "createdAt": "2026-02-16T08:00:00.000Z",
  "updatedAt": "2026-02-16T08:00:00.000Z"
}
```

### PUT /companies/{companyId}
**Purpose:** Updates an existing company.

**Request Body:**
```json
{
  "name": "ExxonMobil Corporation",
  "domain": "exxonmobil.com",
  "tierId": "platinum"
}
```

**Response:**
```json
{
  "companyId": "550e8400-e29b-41d4-a716-446655440000",
  "name": "ExxonMobil Corporation",
  "domain": "exxonmobil.com",
  "tierId": "platinum",
  "createdAt": "2026-02-14T10:00:00Z",
  "updatedAt": "2026-02-16T08:00:00.000Z"
}
```

### DELETE /companies/{companyId}
**Purpose:** Removes a partner company.

**Response:**
```json
{
  "message": "Deleted"
}
```

**Features:**
- CRUD operations for partner company management
- Domain-based lookup powers Team Gig 'Em's PARTNER role assignment
- When a Professional registers with a matching email domain, they automatically get PARTNER role
- UUID-based company IDs for uniqueness
- DynamoDB with domain-index for fast lookups

---

## Integration Points

### Team Gig 'Em (External Core)
**Dependency:** `/companies/domain/{domain}`
- Used during Professional registration
- Checks if email domain matches a partner company
- Automatically assigns PARTNER role if match found

### Velvet Rope API (Phase 2)
**Dependency:** `/config` or `/tiers`
- Queries tier data to enforce early access rules
- Uses `earlyAccessHours` to determine RSVP eligibility
- Lower rank tiers get earlier access to events

---

## Frontend API Clients

### `src/lib/api/config.js`
- `getConfig()` - Fetches aggregated theme + tiers

### `src/lib/api/theme.js`
- `getTheme()` - Fetches theme from config endpoint
- `updateTheme(themeData)` - Updates platform branding

### `src/lib/api/tiers.js`
- `getTiers()` - Fetches tiers from config endpoint
- `createTier(tierData)` - Creates new tier
- `updateTier(tierId, tierData)` - Updates existing tier
- `deleteTier(tierId)` - Deletes tier

### `src/lib/api/companies.js`
- `getCompanies()` - Lists all companies
- `createCompany(companyData)` - Creates new company
- `updateCompany(companyId, companyData)` - Updates company
- `deleteCompany(companyId)` - Deletes company

---

## Admin UI Features

### Theme Editor (`/admin/theme`)
- Live preview of color changes
- Logo URL configuration
- Instant platform-wide updates

### Tier Management (`/admin/tiers`)
- Create/edit/delete membership tiers
- Define tier hierarchy with rank numbers
- Set early access hours for event RSVP
- Safety checks prevent deletion of tiers in use

### Company Management (`/admin/companies`)
- Add/edit/delete partner companies
- Assign tiers to companies
- Domain-based partner verification
- Table view with search and filtering
