# Ops requests

Each file in this directory is the input to one GitHub Actions workflow in
`.github/workflows/ops-*.yml`. Committing a change to `ops/<name>-request.json`
on `master` fires that workflow, which copies `scripts/<name>.mjs` and the
request to the Contabo server over SSH, runs it against **production**, and
then restores the copied files.

## Requests are disarmed by default

A request only runs when it explicitly says so:

```json
{ "armed": true }
```

Every workflow's second step reads `.armed` and skips every later step when it
is not `true`. Nothing reaches the server, and the run goes green with a notice
saying the request was disarmed.

This exists because the trigger is "the file changed", and plenty of things
change a file without anyone intending to run an op: a merge to `master`, a
revert, a rebase, a conflict resolution, a bulk reformat. Before the guard,
each request file sat in the repository holding a real payload from whenever it
was last used — several with `dryRun: false` against named customer orders —
and any of those events would have replayed it against current production data.
A missing `armed` key also reads as disarmed, so an older request file cannot
fire by accident either.

## Running an op

1. Edit the request file: fill in the fields, and set the safety flags you
   actually intend (`dryRun`, `apply`, `force`, `cancelOpen`).
2. Set `"armed": true`.
3. Commit to `master` and watch the run in the Actions tab.
4. **Set `"armed": false` again** and commit. Leaving a request armed means the
   next commit that touches it runs it a second time.

Prefer a dry run first where the script supports one (`"dryRun": true`, or
`"apply": false`), read the output, then arm the real run.

## The two dispatch workflows

`ops-add-serial.yml` and `ops-book-leave.yml` are triggered manually from the
Actions tab with form inputs instead of a committed file. They carry no stored
payload, so they need no guard and have none. They are the better pattern: an
op that gets reused often is worth moving to `workflow_dispatch`, or into a
real admin screen with permissions and an audit trail.

## Housekeeping

`ops-clean-worktree.yml` resets the files these ops copy onto the server, so a
later deploy is not blocked by a dirty worktree. Its `OPS_PATHS` list is
maintained by hand — **add to it whenever a new ops script or request file is
introduced**, or that op will leave the production checkout dirty and the
deploy's dirty-check will refuse to pull.
