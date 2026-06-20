# Gameplay Systems

Mechanics, separated from lore. **Every system doc has an "Implementation status"
section** — do not author content assuming an unimplemented field works. The
authoritative capability list is
[`../engineering/10-current-implementation.md`](../engineering/10-current-implementation.md).

| File | System | Status |
|---|---|---|
| [`10-calendar-and-action-points.md`](10-calendar-and-action-points.md) | Time, 旬, action points, 时辰 | Implemented |
| [`20-character-attributes.md`](20-character-attributes.md) | Character stat categories | Partial |
| [`21-attribute-catalog.md`](21-attribute-catalog.md) | 皇帝/侍君/皇嗣 属性目录(明面/暗+显示文案) | Scaffold (字段已落地) |
| [`30-personality-archetypes.md`](30-personality-archetypes.md) | Temperament / motivation / effects | Mostly future |
| [`40-relationship-memory.md`](40-relationship-memory.md) | Relationship, favor, memory, tags | Implemented (append-only) |
| [`50-event-trigger-rules.md`](50-event-trigger-rules.md) | Checkpoints, priority, cooldown, selection | Implemented |
| [`60-pregnancy-and-heir-system.md`](60-pregnancy-and-heir-system.md) | 怀胎/转胎/承养/继承 | Mostly future |
| [`70-factions-and-pressure.md`](70-factions-and-pressure.md) | Court factions & pressure | Future |
| [`80-attribute-action-flow.md`](80-attribute-action-flow.md) | 玩家行动↔属性变化表(朝政/生产力/宗室不满/特长) | 字段已落地，连接未接线 |
| [`81-attribute-event-triggers.md`](81-attribute-event-triggers.md) | 属性高低→事件触发表(皇帝/国家/侍君/皇嗣) | Design only |
