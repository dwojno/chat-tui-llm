# Nimbus Deployment Guide

This guide covers how and where Nimbus deploys applications. Nimbus is fictional
sample data for the RAG evaluation.

## Supported regions

Nimbus can deploy to four regions. Choose the one closest to your users to
minimize latency:

- `us-east` — Northern Virginia, USA
- `us-west` — Oregon, USA
- `eu-central` — Frankfurt, Germany
- `ap-southeast` — Singapore

Set the target region with `nimbus deploy --region eu-central`. If no region is
given, Nimbus deploys to `us-east` by default.

## Deployment lifecycle

A deploy runs three phases: build, upload, and activate. If the activate phase
fails a health check, Nimbus automatically rolls back to the previous release
and reports the failing check.

## Zero-downtime releases

Nimbus uses blue-green deployment. The new version is started alongside the old
one and only receives traffic once it passes health checks, so there is no
downtime during a normal deploy.
