/* App Sandbox - WebView2 Frontend */
'use strict';

/* Language files (lang/*.js) have registered themselves by now. */
initI18n();

/* ---- State ---- */
let vms = [];
let selectedVm = -1;
let selectedSnap = new Map();
let editVmState = null;
let snapshotModal = null;
let pendingConfirm = null; /* {resolve} */
let minSizeReported = false;
let lastHostInfo = null;
let diskSpaceInfo = null;
let diskSpaceRequestId = 0;
let diskSpaceTimer = null;
let diskSpacePending = false;
let diskDirectoryBeforeEdit = null;
let rowCache = {};          /* vm.name -> <tr> — persistent rows so the status spinner doesn't reset on every update */
let rowSigCache = {};       /* vm.name -> last render signature; skip rebuild when unchanged */

/* ---- Collapsible sections ---- */
function toggleSection(id) {
    var section = document.getElementById(id);
    var collapsed = section.classList.toggle('collapsed');
    localStorage.setItem('collapse_' + id, collapsed ? '1' : '0');
}
(function restoreCollapse() {
    var defaults = { 'log-section': '1' };
    Object.keys(defaults).forEach(function(id) {
        var val = localStorage.getItem('collapse_' + id);
        if (val === null) val = defaults[id];
        if (val === '1') document.getElementById(id).classList.add('collapsed');
    });
})();

const netNames = ['None', 'NAT', 'External', 'Internal'];

/* ---- Message bridge ----
 *
 * Two host environments are supported:
 *   - WebView2 on Windows  (window.chrome.webview)
 *   - WKWebView on macOS   (window.webkit.messageHandlers.host)
 *
 * Native code on both platforms calls window.onHostMessage(obj) with a
 * parsed message object; the JS side only sees one uniform surface. On
 * Windows we keep using the native chrome.webview event path because it
 * is the existing, tested route — onHostMessage is simply wired into the
 * same listener.
 */

var hostBridge = (function() {
    var isWebView2 = !!(window.chrome && window.chrome.webview);
    var isWKWebView = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.host);

    function send(action, data) {
        var msg = Object.assign({ action: action }, data || {});
        if (isWebView2) {
            window.chrome.webview.postMessage(msg);
        } else if (isWKWebView) {
            /* WKWebView only accepts JSON-serializable values; strings round-trip
             * most reliably so we hand the native side the raw JSON text. */
            window.webkit.messageHandlers.host.postMessage(JSON.stringify(msg));
        } else {
            console.warn('[hostBridge] no native host available; dropping', msg);
        }
    }

    return { send: send, isWebView2: isWebView2, isWKWebView: isWKWebView, isMac: isWKWebView };
})();

function sendCmd(action, data) { hostBridge.send(action, data); }

/* On a macOS host, hide the Windows-*host*-only features (templates, snapshots,
 * test-mode, build-template — none supported when the host is a Mac) and the
 * dormant Linux-version row. The OS-type dropdown stays ENABLED so the user can
 * pick Windows (built from a Microsoft ISO via QEMU) or macOS (VZ restore image).
 * Per-OS field visibility — including the .needs-iso picker — is driven by
 * applyOsTypeUI(), which runs on both hosts. */
if (hostBridge.isMac) {
    var hide = document.querySelectorAll('.win-only, .windows-host-only, .needs-linux-version');
    for (var i = 0; i < hide.length; i++) hide[i].style.display = 'none';
}

/* OS Type dropdown: drop guest types that aren't available on this host.
 * Windows host: macOS unavailable (Apple Virtualization is Mac-only).
 * macOS host:   Linux unavailable (Windows IS supported — QEMU+ivshmem). */
{
    var unavailable = hostBridge.isMac ? ['Linux'] : ['macOS'];
    unavailable.forEach(function(v) {
        var opt = document.querySelector('#os-type option[value="' + v + '"]');
        if (opt) opt.remove();
    });
}

function applyOsTypeUI() {
    var modal = document.getElementById('create-vm-overlay');
    var osType = document.getElementById('os-type').value;
    var isWindows = osType === 'Windows';
    var isLinux = osType === 'Linux';
    if (!isWindows || hostBridge.isMac) selectTemplate('', templateDefaultLabel());
    var winOnly = modal.querySelectorAll('.win-only');
    var needsIso = modal.querySelectorAll('.needs-iso');
    var needsWindows = modal.querySelectorAll('.needs-windows');
    var needsLinuxVersion = modal.querySelectorAll('.needs-linux-version');
    /* .win-only = template/snapshot features that exist only on a Windows *host*;
       never shown on a Mac host, even for a Windows guest. */
    for (var i = 0; i < winOnly.length; i++)
        winOnly[i].style.display = (!hostBridge.isMac && isWindows) ? '' : 'none';
    /* .needs-windows = Windows-*guest* options (Test Mode); shown for a Windows
       guest on EITHER host (a Windows-on-Mac VM uses it too), hidden otherwise. */
    for (var w = 0; w < needsWindows.length; w++) needsWindows[w].style.display = isWindows ? '' : 'none';
    /* ISO picker shows for both Windows and Linux now. */
    for (var j = 0; j < needsIso.length; j++) needsIso[j].style.display = (isWindows || isLinux) ? '' : 'none';
    /* Linux distribution dropdown is dormant — kept in the DOM but always
       hidden so the cloud-image code path can be revived without
       re-adding the markup. */
    for (var k = 0; k < needsLinuxVersion.length; k++) needsLinuxVersion[k].style.display = 'none';
    /* Swap the default VM name between OS conventions, but only when the
       field still holds the *other* OS's untouched default — never clobber a
       name the user typed. Linux hostnames must be lowercase. */
    var nameEl = document.getElementById('vm-name');
    if (isLinux && nameEl.value === 'MyAppSandbox') nameEl.value = 'myappsandbox';
    else if (!isLinux && nameEl.value === 'myappsandbox') nameEl.value = 'MyAppSandbox';
    revalidateVmName();
    revalidateUsername();
    revalidatePassword();
    updateCreateButtons();
}

/* Unified dispatch. Native code on either platform calls
 * window.onHostMessage(obj) with an already-parsed object. WebView2 also
 * delivers messages through chrome.webview.addEventListener('message'),
 * which we route into the same handler so both paths end up in one place. */
window.onHostMessage = function(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
        case 'fullState':     onFullState(msg); break;
        case 'vmListChanged': updateVmList(msg.vms); renderVmTable(); updateHostInfo(msg.hostInfo); revalidateVmName(); break;
        case 'vmStateChanged': onVmStateChanged(msg); break;
        case 'snapListChanged': break; /* snapshots now inline in vmListChanged */
        case 'log':           appendLog(msg.message); break;
        case 'hostInfo':      updateHostInfo(msg); break;
        case 'browseResult':  onBrowseResult(msg.path); break;
        case 'diskDirectoryBrowseResult': onDiskDirectoryBrowseResult(msg.path); break;
        case 'diskSpace':     onDiskSpace(msg); break;
        case 'confirmResult': if (pendingConfirm) pendingConfirm.resolve(msg.confirmed); break;
        case 'adapters':      populateAdapters(msg.adapters, msg.defaultIndex); break;
        case 'templates':     populateTemplates(msg.templates); break;
        case 'alert':         showModal(t('Error'), tn(msg.message), t('OK')); break;
        case 'prereqRequired': onPrereqRequired(); break;
        case 'prereqReboot':   onPrereqReboot(); break;
        case 'prereqProgress': onPrereqProgress(msg); break;
        case 'prereqResult':   onPrereqResult(msg); break;
    }
};

/* WebView2 delivers events as DOM CustomEvents; forward them into
 * window.onHostMessage so both transports converge on the same handler. */
if (hostBridge.isWebView2) {
    window.chrome.webview.addEventListener('message', function(event) {
        window.onHostMessage(event.data);
    });
}

/* ---- Initial state ---- */

function onFullState(msg) {
    updateVmList(msg.vms || []);
    renderVmTable();
    revalidateVmName();
    if (msg.hostInfo) updateHostInfo(msg.hostInfo);
    if (msg.adapters) populateAdapters(msg.adapters, msg.defaultAdapter);
    if (msg.templates) populateTemplates(msg.templates);
    if (!minSizeReported) {
        minSizeReported = true;
        setTimeout(reportMinSize, 50);
    }
}

/* Hyper-V/HCS requires VM memory aligned to 2 MB, so RAM (MB) must be even;
   round an odd value down by 1 (an odd value is rejected and the VM won't boot). */
function alignRamMb(mb) { return mb - (mb % 2); }

function applySmartDefaults(info) {
    var ram = Math.min(Math.floor(info.hostRamMb / 2), 16384);
    var cores = Math.min(Math.floor(info.hostCores / 2), 8);
    if (ram < 512) ram = 512;
    if (cores < 1) cores = 1;
    document.getElementById('ram-size').value = alignRamMb(ram);
    document.getElementById('cpu-cores').value = cores;
}

function onVmStateChanged(msg) {
    if (msg.vmIndex >= 0 && msg.vmIndex < vms.length) {
        Object.assign(vms[msg.vmIndex], msg);
    }
    renderVmTable();
    if (msg.hostInfo) updateHostInfo(msg.hostInfo);
}

/* ---- Host info ---- */

