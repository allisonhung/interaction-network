# Interaction Network

Interaction Network is a Next.js app for mapping social relationships between people, exploring graph structure visually, planning events, and asking an AI assistant questions about the network.

## What it does

- Visualizes people and relationship edges in an interactive force graph.
- Supports relationship types: `friends`, `coworkers`, `exes`, `lovers`, `enemies`, `family`.
- Colors relationship edges by type (`coworkers` is gray).
- Supports person groups (for example: `book club`) with multi-group membership per person.
- Includes group viewing modes: show all, highlight one selected group, or show only one group.
- Lets signed-in users add/edit/delete nodes and connections.
- Includes relationship visibility toggles (include/exclude by edge type).
- Includes a Disperse layout mode with automatic zoom-to-fit.
- Provides a shared **Planning Hub** sidebar with:
	- **Gemini** chat tab (example prompts, markdown-style bold/newline rendering)
	- **Events** tab (create, edit, delete, and select saved events)
- Supports sign-in plus account request submission and admin approval/deny workflow.
- Includes event-only graph views that show attendees plus existing connections between them.
- Supports agent-triggered event creation from natural-language prompts using backend AI intent extraction.
- Shows an editable confirmation modal before event creation so users can correct event name and attendees (`Create` / `Cancel`).
- Supports optional post-create “who else should I add?” attendee suggestions.

## Planning Hub behavior

### Gemini tab

- Regular chat with graph-aware Gemini answers.
- Accepts prompts like:
	- `show me what a dinner party would look like with alice, bob, and catie`
- For event-intent prompts, the app first asks the backend AI to extract `eventName` + attendee list (with local parser fallback if extraction fails).
- The confirmation modal is editable, so you can fix parsing issues before the event is created.
- If your prompt includes follow-up language like `who else could I add`, the app auto-requests additional attendee suggestions after event creation.

### Events tab

- Create named events and attendee lists.
- Add attendees from existing network nodes (auto-add from dropdown selection).
- Add custom attendees not in the main graph.
- Edit saved events.
- Delete saved events.
- Select an event to switch graph view to attendees + existing links among those attendees.

## Data ownership

- Events are account-scoped by `user_id`.
- Signed-in users only see their own events.
- Recommended: enforce this with Supabase Row Level Security (RLS).

## Tech stack

- Next.js 16 (App Router)
- React 19
- Tailwind CSS 4
- Supabase (Auth + Database)
- react-force-graph-2d
- Gemini API

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create local env file:

```bash
cp .env.example .env.local
```

3. Fill `.env.local` with real values.

4. Run dev server:

```bash
npm run dev
```

5. Open http://localhost:3000

## Environment variables

Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APPROVER_EMAILS`
- `GEMINI_API_KEY`

Recommended:

- `SUPABASE_INVITE_REDIRECT_URL` (for invite links, e.g. `https://your-domain.com/auth/callback`)

Never commit `.env.local`.

## Supabase requirements

At minimum, create/maintain these tables:

- `nodes` (person nodes)
- relationship table: app supports `links`, `connections`, or `edges`
- `groups` (group metadata, such as name and color)
- `group_memberships` (join table linking people to groups)
- `signup_requests` (for account approval flow)
- `planned_events` or `events` (for per-account event planning)

Notes:

- The app includes fallbacks for some schema variations (`type` vs `relationship_type`, optional color/status metadata).
- Admin approval sends Supabase invite emails via service role key.
- Event rows should include `user_id`, `name`, `attendees` (JSON), and `created_at`.
- Use row-level security so users can only read/write events where `user_id = auth.uid()`.
- If `planned_events`/`events` is missing, the app falls back to browser-local storage for events.

## Run database setup SQL

Use this single script to create the core app tables, indexes, and RLS policies:

- `supabase/sql/interaction_network_setup.sql`

How to apply:

- Supabase Dashboard → SQL Editor → paste and run the script.

After running the script:

- Update the seeded row in `public.approver_emails` to your real approver email(s), or add rows manually.

### SQL Editor quick start checklist

1. Open Supabase Dashboard → **SQL Editor**.
2. Open `supabase/sql/interaction_network_setup.sql`, copy all content, and paste it into SQL Editor.
3. Replace the placeholder approver email in the final `insert into public.approver_emails ...` statement.
4. Click **Run** and confirm it completes without errors.
5. Run these verification queries:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
	and table_name in (
		'nodes',
		'links',
		'groups',
		'group_memberships',
		'planned_events',
		'signup_requests',
		'approver_emails'
	)
order by table_name;
```

```sql
select email, created_at
from public.approver_emails
order by created_at desc;
```

```sql
select tablename, policyname
from pg_policies
where schemaname = 'public'
	and tablename in (
		'nodes',
		'links',
		'groups',
		'group_memberships',
		'planned_events',
		'signup_requests',
		'approver_emails'
	)
order by tablename, policyname;
```

## Authentication and invite flow

- Users can request accounts from the UI.
- Approved requests send invite emails.
- Invite links redirect to the app callback page at `/auth/callback`.
- Configure Supabase Auth URL settings to allow your production and local callback URLs.

## Suggested prompt examples

- `Show me what a dinner party would look like with allison, carter, julia II, kaaj, and catie.`
- `Plan a birthday event with alice, bob, and david.`
- `I’m going on a backpacking trip and so far allison, carter, julia II, kaaj, and catie are going.`
- `Create a team offsite with maya, rina, and tom. Who else could I add to increase social connection?`

## Scripts

- `npm run dev` — start local dev server
- `npm run build` — production build
- `npm run start` — run production server
- `npm run lint` — lint code

## Deployment

Deploy on Vercel with GitHub integration.

- Pushes to your connected branch trigger automatic redeploys.
- Add all required environment variables in Vercel Project Settings.

