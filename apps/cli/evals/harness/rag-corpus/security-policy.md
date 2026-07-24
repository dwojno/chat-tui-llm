# Nimbus Security Policy

How Nimbus handles secrets and access control. Nimbus is fictional sample data
for the RAG evaluation. This document is a distractor for retrieval.

## Secret management

Store secrets with `nimbus secrets set KEY=value`. Secrets are encrypted at rest
with AES-256 and are only decrypted inside the build sandbox. They are never
written to logs.

## Access control

Nimbus supports role-based access control with three roles: `viewer`,
`deployer`, and `admin`. Only `admin` can rotate credentials or change billing.

## Credential rotation

Rotate a project's deploy token with `nimbus secrets rotate`. Old tokens are
invalidated immediately, so update any CI configuration that used them.
