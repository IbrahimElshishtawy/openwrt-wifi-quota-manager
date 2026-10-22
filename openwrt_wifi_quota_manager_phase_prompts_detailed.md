# OpenWrt Wi-Fi Quota Manager

# Detailed Engineering Roadmap, Phase Gates, and AI Execution Prompts

**Document type:** Engineering execution specification\
**Project:** `openwrt-wifi-quota-manager`\
**Controller path previously used:**
`~/wifi-quota-manager/openwrt-controller`\
**Known lab endpoint previously used:** `127.0.0.1:3050`\
**Target use case:** Flutter admin dashboard + OpenWrt controller for
per-device network usage, quotas, and block/unblock.

> This document is a plan and set of execution instructions, not
> evidence that any phase has passed. The AI agent must inspect the
> current repository, preserve existing phase numbering, and prove
> status with current evidence.

------------------------------------------------------------------------

# PART A --- How the AI agent must operate

## A1. Role

Act as the project's senior software engineer, network engineer, test
engineer, and security reviewer. Your responsibility is not merely to
write code. Your responsibility is to establish the current state,
choose the correct next phase, execute that phase safely, and produce
verifiable evidence.

The project already exists. You are **not** starting a new repository or
generating a generic OpenWrt tutorial. Work from the checked-out code
and actual devices available.

## A2. Mandatory discovery sequence

Before editing files, run and inspect the applicable equivalents of:

``` bash
pwd
git status --short --branch
git log -n 12 --oneline --decorate
find . -maxdepth 3 -type f | sort | head -n 400
```

Then inspect: - `README*`, `docs/`, `reports/`, phase tracker,
architecture documents, runbooks, and prior audit reports. -
`package.json`, lockfiles, TypeScript configuration, test configuration,
and build scripts. - Controller source and tests, including API routes,
validation, auth, persistence, quota enforcement, locks, retries,
circuit breaker, router client, nftables integration, nlbwmon parsing,
and restore logic. - `Dockerfile`, compose files, entrypoint, health
checks, volume mounts, user privileges, environment variables, and
`.dockerignore`. - Flutter `pubspec.yaml`, source structure, API
client/repositories, state management, models, local cache, Demo Mode,
and tests. - OpenWrt configuration snippets and scripts, where
present. - CI workflows, lint/static analysis, security/dependency audit
scripts, and test reports. - All Phase 19/20 artifacts and tests,
especially controller crash, distributed failure, recovery, quota
enforcement, and router integration. - Current test outputs, not just
old success statements.

Use `rg`/`grep` and targeted file reads where useful. Do not dump
secrets into reports. If environment files exist, list their names and
redact values.

## A3. Evidence rules

Every claim must be labelled: - **Verified now:** reproduced in this
session with command/output or direct code/test evidence. - **Previously
reported:** found in an older report but not rerun. - **Inferred:**
plausible but not yet proven. - **Blocked:** cannot be verified because
a device, permission, network, credential, or dependency is
unavailable. - **Not tested:** no test was run.

A mock, fixture, unit test, API response, Docker health check, or VM run
is not proof of physical-router end-to-end behavior. A code path that
*should* work is not proof that it works.

Never invent command output, hardware details, router compatibility,
test counts, price quotes, latency numbers, or performance capacity.

## A4. Scope and architecture guardrails

-   Preserve the existing architecture unless the current phase
    demonstrates a concrete defect that requires a documented change.
-   Do not add Kubernetes, Redis, PostgreSQL, Kafka, RabbitMQ, or
    another infrastructure layer as an unrequested redesign.
-   Do not build a second implementation of an existing working module.
-   Do not refactor unrelated files while auditing a specific defect.
-   Do not make destructive network changes, factory-reset/flash a
    router, or disconnect a production device without explicit approval.
-   Do not expose the controller, SSH, LuCI, or management endpoints to
    the public Internet.
-   Do not hardcode secrets or include real credentials, tokens,
    MAC-address inventories, or sensitive network data in reports.
-   Maintain the distinction between **manual blocks** and **quota-owned
    blocks**.
-   Keep infrastructure devices protected from accidental enforcement.
-   With Demo Mode OFF, the UI must not show generated/mock usage as
    live usage. Cached data must be identified as cached/stale when
    appropriate.
-   Do not claim compatibility of a ZTE ZXHN H108N until the exact
    hardware revision is verified from authoritative OpenWrt support
    information. If it cannot run OpenWrt, clearly explain that it may
    remain an upstream modem/router while a separate supported device
    handles enforcement.
-   Never assume that merely connecting a controller to the modem causes
    client traffic to traverse the controller/OpenWrt device.

## A5. Required workflow for every phase

1.  **Discover:** Inspect the repository and phase tracker.
2.  **Baseline:** Run the smallest useful existing test suite before
    edits; capture failures as baseline.
3.  **Scope:** State exactly what is in scope and out of scope.
4.  **Plan:** List files likely to change, risks, commands, and
    acceptance criteria.
5.  **Implement:** Make the smallest safe changes that address confirmed
    issues.
6.  **Verify:** Run focused tests, regression tests, build/type checks,
    static analysis, and integration tests that are possible.
7.  **Review:** Inspect the diff for accidental changes, secrets,
    unrelated refactors, and weakened assertions.
