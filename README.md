# NWI Summer Tennis local preview

## Start the site on Windows

Open PowerShell in this folder and run:

```powershell
node --env-file-if-exists=.env server.mjs
```

The project uses Node.js 24 or newer and requires no package installation. Open http://127.0.0.1:4173 in your browser. The default mode simulates payments and stores your test changes in demo.sqlite. Press Ctrl+C in PowerShell to stop the server.

## Test the booking and owner flows

1. Open **Private Lessons** and choose **Book Me**. Select three Mondays. With the sample coach, the total is $105. Continue, enter fictional information (for example, Jamie Sample, age 12, Jordan Sample, jordan@example.com, 219-555-0100), accept the booking policy, and choose **Checkout**.
2. Before paying, refresh the lessons page in a second tab and reopen the coach schedule. The selected times should be absent. In the first tab choose **Simulate successful payment**. The confirmation should display all three lessons and the total. The booked slots should stay unavailable after refreshing.
3. Try another slot and choose **Cancel checkout**. Refresh the schedule and verify that it returns. If you abandon the demo checkout instead, the hold expires after three minutes by default. For a faster local test set DEMO_HOLD_SECONDS=10 in .env and restart.
4. Register a fictional player for a camp. The paid count advances by one after payment. At 15 paid registrations the session shows **Full**. A session can temporarily stop taking registrations before reaching 15 paid bookings if the remaining spots are held in checkout.
5. Register for the sample match play event. The event uses the same information form and checkout, with no attendance cap.
6. Open http://127.0.0.1:4173/owner and enter **tennis-demo**. Find the test bookings under **Paid bookings** and download **Export CSV**. A multi-lesson order gets one CSV row per lesson. Test a homepage edit, change a coach price, or add a lesson on a future week. Click **Save changes** and refresh the relevant public page. The dashboard accepts browser-accessible image URLs for the logo and photos.
7. In a private browsing window, visit /owner and /api/admin/export.csv. The first should ask for the owner password and the second should deny access.

The registration form currently asks for player name and age or grade, parent/customer name, email, phone and optional coach notes. Compare these with the fields and any agreements you want to carry over from your current registration form. All sample schedules use the displayed EST time zone. Sample dates, groups and prices are editable.

## Test real Stripe Checkout without charging money

1. Copy .env.example to .env. Set DEMO_MODE=false, a new ADMIN_PASSWORD, and the Stripe sandbox secret key (sk_test_…). Keep the local BASE_URL unless you change the port. Use a Stripe test account and fictional data.
2. In another terminal, authenticate the Stripe CLI and forward events:

```powershell
stripe listen --events checkout.session.completed,checkout.session.expired --forward-to http://127.0.0.1:4173/api/stripe/webhook
```

3. Copy the signing secret the CLI prints into STRIPE_WEBHOOK_SECRET in .env. Restart the site. Stripe test mode uses a separate stripe-test.sqlite database.
4. Book a sample offering and verify Stripe shows the matching total. Use test card 4242 4242 4242 4242 with a future expiry and any valid-format CVC and postal code. Verify the confirmation and dashboard. For a decline try 4000 0000 0000 0002. Cancel to release the hold immediately, or let an abandoned Stripe session expire after approximately 31 minutes.
5. The dashboard is the default owner record. To test owner-only SMS, fill in the four TWILIO/OWNER variables with your Twilio sender and personal destination number. The server checks for new paid orders about every 15 seconds. Messaging is disabled in demo mode. Optional SMS requires an eligible sender and may incur Twilio charges.

See [Stripe testing](https://docs.stripe.com/testing) and [Stripe CLI](https://docs.stripe.com/stripe-cli).

## Preview scope

This build runs on loopback and accepts Stripe test keys only. No deployment or live payments are configured. Keep the SQLite files and .env private. The site stores booking details and payment status, while Stripe handles card entry. The site has no customer refund button. The owner handles emergency exceptions and weather rescheduling directly. If a Stripe creation result cannot be reconciled after a network failure, the server keeps the reservation blocked until it can verify the payment, to prevent duplicate bookings.

## Homepage motion and booking archive

In Owner Dashboard, open **Homepage, photos and policy**. Under **Main homepage visual**, choose **Photo** to use the Coaching photo URL or **Animated tennis rally** to show the court animation. Save changes and refresh the home page. The rally stays still when the visitor has reduced motion enabled on their device.

**Paid Bookings** groups entries by assigned coach. **Archive settings** defaults to 30 days after the scheduled end date (Eastern calendar date). Set another number of days or enter 0 to disable the rule. The dashboard applies the current rule whenever it loads and after settings are saved. **Archived** is collapsible. Bookings stay in the CSV and database, and changing the rule can return them to the active view.

## Coach accounts and calendars

1. In **Owner Dashboard**, add or edit the coach under **Coaches and lesson prices**. Add their assigned times under **Lesson availability**, then click **Save changes**.
2. Open **Coach logins**. Choose a username and a unique password of at least 12 characters, then click **Create login**. Give the coach their credentials privately.
3. Coaches use **Coach sign-in** in the footer or visit http://127.0.0.1:4173/coach. Their dashboard opens to the current month in Eastern time. **Previous month** and **Next month** move through their bookings and owner-assigned lesson availability. The calendar includes confirmed camps and events assigned to that coach as well as private lessons.
4. The owner can set a new password or disable a login. Either action signs out the coach's existing browser sessions. Coaches can see their assigned players and booking details. Parent contact details, payment records, exports, and editing are available through Owner Dashboard.
