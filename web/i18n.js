/* App Sandbox - UI localisation
 *
 * English source strings double as the lookup keys: t('Some text') returns the
 * translation for the active language, or the key itself when no translation
 * exists, so a missing entry degrades to English instead of breaking the UI.
 * Placeholders use {name} and are filled from the params object.
 *
 * Static markup is translated through attributes (the English text in the HTML
 * is the key):
 *   data-i18n                 -> element text
 *   data-i18n-title           -> title attribute
 *   data-i18n-placeholder     -> placeholder attribute
 *   data-i18n-aria-label      -> aria-label attribute
 *
 * To add a language: add an entry to LANGUAGES and a matching dictionary in
 * TRANSLATIONS. Messages that originate in the native host (log lines, some
 * installer status text) are not translated here.
 */
'use strict';

var LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'zh-TW', name: '繁體中文' }   /* 繁體中文 */
];

var TRANSLATIONS = {
    'zh-TW': {
        /* Main window */
        'Sandboxes': '沙箱',
        '+ New Sandbox': '+ 新增沙箱',
        '+ Create your first sandbox': '+ 建立您的第一個沙箱',
        'Language': '語言',
        'Name': '名稱',
        'OS': '作業系統',
        'Status': '狀態',
        'Agent': '代理程式',
        'CPU': 'CPU',
        'RAM (MB)': '記憶體 (MB)',
        'HDD (GB)': '硬碟 (GB)',
        'GPU': 'GPU',
        'Network': '網路',
        'Snapshot': '快照',
        'IDD Display': 'IDD 顯示器',
        'SSH': 'SSH',
        'Log': '記錄',

        /* Prerequisite dialog */
        'Virtual Machine Platform Required': '需要「虛擬機器平台」',
        'App Sandbox requires the <strong>Virtual Machine Platform</strong> Windows feature to create and run VMs. This feature is not currently enabled.':
            'App Sandbox 需要 Windows 的<strong>虛擬機器平台</strong>功能才能建立及執行虛擬機器，但目前尚未啟用此功能。',
        '<strong>Virtual Machine Platform</strong> has been enabled but a reboot is required before VMs can be created or started.':
            '<strong>虛擬機器平台</strong>已啟用，但必須重新啟動電腦後才能建立或啟動虛擬機器。',
        'Enabling <strong>Virtual Machine Platform</strong>. This may take a minute...':
            '正在啟用<strong>虛擬機器平台</strong>，可能需要一分鐘…',
        '<strong>Virtual Machine Platform</strong> has been enabled. A reboot is required for the change to take effect.':
            '<strong>虛擬機器平台</strong>已啟用，必須重新啟動電腦後變更才會生效。',
        'Failed to enable <strong>Virtual Machine Platform</strong>.': '無法啟用<strong>虛擬機器平台</strong>。',
        'Try enabling it manually:': '請嘗試手動啟用：',
        'Settings &gt; System &gt; Optional Features &gt; More Windows Features &gt; Virtual Machine Platform':
            '設定 &gt; 系統 &gt; 選用功能 &gt; 更多 Windows 功能 &gt; 虛擬機器平台',
        'Enable': '啟用',
        'Later': '稍後',
        'Reboot Now': '立即重新啟動',
        'Close': '關閉',

        /* New Sandbox dialog */
        'New Sandbox': '新增沙箱',
        'OS Type:': '作業系統類型：',
        'VM Name:': '虛擬機器名稱：',
        'OS Image:': 'OS 映像檔：',
        'Path to ISO...': 'ISO 檔案路徑…',
        'Browse...': '瀏覽…',
        'OR': '或',
        'Template:': '範本：',
        '(None)': '(無)',
        '(1 template available)': '(有 1 個可用範本)',
        '({n} templates available)': '(有 {n} 個可用範本)',
        'Delete template': '刪除範本',
        'Distribution:': '發行版：',
        'Downloaded on first create (~600 MB), cached on the host': '首次建立時下載 (約 600 MB)，並快取於主機',
        'HDD Size:': '硬碟大小：',
        'HDD location...': '硬碟位置…',
        'HDD Location': '硬碟位置',
        'HDD Location: {path}': '硬碟位置：{path}',
        'RAM Size:': '記憶體大小：',
        'CPU Cores:': 'CPU 核心數：',
        'GPU:': 'GPU：',
        'None': '無',
        'Default GPU': '預設 GPU',
        'Network:': '網路：',
        'NAT': 'NAT',
        'External': '外部',
        'Internal': '內部',
        'Adapter:': '介面卡：',
        '(Auto)': '(自動)',
        'Username:': '使用者名稱：',
        'Password:': '密碼：',
        'Confirm:': '確認：',
        'Options:': '選項：',
        'Test Mode': '測試模式',
        'Disable Secure Boot and enable test-signing (required to load the test-signed guest drivers)':
            '停用安全開機並啟用測試簽署 (載入經測試簽署的客體驅動程式時需要)',
        'SSH Server': 'SSH 伺服器',
        "Exposes the VM's sshd on a host-loopback port, tunnelled over vsock":
            '將虛擬機器的 sshd 透過 vsock 通道公開於主機的回送連接埠',
        'Deploy SSH key': '部署 SSH 金鑰',
        'Deploy the AppSandbox SSH public key so you can connect with key auth (requires SSH Server)':
            '部署 AppSandbox 的 SSH 公開金鑰，以便使用金鑰驗證連線 (需要啟用 SSH 伺服器)',
        'Cancel': '取消',
        'Build Template': '建置範本',
        'Create Sandbox': '建立沙箱',

        /* Host info / disk space */
        'Host: {host} cores | VMs using: {used}': '主機：{host} 核心 | 虛擬機器使用中：{used}',
        'Host: {host} MB | VMs using: {used} MB': '主機：{host} MB | 虛擬機器使用中：{used} MB',
        'Free: {free} | VMs allocated: {used} GB': '可用：{free} | 虛擬機器已配置：{used} GB',
        'Free: {free}': '可用：{free}',
        'Checking...': '檢查中…',
        'Unavailable': '無法使用',

        /* HDD location dialog */
        'Choose an existing folder. Disks are stored in a subfolder named after the VM.':
            '請選擇現有的資料夾。磁碟會儲存在以虛擬機器命名的子資料夾中。',
        'Folder:': '資料夾：',
        'Save': '儲存',
        'Disk folder cannot contain control characters.': '磁碟資料夾不可包含控制字元。',
        'Disk folder must be an absolute path.': '磁碟資料夾必須是絕對路徑。',
        'Disk folder contains invalid characters.': '磁碟資料夾包含無效字元。',
        'Disk folder is unavailable.': '磁碟資料夾無法使用。',
        'Checking disk folder...': '正在檢查磁碟資料夾…',

        /* Create form validation */
        'Templates require a Windows guest on a Windows host.': '範本需要在 Windows 主機上使用 Windows 客體。',
        'Passwords do not match.': '密碼不一致。',
        'Disk size must be a whole number of at least 1 GB.': '磁碟大小必須是至少 1 GB 的整數。',
        'RAM must be an even number of at least 512 MB.': '記憶體必須是至少 512 MB 的偶數。',
        'CPU cores must be a whole number of at least 1.': 'CPU 核心數必須是至少 1 的整數。',
        'Select an OS image or an available template.': '請選擇作業系統映像檔或可用的範本。',
        'VM name is required.': '必須輸入虛擬機器名稱。',
        'VM name cannot exceed 63 characters (macOS LocalHostName limit).': '虛擬機器名稱不可超過 63 個字元 (macOS LocalHostName 限制)。',
        'VM name cannot exceed 63 characters (Linux hostname limit).': '虛擬機器名稱不可超過 63 個字元 (Linux 主機名稱限制)。',
        'Linux hostname must be lowercase.': 'Linux 主機名稱必須為小寫。',
        'VM name cannot exceed 15 characters (NetBIOS limit).': '虛擬機器名稱不可超過 15 個字元 (NetBIOS 限制)。',
        'VM name can only contain letters, digits, and hyphens.': '虛擬機器名稱只能包含英文字母、數字及連字號。',
        'VM name cannot be only digits.': '虛擬機器名稱不可全為數字。',
        'VM name cannot start or end with a hyphen.': '虛擬機器名稱不可以連字號開頭或結尾。',
        'A VM with this name already exists.': '已有同名的虛擬機器。',
        'A template with this name already exists.': '已有同名的範本。',
        'Username is required.': '必須輸入使用者名稱。',
        'Username must be a string.': '使用者名稱必須是字串。',
        'Username cannot contain NUL characters.': '使用者名稱不可包含 NUL 字元。',
        'Username contains invalid Unicode.': '使用者名稱包含無效的 Unicode。',
        'Username cannot exceed 32 characters (Linux limit).': '使用者名稱不可超過 32 個字元 (Linux 限制)。',
        'Linux username: lowercase letters, digits, _ and - only; start with a letter or _.':
            'Linux 使用者名稱：只能使用小寫字母、數字、_ 及 -，且須以字母或 _ 開頭。',
        'Username is a reserved name.': '此使用者名稱為保留名稱。',
        'Username is too long (max 63 UTF-8 bytes in AppSandbox).': '使用者名稱過長 (AppSandbox 中最多 63 個 UTF-8 位元組)。',
        'Username cannot contain spaces (macOS short account name).': '使用者名稱不可包含空格 (macOS 簡短帳號名稱)。',
        'Username contains invalid characters.': '使用者名稱包含無效字元。',
        'Username cannot be . or .. (macOS short account name).': '使用者名稱不可為 . 或 .. (macOS 簡短帳號名稱)。',
        'Username cannot exceed 20 characters.': '使用者名稱不可超過 20 個字元。',
        'Username cannot be only dots or spaces.': '使用者名稱不可只包含句點或空格。',
        'Username cannot end with a period.': '使用者名稱不可以句點結尾。',
        'Username cannot match the VM name (Windows computer name).': '使用者名稱不可與虛擬機器名稱 (Windows 電腦名稱) 相同。',
        'Password is required.': '必須輸入密碼。',
        'Password cannot contain NUL characters.': '密碼不可包含 NUL 字元。',
        'Password contains invalid Unicode.': '密碼包含無效的 Unicode。',
        'Password must be at least 6 characters (Ubuntu minimum).': '密碼至少需要 6 個字元 (Ubuntu 最低要求)。',
        'Password is too long (max 255 bytes).': '密碼過長 (最多 255 位元組)。',
        'Password must be at least 4 characters (macOS minimum).': '密碼至少需要 4 個字元 (macOS 最低要求)。',
        'Password is too long (max 127 UTF-8 bytes in AppSandbox).': '密碼過長 (AppSandbox 中最多 127 個 UTF-8 位元組)。',
        'Password is too long (max 127 characters for Windows).': '密碼過長 (Windows 最多 127 個字元)。',

        /* VM table */
        'Staging files...': '正在暫存檔案…',
        'Building Disk ({pct}%)': '正在建置磁碟 ({pct}%)',
        'Shutting Down': '正在關機',
        'Building Template': '正在建置範本',
        'Installing macOS': '正在安裝 macOS',
        'Installing Linux': '正在安裝 Linux',
        'Installing Windows': '正在安裝 Windows',
        'Running': '執行中',
        'Stopped': '已停止',
        'Templates do not run the in-VM agent': '範本不會執行虛擬機器內的代理程式',
        'VM is not running': '虛擬機器未執行',
        'In-VM agent is connected — host can manage the guest': '虛擬機器內的代理程式已連線 — 主機可管理客體',
        'In-VM agent is not connected': '虛擬機器內的代理程式未連線',
        'Installing OpenSSH in the guest...': '正在客體中安裝 OpenSSH…',
        'Open an SSH terminal (localhost:{port}; AppSandbox key deployed — key auth works)':
            '開啟 SSH 終端機 (localhost:{port}；已部署 AppSandbox 金鑰 — 可使用金鑰驗證)',
        'Open an SSH terminal to the VM (localhost:{port}, tunneled over HvSocket)':
            '開啟連至虛擬機器的 SSH 終端機 (localhost:{port}，透過 HvSocket 通道)',
        'SSH install failed': 'SSH 安裝失敗',
        'SSH: waiting for the in-VM agent to come online': 'SSH：正在等待虛擬機器內的代理程式上線',
        'Number of virtual CPU cores assigned to this VM': '配置給此虛擬機器的虛擬 CPU 核心數',
        'Memory allocated to this VM, in megabytes': '配置給此虛擬機器的記憶體 (MB)',
        'Virtual disk size, in gigabytes': '虛擬磁碟大小 (GB)',
        'Windows software rendering (WARP) on the CPU': '由 CPU 執行 Windows 軟體轉譯 (WARP)',
        'GPU passed through to the VM via GPU-PV, or None': '透過 GPU-PV 傳遞給虛擬機器的 GPU，或無',
        'NAT (shared networking)': 'NAT (共用網路)',
        'Networking mode: NAT (shared), External (bridged), Internal (host-only), or None':
            '網路模式：NAT (共用)、外部 (橋接)、內部 (僅限主機) 或無',
        'Start the VM (boots from the selected snapshot/branch)': '啟動虛擬機器 (從選取的快照/分支開機)',
        'Open the VM display window (IDD virtual monitor)': '開啟虛擬機器顯示視窗 (IDD 虛擬監視器)',
        'Request a graceful shutdown from the guest OS': '要求客體作業系統正常關機',
        'Force power off the VM immediately (may lose unsaved guest data)': '立即強制關閉虛擬機器電源 (可能遺失客體中未儲存的資料)',
        'Delete this VM and its virtual disks': '刪除此虛擬機器及其虛擬磁碟',
        'Edit VM configuration — VM must be stopped': '編輯虛擬機器設定 — 虛擬機器必須已停止',

        /* Edit dialog */
        'Edit {name}': '編輯 {name}',
        'RAM must be a whole number of at least {min} MB.': '記憶體必須是至少 {min} MB 的整數。',
        'Stop the VM before editing its configuration.': '請先停止虛擬機器再編輯其設定。',

        /* Confirmation dialogs */
        'Confirm': '確認',
        'Confirm Delete': '確認刪除',
        'Delete': '刪除',
        'Error': '錯誤',
        'OK': '確定',
        "Don't show this again": '不要再顯示此訊息',
        'Name:': '名稱：',
        'Are you sure you want to delete template "{name}"?\n\nThis will permanently delete the template disk image.':
            '確定要刪除範本「{name}」嗎？\n\n這會永久刪除該範本的磁碟映像。',
        'Cancel Template Build': '取消建置範本',
        'Stopping a template build will delete the incomplete template "{name}".\n\nAre you sure?':
            '停止建置範本會刪除未完成的範本「{name}」。\n\n確定要繼續嗎？',
        'Stop & Delete': '停止並刪除',
        'Force Stop': '強制停止',
        'Force Stop will immediately power-off "{name}" which may result in corruption of its data.':
            '強制停止會立即關閉「{name}」的電源，可能導致其資料損毀。',
        'Are you sure you want to delete VM "{name}"?\n\nThis will permanently delete all disk data and snapshots.':
            '確定要刪除虛擬機器「{name}」嗎？\n\n這會永久刪除所有磁碟資料與快照。',

        /* Snapshots */
        'Snapshots — {name}': '快照 — {name}',
        'Snapshots and branches': '快照與分支',
        'No snapshots': '沒有快照',
        'Base': '基底',
        'branch {n}': '分支 {n}',
        '[new branch]': '[新分支]',
        'Current: {path}': '目前：{path}',
        '(current)': '(目前)',
        '(selected)': '(已選取)',
        'Modified {date}': '修改於 {date}',
        'Created {date}': '建立於 {date}',
        '{size} GB including parent disks': '{size} GB (含父磁碟)',
        'New branch on start': '啟動時建立新分支',
        'Original disk': '原始磁碟',
        'Stop the VM to select a different disk or manage snapshots.': '請先停止虛擬機器，才能選取其他磁碟或管理快照。',
        'No snapshots. This VM uses its original disk.': '沒有快照。此虛擬機器使用其原始磁碟。',
        'The next start resumes the current disk. A frozen disk will start in a new branch.':
            '下次啟動會繼續使用目前的磁碟。已凍結的磁碟會以新分支啟動。',
        'The next start resumes this branch.': '下次啟動會繼續使用此分支。',
        'The next start creates a new branch from this disk.': '下次啟動會從此磁碟建立新分支。',
        'Snapshots changed. Select the disk again.': '快照已變更，請重新選取磁碟。',
        'New Snapshot': '新增快照',
        'Create a new snapshot of the base disk. Snapshots are frozen points in time that you can create independent branches from.':
            '建立基底磁碟的新快照。快照是凍結的時間點，您可以從中建立獨立的分支。',
        'Create': '建立',
        'Snapshot name:': '快照名稱：',
        'Snapshot {n}': '快照 {n}',
        'Rename': '重新命名',
        'Enter a new name:': '請輸入新名稱：',
        'Delete Branch': '刪除分支',
        'Delete Snapshot': '刪除快照',
        'Delete branch "{name}"? Its parent disk will be kept.': '要刪除分支「{name}」嗎？其父磁碟將會保留。',
        'Delete snapshot "{name}" and all its branches?': '要刪除快照「{name}」及其所有分支嗎？',
        'New Branch': '新增分支',
        'A new branch will be created from {parent}. Branches are independent working copies — changes in one branch don’t affect others or modify the base snapshot.':
            '將從 {parent} 建立新分支。分支是獨立的工作複本 — 在一個分支中所做的變更不會影響其他分支，也不會修改基底快照。',
        'Boot': '開機',
        'Branch name:': '分支名稱：',
        'Snapshots Changed': '快照已變更',
        'Select the disk again before starting the VM.': '啟動虛擬機器前，請重新選取磁碟。'
    }
};