8.  **Document:** Update phase report, tracker, runbook, and known
    limitations as applicable.
9.  **Gate:** Give a truthful phase verdict.
10. **Stop:** Name the next phase, but do not start it in the same phase
    execution.

If discovery reveals the proposed phase is already genuinely complete,
show the evidence and move to the next incomplete phase without
repeating implementation work. If a mandatory dependency is missing, do
all safe work possible and mark the missing verification **BLOCKED**.

## A6. Required first response

Before edits, report: - Repository root, branch, working-tree status,
and recent commits. - Architecture summary based on files actually
found. - Phase tracker/report files found. - Current verified state and
discrepancies with older notes. - The single next phase and why it is
next. - Baseline test commands and results. - Risks and blockers. -
Proposed step-by-step plan and acceptance criteria.

Do not begin coding until this report has been produced.

------------------------------------------------------------------------

# PART B --- Project context and system model

## B1. Functional objective

The system should allow an administrator to: 1. Discover/see network
clients that are visible to the OpenWrt router. 2. View per-device
upload/download/total usage with a clear time period. 3. Assign or edit
a quota for a device. 4. Enforce the quota at the network layer, not
just hide/disable a Flutter button. 5. Distinguish quota-triggered
blocking from an administrator's manual block. 6. Reset a quota period
without incorrectly removing a manual block. 7. Keep state consistent
across controller restarts and router communication failures. 8. See
accurate connection/health status and understandable error states. 9.
Operate the system without accidentally blocking the router, controller,
or other infrastructure. 10. Recover using documented backup/restore
steps.

## B2. Logical architecture to verify

The expected architecture may include these layers, but verify the
actual implementation:

``` text
Flutter Admin Dashboard
  -> authenticated HTTP API / Dio client
  -> Node.js/TypeScript Controller
       -> validation / authorization / business rules
       -> persistence and recovery
       -> router integration client
            -> ubus / supported SSH or existing transport
            -> OpenWrt nlbwmon for usage accounting
            -> nftables/fw4 for enforcement
  -> OpenWrt forwarding/firewall path
  -> real client devices and WAN/upstream network
```

The actual network topology is a separate concern:

``` text
Internet / ISP
   |
upstream modem/router (if used)
   |
OpenWrt enforcement router
   |---- wired client
   |---- Wi-Fi access point / wireless clients
   |---- controller/admin device (according to chosen topology)
```

If the actual arrangement differs, redraw it. Explain where DHCP, DNS,
NAT, Wi-Fi, WAN, and management access occur. If clients bypass the
OpenWrt forwarding path, quotas cannot be claimed to enforce those
clients' traffic.

## B3. Known historical context --- verify before using

Older notes mention: - Phase 19 was reported complete for production
deployment/tooling. - A local controller endpoint of `127.0.0.1:3050`. -
Prior reports of 33/33 automated tests and 26/26 live OpenWrt checks. -
Docker restart, quota sync, and circuit-breaker tests. - `saveAll`,
per-MAC `AsyncLock`, `NftablesClient` caching, event-loop-lag metrics,
restore checksum, quota enforcement, manual-vs-quota block ownership,
and infrastructure-device protection. - Phase 20 work involving
distributed-failure and controller-crash tests.

Treat these as historical leads. Re-run current tests or cite the
specific existing report with date and environment. Do not present an
old result as a fresh result.

------------------------------------------------------------------------

# PART C --- Phase selection and roadmap

The phase numbering below is a proposed mapping for planning only. If
the repository already defines phase names or numbers, keep the
repository's numbering and map each prompt to its equivalent. Never
rename existing phases just to match this document.

  ------------------------------------------------------------------------------------
  Proposed phase          Workstream                         Mandatory exit evidence
  ----------------------- ---------------------------------- -------------------------
  20                      Production architecture and        Current test results,
                          failure-mode audit                 reproduced defects,
                                                             regression tests, risk
                                                             disposition

  21                      Hardware/topology readiness        Exact hardware revision
                                                             and supported status,
                                                             topology, recovery plan

  22                      Physical OpenWrt baseline          Secure baseline
                                                             configuration,
                                                             connectivity checks,
                                                             recovery procedure

  23                      Real traffic accounting            Controlled client traffic
                                                             and before/after counter
                                                             evidence

  24                      Real quota enforcement             Actual packet behavior,
                                                             quota boundary tests,
                                                             correct block ownership

  25                      Controller/router integration and  Route-level
                          security                           auth/validation tests and
                                                             real-router communication
                                                             evidence

  26                      Flutter/controller end-to-end      Real API/UI flow, honest
                          integration                        cache/offline states,
                                                             error handling

  27                      Reliability/performance/recovery   Reproducible load/failure
                                                             data and recovery tests

  28                      Security/privacy release audit     Threat model, findings,
                                                             remediation evidence,
                                                             residual risks

  29                      Release packaging/operations       Repeatable
                                                             install/update/rollback
                                                             and tested backup/restore

  30                      Final acceptance/handover          Acceptance matrix and GO
                                                             / CONDITIONAL GO / NO-GO
                                                             decision
  ------------------------------------------------------------------------------------

### Phase gate rules

-   Do not mark a phase complete while a mandatory exit criterion is
    blocked.
-   A phase may be `PASS WITH KNOWN LIMITATIONS` only if no critical
    correctness/safety criterion is unresolved and each limitation is
    explicit.
