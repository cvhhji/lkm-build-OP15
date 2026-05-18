const MODULE_ID = "pathmask";
const LEGACY_MODULE_ID = "nohello-demo";
const MODULE_NAME = "pathmask";
const LEGACY_MODULE_NAME = "nohello";
const MODDIR = `/data/adb/modules/${MODULE_ID}`;
const LEGACY_MODDIR = `/data/adb/modules/${LEGACY_MODULE_ID}`;
const CONFIGDIR = "/data/adb/pathmask";
const LEGACY_CONFIGDIR = "/data/adb/nohello";
const LOG_PAGE_LINES = 80;

const DEFAULT_TARGET_PATHS = [
	"/dev/cpuset/scene-daemon",
	"/dev/scene",
	"/system_ext/app/SoterService",
];

const DEFAULT_DENY_PACKAGES = [
	"com.chunqiunativecheck",
	"com.eltavine.duckdetector",
	"luna.safe.luna",
];

const files = {
	targets: `${CONFIGDIR}/target_path.conf`,
	hideDirents: `${CONFIGDIR}/hide_dirents.conf`,
	scope: `${CONFIGDIR}/scope_mode.conf`,
	denyPackages: `${CONFIGDIR}/deny_packages.conf`,
	denyUids: `${CONFIGDIR}/deny_uids.conf`,
	service: `${MODDIR}/service.sh`,
	ko: `${MODDIR}/pathmask.ko`,
};

let apps = [];
let selectedPackages = new Set();
let busy = false;
let lastSnapshot = {};
let logPages = { script: [], kernel: [], status: [], config: [] };
let activeLog = "script";
let activeLogPage = 0;
let lastReport = "";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const pathList = $("#pathList");
const appList = $("#appList");
const statusText = $("#statusText");
const toast = $("#toast");

const actionButtons = [
	"#refreshBtn",
	"#loadAppsBtn",
	"#saveBtn",
	"#reloadBtn",
	"#addPathBtn",
	"#runDiagnosticBtn",
	"#copyReportBtn",
	"#copyReportBtn2",
	"#resetDefaultsBtn",
	"#refreshLogsBtn",
	"#prevLogBtn",
	"#nextLogBtn",
].map($).filter(Boolean);

function shellQuote(value) {
	return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function getKsuBridge() {
	if (typeof window !== "undefined" && window.ksu?.exec) return window.ksu;
	if (typeof ksu !== "undefined" && ksu?.exec) return ksu;
	return null;
}

function execShell(command) {
	const bridge = getKsuBridge();
	if (!bridge) throw new Error("KernelSU WebUI API 不可用");

	return new Promise((resolve, reject) => {
		const callbackName = `pathmask_exec_${Date.now()}_${Math.random().toString(16).slice(2)}`;

		window[callbackName] = (errno, stdout, stderr) => {
			delete window[callbackName];
			if (errno && errno !== 0) {
				reject(new Error(stderr || stdout || `命令失败：${errno}`));
				return;
			}
			resolve(stdout || "");
		};

		try {
			bridge.exec(command, JSON.stringify({}), callbackName);
		} catch (error) {
			try {
				bridge.exec(command, callbackName);
			} catch (fallbackError) {
				delete window[callbackName];
				reject(fallbackError);
			}
		}
	});
}

async function safeExec(command) {
	try {
		return await execShell(command);
	} catch (error) {
		return `ERROR: ${error.message}`;
	}
}

function showToast(message) {
	toast.textContent = message;
	toast.hidden = false;
	clearTimeout(showToast.timer);
	showToast.timer = setTimeout(() => {
		toast.hidden = true;
	}, 4200);
}

function setBusy(nextBusy, message) {
	busy = nextBusy;
	for (const button of actionButtons) button.disabled = nextBusy;
	if (message) statusText.textContent = message;
}

async function runAction(message, action) {
	if (busy) {
		showToast("正在处理，请稍等");
		return;
	}

	setBusy(true, message);
	try {
		await action();
	} catch (error) {
		showToast(error.message);
		throw error;
	} finally {
		setBusy(false);
	}
}

async function readFile(path) {
	return execShell(`[ -f ${shellQuote(path)} ] && cat ${shellQuote(path)} || true`);
}

async function writeLines(path, lines) {
	const clean = lines.map((line) => line.trim()).filter(Boolean);
	const body = clean.length
		? `printf '%s\\n' ${clean.map(shellQuote).join(" ")} > ${shellQuote(path)}`
		: `: > ${shellQuote(path)}`;
	await execShell(`mkdir -p ${shellQuote(CONFIGDIR)}; chmod 0700 ${shellQuote(CONFIGDIR)} 2>/dev/null || true; ${body}`);
}

function linesFromText(text) {
	return text.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));
}

