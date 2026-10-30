# Aiscoo Desktop Runtime

只装配桌面早期数据根，不拥有设置、账号、会话、队列或 owner/lease。只有编译期注入 Aiscoo profile 才启用；未注入原样调用上游 bootstrap。

Aiscoo 的默认业务数据根是系统 appData 下对应渠道的数据目录，再由现有 paths owner派生 .zcode/v2 等路径。显式 ZCODE_DATA_BASE_DIR 保留；bootstrap 只读取所选根的 setting.json，不读取旧 ZCode 全局设置。支持同根持久化的用户自定义 dataBaseDir。

- 不覆盖 HOME/USERPROFILE，不导入、复制、删除任何旧数据库或凭据。
- 先设置默认根，再调用原 bootstrap 的可选精确 settingsFile，返回值由原 owner 决定。
- Main→Host 使用现有 buildHostProcessEnv 注入根目录；Host→CLI 的既有环境覆盖键补齐 storage/db/log 三条路径，不改变上游已显式指定的值。
- 历史迁移不在启动时自动发生；需要退出旧写入者、备份及单独验收。
