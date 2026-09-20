# Configurable OpenCode Model Routing Design

## Goal

Enable each fork user to choose the OpenCode provider/model used for the
`EXPERT`, `MAIN`, and `ECONOMIC` Superpowers roles. The fork must not prescribe
or embed provider-specific model identifiers.

## Scope

This feature targets OpenCode V2 (2.0.4 or later). OpenCode V1 retains its
current tool mapping. The feature does not add providers, credentials, or
model definitions: users configure those independently in their own OpenCode
environment.

The stable routing roles are:

| OpenCode agent ID | Role | Delegation use |
| --- | --- | --- |
| `superpowers-expert` | EXPERT | Architecture, difficult debugging, security-sensitive analysis, and final reviews. |
| `superpowers-main` | MAIN | Normal implementation and multi-step task execution. |
| `superpowers-economic` | ECONOMIC | Repository exploration, routine research, and low-risk mechanical work. |

## User-owned model configuration

The user supplies an explicit JSON file to the installer. The required schema
is exactly:

```json
{
  "expert": "provider/model",
  "main": "provider/model",
  "economic": "provider/model"
}
```

For example, a user may choose Claude for `expert`, OpenAI for `main`, and
another provider for `economic`. The values are opaque OpenCode model IDs: the
installer requires non-empty strings containing a provider/model separator but
does not contact a provider or claim that a model is available. It rejects a
missing file, malformed JSON, an array or non-object root value, missing roles,
unknown roles, non-string values, empty strings, and values without `/`.

The file is intentionally not discovered automatically, copied, modified, or
committed by the installer. This makes the selected providers explicit and
keeps any user-specific choices outside the fork. It must not contain
credentials.

## Installation interface

The installer requires both arguments:

```text
node scripts/install-opencode-model-routing.mjs \
  --config-dir <path> \
  --models-file <path>
```

It accepts one occurrence of each flag, in either order, with no positional
arguments. Invalid or duplicate flags fail before creating directories or
profiles. `--models-file` is resolved from the caller's current directory;
`--config-dir` is resolved in the same way.

The command reads the user-owned model file, creates `<config-dir>/agents/`
when necessary, and writes these files:

- `agents/superpowers-expert.md`
- `agents/superpowers-main.md`
- `agents/superpowers-economic.md`

Each generated profile uses the selected model in its `model:` frontmatter and
retains the repository-supplied role description and prompt body. The source
profiles are templates and contain no fixed model identifier.

Before writing, the installer validates every input and template, then checks
all destination paths. If any destination already exists, including a dangling
symlink, it reports every collision and exits without writing any profile.
Exclusive writes prevent an intervening creation from being overwritten. The
installer does not modify provider configuration, credentials, model catalogs,
`opencode.json`, or `opencode.jsonc`.

To change any role model, the user updates their JSON file and deliberately
removes or renames all three generated agent profiles before running the
installer again. The installer preflights the complete three-profile set, so a
remaining destination is a collision and prevents a partial update. This
preserves the existing no-overwrite safety guarantee.

## Routing behavior

The existing OpenCode V2 bootstrap retains its tool mapping and role policy:
it selects `superpowers-expert`, `superpowers-main`, or
`superpowers-economic` only when that agent is available in the subagent
catalog. When the requested role is unavailable, it calls the native `general`
subagent and states that model routing is not installed. The policy names roles
only; it never embeds a provider/model ID. V1 remains unchanged.

## Documentation

Both OpenCode installation guides will include a schema example with clearly
illustrative, non-recommended provider/model placeholders. They will document
the two required installer flags, `opencode models` as the user-run availability
check, collision handling, safe updates, exact removal targets, and the
`general` fallback. Guidance for starting a primary MAIN session will refer to
the `main` value selected in the JSON file rather than a hard-coded model.

## Verification

The model-routing test will prove that:

1. All invalid installer argument shapes fail before filesystem writes.
2. Invalid model configuration files fail with an actionable error and leave
   no generated profiles.
3. A valid configuration produces exactly three profiles whose `model:` fields
   equal the user's chosen strings verbatim.
4. Existing files, dangling symlinks, and a destination created during copying
   are preserved.
5. The V2 routing policy contains only role names and a `general` fallback;
   the V1 mapping stays free of these profiles.
6. Guides document the JSON configuration flow without naming a fixed model.

The complete non-integration OpenCode suite runs through
`bash tests/opencode/run-tests.sh`. A provider-backed runtime session is
reported separately because it requires the particular user's OpenCode
credentials and enabled models.
