# Feature Tracking

One spec per meaningful feature. Specs describe how features work **now** (git keeps history).
Read the relevant spec before changing a feature and update it in the same change.

| Area | Spec | Status |
|---|---|---|
| Rendering | [Local video renderer](rendering/local-renderer.md) | Implemented; Remotion removal pending sign-off |
| Long form | [Long-form video + linked promo short](longform/longform.md) | Working end to end with a cloned local voice (Pocket TTS); 50k-char run + S3 clip libraries pending |
| Research | [Aura rank](aura/aura-rank.md) | Implemented; `aura_handles` migration needs applying |
| Team | [Team members, roles and the Script board](team/team-and-scripts.md) | Implemented; `team_and_scripts` migration needs applying |

New specs: copy [`_feature-template.md`](_feature-template.md).
