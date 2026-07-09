# Nimbus Plan Quotas

Per-plan resource limits for Nimbus. Nimbus is fictional sample data for the RAG
evaluation. Prices are covered in the Billing FAQ and Changelog, not here.

## Limits by plan

| Plan       | Concurrent deploys | Build minutes / month | Log retention | API rate limit |
| ---------- | ------------------ | --------------------- | ------------- | -------------- |
| Free       | 1                  | 200                   | 24 hours      | 60 req/min     |
| Team       | 5                  | 2,000                 | 30 days       | 600 req/min    |
| Enterprise | 25                 | 10,000                | 365 days      | 6,000 req/min  |

## How build minutes are counted

A build minute is one wall-clock minute of the build phase, rounded up per
deploy. The upload and activate phases do not count against build minutes.

When a plan exhausts its monthly build minutes, further deploys are queued until
the next cycle. Contact sales to raise a limit on the Enterprise plan.
