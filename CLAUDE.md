# WorkBookmarklets

Browser bookmarklets used by staff inside the Konnect CRM. The main tools are:

- `SLA-Manager.js` runs on Konnect Manager. It lists SLA and Pending leads, exports them for the Lead Checker and imports its results back onto the lead cards.
- `Konnect-Lead-Checker.js` runs on Konnect Live. It takes the pasted batch, finds each lead, classifies its Initial Notes into six tiers and sends the results back.
- `Lead-Reset.js` (Lead Re setup) runs on the agent desktop. It takes the National check's Re setup leads and adds each one back as a new lead, then parks the call; on a customer already open (an inbound, say) it sets a chosen closed lead up again and stops in the new lead. It never presses Finished.
- `Work-Tools.js` is the single bookmark for the three tools above: it loads the right one for the page. It is separate from the Konnect Tools bookmark (Konnect Notes, Reg Check) other agents use.
- `Konnect-Notes.js` runs on the agent desktop. It inserts call-note phrases and has the Booking Builder (Alt+B), which writes the booking block into Call Notes using the wording rules in `Konnect-Booking-Engine.js`.

## How the tools are released

Each bookmarklet in `Bookmarklets.txt` fetches its script from the `main` branch on every click. **`main` is production**: anything on it is live for every user straight away. The tools are built, so minor edits go straight to `main` once the checks below pass.

## Checks before every push

```sh
node tests/run-self-tests.mjs
node --check SLA-Manager.js && node --check Konnect-Lead-Checker.js && node --check Lead-Reset.js
node tests/booking-engine.test.js
node --check Konnect-Notes.js && node --check Konnect-Booking-Engine.js
```

The runner loads both tools with a minimal DOM stub, runs every built-in self-test and checks that the values shared between the files still match. Any failure exits non-zero.

## Rules

- Never commit real customer data. Test fixtures use fictional values only: `07700 900xxx` phone numbers, `example.com` emails, `AB12CDE` style registrations and `00Qa200000EXAMPLE` lead IDs.
- Do not log customer data to the console outside the debug flag.
- Keep the TSV handoff headers in step on both sides. The shared-contract check in the test runner fails if they drift.
- Comments explain non-obvious decisions in a line or two. Change history belongs in Git and Notion.
- Plain English, no em dashes, in UI text and comments.
