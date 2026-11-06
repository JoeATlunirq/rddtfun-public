alter table public.presets
add column target_duration_min double precision,
add column target_duration_max double precision,
add constraint presets_target_duration_positive
check (target_duration is null or target_duration > 0),
add constraint presets_target_duration_range_valid
check (
  (target_duration_min is null and target_duration_max is null)
  or (
    target_duration_min is not null
    and target_duration_max is not null
    and target_duration_min > 0
    and target_duration_max >= target_duration_min
  )
);