-   A phase can be software-complete while hardware verification is
    blocked, but it must not be labelled end-to-end complete.
-   Phase 30 must not call the product fully verified if real traffic
    accounting and real packet enforcement have not been proven on the
    actual supported topology.

------------------------------------------------------------------------

# PART D --- Detailed phase prompts

## PHASE 20 --- Production architecture and failure-mode audit

### Goal

Determine whether controller state, quota enforcement, and recovery
remain correct under concurrency, partial failure, process crash, router
unavailability, and restart. This phase is an audit and targeted
hardening task, not a feature-development phase.

### Required discovery

Inspect: - API routes and request validation. - Quota service and
period-reset logic. - State persistence format and atomicity. - Router
client, ubus/nftables calls, timeout/retry logic, and response
parsing. - Per-MAC locks and batch operations. - Cache keys, expiry, and
invalidation. - Circuit breaker and reconnection logic. - Manual/quota
block ownership representation. - Protected-device list and
validation. - Backup/restore checksums and compatibility handling. -
Shutdown handling, Docker startup/restart, health endpoints, metrics. -
Existing tests and prior phase reports.

### Scenarios to test

1.  Controller crashes before, during, and after a state write.
2.  Controller crashes after persistence but before firewall
    reconciliation.
3.  Firewall operation succeeds but the API response is lost; retry is
    made.
4.  Two simultaneous quota updates for the same MAC.
5.  Simultaneous updates for different MACs.
6.  Duplicate/reordered block and unblock requests.
7.  Router timeout, disconnected router, permission denial, malformed
    response, and partial command failure.
8.  Cache returns stale device/usage data after a successful mutation.
9.  Usage counter resets, is missing, is negative/invalid, or reaches a
    boundary.
10. `usedBytes < quotaBytes`, `usedBytes == quotaBytes`, and
    `usedBytes > quotaBytes`.
11. Manual block remains after quota reset; quota-owned block is removed
    only by the correct reset/unblock behavior.
12. Protected router/controller MAC cannot be blocked through any route.
13. Corrupt, old, incomplete, or checksum-invalid backup is rejected
    safely.
14. Circuit breaker opens and closes under the intended conditions.
15. Docker/controller restart restores state and reconciles firewall
    state.
16. Tests do not pass accidentally because they share mutable state or
    mock the exact behavior being claimed.

### Implementation constraints

-   First run baseline tests.
-   Add tests only for confirmed gaps or fragile behavior.
-   Do not claim exactly-once distributed operations unless the design
    actually guarantees them.
-   Prefer idempotent operations and explicit reconciliation where
    appropriate.
-   Avoid changing persistence schemas without a migration/compatibility
    plan.
-   Do not weaken tests to make them pass.

### Acceptance criteria

-   Every critical state transition has a test or is explicitly listed
    as untested.
-   State/firewall disagreement is detected and handled/documented.
-   Manual and quota block ownership cannot be confused.
-   Recovery failure is visible and does not silently report success.
-   Existing build and regression suite passes, or pre-existing failures
    are documented.
-   No critical/high finding is silently deferred.

### Required outputs

-   Existing phase report updated or new Phase 20 audit report.
-   Finding register: ID, severity, evidence, impact, fix, regression
    test, status.
-   Exact test commands and outcomes.
-   Remaining risks and physical-router tests marked BLOCKED if
    unavailable.
-   Phase verdict and next phase only.

### Copy/paste execution prompt

``` text
Execute the Phase 20 audit using the full Phase 20 specification in this document. Inspect first, report the current state and test baseline before edits, and work only on confirmed issues in the existing architecture. Test crash/restart, partial persistence/firewall failure, concurrency, cache invalidation, quota boundaries, manual-vs-quota block ownership, protected devices, restore integrity, circuit breaker, and router failure. Run existing tests before and after changes. Do not fabricate hardware results, weaken tests, add infrastructure, or start Phase 21. Deliver the finding register, exact commands/results, changed files, risks, phase verdict, and next phase.
```

------------------------------------------------------------------------

## PHASE 21 --- Hardware compatibility and network topology

### Goal

Prove what hardware can actually run the enforcement layer and how real
client traffic will pass through it before spending money or flashing
anything.

### Required discovery

-   Exact model, hardware revision, board ID, chipset, flash, RAM,
    bootloader, and recovery options.
-   Whether the exact revision is officially supported by OpenWrt; cite
    authoritative OpenWrt device/support information.
-   Current ZTE ZXHN H108N role and revision; do not infer compatibility
    from the model family name.
-   Whether a separate OpenWrt-capable device is required.
-   Physical WAN/LAN ports, Wi-Fi/AP plan, DHCP/DNS ownership, upstream
    modem/router mode, and management path.
-   Power supply, Ethernet cables, storage, and other costs, not just
    the bare board/device price.
-   Whether the controller runs on the router, a separate Linux machine,
    or another host.
-   Which clients will be forced through OpenWrt and whether any can
    bypass it.

### Required topology deliverable

Create a diagram showing: - ISP/internet - upstream modem/router if
present - OpenWrt enforcement router - LAN/Wi-Fi access point - test
client - controller/admin device - WAN/LAN interfaces and management
network - where accounting and firewall enforcement occur