function countCsv(text) {
	return text.split(",").map((item) => item.trim()).filter(Boolean).length;
}

function setText(selector, value) {
	const node = $(selector);
	if (node) node.textContent = value;
}

function renderPaths(paths) {
	pathList.textContent = "";
	const list = paths.length ? paths : DEFAULT_TARGET_PATHS;
	for (const path of list) addPathRow(path);
}

function addPathRow(value = "") {
	const row = document.createElement("div");
	row.className = "pathRow";

	const input = document.createElement("input");
	input.type = "text";
	input.value = value;
	input.placeholder = "/system/app/example";

	const remove = document.createElement("button");
	remove.type = "button";
	remove.textContent = "删";
	remove.addEventListener("click", () => row.remove());

	row.append(input, remove);
	pathList.append(row);
	input.focus();
}

function collectPaths() {
	return [...pathList.querySelectorAll("input")]
		.map((input) => input.value.trim())
		.filter(Boolean);
}

function parsePackageLine(line) {
	const match = line.match(/^package:(.+?)\s+uid:(\d+)$/);
	if (!match) return null;
	return { pkg: match[1], uid: match[2] };
}

function renderApps() {
	const query = $("#searchInput").value.trim().toLowerCase();
	appList.textContent = "";

	const filtered = apps.filter((app) => !query || app.pkg.toLowerCase().includes(query));
	for (const app of filtered) {
		const row = document.createElement("label");
		row.className = "appRow";

		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.checked = selectedPackages.has(app.pkg);
		checkbox.addEventListener("change", () => {
			if (checkbox.checked) selectedPackages.add(app.pkg);
			else selectedPackages.delete(app.pkg);
			updateHealthList();
		});

		const pkg = document.createElement("div");
		pkg.className = "pkg";
		pkg.textContent = app.pkg;

		const uid = document.createElement("div");
		uid.className = "uid";
		uid.textContent = app.uid;

		row.append(checkbox, pkg, uid);
		appList.append(row);
	}
}

function renderHealth(items) {
	const list = $("#healthList");
	list.textContent = "";

	for (const item of items) {
		const li = document.createElement("li");
		li.className = `healthItem ${item.level}`;

		const title = document.createElement("strong");
		title.textContent = item.title;

		const body = document.createElement("span");
		body.textContent = item.body;

		li.append(title, body);
		list.append(li);
	}
}

function updateSummary(snapshot) {
	const loaded = snapshot.moduleText?.trim();
	const legacyLoaded = snapshot.legacyModuleText?.trim();
	const scope = snapshot.scopeText?.trim() || "deny";
	const targetCount = linesFromText(snapshot.targetText || "").length || DEFAULT_TARGET_PATHS.length;
	const sysUidCount = countCsv(snapshot.sysDenyUids || "");
	const configUidCount = linesFromText(snapshot.uidText || "").length;

	setText("#moduleState", loaded ? "已加载" : legacyLoaded ? "旧模块已加载" : "未加载");
	setText("#scopeState", scope === "global" ? "全局" : "黑名单");
	setText("#targetCount", String(targetCount));
	setText("#uidCount", String(sysUidCount || configUidCount));
	statusText.textContent = loaded ? "模块已加载" : "模块未加载";
}

