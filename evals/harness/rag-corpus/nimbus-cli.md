# Nimbus CLI Reference

Nimbus is a fictional deployment tool used only as sample data for the RAG
evaluation. This document describes its command-line interface.

## Installation

Install the CLI with `npm install -g @nimbus/cli`. Verify the install by
running `nimbus --version`, which prints the client and server versions.

## Managing the local cache

Nimbus keeps a local build cache under `~/.nimbus/cache` to speed up repeated
deploys. Over time this cache can grow large or hold stale artifacts.

To clear it, run `nimbus cache reset`. This deletes every cached artifact and
forces the next deploy to rebuild from scratch. Add `--dry-run` to list what
would be removed without deleting anything. There is no separate confirmation
prompt, so use `--dry-run` first if you are unsure.

## Authentication

Log in with `nimbus login`, which opens a browser to complete an OAuth flow and
stores a token in `~/.nimbus/credentials`. Run `nimbus logout` to remove it.

## Common commands

- `nimbus deploy` — build and deploy the current project.
- `nimbus status` — show the status of the most recent deployment.
- `nimbus logs --tail` — stream logs from the running service.
- `nimbus rollback` — revert to the previous successful deployment.
