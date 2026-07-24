# Nimbus Changelog

Release history for Nimbus. Nimbus is fictional sample data for the RAG
evaluation. This document is the authoritative, most-recent record of changes;
where it disagrees with older docs, the changelog wins.

## v3.4 — 2026-06-20

- The **Team** plan now costs **$59/month**. The previous price of $49/month
  (still quoted in the older Billing FAQ) no longer applies to new invoices.
- Introduced the `nimbus deploy --canary` flag for gradual traffic shifting.

## v3.2 — 2026-03-15

- Added the `ap-southeast` (Singapore) region. Before this release Nimbus
  supported only three regions.
- Log retention on the Free plan was reduced from 7 days to 24 hours.

## v3.0 — 2025-11-01

- Switched normal deploys to blue-green so releases have no downtime.
- Added `nimbus rollback` to revert to the previous successful deployment.

## v2.1 — 2025-07-10

- First public release of the `nimbus` CLI and the `us-east`, `us-west`, and
  `eu-central` regions.
