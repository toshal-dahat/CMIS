# Mentorship program – product flow and engineering notes

This document summarizes the **mentorship opt-in** work that ships with the student profile in CMIS. The **implementation lives in the student-service Lambda and the frontend**; the external-service tree holds this file so operators and other services can read the overall story next to graduation and handover behavior.

## User-facing flow

1. **First-time profile (`ProfileForm`) and “My profile” (`ProfilePanel`)**  
   For non-admin sign-ups and edits, the user must answer **Mentorship program** (**Not interested** vs **Interested in participating**). This is required to save.

2. **If interested**  
   - Choose **Mentee** or **Mentor**.  
   - **Mentor:** enter **how many students** they are willing to mentor (**1–10**).

3. **Always editable**  
   The same controls appear on profile edit; values are persisted on the student profile in DynamoDB.

## Business rules

- **Mentee:** At least one email on the profile CSV must be `@tamu.edu` (aligns with the current-student / TAMU path).  
- **Mentor:** `mentorCapacity` must be an integer from **1** to **10**.  
- **Admin** UI path does not collect mentorship; the student-service handler defaults `mentorshipInterested` to `false` for admins when omitted.

## Cognito and roles

- **`ensureUserGrouped`**, **`syncGraduatedGroupsForProfile`**, and existing **role** rules (for example STUDENT versus FORMER_STUDENT from grad date and email) are **unchanged**.  
- Mentorship fields are **additive**; they do not replace student group membership.

## Data model (StudentProfiles – DynamoDB)

Stored on the profile item, alongside existing fields (name, email, uin, `role`, resume key, and after recent `develop` merges `profileGpa`, `profileEducation`, `profileSkillKeys`):

| Field | Type | Meaning |
|-------|------|---------|
| `mentorshipInterested` | boolean | User opted into considering mentorship. |
| `mentorship` | `"mentee"` \| `"mentor"` \| null | Role in the program when interested. |
| `mentorCapacity` | number \| null | Cap count when `mentorship === "mentor"`. |

## API (student-service)

- **POST** `/student/api/profiles` (create): non-admins must send boolean `mentorshipInterested`; conditional `mentorship` / `mentorCapacity` per rules above.  
- **PUT** `/student/api/profiles/me`: partial updates allowed; merged profile is validated so an “interested” state stays consistent.

More detail: `services/student-service/docs/API.md`.

## Frontend

- **`frontend/src/lib/ProfileForm.svelte`** – required mentorship block for non-admin; combined with **develop** resume-derived **GPA / education / skills** for students.  
- **`frontend/src/lib/ProfilePanel.svelte`** – same for edit.  
- **`frontend/src/lib/api.ts`** – `createProfile` / `updateProfile` / `toProfileFromApi` include mentorship and resume fields.  
- **`frontend/src/lib/types.ts`** – `Profile`, `CreateProfileBody`, `UpdateProfileBody` extended accordingly.

## External-service scope

**This Python external-service does not implement mentorship HTTP APIs.** It remains focused on graduation handover and related external integrations. If mentorship later needs orchestration here (matching, notifications, and so on), extend this document with endpoints and authentication.

## Integration note

Mentorship work tracks on **`feature/mentorshipchanges_main`**, merged periodically with **`develop`** so resume and skills profile changes stay aligned without dropping mentorship behavior.