Explain NAT, DHCP, DNS, AP/bridge mode, and traffic direction in plain
language. If the upstream ZTE device stays in place, specify its exact
role.

### Safety and budget rules

-   Do not buy or flash before a clear go/no-go decision.
-   Do not claim unsupported hardware can run OpenWrt.
-   Do not invent prices, stock, or compatibility.
-   Separate verified market prices from estimates and list the
    date/source if price research is performed.
-   Include recovery/rollback method and risk of losing access.

### Acceptance criteria

-   Exact hardware revision identified or explicitly unresolved.
-   Compatibility claim backed by authoritative evidence.
-   Traffic path makes it technically possible for the enforcement
    router to see the clients' packets.
-   Required components and hidden costs are listed.
-   Recovery route is documented.
-   Decision is GO, NO-GO, or NEEDS MORE INFORMATION.

### Copy/paste execution prompt

``` text
Execute Phase 21 using the detailed specification in this document. Inspect existing hardware notes and topology before researching or recommending anything. Verify the exact target revision against authoritative OpenWrt support sources. Draw the real proposed topology and prove that client traffic will traverse the enforcement router. Include recovery options and all required components. Do not purchase, flash, reset, or change live network configuration. If exact revision or price cannot be verified, state that clearly. Deliver evidence, diagram, BOM, risks, and go/no-go decision. Do not start Phase 22.
```

------------------------------------------------------------------------

## PHASE 22 --- Safe physical OpenWrt deployment

### Goal

Establish a secure, recoverable OpenWrt baseline on hardware approved by
Phase 21. If the hardware is not available or authorization is absent,
prepare a precise runbook and mark physical operations blocked.

### Preflight checklist

-   Exact device and revision match the approved plan.
-   Correct firmware image and official download source.
-   Image checksum/signature checked where provided.
-   Backup of current configuration and credentials stored securely.
-   Recovery mode, serial/TFTP/recovery utility, or other documented
    rollback path understood.
-   Stable power and wired management access.
-   User explicitly approved flashing/resetting the device.
-   IP/subnet conflict checked against the upstream network.
-   A way to regain management access if DHCP or firewall changes fail.

### Baseline verification

-   Firmware identity/version and device identity.
-   LAN interface, link state, address, DHCP lease, and gateway.
-   DNS resolution and routing tested independently.
-   WAN/uplink status and controlled Internet access.
-   Firewall zones, forwarding, NAT, and management exposure.
-   SSH/LuCI access restricted to the intended management network.
-   Default credentials removed or changed; unnecessary services
    disabled.
-   Time synchronization and package/service status.
-   The test client is actually routed through the OpenWrt device.
-   Sanitized configuration backup created and recovery procedure
    rehearsed if safe.

### Acceptance criteria

-   The device boots and remains manageable after reboot.
-   LAN/DHCP/DNS/WAN tests are individually recorded.
-   No management service is unintentionally public.
-   Recovery steps are available and understandable.
-   Traffic path is demonstrated rather than assumed.
-   Every unperformed physical check is marked BLOCKED/NOT RUN.

### Copy/paste execution prompt

``` text
Execute Phase 22 only if Phase 21 approved the exact hardware and the user authorized physical changes. Follow the preflight checklist. Never flash/reset a device without explicit approval and a recovery plan. Configure and verify a secure OpenWrt baseline; test LAN, DHCP, DNS, routing, WAN, management exposure, reboot, and the intended client traffic path separately. Capture sanitized evidence, configuration backup, and rollback instructions. If device/approval is unavailable, write the runbook but mark physical deployment BLOCKED. Do not start Phase 23.
```

------------------------------------------------------------------------

## PHASE 23 --- Real traffic accounting and nlbwmon validation

### Goal

Prove that the accounting source records real client traffic correctly
and that the controller's parser, time period, device mapping, and
displayed values are accurate enough for the product's intended use.

### Required discovery

-   Installed OpenWrt version and nlbwmon package/service status.
-   Actual ubus method/output format and configuration.
-   Accounting interval, database/persistence location, period/timezone
    behavior, and reset behavior.
-   Controller parser, normalized data model, units, rounding, and error
    handling.
-   MAC/IP mapping and behavior across DHCP renewals.
-   IPv4/IPv6 support and limitations.
-   How the app differentiates current, stale, unavailable, and cached
    data.

### Real-client test procedure

1.  Record exact time, client MAC/IP, current counters, and accounting
    period.
2.  Ensure the test client is connected through the intended OpenWrt
    path.
3.  Generate a controlled, safe download workload from an approved
    source.
4.  Wait for the documented accounting interval, then collect counters
    again.
5.  Repeat with upload traffic.
6.  Repeat for a second client and confirm attribution does not cross
    devices.
7.  Disconnect/reconnect and renew DHCP to test identity mapping.
8.  Restart the accounting service/controller and, if approved, reboot
    the router; document persistence/reset effects.
9.  Compare router counters, controller API, and Flutter display.
10. Record expected measurement discrepancies due to protocol overhead,
    buffering, timing, and counter semantics.

### Required data table

For each run, capture: - Run ID/date and environment - Client identity
(redact where reports leave the private lab) - Starting counter - Ending
counter - Counter delta - Test workload size/method -
Controller-reported value - UI-reported value - Difference/tolerance -
Result and explanation