function updateHealthList() {
	const snapshot = lastSnapshot;
	const items = [];
	const loaded = snapshot.moduleText?.trim();
	const legacyLoaded = snapshot.legacyModuleText?.trim();
	const scope = (snapshot.scopeText || "deny").trim() === "global" ? "global" : "deny";
	const targets = collectPaths();
	const selected = [...selectedPackages];
	const directUids = linesFromText($("#denyUidsInput").value);
	const sysUids = linesFromText((snapshot.sysDenyUids || "").replace(/,/g, "\n"));

	if (loaded) {
		items.push({ level: "ok", title: "模块已加载", body: loaded });
	} else if (legacyLoaded) {
		items.push({ level: "warn", title: "旧 nohello 模块仍在运行", body: "卸载旧模块并重启后再安装 PathMask。" });
	} else {
		items.push({ level: "bad", title: "模块未加载", body: "查看脚本日志和内核日志，重点找 ko 缺失、KMI 不匹配、UID 为空或目标路径不存在。" });
	}

	if ((snapshot.koInfo || "").includes("No such file") || (snapshot.koInfo || "").includes("missing")) {
		items.push({ level: "bad", title: "pathmask.ko 不存在", body: `${files.ko} 缺失，重新安装模块包。` });
	} else {
		items.push({ level: "ok", title: "模块文件存在", body: `${files.ko}` });
	}

	if (scope === "deny" && selected.length === 0 && directUids.length === 0 && sysUids.length === 0) {
		items.push({ level: "bad", title: "黑名单为空", body: "deny 模式下没有包名或 UID，service.sh 会跳过加载。" });
	} else if (scope === "deny") {
		items.push({ level: "ok", title: "黑名单模式有目标", body: `包名 ${selected.length} 个，直接 UID ${directUids.length} 个。` });
	}

	if (targets.length === 0) {
		items.push({ level: "bad", title: "隐藏路径为空", body: "至少保留一个存在的路径，否则模块不会加载。" });
	} else if ((snapshot.targetProbe || "").includes("MISS")) {
		items.push({ level: "warn", title: "有路径当前不存在", body: "不存在的路径会在内核加载时被跳过。" });
	} else {
		items.push({ level: "ok", title: "隐藏路径配置有效", body: `${targets.length} 条路径。` });
	}

	if ((snapshot.moduleFlags || "").includes("disable")) {
		items.push({ level: "bad", title: "模块被禁用", body: "删除 disable 文件或在 KernelSU 管理器中启用模块。" });
	}

	if ((snapshot.legacyConfigInfo || "").trim()) {
		items.push({ level: "warn", title: "发现旧配置目录", body: `${LEGACY_CONFIGDIR} 存在，PathMask 会尝试迁移但不会自动删除。` });
	}

	renderHealth(items);
}

function paginate(text) {
	const lines = (text || "").split(/\r?\n/);
	const pages = [];
	for (let i = 0; i < lines.length; i += LOG_PAGE_LINES) {
		pages.push(lines.slice(i, i + LOG_PAGE_LINES).join("\n"));
	}
	return pages.length ? pages : [""];
}

function renderLogPage() {
	const pages = logPages[activeLog] || [""];
	activeLogPage = Math.max(0, Math.min(activeLogPage, pages.length - 1));
	$("#logOutput").value = pages[activeLogPage] || "";
	$("#logPageInfo").textContent = `${activeLogPage + 1} / ${pages.length}`;
	$("#prevLogBtn").disabled = busy || activeLogPage <= 0;
	$("#nextLogBtn").disabled = busy || activeLogPage >= pages.length - 1;
}

function setLogContent(key, text) {
	logPages[key] = paginate(text);
	if (key === activeLog) activeLogPage = 0;
	renderLogPage();
}

function buildReport(snapshot = lastSnapshot) {
	const parts = [
		"PathMask 诊断报告",
		`生成时间: ${new Date().toLocaleString()}`,
		"",
		"=== 模块状态 ===",
		snapshot.statusLog || "(未生成)",
		"",
		"=== 配置文件 ===",
		snapshot.configLog || "(未生成)",
		"",
		"=== 脚本日志 logcat ===",
		snapshot.scriptLog || "(未生成)",
		"",
		"=== 内核日志 dmesg ===",
		snapshot.kernelLog || "(未生成)",
	];
	return parts.join("\n");
}

async function copyText(text) {
	if (!text) {
		showToast("没有可复制内容");
		return;
	}

	if (navigator.clipboard?.writeText) {
		await navigator.clipboard.writeText(text);
		showToast("已复制");
		return;
	}

	const area = document.createElement("textarea");
	area.value = text;
	document.body.append(area);
	area.select();
	document.execCommand("copy");
	area.remove();
	showToast("已复制");
}

async function loadApps() {
	statusText.textContent = "正在加载应用...";
	const showSystem = $("#showSystemInput").checked;
	const command = showSystem ? "pm list packages -U" : "pm list packages -U -3";
	const output = await execShell(command);
	apps = output.split(/\r?\n/)
		.map(parsePackageLine)
		.filter(Boolean)
		.sort((a, b) => a.pkg.localeCompare(b.pkg));
	renderApps();
	showToast(`已加载 ${apps.length} 个应用`);
}