function updateHostInfo(info) {
    if (!info) return;
    var previousDefault = lastHostInfo && lastHostInfo.defaultDiskDirectory;
    if (!hostBridge.isMac && Array.isArray(info.gpus) &&
        JSON.stringify(info.gpus) !== JSON.stringify(lastHostInfo && lastHostInfo.gpus))
        populateGpus(info.gpus);
    lastHostInfo = info;
    var diskDirectory = document.getElementById('disk-directory');
    if (diskDirectoryBeforeEdit === null && info.defaultDiskDirectory &&
        (!diskDirectory.value || diskDirectory.value === previousDefault))
        diskDirectory.value = info.defaultDiskDirectory;
    var el;
    el = document.getElementById('host-cpu');
    if (el) el.textContent = t('Host: {host} cores | VMs using: {used}', { host: info.hostCores, used: info.vmCores });
    el = document.getElementById('host-ram');
    if (el) el.textContent = t('Host: {host} MB | VMs using: {used} MB', { host: info.hostRamMb, used: info.vmRamMb });
    document.getElementById('edit-host-cpu').textContent = document.getElementById('host-cpu').textContent;
    document.getElementById('edit-host-ram').textContent = document.getElementById('host-ram').textContent;
    if (previousDefault !== info.defaultDiskDirectory) refreshDiskSpaceInfo();
    else {
        updateDiskSpaceInfo();
        if (document.getElementById('create-vm-overlay').classList.contains('active') && !diskSpacePending)
            refreshDiskSpaceInfo(true);
    }
}

function gpuSelectionValue(selection) {
    return selection.gpuMode === 1 && selection.gpuId ? 'gpu:' + selection.gpuId : String(selection.gpuMode);
}

function selectedGpu(id) {
    var value = document.getElementById(id).value;
    return value.indexOf('gpu:') === 0 ?
        { gpuMode: 1, gpuId: value.slice(4) } : { gpuMode: Number(value), gpuId: '' };
}

function updateGpuTitle(select) {
    var option = select.options[select.selectedIndex];
    select.title = option ? (option.title || option.textContent) : '';
}

function setGpuSelection(id, selection) {
    var select = document.getElementById(id);
    select.value = gpuSelectionValue(selection);
    if (select.selectedIndex < 0) select.value = '1';
    updateGpuTitle(select);
}

function populateGpus(gpus) {
    ['gpu-mode', 'edit-gpu-mode'].forEach(function(id) {
        var select = document.getElementById(id);
        var selection = selectedGpu(id);
        while (select.options.length > 2) select.remove(2);
        gpus.forEach(function(gpu) {
            if (!gpu.id) return;
            var option = document.createElement('option');
            option.value = 'gpu:' + gpu.id;
            option.textContent = gpu.name;
            option.title = gpu.location ? gpu.name + '\n' + gpu.location : gpu.name;
            select.appendChild(option);
        });
        setGpuSelection(id, selection);
    });
}

['gpu-mode', 'edit-gpu-mode'].forEach(function(id) {
    document.getElementById(id).addEventListener('change', function() { updateGpuTitle(this); });
});

function selectedDiskDirectory() {
    return document.getElementById('disk-directory').value.trim() ||
        (lastHostInfo && lastHostInfo.defaultDiskDirectory) || '';
}

function updateDiskSpaceInfo() {
    if (!lastHostInfo) return;
    var path = selectedDiskDirectory();
    var free = t('Checking...');
    if (!path || validateDiskDirectory(path)) free = t('Unavailable');
    else if (diskSpaceInfo && diskSpaceInfo.path === path)
        free = diskSpaceInfo.freeGb >= 0 ? diskSpaceInfo.freeGb + ' GB' : t('Unavailable');
    document.getElementById('host-hdd').textContent =
        t('Free: {free} | VMs allocated: {used} GB', { free: free, used: lastHostInfo.vmHddGb });
    document.getElementById('disk-location-space').textContent = t('Free: {free}', { free: free });
    document.getElementById('btn-disk-location').title = t('HDD Location: {path}', { path: path });
}

function refreshDiskSpaceInfo(keepPrevious) {
    clearTimeout(diskSpaceTimer);
    diskSpaceTimer = null;
    var path = selectedDiskDirectory();
    var requestId = ++diskSpaceRequestId;
    if (!keepPrevious) diskSpaceInfo = null;
    diskSpacePending = !!path && !validateDiskDirectory(path);
    updateDiskSpaceInfo();
    updateCreateButtons();
    if (!diskSpacePending) return;
    diskSpaceTimer = setTimeout(function() {
        diskSpaceTimer = null;
        sendCmd('getDiskSpace', { path: path, requestId: requestId });
    }, 200);
}

function onDiskSpace(msg) {
    if (msg.requestId !== diskSpaceRequestId || msg.path !== selectedDiskDirectory()) return;
    diskSpacePending = false;
    diskSpaceInfo = {
        path: msg.path,
        freeGb: typeof msg.freeGb === 'number' && Number.isFinite(msg.freeGb) ? msg.freeGb : -1
    };
    updateDiskSpaceInfo();
    updateCreateButtons();
}

/* ---- Adapters ---- */

var currentAdapters = [];

function populateAdapters(adapters, defaultIdx) {
    var sel = document.getElementById('net-adapter');
    sel.innerHTML = '';
    var autoOpt = document.createElement('option');
    autoOpt.value = '';
    autoOpt.textContent = t('(Auto)');
    sel.appendChild(autoOpt);
    currentAdapters = adapters || [];
    if (adapters) {
        adapters.forEach(function(a) {
            var opt = document.createElement('option');
            opt.value = a;
            opt.textContent = a;
            sel.appendChild(opt);
        });
    }
    if (typeof defaultIdx === 'number' && defaultIdx >= 0 && defaultIdx < sel.options.length) {
        sel.selectedIndex = defaultIdx;
    }
}

/* ---- Templates ---- */

var currentTemplates = [];

function templateDefaultLabel() {
    var n = currentTemplates.length;
    if (n === 0) return t('(None)');
    return n === 1 ? t('(1 template available)') : t('({n} templates available)', { n: n });
}

function populateTemplates(templates) {
    currentTemplates = templates || [];
    var list = document.getElementById('template-dropdown-list');
    var hidden = document.getElementById('template-select');
    list.innerHTML = '';

    /* Default (None) item — always shows "None" inside the list */
    var noneItem = document.createElement('div');
    noneItem.className = 'template-dropdown-item';
    noneItem.innerHTML = '<span class="tpl-name">' + t('(None)') + '</span>';
    noneItem.addEventListener('click', function() { selectTemplate('', templateDefaultLabel()); });
    list.appendChild(noneItem);

    currentTemplates.forEach(function(tpl) {
        var item = document.createElement('div');
        item.className = 'template-dropdown-item';

        var nameSpan = document.createElement('span');
        nameSpan.className = 'tpl-name';
        nameSpan.textContent = tpl.name + ' [' + tpl.osType + ']';
        item.appendChild(nameSpan);

        var delBtn = document.createElement('span');
        delBtn.className = 'tpl-delete';
        delBtn.textContent = '\uD83D\uDDD1\uFE0F';
        delBtn.title = t('Delete template');
        delBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            closeTemplateDropdown();
            onDeleteTemplate(tpl.name);
        });
        item.appendChild(delBtn);

        item.addEventListener('click', function() {
            selectTemplate(tpl.name, tpl.name + ' [' + tpl.osType + ']');
        });
        list.appendChild(item);
    });

    /* If the currently selected template was deleted, reset */
    if (hidden.value !== '') {
        var found = currentTemplates.some(function(tpl) { return tpl.name === hidden.value; });
        if (!found) selectTemplate('', templateDefaultLabel());
    } else {
        /* No template selected — update default label in case count changed */
        document.getElementById('template-dropdown-selected').textContent = templateDefaultLabel();
    }
    revalidateVmName();
}

function selectTemplate(value, label) {
    document.getElementById('template-select').value = value;
    document.getElementById('template-dropdown-selected').textContent = label;
    closeTemplateDropdown();
    if (value !== '') {
        document.getElementById('image-path').value = '';
    }
    updateCreateButtons();
}

function closeTemplateDropdown() {
    document.getElementById('template-dropdown').classList.remove('open');
}

document.getElementById('template-dropdown-selected').addEventListener('click', function() {
    document.getElementById('template-dropdown').classList.toggle('open');
});

/* Close dropdown when clicking outside */
document.addEventListener('click', function(e) {
    if (!e.target.closest('#template-dropdown')) {
        closeTemplateDropdown();
    }
});

function onDeleteTemplate(name) {
    showModal(
        t('Confirm Delete'),
        t('Are you sure you want to delete template "{name}"?\n\nThis will permanently delete the template disk image.', { name: name }),
        t('Delete')
    ).then(function(confirmed) {
        if (confirmed) {
            sendCmd('deleteTemplate', { name: name });
        }
    });
}

/* ---- Browse result ---- */

function onBrowseResult(path) {
    if (path) {
        document.getElementById('image-path').value = path;
        selectTemplate('', templateDefaultLabel());
        updateCreateButtons();
    }
}

function onDiskDirectoryBrowseResult(path) {
    if (!path || diskDirectoryBeforeEdit === null) return;
    document.getElementById('disk-directory').value = path;
    revalidateDiskDirectory();
}