### Acceptance criteria

-   Real traffic is observed on the correct device.
-   Two clients are not incorrectly merged or swapped.
-   Units and time periods are consistent from router to UI.
-   Missing/stale data is not displayed as current live usage.
-   Parser tests use sanitized actual output fixtures.
-   Service/controller restart effects are documented.
-   If no physical router/client exists, software parser tests may pass
    but real accounting remains BLOCKED.

### Copy/paste execution prompt

``` text
Execute Phase 23 from this document. Inspect current nlbwmon/ubus configuration and parser before changing code. Run a controlled real-client upload/download test through the approved OpenWrt traffic path, collect before/after counters, test two clients, and compare router, controller, and Flutter values. Document accounting intervals, periods, units, reboot/service-restart effects, and tolerance. Use sanitized real output as fixtures. Never fabricate router output or claim physical validation from mocks/VMs. If hardware is unavailable, complete safe software tests and mark real accounting BLOCKED. Do not start Phase 24.
```

------------------------------------------------------------------------

## PHASE 24 --- Real quota enforcement, firewall behavior, and block ownership

### Goal

Prove that quotas alter real packet forwarding at the quota boundary
while preserving manual administrator decisions and protecting
infrastructure devices.

### Preflight safety

-   Use a dedicated, non-critical test client.
-   Confirm an independent management path.
-   Confirm the router/controller MACs and infrastructure devices are
    protected.
-   Capture current relevant nftables/fw4 state.
-   Know how to remove only the test rules and restore the baseline.
-   Never flush the complete firewall to simplify testing.
-   Do not perform destructive tests on a production/home network
    without approval.

### Required test matrix

-   Usage below quota.
-   Usage exactly at quota.
-   Usage above quota.
-   Zero quota and invalid/negative/overflow quota input.
-   Quota increased/decreased while client is active.
-   Repeated enforcement calls and duplicate API requests.
-   Manual block → quota reset; manual block must remain.
-   Quota-owned block → quota reset/unblock; only the intended
    quota-owned block is removed.
-   Protected router/controller/infrastructure device cannot be blocked.
-   Missing/stale accounting data and router unavailable.
-   nftables operation failure, timeout, partial application, and
    reconciliation.
-   Controller restart and router restart.
-   Backup restore and subsequent enforcement.
-   Client reconnect and IP change where relevant.

### Evidence required

-   Before/after quota state.
-   Before/after relevant nftables/fw4 rules.
-   Controller API result.
-   Actual test-client connectivity/packet behavior.
-   Logs with secrets redacted.
-   Restart/recovery result.
-   Test case ID and outcome.

A rule existing in nftables is not enough by itself: verify packet
behavior from the test client. An API success response is not enough by
itself: verify the router actually applied the intended state.

### Acceptance criteria

-   Quota enforcement occurs at the documented boundary.
-   Repeated operations are safe and idempotent.
-   Manual block ownership is preserved.
-   Infrastructure protection works across all entry points.
-   Failures are surfaced honestly and reconciled safely.
-   Real packet behavior is proven or the physical portion remains
    BLOCKED.

### Copy/paste execution prompt

``` text
Execute Phase 24 only after Phase 23 has enough evidence to trust the accounting source. Use a dedicated test client and preserve management access. Run the full quota/block ownership test matrix from this document. Verify actual packet behavior, not only API responses or firewall rule presence. Do not flush all firewall rules. Fix confirmed defects with regression tests. Separate real-router evidence from mocks and VM tests. If real hardware/client is unavailable, mark enforcement BLOCKED. Do not start Phase 25.
```

------------------------------------------------------------------------

## PHASE 25 --- Controller ↔ OpenWrt integration and security

### Goal

Prove the controller communicates safely and reliably with the actual
router using the existing architecture and transport.

### Required inspection

-   Every API route and state-changing operation.
-   Authentication/authorization middleware and route coverage.
-   Input schemas for MAC, quota, batch payloads, IDs, and query
    parameters.
-   Router transport/client and ubus/SSH command construction.
-   Credentials/configuration loading and secret redaction.
-   Network bind address, firewall rules, CORS, rate limits, and health
    endpoints.
-   Timeouts, retries, cancellation, circuit breaker, duplicate
    requests, and recovery.
-   Persistence and reconciliation after router/controller
    disconnection.
-   API response/error contract used by Flutter.

### Required tests

-   Unauthenticated request to every protected route.
-   Unauthorized role/scope, if roles exist.
-   Invalid MAC, malformed body, negative/overflow quota, oversized
    batch, and unexpected types.
-   Router unavailable, timeout, permission denied, malformed output,
    and recovery.
-   Input strings that could attempt command injection; confirm
    parameterization/validation prevents execution.
-   Repeated request after response loss.
-   Secrets do not appear in logs, stack traces, metrics, or API
    responses.
-   Localhost binding is not misrepresented as LAN reachability.
-   Health/readiness endpoints reveal no credentials or excessive
    internals.
-   Actual router read/write integration where available.

### Acceptance criteria

-   Every mutating route has appropriate authorization and validation.
-   Errors are safe, useful, and do not leak secrets.
-   Network exposure matches documented topology.
-   Retry behavior does not create unsafe duplicate state changes.
-   Real-router integration is separated from unit/mocked evidence.
-   API changes remain backward-compatible or include a documented
    migration.