async function refreshConfig() {
	const targetText = await readFile(files.targets);
	const hideText = await readFile(files.hideDirents);
	const scopeText = await readFile(files.scope);
	const pkgText = await readFile(files.denyPackages);
	const uidText = await readFile(files.denyUids);
	const moduleText = await safeExec(`grep '^${MODULE_NAME} ' /proc/modules || true`);
	const legacyModuleText = await safeExec(`grep '^${LEGACY_MODULE_NAME} ' /proc/modules || true`);
	const sysDenyUids = await safeExec(`[ -f /sys/module/${MODULE_NAME}/parameters/deny_uids ] && cat /sys/module/${MODULE_NAME}/parameters/deny_uids || true`);
	const koInfo = await safeExec(`[ -f ${shellQuote(files.ko)} ] && ls -l ${shellQuote(files.ko)} || echo missing`);
	const moduleFlags = await safeExec(`ls -1 ${shellQuote(MODDIR)}/disable ${shellQuote(MODDIR)}/remove 2>/dev/null || true`);
	const legacyConfigInfo = await safeExec(`[ -d ${shellQuote(LEGACY_CONFIGDIR)} ] && echo ${shellQuote(LEGACY_CONFIGDIR)} || true`);

	renderPaths(linesFromText(targetText));
	$("#hideDirentsInput").checked = (hideText.trim() || "1") !== "0";
	const scope = (scopeText.trim() || "deny") === "global" ? "global" : "deny";
	document.querySelector(`input[name="scope"][value="${scope}"]`).checked = true;
	const packageLines = linesFromText(pkgText);
	selectedPackages = new Set(packageLines.length ? packageLines : DEFAULT_DENY_PACKAGES);
	$("#denyUidsInput").value = linesFromText(uidText).join("\n");
	renderApps();

	lastSnapshot = {
		...lastSnapshot,
		targetText,
		hideText,
		scopeText,
		pkgText,
		uidText,
		moduleText,
		legacyModuleText,
		sysDenyUids,
		koInfo,
		moduleFlags,
		legacyConfigInfo,
	};

	await refreshTargetProbe();
	updateSummary(lastSnapshot);
	updateHealthList();
}

async function refreshTargetProbe() {
	const paths = collectPaths();
	if (!paths.length) {
		lastSnapshot.targetProbe = "";
		return;
	}

	const body = paths.map((path) => (
		`if [ -e ${shellQuote(path)} ]; then echo OK ${shellQuote(path)}; else echo MISS ${shellQuote(path)}; fi`
	)).join("; ");
	lastSnapshot.targetProbe = await safeExec(body);
}

async function saveConfig() {
	const scope = document.querySelector('input[name="scope"]:checked')?.value || "global";
	await writeLines(files.targets, collectPaths());
	await writeLines(files.hideDirents, [$("#hideDirentsInput").checked ? "1" : "0"]);
	await writeLines(files.scope, [scope]);
	await writeLines(files.denyPackages, [...selectedPackages].sort());
	await writeLines(files.denyUids, linesFromText($("#denyUidsInput").value));
	await refreshConfig();
	statusText.textContent = "已保存，重启后生效";
	showToast("已保存，重启后生效");
}

async function reloadModule() {
	await saveConfig();
	statusText.textContent = "正在热重载...";
	const output = await execShell(
		`if grep -q '^${MODULE_NAME} ' /proc/modules 2>/dev/null; then rmmod ${MODULE_NAME}; fi; PATHMASK_TARGET_WAIT_SECONDS=5 PATHMASK_PACKAGE_WAIT_SECONDS=5 sh ${shellQuote(files.service)}; dmesg | grep -Ei 'pathmask|nohello|unknown symbol|invalid module|exec format|module_layout' | tail -n 30`
	);
	setLogContent("kernel", output);
	await refreshDiagnostics();
	showToast("热重载完成");
}

async function restoreDefaults() {
	await writeLines(files.targets, DEFAULT_TARGET_PATHS);
	await writeLines(files.hideDirents, ["1"]);
	await writeLines(files.scope, ["deny"]);
	await writeLines(files.denyPackages, DEFAULT_DENY_PACKAGES);
	await writeLines(files.denyUids, []);
	await refreshConfig();
	showToast("已恢复默认配置，重启后生效");
}

