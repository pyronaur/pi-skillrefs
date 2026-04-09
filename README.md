# pi-skillrefs

`pi-skillrefs` is a fork of `pi-mention-skills` that keeps `$skill` autocomplete and injects referenced skill content as hidden turn context.

## Behavior

- Type `$` in the editor to autocomplete discovered skills.
- Keep the `$skill-name` token in the user prompt.
- Before the agent runs, `pi-skillrefs` reads each referenced `SKILL.md` and injects a hidden custom message like:

```xml
<injected_skill ref="$day">
...
</injected_skill>
```

- The user-visible prompt text stays unchanged.

## Compatibility

- `pi-skillrefs` participates in `pi-fzfp`'s editor handshake so both packages can run together.
- When `pi-skillrefs` owns the editor chain, it composes `pi-fzfp`'s autocomplete wrapper with its existing `$skill` autocomplete provider.