### Copy/paste execution prompt

``` text
Execute Phase 25 using this detailed specification. Trace a state-changing request from API authentication and validation through the existing router client to the actual OpenWrt operation and persisted result. Audit all routes, command construction, credentials, timeout/retry/circuit-breaker behavior, error redaction, network exposure, and recovery. Add targeted tests for confirmed gaps. Do not replace the architecture without evidence. Report route coverage, security matrix, test results, and any real-router checks that are blocked. Do not start Phase 26.
```

------------------------------------------------------------------------

## PHASE 26 --- Flutter/controller integration and truthful UI state

### Goal

Verify that the Flutter app uses the real controller contract correctly
and that the UI never misrepresents demo, cached, stale, unavailable, or
failed state as live success.

### Required inspection

-   `pubspec.yaml`, app entry point, routing, models, repositories, Dio
    configuration/interceptors.
-   Riverpod providers/notifiers and state lifecycle.
-   Auth/session/token handling.
-   API base URL and device/emulator networking.
-   Device list, usage display, quota editor, block/unblock controls,
    refresh behavior.
-   Isar/SharedPreferences cache and Demo Mode boundaries.
-   Loading, empty, offline, unauthorized, timeout, malformed response,
    and partial failure states.
-   Tests for models, repository, providers/notifiers, and widgets.

### Required scenarios

1.  Controller reachable and returning real devices.
2.  Real traffic changes usage; UI updates after documented refresh.
3.  Quota update succeeds and is reflected after server confirmation.
4.  Block/unblock displays success only after confirmed backend/router
    state.
5.  Controller unavailable: clear error and no fake live data.
6.  Cached result shown with explicit stale/cached indication.
7.  Demo Mode ON and OFF are clearly distinct.
8.  Expired/invalid token produces a safe auth flow.
9.  Invalid server response is handled without crash.
10. Concurrent refresh and mutation do not overwrite newer state.
11. API URL works from the actual device/emulator; do not assume
    `127.0.0.1` refers to the development host.
12. Batch operation partial failure is represented honestly.

### Acceptance criteria

-   `flutter analyze` passes or pre-existing failures are documented.
-   Relevant Flutter tests pass.
-   API contract mismatches are fixed or documented.
-   Demo Mode OFF never silently falls back to generated live-looking
    data.
-   Offline/cache state is honest and recoverable.
-   Real E2E result is claimed only after the actual router/client path
    is tested.

### Copy/paste execution prompt

``` text
Execute Phase 26. Inspect the current Flutter implementation and controller API contract before editing. Trace data from router to controller to repository/provider to screen. Test loading, empty, live, stale-cache, offline, auth failure, timeout, malformed response, mutation success/failure, and refresh races. Ensure Demo Mode OFF never silently shows fake usage as live. Verify base URL from the actual phone/emulator. Run flutter analyze and relevant tests, then real E2E tests if hardware is available. Report actual versus mocked coverage and do not start Phase 27.
```

------------------------------------------------------------------------

## PHASE 27 --- Reliability, measured performance, and recovery

### Goal

Measure the current system under representative loads and failures
without promising unsupported capacity.

### Baseline to capture

-   CPU, memory, open handles, event-loop lag, request latency, request
    rate, error rate.
-   Router response latency and failure rate.
-   Number of devices and polling interval.
-   Controller host, OS, Node version, Docker configuration, OpenWrt
    version, and test topology.
-   Test duration, workload, concurrency, and source of test traffic.

### Required scenarios

-   Normal polling and device-list requests.
-   Concurrent requests for same and distinct MACs.
-   Batch quota changes.
-   Router latency/timeouts and recovery.
-   Controller restart during a state transition.
-   Docker restart and persistence restoration.
-   Short soak test and memory-growth observation.
-   Bounded request load with latency/error/resource tracking.
-   Flutter offline/reconnect and repeated refresh.
-   Retry amplification and circuit-breaker recovery.
-   OpenWrt device resource limitations.

### Measurement rules

-   Define pass/fail thresholds before load tests.
-   Use safe, bounded loads; do not flood public services or an ISP.
-   Report p50/p95/p99 only when sample size and measurement method
    justify them.
-   Record exact commands and raw/summary outputs.
-   Do not promise 500 simultaneous users or any capacity without
    representative evidence.
-   Separate controller API load capacity from the number of Wi-Fi
    clients the router can enforce.
-   Do not introduce a new load-testing infrastructure unless current
    tools cannot meet a specific requirement.

### Acceptance criteria

-   A repeatable test procedure exists.
-   Baseline and results include environment and workload.
-   Failure recovery and state correctness are verified.
-   Bottlenecks are evidence-based.
-   Supported-use statement is conservative and tied to measurements.

### Copy/paste execution prompt

``` text
Execute Phase 27. Establish baseline metrics and define acceptance thresholds before testing. Run bounded normal-load, concurrency, router-failure, restart/recovery, and soak scenarios using the existing tooling. Record environment, workload, sample size, p50/p95/p99 where valid, errors, resource use, and exact commands. Do not invent capacity claims or add infrastructure without a demonstrated need. Fix only confirmed phase-relevant defects, rerun regression tests, and do not start Phase 28.
```

------------------------------------------------------------------------

