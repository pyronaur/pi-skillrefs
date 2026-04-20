# pi-skillrefs

`pi-skillrefs` is a fork of `pi-mention-skills` that keeps `$skill` autocomplete and injects referenced skill content as visible turn context.

## Behavior

- Type `$` in the editor to autocomplete discovered skills.
- Keep the `$skill-name` token in the user prompt.
- Before the agent runs, `pi-skillrefs` reads each referenced `SKILL.md` and injects one visible custom message containing one `<environment_context>` block with one `<injected_skill ...>` child per referenced skill, shaped like:

```xml
<environment_context>
<injected_skill ref="$day" path="/absolute/resolved/path/to/day/SKILL.md">
...
</injected_skill>

<injected_skill ref="$night" path="/absolute/resolved/path/to/night/SKILL.md">
...
</injected_skill>
</environment_context>
```

- The user-visible prompt text stays unchanged.
- Every injected skill block includes both `ref` and the skill file's absolute symlink-resolved `path`.
- If the active Pi context already contains that skill's full injected block on the current path, `pi-skillrefs` injects a reminder block with that same resolved absolute skill path instead of repeating the full skill body.
- The transcript shows one compact aside summary for the injected message, including one line per visible referenced skill with resolved skill names when available and estimated token counts.
- Expanding the custom message reveals the full raw injected block.

## Compatibility

- `pi-skillrefs` participates in `pi-fzfp`'s editor handshake so both packages can run together.
- When `pi-skillrefs` owns the editor chain, it composes `pi-fzfp`'s autocomplete wrapper with its existing `$skill` autocomplete provider.