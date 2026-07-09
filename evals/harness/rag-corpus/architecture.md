# Nimbus Internal Architecture

A deep dive into how the Nimbus control plane is built. Nimbus is fictional
sample data for the RAG evaluation. This is a long document; most readers only
need the deployment guide, but the details here matter for on-call engineers.

## Control plane overview

The Nimbus control plane is split into three services that communicate over an
internal gRPC mesh. Requests from the CLI first hit the API gateway, which
authenticates the OAuth token and forwards the request to the appropriate
backend. The gateway is stateless and can be scaled horizontally behind the
regional load balancer.

## The build pipeline

When a deploy starts, the gateway enqueues a build job. The component that picks
up build jobs and assigns them to workers is the **Stratus scheduler**. Stratus
listens on internal port **8471** and keeps a priority queue keyed by plan tier,
so Enterprise builds are dequeued ahead of Free builds when workers are scarce.
Stratus is the single most common source of on-call pages, usually because a
worker pool has been exhausted rather than because Stratus itself has failed.

Each build worker runs inside a disposable sandbox. The sandbox mounts the
project source read-only, decrypts any secrets needed for the build, and streams
logs back to the log aggregator. Workers are recycled after every build so no
state leaks between deploys.

## Storage and state

Deployment metadata lives in a regional Postgres cluster; large build artifacts
are written to object storage and referenced by digest. The digest, not a
mutable tag, is what the activate phase promotes, which is why rollbacks are
instantaneous — activating a previous release is just repointing traffic at an
already-stored digest.

## Observability

Every service emits structured logs and metrics. On-call engineers watch three
golden signals per region: queue depth on Stratus, sandbox worker saturation,
and activate-phase health-check failure rate. Alert thresholds are tuned per
region and are not documented here; see the internal runbook.