var currentLang = 'en';

function normalizeLanguage(code) {
    if (!code) return null;
    for (var i = 0; i < LANGUAGES.length; i++)
        if (LANGUAGES[i].code === code) return code;
    return null;
}

/* Best match for the OS/browser language. Every Chinese variant except
 * Simplified (zh-CN / zh-Hans / zh-SG) maps to Traditional Chinese. */
function detectLanguage() {
    var prefs = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || 'en'];
    for (var i = 0; i < prefs.length; i++) {
        var l = String(prefs[i]).toLowerCase();
        if (l.indexOf('zh') === 0 && !/hans|-cn|-sg/.test(l)) return 'zh-TW';
        if (l.indexOf('en') === 0) return 'en';
    }
    return 'en';
}

function t(key, params) {
    var dict = TRANSLATIONS[currentLang];
    var text = (dict && Object.prototype.hasOwnProperty.call(dict, key)) ? dict[key] : key;
    if (params) {
        text = text.replace(/\{(\w+)\}/g, function(m, name) {
            return Object.prototype.hasOwnProperty.call(params, name) ? params[name] : m;
        });
    }
    return text;
}

/* Translate one attribute family. The first pass records the English source
 * text in a data-* attribute so the element can be translated back later. */
function applyAttr(selector, attr, store) {
    document.querySelectorAll(selector).forEach(function(el) {
        if (!(store in el.dataset)) el.dataset[store] = attr === 'text' ? el.textContent.trim() : el.getAttribute(attr);
        var text = t(el.dataset[store]);
        if (attr === 'text') el.textContent = text;
        else el.setAttribute(attr, text);
    });
}