## PHASE 28 --- Security and privacy release audit

### Goal

Review the complete trust boundary from Flutter through the controller
and router, identify concrete risks, and verify fixes.

### Threat model

Document: - Assets: admin credentials, tokens, router credentials, usage
history, MAC addresses, quota settings, and configuration backups. -
Actors: local admin, untrusted LAN client, compromised Flutter device,
malicious API caller, compromised dependency, and unauthorized network
peer. - Trust boundaries: phone/emulator, LAN, controller
host/container, router management plane, upstream network, and backup
storage. - Security goals: only authorized administration, no secret
leakage, no accidental infrastructure lockout, and no false state
reporting.

### Audit areas

-   Authentication and authorization coverage.
-   Token storage and expiration.
-   Secret loading, rotation, redaction, and accidental source-control
    inclusion.
-   API binding, firewall exposure, CORS, rate limiting, and
    management-plane separation.
-   Input validation and command injection prevention.
-   Unsafe file/path operations and restore validation.
-   Dependency vulnerability audit and runtime support.
-   Docker privileges, mounts, writable directories, and image
    management.
-   Logs, errors, metrics, crash data, backups, and test fixtures.
-   MAC/usage data retention, export, and deletion expectations.
-   Flutter build secrets and configuration.
-   Default accounts, unnecessary services, and recovery access.

### Acceptance criteria

-   Findings have severity, evidence, impact, remediation, retest, and
    status.
-   Confirmed vulnerabilities are separated from theoretical concerns.
-   Critical/high findings are fixed or release is NO-GO, unless the
    project owner explicitly accepts a documented non-exploitable
    limitation.
-   Dependency audit success is not presented as proof that the whole
    product is secure.
-   Only authorized owned/local targets are tested.

### Copy/paste execution prompt

``` text
Execute Phase 28 as a focused local security/privacy audit. Build a threat model from the actual architecture and inspect auth, authorization, secrets, network exposure, input validation, command construction, dependencies, Docker privileges, logs, backups, and device-usage privacy. Run available static/dependency/security tests against owned project assets only. Rank findings, reproduce confirmed issues, fix only scoped defects, retest, and document residual risk. Do not claim complete security from a clean dependency scan. Do not start Phase 29.
```

------------------------------------------------------------------------

## PHASE 29 --- Release packaging, deployment, backup/restore, and operations

### Goal

Make installation, update, recovery, and troubleshooting repeatable for
the actual existing architecture.

### Required deliverables

-   Release/version naming and change log.
-   Repeatable controller build/image with dependency management.
-   `.env.example` containing placeholders only.
-   Startup configuration validation for required settings.
-   Appropriate health/readiness checks.
-   Install, upgrade, rollback, and uninstall instructions.
-   State backup, retention, integrity validation, and restore
    rehearsal.
-   OpenWrt configuration backup and recovery instructions.
-   Log retention/rotation and secret redaction.
-   Flutter build and environment configuration instructions.
-   Troubleshooting for DNS, routing, ubus, nlbwmon, nftables, API auth,
    stale data, and router/controller disconnects.
-   Supported hardware/software matrix and known limitations.

### Validation

-   Test the runbook from a clean/disposable environment where possible.
-   Test restore, not just backup creation.
-   Confirm no real secret is in the repo or artifact.
-   Verify startup fails safely when required production configuration
    is invalid.
-   Confirm rollback restores a known working version/state.
-   Label every step `TESTED`, `PARTIALLY TESTED`, or `NOT TESTED`.

### Acceptance criteria

-   A new operator can follow the documentation without relying on
    undocumented chat history.
-   Backup can be restored and validated.
-   Rollback is documented and tested where safe.
-   Artifacts and config examples are free of secrets.
-   Production readiness is not inferred solely from a successful
    container startup.

### Copy/paste execution prompt

``` text
Execute Phase 29. Inspect current packaging, Docker/compose, config, state format, OpenWrt setup, Flutter build process, and runbooks. Create or update versioned release notes, safe config examples, install/update/rollback, backup/restore, logging, troubleshooting, and supported-hardware documentation. Use the current architecture; do not add new infrastructure. Test the runbook and perform a restore rehearsal in a safe environment if possible. Label untested actions honestly. Do not start Phase 30.
```

------------------------------------------------------------------------

## PHASE 30 --- Final acceptance and handover

### Goal

Make a release decision using a traceable matrix of requirements and
evidence, not optimism or an aggregate test count.

### Mandatory acceptance criteria

1.  Exact supported hardware and topology documented.
2.  OpenWrt boot, management access, LAN, DHCP, DNS, and uplink
    verified.
3.  Real client traffic shown to traverse the enforcement router.
4.  Usage accounting and client attribution verified with controlled
    traffic.
5.  Quota boundaries and actual packet enforcement verified.
6.  Manual and quota-owned block semantics verified.
7.  Infrastructure devices protected.
8.  Controller authentication, validation, safe errors, persistence, and
    recovery verified.
9.  Flutter live data, cache/offline labels, refresh, and error handling
    verified.
10. Restart, backup, and restore verified.
11. Security and dependency checks completed.
12. Install/update/rollback/troubleshooting documentation ready.

### Evidence levels

Label each result as one of: - Unit test - Mock/fake integration test -
VM/emulator test - Local controller/Docker test - Real OpenWrt device
test - Real client traffic test - Full physical end-to-end test

