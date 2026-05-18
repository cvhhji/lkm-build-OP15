# PathMask

PathMask is a small Android arm64 / GKI external kernel module demo for
selectively masking configured filesystem paths. It is intended for controlled
testing on devices you own or administer.

For a beginner-friendly Chinese guide, see [README.zh-CN.md](README.zh-CN.md).

## What It Builds

- `kernel/pathmask.c`: kernel module source.
- `kernel/Kbuild`: external module target.
- `ksu-module/`: KernelSU module wrapper and WebUI.
- `tools/package_ksu.ps1` and `tools/package_ksu.sh`: packaging helpers.
- `.github/workflows/`: CI builds for Android KMI targets and release uploads.

Default hidden paths:

```text
/dev/cpuset/scene-daemon
/dev/scene
/system_ext/app/SoterService
```

Default deny-scope packages:

```text
com.chunqiunativecheck
com.eltavine.duckdetector
luna.safe.luna
```

## Current Status

Implemented:

- Hides direct access through `security_inode_permission`.
- Hides stat/getattr-style checks through `security_inode_getattr`.
- Filters `getdents64` results so target entries disappear from directory
  listings.
- Supports up to 16 target paths per module load.
- Supports `scope_mode=global` and `scope_mode=deny`.
- Resolves package names to UIDs in the KernelSU boot service.
- Stores runtime config under `/data/adb/pathmask`.
- Migrates old `/data/adb/nohello` config on first PathMask boot.
- Provides a KernelSU WebUI with config editing, health checks, paged logs, and
  one-click diagnostic report copying.
- Avoids direct `kern_path()` / `path_put()` usage. Target resolution uses
  `filp_open()` / `filp_close()` so OEM kernels that prune unused
  `kern_path/path_put` exports are less likely to reject the module.

Known limitations:

- At least one target path must exist before `insmod`; missing paths are
  skipped.
- Directory listing filtering compares `d_ino`; direct access checks still use
  both inode and device.
- Existing open file descriptors are not hidden retroactively.
- The module must match the device KMI/kernel version and arm64 ABI.
- Proc mount text files such as `/proc/*/mountinfo` and `/proc/*/mounts` are
  not filtered.
- Hot reload is convenient, but reboot loading is safer on unstable kernels.

## GitHub Actions And Releases

Pushing to `main`, pushing a `v*` tag, or running the workflow manually builds:

```text
android12-5.10_pathmask.ko
android12-5.10_pathmask-ksu.zip
...
android16-6.12_pathmask.ko
android16-6.12_pathmask-ksu.zip
```

Non-tag builds are uploaded to the `pathmask-latest` prerelease. Tag builds are
uploaded to the matching version release.

Install the `*_pathmask-ksu.zip` file that matches your device KMI. The raw
`.ko` is also uploaded for manual testing.

## Local Build

If your DDK container exports `KDIR`:

```sh
cd kernel
CONFIG_KSU=m CC=clang make
```

With an explicit kernel build directory:

```sh
cd kernel
make KDIR=/path/to/kernel/build
```

The output is:

```text
kernel/pathmask.ko
```

## Manual Test

```sh
adb shell
su
echo "demo secret" > /data/local/tmp/pathmask
insmod /data/local/tmp/pathmask.ko target_path=/data/local/tmp/pathmask
grep '^pathmask ' /proc/modules
ls -l /data/local/tmp/pathmask
```

Multiple paths:

```sh
insmod /data/local/tmp/pathmask.ko target_paths=/data/local/tmp/a,/data/local/tmp/b
```

Deny scope:

```sh
insmod /data/local/tmp/pathmask.ko target_paths=/data/local/tmp/a scope_mode=deny deny_uids=10123,10124
```

Disable directory-list filtering:

```sh
insmod /data/local/tmp/pathmask.ko target_paths=/data/local/tmp/a hide_dirents=0
```

Unload:

```sh
rmmod pathmask
```

## KernelSU Package

Windows PowerShell:

```powershell
.\tools\package_ksu.ps1 -KoPath .\kernel\pathmask.ko -Output .\out\pathmask-ksu.zip
```

Linux/macOS shell:

```sh
./tools/package_ksu.sh kernel/pathmask.ko out/pathmask-ksu.zip
```

Override target paths:

```powershell
.\tools\package_ksu.ps1 -KoPath .\kernel\pathmask.ko -Output .\out\pathmask-ksu.zip -TargetPath "/data/local/tmp/a,/data/local/tmp/b"
```

Direct-access-only package:

```powershell
.\tools\package_ksu.ps1 -KoPath .\kernel\pathmask.ko -Output .\out\pathmask-direct.zip -TargetPath "/data/local/tmp/pathmask" -HideDirents 0
```

Blacklist package:

```powershell
.\tools\package_ksu.ps1 -KoPath .\kernel\pathmask.ko -Output .\out\pathmask-ksu.zip -ScopeMode deny -DenyPackage "com.example.detector"
```

Runtime config files:

```text
/data/adb/pathmask/target_path.conf
/data/adb/pathmask/scope_mode.conf
/data/adb/pathmask/hide_dirents.conf
/data/adb/pathmask/deny_packages.conf
/data/adb/pathmask/deny_uids.conf
/data/adb/pathmask/target_wait_seconds.conf
/data/adb/pathmask/package_wait_seconds.conf
```

## WebUI Diagnosis

Open KernelSU Manager, enter PathMask WebUI, then use:

- `配置`: edit paths, mode, packages, and direct UIDs.
- `诊断`: view health checks and generate a report.
- `日志`: page through script, kernel, status, and config logs.
- `报告`: copy a single report for issue reports.

When a user says "module not loaded", ask them to open `诊断 -> 生成诊断 ->
复制诊断报告` and send the full text.

## Quick Device Checks

```sh
su
grep '^pathmask ' /proc/modules
cat /sys/module/pathmask/parameters/target_paths
cat /sys/module/pathmask/parameters/scope_mode
cat /sys/module/pathmask/parameters/deny_uids
logcat -d -s pathmask
dmesg | grep -Ei 'pathmask|unknown symbol|invalid module|module_layout'
```

Common failure classes:

- No `pathmask` in `/proc/modules`: boot service skipped or `insmod` failed.
- `Unknown symbol`: kernel export/KMI mismatch.
- Empty `deny_uids` in deny mode: package names did not resolve to UIDs.
- All targets missing at boot: service skips loading.
- Old `nohello` module loaded: uninstall the old module and reboot.

## Use Your Own Module

Replace `kernel/pathmask.c` and update `kernel/Kbuild`.

Single source file:

```makefile
obj-m += mymod.o
```

Multiple source files:

```makefile
obj-m += mymod.o
mymod-y := mymod_main.o mymod_hook.o mymod_util.o
```

Then update the KernelSU template and packaging scripts if your output module is
not named `pathmask.ko`.
