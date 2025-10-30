---
"@samsara-dev/appwright": minor
---

feat: add Visual Trace Service for automatic screenshot capture during test execution

- Implements automatic screenshot capture with smart defaults (only captures for failed tests)
- Adds screenshot deduplication using SHA-256 hashing
- Supports configurable screenshot limits (default: 50)
- Integrates with Playwright's trace configuration modes
- Works with both test-scoped device and worker-scoped persistentDevice fixtures
- Provides proper test isolation and retry support
- Includes comprehensive unit test coverage