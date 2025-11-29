---
"@samsara-dev/appwright": patch
---

Add CI metadata support for BrowserStack build traceability

BrowserStack sessions now automatically include CI context in build names and session names:
- **Buildkite**: Build number, branch, commit from `BUILDKITE_*` env vars
- **GitHub Actions**: Run number, ref name, SHA from `GITHUB_*` env vars  
- **GitLab CI**: Pipeline ID, ref name, commit from `CI_*` env vars

Example build names:
- CI: `driver-performance-tests android #35 (main)`
- Local: `driver-performance-tests android`

Environment variable overrides:
- `BROWSERSTACK_BUILD_NAME`: Override auto-generated build name
- `BROWSERSTACK_SESSION_NAME`: Override auto-generated session name
