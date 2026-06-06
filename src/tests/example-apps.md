# Radix — the 40 example apps

> The representative set we used to size the surface area. Two batches: the first skews toward
> visible consumer software (screens on databases), the second toward what's _actually_ built
> every day (tooling, glue, services, jobs). Each note says what the app mainly _stresses_ in the
> architecture — i.e. why it's in the set and what it would force us to get right.
>
> Cross-references: shell / spine / driver axes are defined in `notes.md` §4. The two
> foundations (data + world-simulator) are §3.

---

## Batch 1 — consumer / frontend-leaning apps

1. **Team task board (Trello-like).** Drag-drop, realtime multi-user, optimistic updates. Stresses
   the CRUD spine plus simulated collaborators and websocket-style sync — a first taste of the
   world-simulator standing in for "other people."

2. **Food delivery app.** The canonical multi-system app: data (restaurants/menus/orders), payments
   off the shelf, a moving-driver world-actor, push notifications via `host`, phone shell. Stresses
   the data + world foundations running at once. (See the full walkthrough doc.)

3. **Personal finance dashboard.** Read-heavy analytics over a rich seeded dataset; lots of derived
   and aggregated values. Stresses seed-data realism and the query/aggregation side of the data
   foundation more than writes.

4. **Fitness tracker.** Accelerometer, heart rate, GPS route, HealthKit. Stresses the sensor
   primitive — believable readings with lag and glitches — as the whole point of the app.

5. **Multiplayer trivia game.** Matchmaking, simulated opponents, a game-state server, timers.
   Stresses ephemeral state, the clock, and simulated opponents; sits between reactive and
   frame-loop.

6. **E-commerce storefront with admin.** Two interfaces (shopper, merchant) over one schema; payment,
   inventory, shipping, fulfilment. Stresses role separation and CRUD depth on a shared data model.

7. **Chat / messaging app.** Simulated correspondents, typing indicators, read receipts, presence,
   media upload. Stresses the world-simulator as a believable conversational partner + realtime feel.

8. **IoT smart-home controller.** A fleet of stateful devices (lights, thermostat, locks) with
   latency and occasional failure. Stresses device-fleet simulation — many small state machines
   evolving over time.

9. **Booking / reservation system.** Availability calendar, double-booking prevention, confirmation
   email/SMS, deposit. Stresses constraint-satisfaction over time slots and the "confirm spawns a
   process" pattern.

10. **Social feed with infinite scroll.** A content-generating backend, ranking, likes/comments from
    simulated users, pagination at volume. Stresses generated-content-at-scale and seeded variety.

11. **Collaborative document editor (Google-Docs-lite).** Concurrent editors, cursor presence,
    conflict resolution. Stresses the graceful-degradation path — fake a scripted second cursor,
    honestly stub real OT/CRDT merging. A deliberate hard case.

12. **Habit / mood journaling app.** Mostly local data, charts over time, reminders. Stresses the
    _simple_ baseline — confirms the system isn't only good at complex apps, and exercises clock-based
    reminders.

13. **Ride-share driver app.** Simulated rider demand, incoming requests, navigation, earnings.
    Stresses the world-simulator generating a whole market on the other side; event-driven.

14. **Admin / internal CRUD dashboard.** Tables, filters, bulk actions, role-based permissions, audit
    log. Stresses the unglamorous 60% of real software — must be fast and clean here, not just on
    flashy apps.

15. **Streaming media app (music/video).** Catalogue, a simulated player, recommendations, paywall,
    offline downloads. Stresses a non-CRUD interaction model and the TV / 10-foot runtime variant of
    the viewport shell.

16. **Maps-based discovery app (find nearby X).** Geosearch, map rendering, place data, reviews,
    directions. Stresses geospatial query + map UI, and reuses the maps-stub pattern from app 2.

17. **DevOps / CI-CD monitor (kanban-style).** Pipelines emitting status events over time, streaming
    logs, alerts. Stresses live-updating operational dashboards — the world-simulator in ops clothing.

18. **Multi-step onboarding / KYC flow.** Identity verification, document upload + OCR, address check,
    a delayed backend approval. Stresses wizards, async external decisions, saved partial progress,
    and "submit spawns an approval actor."

19. **Calendar / scheduling app with invites.** Others' availability, email invites, timezones,
    recurring events, conflict detection. Stresses a deceptively hard data model (recurrence,
    timezones) more than infrastructure.

20. **Point-of-sale / kiosk app.** Barcode scanner, card reader, receipt printer, cash drawer,
    offline-first sync. Stresses hardware peripherals + offline-first + a touch-first kiosk form
    factor.

---

## Batch 2 — tooling, services, glue (what's actually built daily)

21. **CLI tool (scaffolder / linter / deploy).** Args, flags, stdin/stdout/stderr, exit codes, piping.
    Stresses the text-stream shell and the pure-compute spine — no screen, no database.