async function refreshDiagnostics() {
	await refreshConfig();

	const statusLog = await safeExec(`
echo '--- basic ---'
date 2>/dev/null || true
uname -a 2>/dev/null || true
getprop ro.build.version.release 2>/dev/null || true
getprop ro.product.manufacturer 2>/dev/null || true
getprop ro.product.device 2>/dev/null || true
echo '--- modules ---'
grep -E '^(pathmask|nohello) ' /proc/modules 2>/dev/null || true
echo '--- module files ---'
ls -l ${shellQuote(MODDIR)} 2>/dev/null || true
ls -l ${shellQuote(LEGACY_MODDIR)} 2>/dev/null || true
echo '--- sysfs parameters ---'
for f in /sys/module/pathmask/parameters/*; do [ -f "$f" ] && echo "$(basename "$f")=$(cat "$f" 2>/dev/null)"; done
`);

	const configLog = await safeExec(`
echo '--- persistent config ---'
for f in ${shellQuote(CONFIGDIR)}/*.conf; do [ -f "$f" ] && echo "### $f" && cat "$f"; done
echo '--- legacy config ---'
for f in ${shellQuote(LEGACY_CONFIGDIR)}/*.conf; do [ -f "$f" ] && echo "### $f" && cat "$f"; done
echo '--- target existence ---'
if [ -f ${shellQuote(files.targets)} ]; then while IFS= read -r p || [ -n "$p" ]; do [ -z "$p" ] && continue; case "$p" in \\#*) continue;; esac; if [ -e "$p" ]; then echo "OK $p"; else echo "MISS $p"; fi; done < ${shellQuote(files.targets)}; fi
`);

	const scriptLog = await safeExec(`logcat -d -s pathmask nohello 2>/dev/null | tail -n 300 || true`);
	const kernelLog = await safeExec(`dmesg 2>/dev/null | grep -Ei 'pathmask|nohello|unknown symbol|invalid module|exec format|module_layout' | tail -n 240 || true`);

	lastSnapshot = {
		...lastSnapshot,
		statusLog,
		configLog,
		scriptLog,
		kernelLog,
	};

	setLogContent("status", statusLog);
	setLogContent("config", configLog);
	setLogContent("script", scriptLog);
	setLogContent("kernel", kernelLog);
	lastReport = buildReport(lastSnapshot);
	$("#reportOutput").value = lastReport;
	statusText.textContent = "诊断已生成";
	showToast("诊断报告已生成");
	updateHealthList();
}

function switchTab(tab) {
	for (const button of $$(".tab")) {
		button.classList.toggle("active", button.dataset.tab === tab);
	}
	for (const panel of $$(".tabPanel")) {
		panel.classList.toggle("active", panel.id === `${tab}Panel`);
	}
}

function switchLog(log) {
	activeLog = log;
	activeLogPage = 0;
	for (const button of $$(".logTab")) {
		button.classList.toggle("active", button.dataset.log === log);
	}
	renderLogPage();
}

$("#addPathBtn").addEventListener("click", () => addPathRow());
$("#loadAppsBtn").addEventListener("click", () => runAction("正在加载应用...", loadApps).catch(() => {}));
$("#refreshBtn").addEventListener("click", () => runAction("正在刷新...", refreshConfig).catch(() => {}));
$("#searchInput").addEventListener("input", renderApps);
$("#saveBtn").addEventListener("click", () => runAction("正在保存...", saveConfig).catch(() => {}));
$("#reloadBtn").addEventListener("click", () => runAction("正在热重载...", reloadModule).catch(() => {}));
$("#runDiagnosticBtn").addEventListener("click", () => runAction("正在生成诊断...", refreshDiagnostics).catch(() => {}));
$("#refreshLogsBtn").addEventListener("click", () => runAction("正在刷新日志...", refreshDiagnostics).catch(() => {}));
$("#copyReportBtn").addEventListener("click", () => runAction("正在复制...", () => copyText(lastReport || buildReport())).catch(() => {}));
$("#copyReportBtn2").addEventListener("click", () => runAction("正在复制...", () => copyText($("#reportOutput").value)).catch(() => {}));
$("#resetDefaultsBtn").addEventListener("click", () => runAction("正在恢复默认配置...", restoreDefaults).catch(() => {}));
$("#prevLogBtn").addEventListener("click", () => {
	activeLogPage -= 1;
	renderLogPage();
});
$("#nextLogBtn").addEventListener("click", () => {
	activeLogPage += 1;
	renderLogPage();
});

for (const button of $$(".tab")) {
	button.addEventListener("click", () => switchTab(button.dataset.tab));
}

for (const button of $$(".logTab")) {
	button.addEventListener("click", () => switchLog(button.dataset.log));
}

for (const radio of document.querySelectorAll('input[name="scope"]')) {
	radio.addEventListener("change", () => {
		updateHealthList();
		if (radio.value === "deny" && radio.checked && apps.length === 0) {
			loadApps().catch(() => {});
		}
	});
}

$("#denyUidsInput").addEventListener("input", updateHealthList);

runAction("正在读取配置...", refreshConfig).catch((error) => {
	statusText.textContent = "读取失败";
	showToast(error.message);
});