function validateDiskDirectory(path) {
    if (!path) return null;  /* Empty uses the host's default. */
    if (/[\x00-\x1f\x7f]/.test(path)) return t('Disk folder cannot contain control characters.');
    if (hostBridge.isMac) {
        if (path[0] !== '/') return t('Disk folder must be an absolute path.');
    } else {
        if (!/^(?:[a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(path))
            return t('Disk folder must be an absolute path.');
        if (/["<>|?*]/.test(path) || /:/.test(path.slice(2)))
            return t('Disk folder contains invalid characters.');
    }
    return null;
}

function revalidateDiskDirectory() {
    var path = document.getElementById('disk-directory').value.trim();
    var error = validateDiskDirectory(path);
    document.getElementById('disk-directory-warn').textContent = error || '';
    document.getElementById('btn-save-disk-location').disabled = !!error;
    refreshDiskSpaceInfo();
}
document.getElementById('disk-directory').addEventListener('input', revalidateDiskDirectory);

function openDiskLocationModal() {
    var createOverlay = document.getElementById('create-vm-overlay');
    if (!createOverlay.classList.contains('active') || diskDirectoryBeforeEdit !== null) return;
    diskDirectoryBeforeEdit = document.getElementById('disk-directory').value;
    document.getElementById('disk-location-overlay').classList.add('active');
    createOverlay.inert = true;
    revalidateDiskDirectory();
    document.getElementById('disk-directory').focus();
    document.getElementById('disk-directory').select();
}

function closeDiskLocationModal(save) {
    if (diskDirectoryBeforeEdit === null) return;
    var input = document.getElementById('disk-directory');
    if (save && validateDiskDirectory(input.value.trim())) {
        revalidateDiskDirectory();
        input.focus();
        return;
    }
    var previousPath = selectedDiskDirectory();
    input.value = save ? input.value.trim() : diskDirectoryBeforeEdit;
    diskDirectoryBeforeEdit = null;
    document.getElementById('disk-location-overlay').classList.remove('active');
    document.getElementById('create-vm-overlay').inert = false;
    if (selectedDiskDirectory() !== previousPath) revalidateDiskDirectory();
    document.getElementById('btn-disk-location').focus();
}

let diskLocationBackdropPress = false;
document.getElementById('disk-location-overlay').addEventListener('mousedown', function(e) {
    diskLocationBackdropPress = (e.target === this);
});
document.getElementById('disk-location-overlay').addEventListener('click', function(e) {
    if (e.target === this && diskLocationBackdropPress) closeDiskLocationModal(false);
    diskLocationBackdropPress = false;
});

/* ---- Create buttons state ---- */

function createValidationError(isTemplate) {
    var osType = document.getElementById('os-type').value;
    if (isTemplate && (hostBridge.isMac || osType !== 'Windows'))
        return t('Templates require a Windows guest on a Windows host.');
    var error = validateVmName(document.getElementById('vm-name').value.trim()) ||
        validateDiskDirectory(document.getElementById('disk-directory').value.trim()) ||
        validateUsername(document.getElementById('admin-user').value.trim(), isTemplate) ||
        validatePassword(document.getElementById('admin-pass').value);
    if (error) return error;
    if (document.getElementById('admin-pass').value !== document.getElementById('admin-confirm').value)
        return t('Passwords do not match.');

    var numericFields = [
        ['hdd-size', t('Disk size must be a whole number of at least 1 GB.')],
        ['ram-size', t('RAM must be an even number of at least 512 MB.')],
        ['cpu-cores', t('CPU cores must be a whole number of at least 1.')]
    ];
    for (var i = 0; i < numericFields.length; i++) {
        var input = document.getElementById(numericFields[i][0]);
        if (input.value === '' || !input.validity.valid) return numericFields[i][1];
    }

    var path = selectedDiskDirectory();
    var diskKnown = diskSpaceInfo && diskSpaceInfo.path === path;
    if (diskKnown && diskSpaceInfo.freeGb < 0) return t('Disk folder is unavailable.');
    if (diskSpacePending && !diskKnown) return t('Checking disk folder...');

    var hasImage = document.getElementById('image-path').value.trim() !== '';
    var hasTemplate = !hostBridge.isMac && osType === 'Windows' &&
        document.getElementById('template-select').value !== '';
    if ((isTemplate || osType !== 'macOS') && !hasImage && (isTemplate || !hasTemplate))
        return t('Select an OS image or an available template.');
    return null;
}

function updateCreateButtons() {
    document.getElementById('btn-create').disabled = !!createValidationError(false);
    document.getElementById('btn-create-template').disabled = !!createValidationError(true);
}

/* Wire up change events */
document.getElementById('create-vm-overlay').addEventListener('input', updateCreateButtons);
document.getElementById('create-vm-overlay').addEventListener('change', updateCreateButtons);
document.getElementById('image-path').addEventListener('input', function() {
    if (this.value.trim() !== '') {
        selectTemplate('', templateDefaultLabel());
    }
    updateCreateButtons();
});

/* RAM must be 2 MB-aligned: snap an odd entry down by 1 when the field is committed. */
document.getElementById('ram-size').addEventListener('change', function() {
    var mb = this.valueAsNumber;
    if (!isNaN(mb)) this.value = alignRamMb(mb);
});

function revalidateVmName() {
    var name = document.getElementById('vm-name').value.trim();
    document.getElementById('vm-name-warn').textContent = validateVmName(name) || '';
    updateCreateButtons();
}
document.getElementById('vm-name').addEventListener('input', function() {
    revalidateVmName();
    revalidateUsername();
});

function revalidateUsername() {
    var u = document.getElementById('admin-user').value.trim();
    document.getElementById('admin-user-warn').textContent = validateUsername(u) || '';
}
function revalidatePassword() {
    var p = document.getElementById('admin-pass').value;
    document.getElementById('admin-pass-warn').textContent = validatePassword(p) || '';
}
document.getElementById('admin-user').addEventListener('input', revalidateUsername);

function checkPasswordMatch() {
    var pass = document.getElementById('admin-pass').value;
    var confirm = document.getElementById('admin-confirm');
    if (confirm.value === '' && pass === '') {
        confirm.classList.remove('pass-mismatch', 'pass-match');
        return;
    }
    if (confirm.value === pass) {
        confirm.classList.remove('pass-mismatch');
        confirm.classList.add('pass-match');
    } else {
        confirm.classList.remove('pass-match');
        confirm.classList.add('pass-mismatch');
    }
}
document.getElementById('admin-pass').addEventListener('input', function() {
    checkPasswordMatch();
    revalidatePassword();
});
document.getElementById('admin-confirm').addEventListener('input', checkPasswordMatch);
checkPasswordMatch();

function showPassword() {
    document.getElementById('admin-pass').type = 'text';
    document.getElementById('admin-confirm').type = 'text';
}
function hidePassword() {
    document.getElementById('admin-pass').type = 'password';
    document.getElementById('admin-confirm').type = 'password';
}

function onNetModeChange() {
    /* Adapter dropdown only relevant for External */
    var mode = parseInt(document.getElementById('net-mode').value);
    var show = (!hostBridge.isMac && mode === 2) ? '' : 'none';
    document.getElementById('net-adapter').style.display = show;
    document.getElementById('net-adapter-label').style.display = show;
}
onNetModeChange();

/* ---- Create VM ---- */

function gatherConfig() {
    var osType = document.getElementById('os-type').value;
    var gpu = selectedGpu('gpu-mode');
    /* Same ISO-picker path for Windows and Linux. The cloud-image
       Linux-version dropdown is dormant (see applyOsTypeUI). */
    var imagePath = document.getElementById('image-path').value.trim();
    return {
        name:        document.getElementById('vm-name').value.trim(),
        osType:      osType,
        imagePath:   imagePath,
        diskDirectory: document.getElementById('disk-directory').value.trim() ===
            (lastHostInfo && lastHostInfo.defaultDiskDirectory) ? '' :
            document.getElementById('disk-directory').value.trim(),
        templateName: (!hostBridge.isMac && osType === 'Windows') ?
            document.getElementById('template-select').value : '',
        hddGb:       document.getElementById('hdd-size').valueAsNumber,
        ramMb:       alignRamMb(document.getElementById('ram-size').valueAsNumber),
        cpuCores:    document.getElementById('cpu-cores').valueAsNumber,
        gpuMode:     gpu.gpuMode,
        gpuId:       gpu.gpuId,
        networkMode: hostBridge.isMac ? 1 : parseInt(document.getElementById('net-mode').value),
        netAdapter:  hostBridge.isMac ? '' : document.getElementById('net-adapter').value,
        adminUser:   document.getElementById('admin-user').value.trim(),
        adminPass:   document.getElementById('admin-pass').value,
        adminConfirm: document.getElementById('admin-confirm').value,
        testMode:    document.getElementById('test-mode').checked,
        sshEnabled:  document.getElementById('ssh-enabled').checked,
        sshDeployKey: document.getElementById('ssh-deploy-key').checked
    };
}

/* "Deploy SSH key" depends on "SSH Server": grey it out (and clear it) unless
   SSH is enabled. The core also gates deploy on ssh_enabled as a backstop. */
function onSshToggle() {
    var ssh = document.getElementById('ssh-enabled').checked;
    var dep = document.getElementById('ssh-deploy-key');
    dep.disabled = !ssh;
    if (!ssh) dep.checked = false;
}

function clearCreateForm() {
    document.getElementById('image-path').value = '';
    selectTemplate('', templateDefaultLabel());
    updateCreateButtons();
}

/* VM name / hostname validation. Per-guest-OS rules, keyed off the
   selected OS Type (on a macOS host the dropdown is locked to 'macOS',
   so osType is an accurate guest discriminator on all hosts). */
function validateVmName(name) {
    if (!name) return t('VM name is required.');
    var osSelect = document.getElementById('os-type');
    var osType = osSelect ? osSelect.value : 'Windows';
    if (osType === 'macOS') {
        if (name.length > 63) return t('VM name cannot exceed 63 characters (macOS LocalHostName limit).');
    } else if (osType === 'Linux') {
        if (name.length > 63) return t('VM name cannot exceed 63 characters (Linux hostname limit).');
        if (/[A-Z]/.test(name)) return t('Linux hostname must be lowercase.');
    } else { /* Windows */
        if (name.length > 15) return t('VM name cannot exceed 15 characters (NetBIOS limit).');
    }
    if (/[^a-zA-Z0-9-]/.test(name)) return t('VM name can only contain letters, digits, and hyphens.');
    if (/^\d+$/.test(name)) return t('VM name cannot be only digits.');
    if (name.startsWith('-') || name.endsWith('-')) return t('VM name cannot start or end with a hyphen.');
    var lower = name.toLowerCase();
    for (var i = 0; i < vms.length; i++) {
        if (vms[i].name.toLowerCase() === lower) return t('A VM with this name already exists.');
    }
    for (var j = 0; j < currentTemplates.length; j++) {
        if (currentTemplates[j].name.toLowerCase() === lower) return t('A template with this name already exists.');
    }
    return null;
}

/* Username validation. Per-guest-OS rules keyed off osType. Each branch
   is explicit so it's clear which OS's account rules apply. */
function validateUsername(name, isTemplate) {
    if (name === undefined) return t('Username is required.');
    if (typeof name !== 'string') return t('Username must be a string.');
    name = name.trim();
    if (!name) return t('Username is required.');
    if (name.indexOf('\u0000') >= 0) return t('Username cannot contain NUL characters.');
    var bytes;
    try {
        bytes = unescape(encodeURIComponent(name)).length;
    } catch (e) {
        return t('Username contains invalid Unicode.');
    }
    var osSelect = document.getElementById('os-type');
    var osType = osSelect ? osSelect.value : 'Windows';
    if (osType === 'Linux') {
        /* Ubuntu 26.04's installer grammar and reserved-usernames list.
           https://github.com/canonical/subiquity/tree/26.04 */
        if (name.length > 32) return t('Username cannot exceed 32 characters (Linux limit).');
        if (!/^[a-z_][a-z0-9_-]*$/.test(name))
            return t('Linux username: lowercase letters, digits, _ and - only; start with a letter or _.');
        var linuxReserved = (
            'root daemon bin sys sync games man lp mail news uucp proxy www-data backup list irc gnats nobody ' +
            'adm tty disk kmem dialout fax voice cdrom floppy tape sudo audio dip operator src shadow utmp video ' +
            'sasl plugdev staff users nogroup netplan ftn mysql tac-plus alias qmail qmaild qmails qmailr qmailq ' +
            'qmaill qmailp asterisk vpopmail vchkpw slurm hacluster haclient grsec-tpe grsec-sock-all grsec-sock-clt ' +
            'grsec-sock-srv grsec-proc ceph opensrf libvirt-qemu admin Debian-exim bind crontab cupsys dcc dhcp ' +
            'dictd dnsmasq dovecot fetchmail firebird ftp fuse gdm haldaemon hplilp identd input jwhois klog kvm ' +
            'lpadmin maas messagebus mythtv netdev powerdev radvd render saned sbuild scanner sgx slocate ssh ' +
            'sshd ssl-cert sslwrap statd syslog telnetd tftpd'
        ).split(' ');
        if (linuxReserved.indexOf(name) >= 0) return t('Username is a reserved name.');
        return null;
    }
    if (osType === 'macOS') {
        if (bytes > 63) return t('Username is too long (max 63 UTF-8 bytes in AppSandbox).');
        if (/\s/.test(name)) return t('Username cannot contain spaces (macOS short account name).');
        if (/[\x00-\x1f\x7f\ufffe\uffff/\\:]/.test(name)) return t('Username contains invalid characters.');
        if (name === '.' || name === '..') return t('Username cannot be . or .. (macOS short account name).');
        if (['root', 'daemon', 'nobody', 'guest', 'shared'].indexOf(name.toLowerCase()) >= 0)
            return t('Username is a reserved name.');
        return null;
    }
    if (name.length > 20) return t('Username cannot exceed 20 characters.');
    if (/[\x00-\x1f\ufffe\uffff"\\/\[\]:;|=,+*?<>%@]/.test(name)) return t('Username contains invalid characters.');
    if (/^[.\s]+$/.test(name)) return t('Username cannot be only dots or spaces.');
    if (name.endsWith('.')) return t('Username cannot end with a period.');
    var reserved = ['NONE','CON','PRN','AUX','NUL',
        'COM1','COM2','COM3','COM4','COM5','COM6','COM7','COM8','COM9',
        'LPT1','LPT2','LPT3','LPT4','LPT5','LPT6','LPT7','LPT8','LPT9'];
    if (reserved.indexOf(name.toUpperCase()) >= 0) return t('Username is a reserved name.');
    if (!isTemplate &&
        name.toLowerCase() === document.getElementById('vm-name').value.trim().toLowerCase())
        return t('Username cannot match the VM name (Windows computer name).');
    return null;
}

function validatePassword(pass) {
    if (!pass) return t('Password is required.');
    if (pass.indexOf('\u0000') >= 0) return t('Password cannot contain NUL characters.');
    var bytes;
    try {
        bytes = unescape(encodeURIComponent(pass)).length;
    } catch (e) {
        return t('Password contains invalid Unicode.');
    }
    var osSelect = document.getElementById('os-type');
    var osType = osSelect ? osSelect.value : 'Windows';
    if (osType === 'Linux') {
        if (Array.from(pass).length < 6)
            return t('Password must be at least 6 characters (Ubuntu minimum).');
        if (bytes > 255) return t('Password is too long (max 255 bytes).');
    } else if (osType === 'macOS') {
        if (Array.from(pass).length < 4)
            return t('Password must be at least 4 characters (macOS minimum).');
        if (bytes > 127) return t('Password is too long (max 127 UTF-8 bytes in AppSandbox).');
    } else if (pass.length > 127) {
        return t('Password is too long (max 127 characters for Windows).');
    }
    return null;
}

function onCreateVm() {
    var error = createValidationError(false);
    if (error) { sendCmd('log', { message: error }); updateCreateButtons(); return; }
    var cfg = gatherConfig();
    sendCmd('createVm', cfg);
    clearCreateForm();
    closeCreateModal();
}

function onCreateTemplate() {
    var error = createValidationError(true);
    if (error) { sendCmd('log', { message: error }); updateCreateButtons(); return; }
    var cfg = gatherConfig();
    cfg.isTemplate = true;
    sendCmd('createVm', cfg);
    clearCreateForm();
    closeCreateModal();
}

/* ---- Create Sandbox modal ---- */

function openCreateModal() {
    closeDiskLocationModal(false);
    /* Reset to defaults every time the modal opens */
    document.getElementById('vm-name').value = 'MyAppSandbox';
    document.getElementById('image-path').value = '';
    document.getElementById('disk-directory').value = (lastHostInfo && lastHostInfo.defaultDiskDirectory) || '';
    revalidateDiskDirectory();
    selectTemplate('', templateDefaultLabel());
    document.getElementById('hdd-size').value = 64;
    setGpuSelection('gpu-mode', { gpuMode: 1 });
    document.getElementById('net-mode').value = '1';
    document.getElementById('admin-user').value = 'user';
    document.getElementById('admin-pass').value = 'test123';
    document.getElementById('admin-confirm').value = 'test123';
    document.getElementById('test-mode').checked = false;
    document.getElementById('ssh-enabled').checked = false;
    document.getElementById('ssh-deploy-key').checked = false;
    onSshToggle();   /* re-grey "Deploy SSH key" to match the cleared SSH checkbox */
    /* Reset OS type to Windows on each open. Valid on both hosts (a Mac host
       supports Windows via QEMU); the user can switch to macOS on a Mac. */
    document.getElementById('os-type').value = 'Windows';

    /* Smart defaults (RAM/cores) from latest host info */
    if (lastHostInfo) applySmartDefaults(lastHostInfo);

    /* Clear validation state */
    document.getElementById('vm-name-warn').textContent = '';
    document.getElementById('admin-user-warn').textContent = '';
    document.getElementById('admin-pass-warn').textContent = '';
    checkPasswordMatch();
    onNetModeChange();
    applyOsTypeUI();   /* fires updateCreateButtons + revalidateVmName */

    document.getElementById('create-vm-overlay').classList.add('active');
    setTimeout(function() {
        if (diskDirectoryBeforeEdit === null) document.getElementById('vm-name').focus();
    }, 0);
}

function closeCreateModal() {
    closeDiskLocationModal(false);
    document.getElementById('create-vm-overlay').classList.remove('active');
    clearTimeout(diskSpaceTimer);
    diskSpaceTimer = null;
    diskSpacePending = false;
    ++diskSpaceRequestId;
}

/* Close on backdrop click — but only when the press also STARTED on the backdrop.
   A click targets the common ancestor of the mousedown and mouseup, so pressing
   inside the modal (e.g. selecting text in a field) and releasing on the backdrop
   would otherwise close it. */
let createBackdropPress = false;
document.getElementById('create-vm-overlay').addEventListener('mousedown', function(e) {
    createBackdropPress = (e.target === this);
});
document.getElementById('create-vm-overlay').addEventListener('click', function(e) {
    if (e.target === this && createBackdropPress) closeCreateModal();
    createBackdropPress = false;
});

function trapModalFocus(event, overlay) {
    if (event.key !== 'Tab') return;
    var controls = Array.from(overlay.querySelectorAll('button, input, select, [tabindex]')).filter(function(el) {
        return !el.disabled && el.tabIndex >= 0 && el.getClientRects().length;
    });
    if (!controls.length) return;
    var first = controls[0], last = controls[controls.length - 1];
    if (!overlay.contains(document.activeElement) ||
        (event.shiftKey && document.activeElement === first) ||
        (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
    }
}

document.addEventListener('keydown', function(e) {
    var confirmOverlay = document.getElementById('modal-overlay');
    if (confirmOverlay.classList.contains('active')) {
        if (e.key === 'Escape') { e.preventDefault(); modalResolve(false); }
        else trapModalFocus(e, confirmOverlay);
        return;
    }
    var diskOverlay = document.getElementById('disk-location-overlay');
    if (diskOverlay.classList.contains('active')) {
        if (e.key === 'Escape') { e.preventDefault(); closeDiskLocationModal(false); }
        else if (e.key === 'Enter' && e.target.id === 'disk-directory') {
            e.preventDefault();
            closeDiskLocationModal(true);
        } else trapModalFocus(e, diskOverlay);
        return;
    }
    var editOverlay = document.getElementById('edit-vm-overlay');
    if (editOverlay.classList.contains('active')) {
        if (e.key === 'Escape') { e.preventDefault(); closeEditVmModal(); }
        else if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
            e.preventDefault();
            saveEditVm();
        } else trapModalFocus(e, editOverlay);
        return;
    }
    var snapshotOverlay = document.getElementById('snapshot-overlay');
    if (snapshotOverlay.classList.contains('active')) {
        if (e.key === 'Escape') { e.preventDefault(); closeSnapshotModal(); }
        else trapModalFocus(e, snapshotOverlay);
        return;
    }
    if (e.key !== 'Escape') return;
    if (document.getElementById('create-vm-overlay').classList.contains('active')) {
        closeCreateModal();
    }
});

/* ---- VM Table ---- */

/* Update the status <td> in place. Preserves the spinner element across
   updates so its CSS animation doesn't restart on every staging-file tick. */
function updateStatusCell(td, vm) {
    var needsSpinner = false;
    var label = '';
    var className = '';

    if (vm.buildingVhdx) {
        needsSpinner = true;
        label = (vm.vhdxStaging ? t('Staging files...') : t('Building Disk ({pct}%)', { pct: vm.vhdxProgress || 0 })) + ' ';
        className = 'status-building';
    } else if (vm.running && vm.shuttingDown) {
        className = 'status-shutting-down';
        label = t('Shutting Down');
    } else if (vm.running && vm.isTemplate) {
        needsSpinner = true;
        label = t('Building Template') + ' ';
        className = 'status-building';
    } else if (vm.running && !vm.installComplete && !vm.isTemplate) {
        needsSpinner = true;
        var defaultLabel;
        if (vm.osType === 'macOS')      defaultLabel = t('Installing macOS') + ' ';
        else if (vm.osType === 'Linux') defaultLabel = t('Installing Linux') + ' ';
        else                            defaultLabel = t('Installing Windows') + ' ';
        label = (vm.installStatus && vm.installStatus.length > 0)
            ? (tn(vm.installStatus) + ' ')
            : defaultLabel;
        className = 'status-building';
    } else if (vm.running) {
        className = 'status-running';
        label = t('Running');
    } else {
        className = 'status-stopped';
        label = t('Stopped');
    }

    td.className = className;

    var existingSpinner = td.querySelector('.spinner');

    if (needsSpinner) {
        /* Drop any existing children except the spinner, then insert the new text
           before it. The spinner stays in the document the whole time, so its
           CSS animation clock isn't reset. */
        if (existingSpinner) {
            var child = td.firstChild;
            while (child) {
                var next = child.nextSibling;
                if (child !== existingSpinner) td.removeChild(child);
                child = next;
            }
            td.insertBefore(document.createTextNode(label), existingSpinner);
        } else {
            td.textContent = '';
            td.appendChild(document.createTextNode(label));
            var spin = document.createElement('span');
            spin.className = 'spinner';
            td.appendChild(spin);
        }
    } else {
        /* No spinner needed — wipe and set plain text. Any existing spinner is
           removed along with the old text. */
        td.textContent = label;
    }
}

/* Build the list of <td> cells for a row. The status cell is passed in and
   updated in place (rather than recreated) so the spinner animation survives. */
function buildRowCells(vm, i, statusTd) {
    updateStatusCell(statusTd, vm);

    var agentTd = document.createElement('td');
    var agentOff = !vm.running || vm.isTemplate;
    var dotClass = 'agent-dot' + (vm.agentOnline ? ' online' : '') + (agentOff ? ' disabled' : '');
    agentTd.innerHTML = '<span class="' + dotClass + '"></span>';
    agentTd.title = vm.isTemplate
        ? t('Templates do not run the in-VM agent')
        : (!vm.running
            ? t('VM is not running')
            : (vm.agentOnline
                ? t('In-VM agent is connected — host can manage the guest')
                : t('In-VM agent is not connected')));

    var bld = vm.buildingVhdx;

    var sshActive = vm.sshEnabled && (vm.sshState === 2 || vm.sshState === 4) && vm.running && !bld;
    var sshCell = makeIconCell('ssh', '>_', sshActive, (function(idx) { return function() { sendCmd('sshConnect', {vmIndex: idx}); }; })(i), !vm.sshEnabled ? 'hidden' : '');
    if (vm.sshEnabled) {
        var sshBtn = sshCell.querySelector('.icon-btn');
        if (vm.sshState === 1) sshBtn.title = t('Installing OpenSSH in the guest...');
        else if (vm.sshState === 4) sshBtn.title = t('Open an SSH terminal (localhost:{port}; AppSandbox key deployed — key auth works)', { port: vm.sshPort });
        else if (vm.sshState === 2) sshBtn.title = t('Open an SSH terminal to the VM (localhost:{port}, tunneled over HvSocket)', { port: vm.sshPort });
        else if (vm.sshState === 3) sshBtn.title = t('SSH install failed');
        else sshBtn.title = t('SSH: waiting for the in-VM agent to come online');
    }

    var cells = [
        makeCell(vm.name),
        makeCell(vm.osType),
        statusTd,
        agentTd,
        makeCell(vm.cpuCores, t('Number of virtual CPU cores assigned to this VM')),
        makeCell(vm.ramMb + ' MB', t('Memory allocated to this VM, in megabytes')),
        makeCell(vm.hddGb + ' GB', t('Virtual disk size, in gigabytes')),
        makeCell(vm.gpuName || (vm.gpuMode === 1 ? t('Default GPU') : t('None')),
            hostBridge.isMac && vm.osType === 'Windows'
                ? t('Windows software rendering (WARP) on the CPU')
                : t('GPU passed through to the VM via GPU-PV, or None')),
        makeCell(hostBridge.isMac ? 'NAT' : t(netNames[vm.networkMode] || 'None'),
            hostBridge.isMac ? t('NAT (shared networking)')
                : t('Networking mode: NAT (shared), External (bridged), Internal (host-only), or None')),
    ];
    if (!hostBridge.isMac) cells.push(makeSnapCell(vm, i));
    cells.push(
        makeIconCell('start', '\u25B6\uFE0F', !vm.running && !bld, function() { onStartVm(i); }, '', t('Start the VM (boots from the selected snapshot/branch)')),
        makeIconCell('connect-idd', '\uD83D\uDCFA', vm.running && !bld, function() { sendCmd('connectIddVm', {vmIndex: i}); }, '', t('Open the VM display window (IDD virtual monitor)')),
        sshCell,
        makeIconCell('shutdown', '\u23FB', vm.running && !bld, function() { sendCmd('shutdownVm', {vmIndex: i}); }, '', t('Request a graceful shutdown from the guest OS')),
        makeIconCell('stop', '\u2715\uFE0F', vm.running && !bld, function() { onStopVm(i); }, '', t('Force power off the VM immediately (may lose unsaved guest data)')),
        makeIconCell('delete', '\uD83D\uDDD1\uFE0F', !bld, function() { onDeleteVm(i); }, vm.running ? 'running' : '', t('Delete this VM and its virtual disks')),
        makeIconCell('edit', '\u270F\uFE0F', !vm.running && !bld, function() { openEditVmModal(i); }, '', t('Edit VM configuration — VM must be stopped')),
    );
    return cells;
}

function renderVmTable() {
    updateEditVmModal();
    renderSnapshotModal();
    var tbody = document.getElementById('vm-tbody');

    if (vms.length === 0) {
        rowCache = {};
        rowSigCache = {};
        tbody.innerHTML = '';
        var tr = document.createElement('tr');
        var td = document.createElement('td');
        td.colSpan = hostBridge.isMac ? 16 : 17;
        td.className = 'empty-state';
        var btn = document.createElement('button');
        btn.className = 'primary empty-state-btn';
        btn.textContent = t('+ Create your first sandbox');
        btn.onclick = openCreateModal;
        td.appendChild(btn);
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    /* Drop cached rows for VMs that no longer exist. */
    var seen = {};
    vms.forEach(function(vm) { seen[vm.name] = true; });
    Object.keys(rowCache).forEach(function(name) {
        if (!seen[name]) {
            var stale = rowCache[name];
            if (stale.parentNode) stale.parentNode.removeChild(stale);
            delete rowCache[name];
            delete rowSigCache[name];
        }
    });

    /* Remove any non-cached tbody children (e.g. leftover empty-state row). */
    var kids = Array.prototype.slice.call(tbody.children);
    kids.forEach(function(c) {
        var cached = false;
        for (var n in rowCache) { if (rowCache[n] === c) { cached = true; break; } }
        if (!cached) tbody.removeChild(c);
    });

    /* Skip the cell rebuild when button-relevant fields are unchanged; the
     * install progress tick would otherwise destroy the button DOM mid-click. */
    vms.forEach(function(vm, i) {
        var tr = rowCache[vm.name];
        var firstBuild = !tr;
        if (!tr) {
            tr = document.createElement('tr');
            rowCache[vm.name] = tr;
        }

        var statusTd = tr.children[2] || document.createElement('td');
        updateStatusCell(statusTd, vm);

        var sig = [
            currentLang, i, i === selectedVm,
            vm.running, vm.buildingVhdx, vm.shuttingDown, vm.agentOnline,
            vm.installComplete, vm.isTemplate,
            vm.sshEnabled, vm.sshState, vm.sshPort,
            vm.osType, vm.ramMb, vm.hddGb, vm.cpuCores,
            vm.gpuMode, vm.gpuId, vm.gpuName, vm.networkMode,
            selectedSnap.get(vm.name) || 'current',
            /* Snapshot tree: take/delete/rename/branch must trigger a row rebuild
               so makeSnapCell re-runs. These fields only change on user snapshot
               actions (never on install-progress ticks — a VM can't be snapshotted
               while running), so the rebuild-skip optimization above is preserved. */
            vm.hasSnapshots, vm.snapCurrent, vm.snapCurrentBranch,
            JSON.stringify(vm.snapshots || []), JSON.stringify(vm.baseBranches || [])
        ].join('|');

        if (!firstBuild && rowSigCache[vm.name] === sig) {
            if (tbody.children[i] !== tr) {
                tbody.insertBefore(tr, tbody.children[i] || null);
            }
            return;
        }
        rowSigCache[vm.name] = sig;

        tr.className = (i === selectedVm ? 'selected ' : '') +
                       (vm.running ? 'running' : 'stopped');
        tr.onclick = function(e) {
            if (e.target.closest('.icon-btn')) return;
            if (e.target.closest('.snap-cell')) return;
            selectVm(i);
        };

        var cells = buildRowCells(vm, i, statusTd);

        for (var c = 0; c < cells.length; c++) {
            var newCell = cells[c];
            var oldCell = tr.children[c];
            if (oldCell === newCell) continue;
            if (oldCell) tr.replaceChild(newCell, oldCell);
            else tr.appendChild(newCell);
        }
        while (tr.children.length > cells.length) tr.removeChild(tr.lastChild);

        if (tbody.children[i] !== tr) {
            tbody.insertBefore(tr, tbody.children[i] || null);
        }
    });
}

function makeCell(text, title) {
    var td = document.createElement('td');
    td.textContent = text;
    if (title) td.title = title;
    return td;
}

function makeIconCell(cls, icon, active, handler, extraClass, title) {
    var td = document.createElement('td');
    td.className = 'icon-col';
    var btn = document.createElement('button');
    btn.className = 'icon-btn ' + cls + (active ? '' : ' inactive') + (extraClass ? ' ' + extraClass : '');
    btn.textContent = icon;
    if (title) btn.title = title;
    if (active) btn.onclick = handler;
    else btn.disabled = true;
    td.appendChild(btn);
    return td;
}

/* ---- VM Selection ---- */

function selectVm(idx) {
    selectedVm = idx;
    renderVmTable();
    sendCmd('selectVm', { vmIndex: idx });
}

function updateVmList(next) {
    selectedSnap.forEach(function(value, name) {
        var before = vms.find(function(vm) { return vm.name === name; });
        var after = next.find(function(vm) { return vm.name === name; });
        if (!before || !after || snapshotTreeSignature(before) !== snapshotTreeSignature(after))
            selectedSnap.delete(name);
    });
    vms = next;
}

function vmIndexByName(name) {
    return vms.findIndex(function(vm) { return vm.name === name; });
}

function openEditVmModal(idx) {
    var vm = vms[idx];
    if (!vm || vm.running || vm.buildingVhdx) return;
    editVmState = { name: vm.name, initial: Object.assign({}, vm), previousFocus: rowCache[vm.name].querySelector('.edit') };
    document.getElementById('edit-vm-title').textContent = t('Edit {name}', { name: vm.name });
    document.getElementById('edit-ram-size').value = vm.ramMb;
    document.getElementById('edit-ram-size').min = hostBridge.isMac ? 512 : 4000;
    document.getElementById('edit-cpu-cores').value = vm.cpuCores;
    setGpuSelection('edit-gpu-mode', vm);
    document.getElementById('edit-net-mode').value = String(vm.networkMode);
    updateEditVmModal();
    document.getElementById('edit-vm-overlay').classList.add('active');
    document.getElementById('edit-ram-size').focus();
}

function closeEditVmModal() {
    document.getElementById('edit-vm-overlay').classList.remove('active');
    restoreVmModalFocus(editVmState, '.edit');
    editVmState = null;
}

function restoreVmModalFocus(state, selector) {
    if (!state) return;
    var target = state.previousFocus;
    if (!target || !target.isConnected || target.disabled) {
        var row = rowCache[state.name];
        target = row && row.querySelector(selector);
    }
    if (!target || !target.isConnected || target.disabled) target = document.getElementById('btn-new-sandbox');
    target.focus();
}

function editVmValues() {
    var values = {
        ramMb: document.getElementById('edit-ram-size').valueAsNumber,
        cpuCores: document.getElementById('edit-cpu-cores').valueAsNumber
    };
    if (!hostBridge.isMac) {
        Object.assign(values, selectedGpu('edit-gpu-mode'));
        values.networkMode = Number(document.getElementById('edit-net-mode').value);
    }
    return values;
}

function editVmValidationError(values) {
    if (!Number.isInteger(values.cpuCores) || values.cpuCores < 1 || values.cpuCores > 2147483647)
        return t('CPU cores must be a whole number of at least 1.');
    var minRam = hostBridge.isMac ? 512 : 4000;
    if (values.ramMb !== editVmState.initial.ramMb &&
        (!Number.isInteger(values.ramMb) || values.ramMb < minRam || values.ramMb > 2147483647))
        return t('RAM must be a whole number of at least {min} MB.', { min: minRam });
    return '';
}

function updateEditVmModal() {
    if (!editVmState) return;
    var vm = vms[vmIndexByName(editVmState.name)];
    if (!vm) { closeEditVmModal(); return; }
    var disabled = vm.running || vm.buildingVhdx;
    document.querySelectorAll('#edit-vm-overlay input, #edit-vm-overlay select').forEach(function(el) {
        el.disabled = !!disabled;
    });
    var values = editVmValues();
    var error = disabled ? t('Stop the VM before editing its configuration.') : editVmValidationError(values);
    document.getElementById('edit-vm-warn').textContent = error;
    document.getElementById('btn-save-edit-vm').disabled = !!error;
}

function saveEditVm() {
    if (!editVmState) return;
    updateEditVmModal();
    if (!editVmState || document.getElementById('btn-save-edit-vm').disabled) return;
    var idx = vmIndexByName(editVmState.name);
    var values = editVmValues();
    if (values.ramMb !== editVmState.initial.ramMb) values.ramMb = alignRamMb(values.ramMb);
    var gpuChanged = !hostBridge.isMac &&
        gpuSelectionValue(values) !== gpuSelectionValue(editVmState.initial) &&
        gpuSelectionValue(values) !== gpuSelectionValue(vms[idx]);
    var fields = Object.keys(values).filter(function(field) {
        return field !== 'gpuMode' && field !== 'gpuId' &&
            values[field] !== editVmState.initial[field] && values[field] !== vms[idx][field];
    });
    closeEditVmModal();
    fields.forEach(function(field) {
        sendCmd('editVm', { vmIndex: idx, field: field, value: String(values[field]) });
    });
    if (gpuChanged)
        sendCmd('editVm', { vmIndex: idx, field: 'gpuMode', value: String(values.gpuMode), gpuId: values.gpuId });
}

document.getElementById('edit-vm-overlay').addEventListener('input', updateEditVmModal);
document.getElementById('edit-vm-overlay').addEventListener('change', updateEditVmModal);
document.getElementById('edit-ram-size').addEventListener('change', function() {
    if (Number.isInteger(this.valueAsNumber)) this.value = alignRamMb(this.valueAsNumber);
    updateEditVmModal();
});

['edit-vm-overlay', 'snapshot-overlay'].forEach(function(id) {
    var backdropPress = false;
    var overlay = document.getElementById(id);
    overlay.addEventListener('mousedown', function(e) { backdropPress = e.target === overlay; });
    overlay.addEventListener('click', function(e) {
        if (backdropPress && e.target === overlay) {
            if (id === 'edit-vm-overlay') closeEditVmModal();
            else closeSnapshotModal();
        }
        backdropPress = false;
    });
});

/* ---- Force Stop VM ---- */

function onStopVm(idx) {
    var vm = vms[idx];
    if (!vm) return;
    if (vm.isTemplate) {
        showModal(
            t('Cancel Template Build'),
            t('Stopping a template build will delete the incomplete template "{name}".\n\nAre you sure?', { name: vm.name }),
            t('Stop & Delete')
        ).then(function(confirmed) {
            if (confirmed) {
                sendCmd('stopVm', { vmIndex: idx });
                sendCmd('deleteVm', { vmIndex: idx });
            }
        });
    } else {
        if (localStorage.getItem('suppress_force_stop_warn') === '1') {
            sendCmd('stopVm', { vmIndex: idx });
        } else {
            showForceStopModal(idx);
        }
    }
}

function showForceStopModal(idx) {
    document.getElementById('modal-title').textContent = t('Force Stop');
    document.getElementById('modal-message').textContent =
        t('Force Stop will immediately power-off "{name}" which may result in corruption of its data.', { name: vms[idx].name });
    document.getElementById('modal-confirm-btn').textContent = t('Force Stop');

    var cb = document.getElementById('modal-dont-show');
    if (cb) { cb.checked = false; cb.parentElement.style.display = ''; }

    document.getElementById('modal-overlay').classList.add('active');
    pendingConfirm = { resolve: function(confirmed) {
        if (confirmed) {
            if (cb && cb.checked) localStorage.setItem('suppress_force_stop_warn', '1');
            sendCmd('stopVm', { vmIndex: idx });
        }
        if (cb) cb.parentElement.style.display = 'none';
    }};
}

/* ---- Delete VM ---- */

function onDeleteVm(idx) {
    var vm = vms[idx];
    if (!vm) return;
    showModal(
        t('Confirm Delete'),
        t('Are you sure you want to delete VM "{name}"?\n\nThis will permanently delete all disk data and snapshots.', { name: vm.name }),
        t('Delete')
    ).then(function(confirmed) {
        if (confirmed) {
            sendCmd('deleteVm', { vmIndex: idx });
        }
    });
}

/* ---- Snapshots ---- */

/* Parse select value string into {snapIndex, branchIndex} */
function parseSnapValue(val) {
    if (!val || val === 'current') return {snapIndex: -1, branchIndex: -1};
    if (val === 'base') return {snapIndex: -2, branchIndex: -1};
    if (val.substring(0, 5) === 'base-') return {snapIndex: -2, branchIndex: parseInt(val.substring(5))};
    var parts = val.split('-');
    if (parts.length === 1) return {snapIndex: parseInt(parts[0]), branchIndex: -1};
    return {snapIndex: parseInt(parts[0]), branchIndex: parseInt(parts[1])};
}

function snapshotTreeSignature(vm) {
    return JSON.stringify([vm.hasSnapshots, vm.baseBranches || [], vm.snapshots || []]);
}

function snapshotSelection(vm, value) {
    var p = value === 'current' ? { snapIndex: vm.snapCurrent, branchIndex: vm.snapCurrentBranch } : parseSnapValue(value);
    var snap = p.snapIndex >= 0 && (vm.snapshots || [])[p.snapIndex];
    var branches = snap ? snap.branches || [] : vm.baseBranches || [];
    var branch = p.branchIndex >= 0 && branches[p.branchIndex];
    return { snapIndex: p.snapIndex, branchIndex: p.branchIndex, snapshot: snap, branch: branch };
}

function snapshotRowValue(vm, value) {
    var p = snapshotSelection(vm, value);
    if (p.branch) return (p.snapIndex === -2 ? 'base-' : p.snapIndex + '-') + p.branchIndex;
    if (p.snapshot) return String(p.snapIndex);
    return 'base';
}

function snapshotPath(vm, value) {
    var p = snapshotSelection(vm, value);
    var path = t('Base');
    if (p.snapshot) path += ' \u2192 ' + p.snapshot.name;
    if (p.branch) path += ' \u2192 ' + (p.branch.name || t('branch {n}', { n: p.branchIndex + 1 }));
    if (value !== 'current' && p.branchIndex < 0) path += ' ' + t('[new branch]');
    return path;
}

function makeSnapCell(vm, vmIdx) {
    var td = document.createElement('td');
    td.className = 'snap-cell';
    var button = document.createElement('button');
    button.className = 'snap-open';
    button.textContent = vm.hasSnapshots ? snapshotPath(vm, selectedSnap.get(vm.name) || 'current') : t('No snapshots');
    button.title = t('Snapshots — {name}', { name: button.textContent });
    button.setAttribute('aria-haspopup', 'dialog');
    button.onclick = function(e) { e.stopPropagation(); openSnapshotModal(vmIdx); };
    td.appendChild(button);
    return td;
}

function openSnapshotModal(idx) {
    var vm = vms[idx];
    if (!vm || hostBridge.isMac) return;
    var value = selectedSnap.get(vm.name) || 'current';
    snapshotModal = {
        name: vm.name,
        currentValue: value,
        currentRow: snapshotRowValue(vm, value),
        currentPath: snapshotPath(vm, value),
        selectedValue: null,
        treeSignature: snapshotTreeSignature(vm),
        previousFocus: rowCache[vm.name].querySelector('.snap-open'),
        signature: null
    };
    document.getElementById('snapshot-title').textContent = t('Snapshots — {name}', { name: vm.name });
    document.getElementById('snapshot-warn').textContent = '';
    renderSnapshotModal();
    document.getElementById('snapshot-overlay').classList.add('active');
    var choice = document.querySelector('#snapshot-tree [aria-pressed="true"]:not(:disabled)');
    (choice || document.querySelector('#snapshot-overlay .modal-buttons button:last-child')).focus();
}

function closeSnapshotModal() {
    document.getElementById('snapshot-overlay').classList.remove('active');
    restoreVmModalFocus(snapshotModal, '.snap-open');
    snapshotModal = null;
}

function renderSnapshotModal() {
    if (!snapshotModal) return;
    var vm = vms[vmIndexByName(snapshotModal.name)];
    if (!vm) { closeSnapshotModal(); return; }
    var value = selectedSnap.get(vm.name) || 'current';
    var disabled = !!(vm.running || vm.buildingVhdx);
    var treeSignature = snapshotTreeSignature(vm);
    if (treeSignature !== snapshotModal.treeSignature) {
        snapshotModal.currentValue = value;
        snapshotModal.currentRow = snapshotRowValue(vm, value);
        snapshotModal.currentPath = snapshotPath(vm, value);
        snapshotModal.selectedValue = null;
        snapshotModal.treeSignature = treeSignature;
    }
    var signature = [treeSignature, vm.snapCurrent, vm.snapCurrentBranch, value, snapshotModal.selectedValue, disabled].join('|');
    if (signature === snapshotModal.signature) return;
    snapshotModal.signature = signature;
    var tree = document.getElementById('snapshot-tree');
    var focusedValue = tree.contains(document.activeElement) ? document.activeElement.value : null;
    tree.textContent = '';
    var list = document.createElement('ul');
    tree.appendChild(list);
    var p = snapshotSelection(vm, value);
    var currentRow = snapshotModal.currentRow;
    var selectedRow = snapshotRowValue(vm, value);
    document.getElementById('snapshot-current').textContent = t('Current: {path}', { path: snapshotModal.currentPath });
    document.getElementById('snapshot-help').textContent = disabled
        ? t('Stop the VM to select a different disk or manage snapshots.')
        : !vm.hasSnapshots ? t('No snapshots. This VM uses its original disk.')
        : value === 'current' ? t('The next start resumes the current disk. A frozen disk will start in a new branch.')
        : p.branch ? t('The next start resumes this branch.')
        : t('The next start creates a new branch from this disk.');

    function addChoice(parent, val, name, meta) {
        var item = document.createElement('li');
        var choice = document.createElement('button');
        choice.type = 'button';
        choice.className = 'snapshot-choice';
        choice.value = val;
        choice.setAttribute('aria-pressed', String(selectedRow === val));
        choice.disabled = disabled;
        choice.onclick = function() {
            snapshotModal.selectedValue = val;
            selectedSnap.set(vm.name, vm.hasSnapshots ? val : 'current');
            document.getElementById('snapshot-warn').textContent = '';
            renderVmTable();
        };
        var text = document.createElement('span');
        text.className = 'snapshot-name';
        text.textContent = name + (currentRow === val ? ' ' + t('(current)') : '') +
            (snapshotModal.selectedValue === val ? ' ' + t('(selected)') : '');
        choice.appendChild(text);
        if (meta) {
            var info = document.createElement('span');
            info.className = 'snapshot-meta';
            info.textContent = meta;
            choice.appendChild(info);
        }
        item.appendChild(choice);
        parent.appendChild(item);
        return item;
    }
    function addBranches(parent, branches, prefix) {
        branches.forEach(function(branch, b) {
            var meta = branch.date ? t('Modified {date}', { date: branch.date }) : '';
            if (branch.sizeGb) meta += (meta ? ' · ' : '') + t('{size} GB including parent disks', { size: branch.sizeGb });
            addChoice(parent, prefix + b, branch.name || t('branch {n}', { n: b + 1 }), meta);
        });
    }
    var base = addChoice(list, 'base', t('Base'), vm.hasSnapshots ? t('New branch on start') : t('Original disk'));
    if (vm.hasSnapshots) {
        var children = document.createElement('ul');
        base.appendChild(children);
        addBranches(children, vm.baseBranches || [], 'base-');
        (vm.snapshots || []).forEach(function(snap, i) {
            var item = addChoice(children, String(i), snap.name,
                (snap.date ? t('Created {date}', { date: snap.date }) + ' · ' : '') + t('New branch on start'));
            var branches = document.createElement('ul');
            item.appendChild(branches);
            addBranches(branches, snap.branches || [], i + '-');
        });
    }
    if (focusedValue !== null && !disabled) {
        var focusChoice = Array.from(tree.querySelectorAll('.snapshot-choice')).find(function(choice) { return choice.value === focusedValue; });
        (focusChoice || tree.querySelector('[aria-pressed="true"]')).focus();
    }
    var editable = !!(p.snapshot || p.branch);
    document.getElementById('btn-snapshot-create').disabled = disabled;
    document.getElementById('btn-snapshot-rename').disabled = disabled || !editable;
    document.getElementById('btn-snapshot-delete').disabled = disabled || !editable;
}

function snapshotActionContext() {
    if (!snapshotModal) return null;
    var vm = vms[vmIndexByName(snapshotModal.name)];
    if (!vm || vm.running || vm.buildingVhdx) return null;
    return { modal: snapshotModal, name: vm.name, value: selectedSnap.get(vm.name) || 'current',
        tree: snapshotTreeSignature(vm), vm: vm };
}

function snapshotActionIndex(context) {
    if (snapshotModal !== context.modal) return -1;
    var idx = vmIndexByName(context.name);
    var vm = vms[idx];
    if (!vm || vm.running || vm.buildingVhdx) return -1;
    if (context.tree !== snapshotTreeSignature(vm)) {
        document.getElementById('snapshot-warn').textContent = t('Snapshots changed. Select the disk again.');
        return -1;
    }
    return idx;
}

function takeSnapshot() {
    var context = snapshotActionContext();
    if (!context) return;
    showModal(t('New Snapshot'), t('Create a new snapshot of the base disk. Snapshots are frozen points in time that you can create independent branches from.'), t('Create'), {
        confirmClass: 'primary',
        input: { label: t('Snapshot name:'), value: t('Snapshot {n}', { n: (context.vm.snapshots || []).length + 1 }) }
    }).then(function(result) {
        if (result === false) return;
        var idx = snapshotActionIndex(context);
        if (idx >= 0) sendCmd('snapTake', { vmIndex: idx, name: result });
    });
}

function renameSnapshot() {
    var context = snapshotActionContext();
    if (!context) return;
    var p = snapshotSelection(context.vm, context.value);
    var target = p.branch || p.snapshot;
    if (!target) return;
    showModal(t('Rename'), t('Enter a new name:'), t('Rename'), {
        confirmClass: 'primary',
        input: { label: t('Name:'), value: target.name || '' }
    }).then(function(result) {
        if (result === false || result === target.name) return;
        var idx = snapshotActionIndex(context);
        if (idx < 0) return;
        var cmd = { vmIndex: idx, snapIndex: p.snapIndex, name: result };
        if (p.branchIndex >= 0) cmd.branchIndex = p.branchIndex;
        sendCmd('snapRename', cmd);
    });
}

function deleteSnapshot() {
    var context = snapshotActionContext();
    if (!context) return;
    var p = snapshotSelection(context.vm, context.value);
    var target = p.branch || p.snapshot;
    if (!target) return;
    showModal(p.branch ? t('Delete Branch') : t('Delete Snapshot'),
        p.branch ? t('Delete branch "{name}"? Its parent disk will be kept.', { name: target.name || '' })
            : t('Delete snapshot "{name}" and all its branches?', { name: target.name }), t('Delete')
    ).then(function(confirmed) {
        if (!confirmed) return;
        var idx = snapshotActionIndex(context);
        if (idx < 0) return;
        selectedSnap.delete(context.name);
        if (p.branch) sendCmd('snapDeleteBranch', { vmIndex: idx, snapIndex: p.snapIndex, branchIndex: p.branchIndex });
        else sendCmd('snapDelete', { vmIndex: idx, snapIndex: p.snapIndex });
    });
}

function onStartVm(idx) {
    var vm = vms[idx];
    if (!vm || vm.running || vm.buildingVhdx) return;
    var name = vm.name;
    var p = parseSnapValue(selectedSnap.get(name) || 'current');
    if ((p.snapIndex >= 0 || p.snapIndex === -2) && p.branchIndex < 0) {
        var tree = snapshotTreeSignature(vm);
        var parentName = p.snapIndex === -2 ? t('Base') : vm.snapshots[p.snapIndex].name;
        var now = new Date();
        var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
        var defaultName = now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
        showModal(t('New Branch'), t('A new branch will be created from {parent}. Branches are independent working copies \u2014 changes in one branch don\u2019t affect others or modify the base snapshot.', { parent: parentName }), t('Boot'), {
            confirmClass: 'primary', input: { label: t('Branch name:'), value: defaultName }
        }).then(function(result) {
            if (result === false) return;
            var currentIdx = vmIndexByName(name);
            var current = vms[currentIdx];
            if (!current || current.running || current.buildingVhdx) return;
            if (tree !== snapshotTreeSignature(current)) {
                showModal(t('Snapshots Changed'), t('Select the disk again before starting the VM.'), t('OK'), { confirmClass: 'primary' });
                return;
            }
            selectedSnap.delete(name);
            sendCmd('startVm', { vmIndex: currentIdx, snapIndex: p.snapIndex, branchIndex: p.branchIndex, branchName: result });
        });
    } else {
        sendCmd('startVm', { vmIndex: idx, snapIndex: p.snapIndex, branchIndex: p.branchIndex });
    }
}

/* ---- Log ---- */

function appendLog(msg) {
    var panel = document.getElementById('log-panel');
    var div = document.createElement('div');
    div.className = 'log-line';
    div.dataset.raw = msg;   /* kept so the line can be re-translated on a language switch */
    div.textContent = tn(msg);
    panel.appendChild(div);
    panel.scrollTop = panel.scrollHeight;
}

/* ---- Prerequisite check ---- */

function setPrereqDialog(messageHtml, buttons) {
    document.getElementById('prereq-message').innerHTML = messageHtml;
    var box = document.getElementById('prereq-buttons');
    box.textContent = '';
    buttons.forEach(function(b) {
        var btn = document.createElement('button');
        if (b.primary) btn.className = 'primary';
        btn.textContent = b.label;
        btn.onclick = b.onclick;
        box.appendChild(btn);
    });
    box.style.display = '';
}

function hidePrereqOverlay() {
    document.getElementById('prereq-overlay').classList.remove('active');
}

function onPrereqRequired() {
    setPrereqDialog(
        t('App Sandbox requires the <strong>Virtual Machine Platform</strong> Windows feature to create and run VMs. This feature is not currently enabled.'),
        [{ label: t('Cancel'), onclick: hidePrereqOverlay },
         { label: t('Enable'), primary: true, onclick: enableFeature }]);
    document.getElementById('prereq-overlay').classList.add('active');
}

function onPrereqReboot() {
    setPrereqDialog(
        t('<strong>Virtual Machine Platform</strong> has been enabled but a reboot is required before VMs can be created or started.'),
        [{ label: t('Later'), onclick: hidePrereqOverlay },
         { label: t('Reboot Now'), primary: true, onclick: function() { sendCmd('enableFeatureReboot'); } }]);
    document.getElementById('prereq-overlay').classList.add('active');
}

function enableFeature() {
    document.getElementById('prereq-message').innerHTML =
        t('Enabling <strong>Virtual Machine Platform</strong>. This may take a minute...') +
        '<div class="prereq-progress"><div class="prereq-progress-bar" id="prereq-bar"></div></div>' +
        '<div class="prereq-pct" id="prereq-pct">0%</div>';
    document.getElementById('prereq-buttons').style.display = 'none';
    sendCmd('enableFeature');
}

function onPrereqProgress(msg) {
    var bar = document.getElementById('prereq-bar');
    var pctEl = document.getElementById('prereq-pct');
    if (bar) bar.style.width = msg.pct + '%';
    if (pctEl) pctEl.textContent = msg.pct + '%';
}

function onPrereqResult(msg) {
    if (msg.ok && !msg.reboot) {
        hidePrereqOverlay();
    } else if (msg.ok && msg.reboot) {
        setPrereqDialog(
            t('<strong>Virtual Machine Platform</strong> has been enabled. A reboot is required for the change to take effect.'),
            [{ label: t('Later'), onclick: hidePrereqOverlay },
             { label: t('Reboot Now'), primary: true, onclick: function() { sendCmd('enableFeatureReboot'); } }]);
    } else {
        setPrereqDialog(
            t('Failed to enable <strong>Virtual Machine Platform</strong>.') + '<br><br>' +
            t('Try enabling it manually:') + '<br>' +
            t('Settings &gt; System &gt; Optional Features &gt; More Windows Features &gt; Virtual Machine Platform'),
            [{ label: t('Close'), onclick: hidePrereqOverlay }]);
    }
}

/* ---- Modal ---- */

function showModal(title, message, confirmText, opts) {
    var previousFocus = document.activeElement;
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    var confirmBtn = document.getElementById('modal-confirm-btn');
    confirmBtn.textContent = confirmText || t('Confirm');
    confirmBtn.className = (opts && opts.confirmClass) || 'danger';
    var cb = document.getElementById('modal-dont-show');
    if (cb) cb.parentElement.style.display = 'none';
    var inputRow = document.getElementById('modal-input-row');
    var inputEl = document.getElementById('modal-input');
    if (opts && opts.input) {
        inputRow.style.display = 'block';
        inputEl.value = opts.input.value || '';
        if (opts.input.label) document.getElementById('modal-input-label').textContent = opts.input.label;
        inputEl.onkeydown = function(e) { if (e.key === 'Enter') modalResolve(true); };
        inputEl.oninput = function() {
            /* Strip characters that would break the INI-style .dat file */
            var clean = inputEl.value.replace(/[\n\r\t\[\]\\]/g, '');
            if (clean !== inputEl.value) inputEl.value = clean;
        };
        inputEl.maxLength = 127;
        setTimeout(function() { inputEl.select(); inputEl.focus(); }, 50);
    } else {
        inputRow.style.display = 'none';
    }
    document.getElementById('modal-overlay').classList.add('active');
    if (!(opts && opts.input)) confirmBtn.focus();

    return new Promise(function(resolve) {
        pendingConfirm = { resolve: resolve, hasInput: !!(opts && opts.input), previousFocus: previousFocus };
    });
}

function modalResolve(result) {
    document.getElementById('modal-overlay').classList.remove('active');
    if (pendingConfirm) {
        if (pendingConfirm.previousFocus && pendingConfirm.previousFocus.isConnected) {
            pendingConfirm.previousFocus.focus();
        } else if (snapshotModal) {
            document.querySelector('#snapshot-overlay .modal-buttons button:last-child').focus();
        } else if (editVmState) {
            document.getElementById('btn-save-edit-vm').focus();
        }
        if (result && pendingConfirm.hasInput) {
            pendingConfirm.resolve(document.getElementById('modal-input').value);
        } else {
            pendingConfirm.resolve(result);
        }
        pendingConfirm = null;
    }
}

/* ---- Minimum size reporting ---- */

function reportMinSize() {
    var minW = 0;

    /* Measure <table> elements directly — they always report true natural width */
    var tables = document.querySelectorAll('table');
    tables.forEach(function(t) {
        if (t.scrollWidth > minW) minW = t.scrollWidth;
    });

    /* Add wrapper border (2px) + body padding (24px) */
    minW += 28;

    /* Height: sum of all sections at minimum height (log just needs ~100px) */
    var minH = 0;
    var sections = document.querySelectorAll('section');
    sections.forEach(function(s, i) {
        if (i < sections.length - 1) {
            minH += s.scrollHeight + 12;
        } else {
            minH += 100;
        }
    });
    minH += 16;

    sendCmd('setMinSize', { width: minW, height: minH });
}

/* ---- Language ---- */

/* Called by i18n.js after the static markup has been re-translated. Re-render
 * everything that app.js builds from strings at runtime. */
window.onLanguageChanged = function() {
    document.querySelectorAll('#log-panel .log-line').forEach(function(line) {
        line.textContent = tn(line.dataset.raw);
    });
    renderVmTable();
    if (lastHostInfo) updateHostInfo(lastHostInfo);
    var autoOpt = document.querySelector('#net-adapter option[value=""]');
    if (autoOpt) autoOpt.textContent = t('(Auto)');
    populateTemplates(currentTemplates);
    updateCreateButtons();
    setTimeout(reportMinSize, 50);   /* column widths differ per language */
};

/* ---- Init ---- */
document.getElementById('template-dropdown-selected').textContent = templateDefaultLabel();
/* Signal to C that the UI is ready */
sendCmd('uiReady');

/* Report min size once layout is complete (covers case with no VMs) */
setTimeout(function() {
    if (!minSizeReported) {
        minSizeReported = true;
        reportMinSize();
    }
}, 300);
