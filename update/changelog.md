# PathMask 2.2.0

- Module author is now `zaomi`.
- WebUI adds config validation for paths, deny scope, direct UIDs, target existence, and package UID hints.
- WebUI adds a temporary pause button. It unloads `pathmask` without disabling the module; reboot or save-and-hot-reload restores hiding.
- Boot service now records consecutive module load failures and skips automatic loading after repeated `insmod` failures.
- Save-and-hot-reload clears the load-failure guard and retries immediately.
- Release packages keep KMI-specific update metadata to avoid cross-installing the wrong kernel package.

中文说明：

- 模块作者已改为 `zaomi`。
- WebUI 新增配置校验：检查隐藏路径、黑名单模式、直接 UID、路径是否存在、包名是否可能解析失败。
- WebUI 新增“暂停隐藏”：临时卸载 `pathmask`，不会禁用模块；重启或“保存并热重载”即可恢复。
- 开机脚本新增连续加载失败保护，多次 `insmod` 失败后会自动跳过后续自动加载。
- “保存并热重载”会清除失败保护并立即重试。
- Release 包继续使用按 KMI 区分的更新信息，避免刷错内核版本包。