22. **Git-style TUI (lazygit / k9s).** Full-screen character grid, panes, keyboard nav, live refresh.
    Stresses the full-screen-text (TUI) shell — a text _interface_, not just line-by-line output.

23. **Native macOS menu-bar utility.** No main window; tray dropdown, global hotkeys, launch-at-login,
    OS notifications. Stresses the embedded-in-host shell where the OS chrome _is_ the app. (High-risk
    shell.)

24. **Windows system-tray sync client (Dropbox-style).** Background process, file-watching, conflict
    resolution, network flakiness. Stresses faking a filesystem watcher + remote sync server +
    embedded-in-host shell.

25. **VS Code / editor extension.** Runs inside a host app's extension API. Stresses faking _the
    editor host itself_ (open files, cursor, commands, the extension API). The hardest mock category:
    an app inside an app.

26. **Browser extension.** Popup + content script + background worker. Stresses multi-context faking
    (injected pages, browser storage, tab events, cross-context messaging) + embedded-in-host shell.

27. **REST / GraphQL API service (backend only).** The deliverable is endpoints + behaviour, no UI.
    Stresses the headless shell — "running it" means firing requests at a console and seeing
    responses. Forces the question of prototyping a thing whose whole interface is HTTP.

28. **Webhook processor / integration glue (Zapier-shaped).** Receive event from A, transform, call B;
    retries, idempotency. Stresses the reactive spine + faking _both_ external services + the event
    source. Enormous in real-world volume.

29. **Background job / cron worker.** Scheduled or queue-driven, no human in the loop. Stresses the
    clock-advanced driver — "running it" means advancing simulated time and watching jobs fire.

30. **Data pipeline / ETL job.** Read source → transform → load to sink; failures, partial batches.
    Stresses pure-compute over volume + the headless shell; output is data + run logs, not a screen.

31. **Discord / Slack bot.** Event-driven over a chat platform; slash commands, simulated users.
    Stresses the conversational shell as a _fake chat client_ and the reactive spine.

32. **2D game (canvas/engine-style).** Game loop, sprites, input, physics, state machine; no DB.
    Stresses the frame-loop spine — the 60fps tick nothing else here uses.

33. **Embedded / microcontroller firmware.** Read sensor → decide → drive actuator, tight loop.
    Stresses frame-loop + headless + a _simulated physical environment to react to_. The purest
    "simulate the world on the other side" case, with no UI to hide behind.

34. **Desktop creative tool (paint / audio / level editor).** Heavy canvas interaction, tool palettes,
    undo/redo, document model, open/save. Stresses the document-with-undo spine; basically no backend.

35. **Local-first / P2P sync app.** On-device data, peer-to-peer / CRDT sync, fully offline-capable.
    Stresses an architecture with _no central server_, faked peers, and conflict merges — another
    graceful-degradation case alongside app 11.

36. **Database admin / query tool (TablePlus / pgAdmin-shaped).** Connect, browse schema, write
    queries, edit rows. Stresses a power-tool UI over a faked data source — a CRUD spine turned
    inside-out (the schema is the subject, not the substrate).

37. **Observability / log-tailing dashboard.** Streaming logs, live metric graphs, alert rules,
    time-series queries. Stresses the world-simulator emitting telemetry over time (the ops twin of
    app 17).

38. **Infra-as-code / config tool (Terraform-shaped).** Declare desired state → diff vs current →
    apply. Stresses the declarative-state spine and the diff/apply lifecycle — the interesting part
    isn't a UI.

39. **Voice / conversational interface (Alexa-skill / IVR).** No screen; turns of speech, intents,
    slots, dialog state. Stresses the conversational shell in its voice form — faked STT/TTS and
    spoken turns.

40. **Compiler / interpreter / DSL playground.** Source → parse → evaluate → output, with errors and
    a REPL. Stresses pure-compute with _almost nothing to mock_ — a useful test of what the system
    does when it's mostly real logic.

---

## What the set is designed to cover

Across the 40, the axes (notes §4) are exercised roughly as: **viewport** ~24, with the rest split
across **text-stream, full-screen-text, conversational, headless, embedded-in-host**; spines split
**CRUD-schema** (~21) and **reactive-handler** (~13, the quiet giant) as the two majorities, with
**document, frame-loop, pure-compute, declarative-state** as recurring lower-frequency patterns;
drivers split across **human-realtime, event-injected, clock-advanced, pipeline-run**.

Deliberate inclusions worth remembering: the _simple_ apps (12) to prove the system isn't
complexity-only; the _hard-fallback_ apps (11, 35) to stress graceful degradation on purpose; the
_almost-nothing-to-mock_ app (40) to test the opposite extreme; and the _embedded-in-host_ cluster
(23–26) which is the highest-risk shell and the likely v1 deferral.