These evidence levels are not interchangeable.

### Release decision

-   **GO:** Every mandatory acceptance criterion passes with suitable
    evidence.
-   **CONDITIONAL GO:** Mandatory safety/correctness criteria pass; only
    explicit, accepted non-critical limitations remain.
-   **NO-GO:** A mandatory criterion fails or a critical verification
    remains blocked.

### Copy/paste execution prompt

``` text
Execute Phase 30 as final acceptance only; do not add features. Build a requirement-to-evidence matrix for every mandatory criterion in this document. For each, show PASS/FAIL/BLOCKED/NOT RUN, evidence, command/method, environment/date, and limitation. Separate unit, mock, VM, real-router, real-client, and full E2E evidence. If traffic path, accounting, or actual quota packet enforcement has not been physically verified, do not declare the product fully end-to-end verified. Issue GO, CONDITIONAL GO, or NO-GO with reasons. Deliver the handover, known issues, operating docs, and prioritized next steps. Do not commit/publish without authorization.
```

------------------------------------------------------------------------

# PART E --- Master prompt for every new AI coding session

Copy this into your AI coding agent at the beginning of a session:

``` text
You are continuing my existing OpenWrt Wi-Fi Quota Manager project. Read `openwrt_wifi_quota_manager_phase_prompts_detailed.md` first and follow its engineering rules.

Do not assume prior chat summaries, phase numbers, or old test counts are current. Inspect the repository, Git status/history, phase tracker, reports, code, tests, Docker config, Flutter code, and available router integration. Establish a baseline before edits.

First output a Current State & Next Phase Report:
1. Current branch and working-tree state.
2. What is genuinely verified complete and the evidence for it.
3. What is in progress, blocked, unverified, or contradicted by current code/tests.
4. The single next phase and why it is next.
5. The exact baseline commands and their results.
6. A scoped execution plan and acceptance criteria.

Then execute only that phase using its detailed prompt in the document. Do not begin the next phase in the same run. Preserve existing architecture and working behavior. Do not add Kubernetes, Redis, PostgreSQL, Kafka, RabbitMQ, or unrequested infrastructure. Do not perform destructive router changes or flash hardware without explicit authorization. Do not claim physical-router, real-traffic, or end-to-end success unless it was actually tested.

After work, run relevant regression tests and checks. Inspect the diff. Update the phase report/tracker and runbook. Report changed files, commands/results, PASS/FAIL/BLOCKED/NOT RUN, remaining risks, and the exact next phase. Never invent evidence or hide a failed test.
```

------------------------------------------------------------------------

# PART F --- Required phase completion report

Use this structure for every phase:

``` text
# Phase <N> — Completion Report

## Decision
PASS / PASS WITH KNOWN LIMITATIONS / BLOCKED / NO-GO

## Objective and scope
What this phase was required to prove and what was out of scope.

## Initial baseline
- Branch / git status:
- Relevant recent commit:
- Baseline commands:
- Baseline results:
- Existing failures:

## Evidence status
- VERIFIED NOW:
- PREVIOUSLY REPORTED:
- INFERRED:
- BLOCKED:
- NOT TESTED:

## Findings
| ID | Severity | Evidence | Impact | Fix / decision | Retest |
|----|----------|----------|--------|----------------|--------|

## Changes
| File | Change | Why | Risk |
|------|--------|-----|------|

## Tests and commands
| Check | Exact command/method | Result | Evidence |
|-------|----------------------|--------|----------|

## Physical hardware / real traffic
- Exact router model/revision:
- OpenWrt version:
- Test client:
- Traffic path proven:
- Usage accounting proven:
- Actual packet enforcement proven:
- If not, why blocked:

## Residual risks
Ranked by severity with impact and owner/action.

## Documentation updated
List exact paths.

## Next phase
Exactly one next phase, why it is next, and what prerequisite it needs.
```

------------------------------------------------------------------------

# PART G --- Troubleshooting the AI agent's phase decisions

If the agent says a phase is complete, ask it to provide the exact
source files, test commands, and evidence supporting each exit
criterion. If it cannot, status must be `UNVERIFIED`.

If the agent tries to start several phases at once, stop it and require
a single-phase scope.

If the agent wants to replace the architecture, require: 1. the concrete
defect, 2. reproducible evidence, 3. a minimal alternative, 4.
migration/rollback plan, 5. explicit approval before a broad change.

If the agent reports a passing mocked test as proof of real router
behavior, require a real-device test or mark the hardware criterion
`BLOCKED`.

If the ZTE hardware is unsupported, do not keep trying random firmware
images. Revisit Phase 21 and select a verified supported topology.

If real traffic is not measured by the OpenWrt device, do not continue
to declare quota enforcement complete. Fix the topology first.

------------------------------------------------------------------------

# PART H --- Project-specific non-negotiable acceptance principle

The central risk is not whether the app builds or whether the controller
responds on localhost. The core product claim is:

**A real client is forced through a supported OpenWrt device; usage is
attributed to the correct client; the configured quota is enforced on
real packets; manual blocks and quota-owned blocks remain distinct; and
the system recovers honestly after failure.**

Until those elements are verified on the actual target topology,
describe the project as software-tested or lab-tested, not fully
end-to-end verified.