function applyI18n() {
    document.documentElement.lang = currentLang;
    applyAttr('[data-i18n]', 'text', 'i18nSrc');
    applyAttr('[data-i18n-title]', 'title', 'i18nTitleSrc');
    applyAttr('[data-i18n-placeholder]', 'placeholder', 'i18nPlaceholderSrc');
    applyAttr('[data-i18n-aria-label]', 'aria-label', 'i18nAriaSrc');
}

function populateLanguageSelect() {
    var sel = document.getElementById('lang-select');
    if (!sel) return;
    sel.textContent = '';
    LANGUAGES.forEach(function(lang) {
        var opt = document.createElement('option');
        opt.value = lang.code;
        opt.textContent = lang.name;   /* endonym, never translated */
        sel.appendChild(opt);
    });
    sel.value = currentLang;
}

function setLanguage(code) {
    code = normalizeLanguage(code) || 'en';
    currentLang = code;
    try { localStorage.setItem('lang', code); } catch (e) { /* storage unavailable */ }
    applyI18n();
    var sel = document.getElementById('lang-select');
    if (sel) sel.value = code;
    if (typeof window.onLanguageChanged === 'function') window.onLanguageChanged();
}

(function initLanguage() {
    var saved = null;
    try { saved = localStorage.getItem('lang'); } catch (e) { /* storage unavailable */ }
    currentLang = normalizeLanguage(saved) || detectLanguage();
    populateLanguageSelect();
    applyI18n();
})();
