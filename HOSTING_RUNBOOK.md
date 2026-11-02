# ICC Pulse daily refresh

[Public calendar](https://zellet.github.io/icc-pulse/) · [Refresh workflow](https://github.com/Zellet/icc-pulse/actions/workflows/refresh-and-deploy.yml) · [Published event data](https://zellet.github.io/icc-pulse/data/events.json)

## Install Stage 4

1. In the existing ICC Pulse folder, run `git pull --ff-only` and `git status --short`. A clean working tree produces no status lines. Preserve any local edits before copying the files.
2. Copy the supplied `.github/workflows/refresh-and-deploy.yml` over the Stage 3 file. Place `HOSTING_RUNBOOK.md` beside `refresh_events.py`.
3. Review and push the two files from that folder. Stop if a command fails.

```powershell
git add -- .github/workflows/refresh-and-deploy.yml HOSTING_RUNBOOK.md
git --no-pager diff --cached --stat
git commit -m "Schedule ICC Pulse refresh at 5:17 AM Pacific"
git push
```

The schedule takes effect when the workflow reaches the default branch, `main`. Pages should already use GitHub Actions from Stage 3. The manual Run workflow button remains available.

## Check email delivery once

1. While signed in as the account that pushes the schedule, open [notification settings](https://github.com/settings/notifications). Under **System → Actions**, select **Email**. Select **Only notify for failed workflows** if you want failure emails only, then save. This preference applies to the account's Actions notifications across repositories.
2. Open the refresh workflow. Choose **Run workflow → main**, select **Test failure email**, and start the run.
3. Expect a red **Refresh and prepare** job at **Test failure notification**, a skipped **Deploy website** job, and a failure email. This deliberate failure occurs before checkout. The public calendar should still open with its previous update time. Check spam and your GitHub notification email address if the message is missing.
4. Leave **Test failure email** unchecked for ordinary manual refreshes. Daily runs bypass the test. Choose **Run workflow** for a fresh run if needed. Re-running the original alert test repeats the intentional failure.

GitHub sends scheduled workflow notifications to the account that last modified the cron expression. If responsibility changes, review notification ownership with the new maintainer.

## Verify the first scheduled refresh

1. After the next 5:17 AM Pacific, open [scheduled runs](https://github.com/Zellet/icc-pulse/actions/workflows/refresh-and-deploy.yml?query=event%3Aschedule). Look for today's **schedule** event on **main**. Allow time for GitHub to start and complete the run.
2. Check that **Refresh and prepare** and **Deploy website** both succeeded. In the run summary, record **Accepted events** and **Last updated**. The count can stay the same after a successful refresh.
3. Reload the public calendar. Its update time should agree with the run summary when converted to Pacific time. For an exact comparison, open the published event data and search for `last_updated`. It should match the summary's UTC timestamp.
4. In your local ICC Pulse folder, run `git pull --ff-only` then `python preview_website.py --check` when you want the updated local copy.

Record the run URL, the published timestamp and the email-test result. This completes the scheduled-refresh check.

## Monitor a late or missing run

GitHub schedules are best effort. If the site still shows yesterday's update by **7:00 AM Pacific**, use the scheduled-runs link above. This is a suggested human check time. A missing workflow run cannot send a failure email. The site displays an age warning using the accepted data's timestamp.

| What you see | What to do |
| --- | --- |
| Today's scheduled run is queued or running | Let it finish and then reload the calendar. |
| No scheduled run today | Open the workflow, check whether it is enabled, verify the cron entry on main, and check [GitHub Status](https://www.githubstatus.com/). If the site needs fresh data, start a normal manual run. Later verify a run with event type schedule. |
| Workflow disabled | In Actions, open the workflow and select **Enable workflow**. GitHub may disable schedules in a public repository after 60 days without repository activity. Run manually to restore freshness. |
| Run failed during collection | Open the first failed step. For a temporary network error, wait for the source to recover and start a new manual run. A rejected refresh preserves the accepted data, timestamp, and published site. |
| Count loss or empty result rejected | Check the public DVC Synch source and the collector log. Follow the existing collector README's manual investigation process. Keep the workflow's count safeguards enabled. |
| Data commit succeeded, deployment failed | Compare the repository and public timestamps. Inspect the deployment error and Pages source. If the uploaded artifact is still available, fix the cause and use **Re-run failed jobs**. If it expired, start a normal manual run to collect, package, and deploy again. |
| Green run, old page on screen | Reload the page to fetch new JSON. Open the public JSON directly and compare its timestamp to the run summary. Check the timezone before treating a displayed time as stale. |

## Recover an earlier published version

For a rejected collection, the existing public site already serves the last successful deployment. Downloading replacement JSON is unnecessary. If **incorrect data was actually published**, pause new runs using **Actions → refresh workflow → … → Disable workflow**, and let any active run finish or cancel it before restoration.

1. In a clean local checkout run `git pull --ff-only`, then `git --no-pager log --oneline -- data/events.json`. Choose a commit whose accepted data you have verified. Each displayed identifier is a commit ID.
2. Inspect the candidate version with `git show COMMIT_ID:data/events.json`. Replace COMMIT_ID with the chosen ID. Press Q if Git opens a viewer. Confirm its window, timestamp and event details.
3. Run these individually, replacing COMMIT_ID on the first line. This creates a new recovery commit and retains the history.

```powershell
git restore --source=COMMIT_ID -- data/events.json
python prepare_pages.py --check
git add -- data/events.json
git commit -m "Restore verified accepted event data"
git push
```

4. To publish that exact file without collecting again, temporarily choose **Settings → Pages → Deploy from a branch → main → / (root) → Save**, as in Stage 2. Wait for the Pages deployment and verify the live JSON timestamp. An older snapshot can show a stale-data warning.
5. Once the underlying issue is fixed, switch Pages back to **GitHub Actions**, enable the refresh workflow again, run it manually with the test box unchecked, and verify the next scheduled run.

If a local pull or push reports conflicting changes, preserve the error and local files for review. A force-push is unnecessary for this recovery.

## GitHub references

- [Schedule syntax, notification ownership, delays and inactivity](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [Managing GitHub Actions notifications](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications)
