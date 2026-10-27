# Fantasy Group

A small installable web app (PWA) for your Champions League fantasy group. It shows:

- **Table**: your league's official standings, plus the table after any past matchday, with movement arrows and a red card for last place
- **Matchday**: the best player of the day (as a collectible sticker), who won the day, and each person's top scorer, captain result, bench points and full squad
- **Season**: points behind the leader over time, plus awards (most matchday wins, best single matchday, top player, most points left on the bench)

It works offline with the last loaded scores, and friends can add it to their home screen.

It runs in **demo mode** until you finish step 2, so you can deploy first and see it working.

## 1. Deploy (about 5 minutes, free)

1. Create a free account at [vercel.com](https://vercel.com) (sign in with GitHub is easiest).
2. Put this folder in a new GitHub repository (you can drag and drop the files in the GitHub website).
3. In Vercel, choose **Add New → Project**, pick the repository, and click **Deploy**. No build settings are needed.
4. Open the link Vercel gives you. You should see the demo league.

## 2. Connect your real data

The UEFA fantasy game has no official public API, so the app reads the same data the game's website loads. You find that address once in your browser.

**Find the data URL**

1. On a computer, log in to the fantasy game in Chrome and open a team's points for a past matchday (yours or a friend's from your league).
2. Press F12 to open DevTools, go to the **Network** tab, and select the **Fetch/XHR** filter.
3. Reload the page. Click through the requests and look at the **Preview** tab for one that contains the list of players with their points for that matchday.
4. Right click it, choose **Copy → Copy URL**.
5. In that URL, replace the team ID with `{teamId}` and the matchday number with `{md}`. For example
   `https://…/user/AB12CD/…/3` becomes `https://…/user/{teamId}/…/{md}`.

**Find your league's standings URL (recommended)**

This lets the app pick up everyone in your league automatically and show the game's official rankings.

1. With DevTools still open on the **Network → Fetch/XHR** tab, go to your private league's page in the game.
2. Look for the request whose **Preview** shows the list of members with their rank and total points.
3. Right click it, choose **Copy → Copy URL**. Use it as is, with no placeholders.

The member IDs in that list should be the same IDs used in the team URL. If you see each member's ID in the standings and it matches the value you replaced with `{teamId}`, you're set.

**Optional: nicknames, or no league URL**

With the league URL set, `league.config.json` is only used for nicknames. To show "Marco" instead of the game's account name, add an entry with his team ID and the name you want. Anyone not listed keeps the name from the game.

If you'd rather not use the league URL, list every person's name, team name and team ID in `league.config.json` instead, and the app calculates the rankings itself.

**Set environment variables** in Vercel (Project → Settings → Environment Variables), then redeploy:

| Name | Value |
|---|---|
| `UEFA_TEAM_URL` | The URL template from above, with `{teamId}` and `{md}` |
| `UEFA_LEAGUE_URL` | Your league standings URL from above (recommended) |
| `UEFA_SCHEDULE_URL` | Optional. The request containing `"deadline"` (the player list info feed, message `cl_admin_player_recommended_list_info_get`), used for the deadline countdown |
| `UEFA_DEADLINE_TZ` | Optional. Timezone of the game's deadline times. Defaults to `Europe/Paris` (Central European Time); set to `UTC` if the countdown is an hour off |
| `NEXT_DEADLINE` | Optional fallback if you don't have the schedule URL, e.g. `2026-11-04T17:45:00Z`. Update it each matchday. |
| `UEFA_COOKIE` | Only if the request fails without being logged in. In DevTools, open the request, go to **Headers → Request Headers**, and copy the whole `cookie` value. This is your login session, so keep it private and never commit it to GitHub. It expires periodically, so update it if scores stop loading. |
| `MAX_MATCHDAY` | Optional. Highest matchday to check (default 17). |
| `DEBUG_KEY` | Optional. Any password, used for the debug page below. |

## 2b. Sync mode (if UEFA blocks Vercel)

UEFA's bot protection ignores requests from cloud servers, so the app can't fetch your league by itself. Instead, a browser fetches it and the app stores a copy:

1. In Vercel, open **Storage**, create an **Upstash for Redis** database (free) and connect it to this project. This adds the storage settings automatically.
2. Add an environment variable `SYNC_KEY` with any password you choose. Share it only with friends you want to be able to sync.
3. Keep `UEFA_LEAGUE_URL` set; the Sync page uses it to build the one-tap bookmark.
4. Redeploy, then open `/sync.html` on your app. Drag the **Sync league** button to your bookmarks bar.
5. On the UEFA fantasy site, click the bookmark. Your league is saved and everyone sees it within a minute.

You can also paste the league data on the Sync page, plus the response containing `"deadline"` to update the countdown.

## 3. If the numbers look wrong

The game uses short field names that can change between seasons. Open

`https://YOUR-APP.vercel.app/api/debug?key=YOUR_DEBUG_KEY&teamId=SOME_ID&md=1`

to see exactly what the game returns for one team, or

`https://YOUR-APP.vercel.app/api/debug?key=YOUR_DEBUG_KEY&league=1`

for your league standings. Use `&schedule=1` to check the matchday schedule. Then adjust the field name lists at the top of `api/_lib.js` (`KEYS.points`, `KEYS.name`, `KEYS.rank`, and so on). That file is the only place that knows about the game's format. You can also paste the debug output to Claude and ask it to update the mapping.

## 4. Share it

Send your friends the Vercel link. To install it:

- **iPhone**: open in Safari, tap Share, then **Add to Home Screen**.
- **Android**: open in Chrome, tap the menu, then **Install app**.

Anyone with the link can see the scores. Scores are cached for 5 minutes so everyone refreshing at once doesn't overload the game's servers.

## Good to know

- These are unofficial endpoints. If UEFA changes its site, the app may stop updating until the URL or field names are updated (see step 3).
- Use it for your own small group at a gentle refresh rate. It isn't affiliated with or endorsed by UEFA.

## Files

```
api/_lib.js          All game-specific logic: fetching, field mapping, demo data
api/league.js        GET /api/league, the normalized data the app uses
api/debug.js         GET /api/debug, raw game data for troubleshooting
league.config.json   Nicknames, or your full member list if you don't use the league URL
public/              The app: index.html, app.js, styles.css, sw.js, manifest, icons
```

To run locally: `npm i -g vercel`, then `vercel dev` in this folder.
