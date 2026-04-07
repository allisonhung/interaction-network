# Interaction Network

Interaction Network is a Next.js app for mapping social relationships between people, exploring graph structure visually, and asking an AI assistant questions about the network.

## What it does

- Visualizes people and relationship edges in an interactive force graph.
- Supports relationship types: `friends`, `coworkers`, `exes`, `lovers`, `enemies`, `family`.
- Colors relationship edges by type (`coworkers` is gray).
- Lets signed-in users add/edit/delete nodes and connections.
- Includes relationship visibility toggles (include/exclude by edge type).
- Includes a Disperse layout mode with automatic zoom-to-fit.
- Provides a Gemini-powered “Social Dynamics Agent” sidebar with example prompts.
- Supports sign-in plus account request submission and admin approval/deny workflow.
- Includes an Events planner sidebar tab for creating events, adding attendees, and viewing attendee-only subgraphs.

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
- `signup_requests` (for account approval flow)
- `planned_events` or `events` (for per-account event planning)

Notes:

- The app includes fallbacks for some schema variations (`type` vs `relationship_type`, optional color/status metadata).
- Admin approval sends Supabase invite emails via service role key.
- Event rows should include `user_id`, `name`, `attendees` (JSON), and `created_at`.
- Use row-level security so users can only read/write events where `user_id = auth.uid()`.

## Authentication and invite flow

- Users can request accounts from the UI.
- Approved requests send invite emails.
- Invite links redirect to the app callback page at `/auth/callback`.
- Configure Supabase Auth URL settings to allow your production and local callback URLs.

## Scripts

- `npm run dev` — start local dev server
- `npm run build` — production build
- `npm run start` — run production server
- `npm run lint` — lint code

## Deployment

Deploy on Vercel with GitHub integration.

- Pushes to your connected branch trigger automatic redeploys.
- Add all required environment variables in Vercel Project Settings.

