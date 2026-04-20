# pi-skillrefs

`pi-skillrefs` adds `$skill` autocomplete to Pi and injects referenced skill bodies as visible turn context.

## Install

```bash
pi install npm:pi-skillrefs
```

Or add it directly to Pi settings:

```json
{
  "packages": ["npm:pi-skillrefs"]
}
```

## What it does

- Autocompletes discovered skills when you type `$` in the editor.
- Keeps the `$skill-name` token in the user prompt.
- Injects one visible `skillrefs` custom message per turn before the agent runs.
- Aggregates multiple referenced skills into one `<environment_context>` wrapper.
- Strips YAML frontmatter from full skill injections.
- Resolves every skill `path` to an absolute symlink-resolved path.
- Sends a reminder block instead of reinjecting the full body when that skill is already on the active session path.

## Injected message shape

```xml
<environment_context>
<injected_skill ref="$day" path="/absolute/resolved/path/to/day/SKILL.md">
# Day Skill

...
</injected_skill>

<injected_skill ref="$night" path="/absolute/resolved/path/to/night/SKILL.md">
# Night Skill

...
</injected_skill>
</environment_context>
```

Reminder injections keep the same wrapper and attributes, but replace the body with a short reminder string.

## Transcript behavior

- The user-visible prompt text stays unchanged.
- The transcript shows one compact aside summary for the injected message, with one line per visible referenced skill and token counts.
- Expanding the custom message reveals the raw injected XML.

## Compatibility

- Composes with `pi-fzfp` through its editor handshake.
- Uses Pi package metadata in `package.json`, so it loads through `pi install` and appears in the Pi package gallery contract for npm packages tagged with `pi-package`.

## Development

```bash
npm test
npm run typecheck
npm run lint
gate
```