//! Phase 0 骨架：领域层。
//!
//! 按 docs/12-extensibility-module-design.md，领域层只包含实体、值对象、
//! 纯规则与错误，不依赖 Tauri / SQLite / Windows。业务模块（tips、agents、
//! hotkey、detection、activation、reminder）在 Phase 2+ 按阶段填充。
