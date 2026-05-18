# PathMask 路径遮罩小白使用说明

PathMask 是一个 Android GKI/arm64 内核模块演示项目。它可以把指定路径在指定 App 面前伪装成“不存在”。请只在你自己的设备或你有明确授权的设备上测试。

## 我应该下载哪个文件

去 GitHub Release 下载和你设备 KMI 对应的模块包：

```text
android14-5.15_pathmask-ksu.zip
android14-6.1_pathmask-ksu.zip
android15-6.6_pathmask-ksu.zip
android16-6.12_pathmask-ksu.zip
```

如果你的设备是 Android 15 / 6.6，就下载：

```text
android15-6.6_pathmask-ksu.zip
```

不要直接把 `.ko` 当 KernelSU 模块刷入。KernelSU 需要刷入的是 `*-ksu.zip`。

## 怎么安装

1. 打开 KernelSU 管理器。
2. 进入模块页。
3. 选择本地安装。
4. 选择对应的 `*_pathmask-ksu.zip`。
5. 安装完成后重启手机。

## 怎么确认是否加载成功

打开终端或 adb shell：

```sh
su
grep '^pathmask ' /proc/modules
```

有类似输出就说明内核模块已经加载：

```text
pathmask 28672 0 - Live 0x0000000000000000 (O)
```

也可以看参数：

```sh
cat /sys/module/pathmask/parameters/target_paths
cat /sys/module/pathmask/parameters/scope_mode
cat /sys/module/pathmask/parameters/deny_uids
```

## WebUI 怎么用

KernelSU 管理器里进入 PathMask 的 WebUI。

页面分为四个页：

```text
配置：修改隐藏路径、黑名单 App、UID、模式
诊断：自动检查常见问题
日志：分页查看脚本日志、内核日志、配置和状态
报告：复制完整诊断报告
```

别人问你“为什么模块未加载”时，让他点：

```text
诊断 -> 生成诊断 -> 复制诊断报告
```

把完整报告发出来，比截图靠谱。

## 默认隐藏什么

默认隐藏路径：

```text
/dev/cpuset/scene-daemon
/dev/scene
/system_ext/app/SoterService
```

默认只对这几个包隐藏：

```text
com.chunqiunativecheck
com.eltavine.duckdetector
luna.safe.luna
```

这叫黑名单模式，也就是只有被勾选或写入的 App 看不到这些路径，其它 App 仍然能正常访问。

## 保存和热重载有什么区别

`保存配置`：只写配置文件，重启后由开机脚本加载新配置。

`保存并热重载`：保存后立刻执行 `rmmod pathmask` 和 `insmod pathmask.ko`，不需要重启。

热重载很方便，但如果某些内核或 KernelSU 环境不稳定，可能会黑屏重启。遇到这种情况就只保存配置，然后手动重启手机。

## 常见问题

### 1. UI 显示模块未加载

先看：

```sh
su
grep '^pathmask ' /proc/modules
logcat -d -s pathmask
dmesg | grep -Ei 'pathmask|unknown symbol|invalid module|module_layout'
```

如果 `/proc/modules` 里没有 `pathmask`，说明模块确实没加载。

### 2. dmesg 没有 pathmask 日志

`dmesg` 是内核环形日志，旧日志可能被覆盖。判断模块是否加载，优先看：

```sh
grep '^pathmask ' /proc/modules
```

### 3. Unknown symbol / Invalid module format

通常是 `.ko` 和设备内核 KMI 不匹配，或者厂商内核裁剪了符号。请换对应 KMI 的 Release 包。

### 4. 黑名单模式不生效

检查 UID 是否解析到了：

```sh
cat /sys/module/pathmask/parameters/deny_uids
```

如果为空，说明包名没有解析到 UID。确认 App 已安装、包名写对，或者在 WebUI 里直接填写 UID。

### 5. 路径没隐藏

检查目标路径是否在模块加载前存在：

```sh
cat /sys/module/pathmask/parameters/target_paths
ls -ld /你要隐藏的路径
```

路径不存在时加载模块，会被跳过。

## 一键排查命令

```sh
su
grep '^pathmask ' /proc/modules
ls -l /data/adb/modules/pathmask/pathmask.ko
cat /data/adb/pathmask/target_path.conf 2>/dev/null
cat /data/adb/pathmask/scope_mode.conf 2>/dev/null
cat /data/adb/pathmask/deny_packages.conf 2>/dev/null
cat /data/adb/pathmask/deny_uids.conf 2>/dev/null
cat /sys/module/pathmask/parameters/target_paths 2>/dev/null
cat /sys/module/pathmask/parameters/scope_mode 2>/dev/null
cat /sys/module/pathmask/parameters/deny_uids 2>/dev/null
logcat -d -s pathmask
dmesg | grep -Ei 'pathmask|unknown symbol|invalid module|module_layout'
```

## 自己打包

Windows PowerShell：

```powershell
.\tools\package_ksu.ps1 -KoPath .\kernel\pathmask.ko -Output .\out\pathmask-ksu.zip
```

指定隐藏路径：

```powershell
.\tools\package_ksu.ps1 -KoPath .\kernel\pathmask.ko -Output .\out\pathmask-ksu.zip -TargetPath "/dev/scene,/system_ext/app/SoterService"
```
