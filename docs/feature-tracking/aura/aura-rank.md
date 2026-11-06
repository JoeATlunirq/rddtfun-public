# Aura rank

**Status:** implemented
**Next step / blockers:** Apply migration `20261024120000_add_aura_handles.sql` to Supabase. Until then the list stays in `backend/data/aura_settings.json`.

## Purpose

`/aura` is a leaderboard of YouTube channels that the user picks, so they can see how competitors are doing. It is a port of the standalone StoryRank app (Next.js, `StoryRank (XYZ)/web`) into GetBrainrot. StoryRank used one global, admin-managed channel list with a cron that cached rows in its own Supabase tables. Aura instead has one list per user and fetches the data when the page loads.

## Intended behavior

- **Settings → Aura tab** (`AuraChannelSettings`): accepts an `@handle`, a bare handle, a `UC…` channel ID or a YouTube channel URL. The backend resolves it through ViewStats to a channel ID, title and avatar and saves it right away, with no Save button. Each channel can be removed. A user can have at most 50 channels, and the same channel ID can't be added twice. A handle ViewStats doesn't know shows "`@x` was not found on YouTube".
- **`/aura` page**: Daily / Weekly / Monthly tabs (`24h` / `7d` / `30d`; the choice is remembered in localStorage). The page shows:
  - total stat tiles
  - a podium for the top 3 (#2, #1, #3)
  - a table for rank 4 and below
  - "Leaders" cards: most views, most consistent, fastest growing and best performer, each a different channel
  - a detail modal with a daily-views chart, stats and a link to the channel.
- **Ranking**: channels are ordered by **views gained** in the timeframe, as in StoryRank. The **Aura score** (0–100) is StoryRank's SR formula: saturating components for views 40%, subscriber growth rate 20%, engagement 20%, views per video 15% and posting consistency 5%. The benchmarks depend on the timeframe. Engagement is always 0, because ViewStats daily stats don't include it (StoryRank had the same gap).
- **Timeframe data**: ViewStats `/channels/{id}/stats?range=N&groupBy=daily` with range 7 for `24h` and `7d` and range 28 for `30d`. The most recent 1, 7 or 28 daily records are summed into views, subs and videos gained.
- **Rank change**: compared against a snapshot per user and timeframe in `backend/data/aura_snapshots.json`. The snapshot rolls forward at most every 6 hours, matching StoryRank's refresh cadence.
- **Caching**: ViewStats stats responses are kept in memory for 30 minutes per channel and range. Up to 5 channels are fetched at once. If a channel fails, the page lists it in a warning instead of failing the whole page.

## Must-preserve invariants

- Every ViewStats call happens in the backend (`researchService.viewstatsRequest`). The frontend calls only `/api/aura/*` through `apiFetch`.
- All `/api/aura/*` routes are behind the shared Supabase-token middleware and are scoped to `req.authUser.id`.

## Contracts

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/aura/channels` | — | `{ channels: AuraChannel[] }` |
| POST | `/api/aura/channels` | `{ handle }` | `201 { channels }`, or `400 { error }` |
| DELETE | `/api/aura/channels/:channelId` | — | `{ channels }` |
| GET | `/api/aura/leaderboard` | `?timeframe=24h\|7d\|30d` | `{ timeframe, entries, errors, channelCount, lastUpdated }` |

`AuraChannel` is `{ channelId, handle, title, thumbnailUrl }`. Entries add the stats, `rank`, `previousRank`, `rankChange`, `score` and `dailyViews`. See `src/types/aura.ts`.

## Persistence

The list is stored in `user_settings.aura_handles` (jsonb array of `AuraChannel`, default `[]`), added by migration `20261024120000_add_aura_handles.sql`. If the column is missing (`isMissingColumnError`), reads and writes fall back to `backend/data/aura_settings.json` (`{ [userId]: { channels, updatedAt } }`), the same fallback the vibi/groq keys use. After the migration, an empty column still reads the local list, so lists saved before the migration carry over. The first successful Supabase save deletes that user's local entry, so removed channels can't come back. The JSON files in `backend/data/` are gitignored.

## Dependencies and regression risks

- ViewStats is an unofficial API; it is configured through `VIEWSTATS_BEARER_TOKEN`, `VIEWSTATS_IV_B64` and `VIEWSTATS_KEY_B64` (the same setup Research uses). If ViewStats changes, both Research and Aura break.
- `researchService` now also returns `viewstatsRequest` and `resolveViaViewstats` for Aura to use.

## Main implementation locations

- `backend/services/auraService.js`: storage, ViewStats stats, score, ranking, snapshots
- `backend/server.js`: `/api/aura/*` routes
- `src/pages/Aura.tsx`, `src/types/aura.ts`
- `src/components/AuraChannelSettings.tsx`, used in `src/pages/Settings.tsx` (Aura tab)
- `src/App.tsx` route and `src/components/Layout.tsx` sidebar link

## Verification

- `npm test` (`backend/utils/auraService.test.js`: handle normalization, daily summarization, score bounds)
- Manual check: add and remove handles in Settings → Aura, then open `/aura` and switch timeframes.
