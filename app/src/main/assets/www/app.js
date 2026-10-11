(function () {
    "use strict";

    var MAX_TEXT_PREVIEW_SIZE = 10 * 1024 * 1024;
    var BRIDGE_RETRY_LIMIT = 20;
    var BRIDGE_RETRY_DELAY = 150;

    var IMAGE_EXTENSIONS = [
        "jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif"
    ];
    var VIDEO_EXTENSIONS = [
        "mp4", "m4v", "3gp", "webm", "mkv", "mov", "avi", "mpeg", "mpg"
    ];

    var files = [];
    var selectedFolderUri = "";
    var selectedCategory = "gambar";
    var currentFile = null;
    var thumbnailCache = {};
    var elements = {};
    var initialized = false;
    var renderVersion = 0;

    function byId(id) {
        return document.getElementById(id);
    }

    function bridgeAvailable() {
        return typeof window.AndroidApp !== "undefined";
    }

    function showToast(message) {
        try {
            if (bridgeAvailable() &&
                    typeof window.AndroidApp.showToast === "function") {
                window.AndroidApp.showToast(message);
                return;
            }
        } catch (error) {
            console.warn("Gagal menampilkan notifikasi Android.", error);
        }

        console.log(message);
    }

    function addClass(element, className) {
        if (element && !element.classList.contains(className)) {
            element.classList.add(className);
        }
    }

    function removeClass(element, className) {
        if (element) {
            element.classList.remove(className);
        }
    }

    function setHidden(element, hidden) {
        if (hidden) {
            addClass(element, "is-hidden");
        } else {
            removeClass(element, "is-hidden");
        }
    }

    function extensionOf(name) {
        var dot = name.lastIndexOf(".");
        return dot < 0 ? "" : name.substring(dot + 1).toLowerCase();
    }

    function categoryOf(file) {
        if (file.isDirectory) {
            return "lainnya";
        }

        var mime = (file.type || "").toLowerCase();
        var extension = extensionOf(file.name);

        if (mime.indexOf("image/") === 0 ||
                IMAGE_EXTENSIONS.indexOf(extension) !== -1) {
            return "gambar";
        }

        if (mime.indexOf("video/") === 0 ||
                VIDEO_EXTENSIONS.indexOf(extension) !== -1) {
            return "video";
        }

        return "lainnya";
    }

    function clearElement(element) {
        while (element.firstChild) {
            element.removeChild(element.firstChild);
        }
    }

    function formatSize(size) {
        if (typeof size !== "number" || !isFinite(size) || size < 0) {
            return "Ukuran tidak diketahui";
        }

        if (size < 1024) {
            return size + " B";
        }

        if (size < 1024 * 1024) {
            return (size / 1024).toFixed(1) + " KB";
        }

        if (size < 1024 * 1024 * 1024) {
            return (size / (1024 * 1024)).toFixed(1) + " MB";
        }

        return (size / (1024 * 1024 * 1024)).toFixed(1) + " GB";
    }

    function normalizeFiles(raw) {
        var parsed = typeof raw === "string" ? JSON.parse(raw) : raw;

        if (!Array.isArray(parsed)) {
            throw new Error("Respons daftar file bukan array.");
        }

        var normalized = [];

        for (var i = 0; i < parsed.length; i++) {
            var item = parsed[i] || {};
            var size = Number(item.size);

            normalized.push({
                name: item.name ? String(item.name) : "Tanpa nama",
                size: isFinite(size) && size >= 0 ? size : 0,
                isDirectory: Boolean(item.isDirectory),
                type: item.type ? String(item.type) : "unknown",
                uri: item.uri ? String(item.uri) : ""
            });
        }

        normalized = normalized.filter(function (item) {
            return Boolean(item.uri);
        });

        normalized.sort(function (a, b) {
            if (a.isDirectory !== b.isDirectory) {
                return a.isDirectory ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

        return normalized;
    }

    function displayFolderLocation(uri) {
        var location = uri;

        try {
            location = decodeURIComponent(uri);
        } catch (error) {
            // URI asli tetap dapat digunakan jika tidak bisa didekode.
        }

        var marker = location.indexOf("/tree/");
        if (marker !== -1) {
            location = location.substring(marker + 6);
        }

        location = location.replace(/^primary:/i, "Penyimpanan internal / ");
        location = location.replace(/^home:/i, "Folder Home / ");

        if (!location || location.indexOf("content://") === 0) {
            return "Folder penyimpanan sudah dipilih.";
        }

        return "Lokasi: " + location;
    }

    function setFolderStatus(selected, text) {
        elements.folderStatus.textContent =
            selected ? "Terhubung" : "Belum dipilih";
        elements.folderStatus.className =
            "badge " + (selected ? "selected" : "not-selected");
        elements.folderPathDisplay.textContent = text;
    }

    function imageMimeFor(file) {
        var mime = (file.type || "").toLowerCase();

        if (mime.indexOf("image/") === 0) {
            return mime;
        }

        var mimeByExtension = {
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            png: "image/png",
            gif: "image/gif",
            webp: "image/webp",
            bmp: "image/bmp",
            heic: "image/heic",
            heif: "image/heif"
        };

        return mimeByExtension[extensionOf(file.name)] || "image/jpeg";
    }

    function loadThumbnail(file, callback) {
        if (!bridgeAvailable() || !file.uri) {
            callback("");
            return;
        }

        if (Object.prototype.hasOwnProperty.call(thumbnailCache, file.uri)) {
            callback(thumbnailCache[file.uri]);
            return;
        }

        window.setTimeout(function () {
            var result = "";

            try {
                if (categoryOf(file) === "gambar" &&
                        typeof window.AndroidApp.getImageThumbnailBase64 === "function") {
                    result =
                        window.AndroidApp.getImageThumbnailBase64(file.uri) || "";
                } else if (categoryOf(file) === "video" &&
                        typeof window.AndroidApp.getVideoThumbnailBase64 === "function") {
                    result =
                        window.AndroidApp.getVideoThumbnailBase64(file.uri) || "";
                }
            } catch (error) {
                console.warn("Thumbnail tidak dapat dimuat.", error);
            }

            thumbnailCache[file.uri] = result;
            callback(result);
        }, 30);
    }

    function makeOtherIcon(file) {
        var icon = document.createElement("span");
        icon.className = "file-icon";
        icon.textContent = file.isDirectory ? "📁" : "📄";
        return icon;
    }

    function makeThumbnailPlaceholder(file, version) {
        if (categoryOf(file) === "video") {
            var wrapper = document.createElement("span");
            wrapper.className = "video-thumbnail";

            var fallback = document.createElement("span");
            fallback.className = "file-icon";
            fallback.textContent = "🎬";
            wrapper.appendChild(fallback);

            var playIcon = document.createElement("span");
            playIcon.className = "video-play-icon";
            playIcon.textContent = "▶";
            wrapper.appendChild(playIcon);

            loadThumbnail(file, function (base64) {
                if (!base64 ||
                        version !== renderVersion ||
                        !document.documentElement.contains(wrapper)) {
                    return;
                }

                clearElement(wrapper);

                var image = document.createElement("img");
                image.alt = "";
                image.src = "data:image/jpeg;base64," + base64;
                wrapper.appendChild(image);
                wrapper.appendChild(playIcon);
            });

            return wrapper;
        }

        var imagePlaceholder = document.createElement("span");
        imagePlaceholder.className = "file-icon";
        imagePlaceholder.textContent = "🖼️";

        loadThumbnail(file, function (base64) {
            if (!base64 ||
                    version !== renderVersion ||
                    !document.documentElement.contains(imagePlaceholder)) {
                return;
            }

            var image = document.createElement("img");
            image.className = "thumbnail";
            image.alt = "";
            image.src = "data:" + imageMimeFor(file) + ";base64," + base64;

            if (imagePlaceholder.parentNode) {
                imagePlaceholder.parentNode.replaceChild(
                    image,
                    imagePlaceholder
                );
            }
        });

        return imagePlaceholder;
    }

    function appendEmpty(message) {
        var item = document.createElement("li");
        item.className = "empty-state";
        item.textContent = message;
        elements.fileList.appendChild(item);
    }

    function renderFiles() {
        renderVersion++;
        var currentVersion = renderVersion;

        clearElement(elements.fileList);

        if (!selectedFolderUri) {
            elements.fileCount.textContent = "0 item";
            appendEmpty("Pilih folder penyimpanan untuk melihat isinya.");
            return;
        }

        var query = elements.searchInput.value.trim().toLowerCase();
        var categoryFiles = [];
        var visibleFiles = [];

        for (var i = 0; i < files.length; i++) {
            if (categoryOf(files[i]) === selectedCategory) {
                categoryFiles.push(files[i]);

                if (files[i].name.toLowerCase().indexOf(query) !== -1) {
                    visibleFiles.push(files[i]);
                }
            }
        }

        elements.fileCount.textContent = query
            ? visibleFiles.length + " dari " + categoryFiles.length + " item"
            : categoryFiles.length + " item";

        if (visibleFiles.length === 0) {
            appendEmpty(query
                ? "Tidak ada item yang cocok di kategori ini."
                : "Belum ada item di kategori ini.");
            return;
        }

        for (var j = 0; j < visibleFiles.length; j++) {
            (function (file) {
                var item = document.createElement("li");
                item.className = "file-item";
                item.tabIndex = 0;
                item.setAttribute("role", "button");

                var info = document.createElement("div");
                info.className = "file-info-col";

                if (selectedCategory === "lainnya") {
                    info.appendChild(makeOtherIcon(file));
                } else {
                    info.appendChild(
                        makeThumbnailPlaceholder(file, currentVersion)
                    );
                }

                var texts = document.createElement("div");
                texts.className = "file-texts";

                var name = document.createElement("div");
                name.className = "file-name";
                name.textContent = file.name;

                var subtitle = document.createElement("div");
                subtitle.className = "file-sub";
                subtitle.textContent = file.isDirectory
                    ? "Folder (navigasi subfolder belum tersedia)"
                    : formatSize(file.size);

                texts.appendChild(name);
                texts.appendChild(subtitle);
                info.appendChild(texts);
                item.appendChild(info);

                item.addEventListener("click", function () {
                    openPreview(file);
                });

                item.addEventListener("keydown", function (event) {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openPreview(file);
                    }
                });

                elements.fileList.appendChild(item);
            })(visibleFiles[j]);
        }
    }

    function isTextFile(file) {
        var mime = (file.type || "").toLowerCase();
        var extensions = [
            "txt", "md", "csv", "json", "xml", "html", "htm",
            "js", "css", "log", "ini", "yaml", "yml", "java",
            "kt", "py", "sql"
        ];

        return mime.indexOf("text/") === 0 ||
            mime === "application/json" ||
            mime === "application/xml" ||
            extensions.indexOf(extensionOf(file.name)) !== -1;
    }

    function decodeBase64Text(base64) {
        var binary = window.atob(base64);
        var bytes = new Uint8Array(binary.length);
        var i;

        for (i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        if (typeof window.TextDecoder !== "undefined") {
            return new window.TextDecoder("utf-8").decode(bytes);
        }

        var encoded = "";
        for (i = 0; i < bytes.length; i++) {
            var hex = bytes[i].toString(16);
            if (hex.length < 2) {
                hex = "0" + hex;
            }
            encoded += "%" + hex;
        }

        try {
            return decodeURIComponent(encoded);
        } catch (error) {
            return binary;
        }
    }

    function showPreviewMessage(message) {
        clearElement(elements.modalBody);

        var paragraph = document.createElement("p");
        paragraph.textContent = message;
        elements.modalBody.appendChild(paragraph);
    }

    function openPreview(file) {
        if (file.isDirectory) {
            showToast("Navigasi subfolder belum tersedia.");
            return;
        }

        if (!bridgeAvailable()) {
            showToast("Bridge Android tidak tersedia.");
            return;
        }

        currentFile = file;
        elements.modalTitle.textContent = file.name;
        removeClass(elements.previewModal, "hidden");
        clearElement(elements.modalBody);

        if (categoryOf(file) === "video") {
            loadThumbnail(file, function (base64) {
                if (currentFile !== file) {
                    return;
                }

                clearElement(elements.modalBody);

                if (!base64) {
                    showPreviewMessage(
                        "Sampul video tidak tersedia. Gunakan tombol untuk membuka video di aplikasi lain."
                    );
                    return;
                }

                var cover = document.createElement("img");
                cover.alt = "Sampul " + file.name;
                cover.src = "data:image/jpeg;base64," + base64;
                elements.modalBody.appendChild(cover);
            });
            return;
        }

        if (categoryOf(file) === "gambar") {
            if (file.size > MAX_TEXT_PREVIEW_SIZE) {
                loadThumbnail(file, function (base64) {
                    if (currentFile !== file) {
                        return;
                    }

                    clearElement(elements.modalBody);

                    if (!base64) {
                        showPreviewMessage(
                            "Gambar terlalu besar untuk pratinjau penuh."
                        );
                        return;
                    }

                    var thumbnail = document.createElement("img");
                    thumbnail.alt = file.name;
                    thumbnail.src =
                        "data:" + imageMimeFor(file) + ";base64," + base64;
                    elements.modalBody.appendChild(thumbnail);
                });
                return;
            }

            try {
                var imageBase64 =
                    window.AndroidApp.readFileBase64(file.uri);

                if (!imageBase64 && file.size > 0) {
                    showPreviewMessage("Gambar tidak dapat dibaca.");
                    return;
                }

                var image = document.createElement("img");
                image.alt = file.name;
                image.src =
                    "data:" + imageMimeFor(file) + ";base64," + imageBase64;
                elements.modalBody.appendChild(image);
            } catch (error) {
                console.error("Gagal membaca gambar.", error);
                showPreviewMessage("Gagal membaca gambar.");
            }
            return;
        }

        if (isTextFile(file) && file.size <= MAX_TEXT_PREVIEW_SIZE) {
            try {
                var textBase64 =
                    window.AndroidApp.readFileBase64(file.uri);

                if (!textBase64 && file.size > 0) {
                    showPreviewMessage("File tidak dapat dibaca.");
                    return;
                }

                var pre = document.createElement("pre");
                pre.textContent = decodeBase64Text(textBase64);
                elements.modalBody.appendChild(pre);
            } catch (error) {
                console.error("Gagal membaca file teks.", error);
                showPreviewMessage("Gagal membaca file teks.");
            }
            return;
        }

        showPreviewMessage(
            "Pratinjau tidak tersedia. Gunakan tombol untuk membuka file di aplikasi lain."
        );
    }

    function closePreview() {
        addClass(elements.previewModal, "hidden");
        clearElement(elements.modalBody);
        currentFile = null;
    }

    function refreshFiles() {
        if (!bridgeAvailable()) {
            selectedFolderUri = "";
            files = [];
            setFolderStatus(
                false,
                "Bridge Android tidak tersedia. Buka aplikasi melalui APK."
            );
            renderFiles();
            return;
        }

        try {
            selectedFolderUri =
                window.AndroidApp.getSelectedFolderUri() || "";

            if (!selectedFolderUri) {
                files = [];
                setFolderStatus(
                    false,
                    "Silakan pilih folder penyimpanan Anda."
                );
                renderFiles();
                return;
            }

            setFolderStatus(
                true,
                displayFolderLocation(selectedFolderUri)
            );
            files = normalizeFiles(window.AndroidApp.listFiles());
            renderFiles();
        } catch (error) {
            console.error("Gagal memuat daftar file.", error);
            files = [];
            setFolderStatus(true, "Daftar file gagal dimuat.");
            renderFiles();
            showToast("Gagal memuat isi folder.");
        }
    }

    function getPinState() {
        if (!bridgeAvailable() ||
                typeof window.AndroidApp.isPinEnabled !== "function") {
            return null;
        }

        try {
            return Boolean(window.AndroidApp.isPinEnabled());
        } catch (error) {
            console.error("Gagal memeriksa status PIN.", error);
            return null;
        }
    }

    function showStartup(message, retryVisible) {
        removeClass(elements.startupScreen, "is-hidden");
        addClass(elements.lockScreen, "is-hidden");
        addClass(elements.appShell, "is-hidden");

        elements.startupMessage.textContent = message;
        setHidden(elements.btnRetryStartup, !retryVisible);
    }

    function showApp() {
        addClass(elements.startupScreen, "is-hidden");
        addClass(elements.lockScreen, "is-hidden");
        removeClass(elements.appShell, "is-hidden");

        elements.lockPinInput.value = "";
        elements.lockMessage.textContent = "";
        refreshFiles();
    }

    function showLock(message) {
        addClass(elements.startupScreen, "is-hidden");
        addClass(elements.appShell, "is-hidden");
        removeClass(elements.lockScreen, "is-hidden");

        elements.lockPinInput.value = "";
        elements.lockMessage.textContent = message || "";

        closePreview();
        addClass(elements.settingsModal, "hidden");
    }

    function checkStartup(attempt) {
        var pinState = getPinState();

        if (pinState === true) {
            showLock("");
            return;
        }

        if (pinState === false) {
            showApp();
            return;
        }

        if (attempt >= BRIDGE_RETRY_LIMIT) {
            showStartup(
                "Tidak dapat terhubung ke Android. Pastikan aplikasi dibuka dari APK, lalu tekan Coba lagi.",
                true
            );
            return;
        }

        showStartup("Menghubungkan ke aplikasi...", false);

        window.setTimeout(function () {
            checkStartup(attempt + 1);
        }, BRIDGE_RETRY_DELAY);
    }

    function retryStartup() {
        showStartup("Mencoba menghubungkan ke aplikasi...", false);
        checkStartup(0);
    }

    function unlockApp() {
        if (!bridgeAvailable() ||
                typeof window.AndroidApp.verifyPin !== "function") {
            elements.lockMessage.textContent =
                "Layanan PIN Android tidak tersedia. Tutup lalu buka ulang aplikasi.";
            return;
        }

        var pin = elements.lockPinInput.value;

        if (!/^[0-9]{4,8}$/.test(pin)) {
            elements.lockMessage.textContent =
                "PIN harus terdiri dari 4–8 angka.";
            return;
        }

        try {
            if (window.AndroidApp.verifyPin(pin)) {
                showApp();
            } else {
                elements.lockPinInput.value = "";
                elements.lockMessage.textContent =
                    "PIN salah atau percobaan sedang dibatasi. Coba lagi nanti.";
                elements.lockPinInput.focus();
            }
        } catch (error) {
            console.error("Verifikasi PIN gagal.", error);
            elements.lockMessage.textContent = "Verifikasi PIN gagal.";
        }
    }

    function updatePinSettings() {
        var enabled = getPinState();

        if (enabled === true) {
            elements.pinStatus.textContent =
                "PIN aktif. Masukkan PIN saat ini untuk mengubah atau menghapusnya.";
        } else if (enabled === false) {
            elements.pinStatus.textContent =
                "PIN belum aktif. Aplikasi tidak meminta PIN sampai Anda menyimpannya.";
        } else {
            elements.pinStatus.textContent =
                "Layanan PIN Android tidak tersedia.";
        }

        setHidden(elements.currentPinWrap, enabled !== true);
        setHidden(elements.btnRemovePin, enabled !== true);

        elements.currentPinInput.value = "";
        elements.newPinInput.value = "";
        elements.confirmPinInput.value = "";
        elements.settingsMessage.textContent = "";
        elements.settingsMessage.style.color = "";
    }

    function openSettings() {
        updatePinSettings();
        removeClass(elements.settingsModal, "hidden");
    }

    function savePin() {
        if (!bridgeAvailable() ||
                typeof window.AndroidApp.setPin !== "function") {
            elements.settingsMessage.textContent =
                "Layanan PIN Android tidak tersedia.";
            return;
        }

        var enabled = getPinState();

        if (enabled === null) {
            elements.settingsMessage.textContent =
                "Status PIN gagal diperiksa. Coba buka ulang aplikasi.";
            return;
        }

        var currentPin = elements.currentPinInput.value;
        var newPin = elements.newPinInput.value;
        var confirmation = elements.confirmPinInput.value;

        if (!/^[0-9]{4,8}$/.test(newPin)) {
            elements.settingsMessage.textContent =
                "PIN baru harus terdiri dari 4–8 angka.";
            elements.newPinInput.focus();
            return;
        }

        if (newPin !== confirmation) {
            elements.settingsMessage.textContent =
                "Konfirmasi PIN tidak sama.";
            elements.confirmPinInput.focus();
            return;
        }

        if (enabled && !/^[0-9]{4,8}$/.test(currentPin)) {
            elements.settingsMessage.textContent =
                "Masukkan PIN saat ini.";
            elements.currentPinInput.focus();
            return;
        }

        try {
            if (!window.AndroidApp.setPin(currentPin, newPin)) {
                elements.settingsMessage.textContent =
                    "PIN saat ini salah atau PIN gagal disimpan.";
                return;
            }

            addClass(elements.settingsModal, "hidden");
            showLock("");
        } catch (error) {
            console.error("Gagal menyimpan PIN.", error);
            elements.settingsMessage.textContent = "Gagal menyimpan PIN.";
        }
    }

    function removePin() {
        if (!bridgeAvailable() ||
                typeof window.AndroidApp.removePin !== "function") {
            elements.settingsMessage.textContent =
                "Layanan PIN Android tidak tersedia.";
            return;
        }

        var currentPin = elements.currentPinInput.value;

        if (!/^[0-9]{4,8}$/.test(currentPin)) {
            elements.settingsMessage.textContent =
                "Masukkan PIN saat ini untuk menghapus PIN.";
            elements.currentPinInput.focus();
            return;
        }

        try {
            if (!window.AndroidApp.removePin(currentPin)) {
                elements.settingsMessage.textContent =
                    "PIN saat ini salah atau PIN gagal dihapus.";
                return;
            }

            updatePinSettings();
            elements.settingsMessage.style.color = "#6ee7b7";
            elements.settingsMessage.textContent = "PIN berhasil dihapus.";
        } catch (error) {
            console.error("Gagal menghapus PIN.", error);
            elements.settingsMessage.textContent = "Gagal menghapus PIN.";
        }
    }

    function openCurrentFileExternally() {
        if (!currentFile || currentFile.isDirectory) {
            return;
        }

        if (!bridgeAvailable() ||
                typeof window.AndroidApp.openFileWithSystemViewer !== "function") {
            showToast("Fitur ini hanya tersedia di aplikasi Android.");
            return;
        }

        try {
            window.AndroidApp.openFileWithSystemViewer(currentFile.uri);
        } catch (error) {
            console.error("Gagal membuka file.", error);
            showToast("File tidak dapat dibuka dengan aplikasi lain.");
        }
    }

    function bindEvents() {
        elements.btnPickFolder.addEventListener("click", function () {
            if (!bridgeAvailable() ||
                    typeof window.AndroidApp.openFolderPicker !== "function") {
                showToast("Pemilih folder hanya tersedia di aplikasi Android.");
                return;
            }

            try {
                window.AndroidApp.openFolderPicker();
            } catch (error) {
                console.error("Pemilih folder gagal dibuka.", error);
                showToast("Pemilih folder tidak dapat dibuka.");
            }
        });

        elements.btnRefresh.addEventListener("click", refreshFiles);
        elements.searchInput.addEventListener("input", renderFiles);
        elements.btnSettings.addEventListener("click", openSettings);
        elements.btnUnlock.addEventListener("click", unlockApp);
        elements.btnSavePin.addEventListener("click", savePin);
        elements.btnRemovePin.addEventListener("click", removePin);
        elements.btnCloseModal.addEventListener("click", closePreview);
        elements.btnOpenExternal.addEventListener(
            "click",
            openCurrentFileExternally
        );
        elements.btnRetryStartup.addEventListener("click", retryStartup);

        elements.lockPinInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                unlockApp();
            }
        });

        for (var i = 0; i < elements.categoryTabs.length; i++) {
            (function (tab) {
                tab.addEventListener("click", function () {
                    selectedCategory = tab.getAttribute("data-category");

                    for (var j = 0; j < elements.categoryTabs.length; j++) {
                        var otherTab = elements.categoryTabs[j];
                        var active = otherTab === tab;

                        if (active) {
                            addClass(otherTab, "active");
                            otherTab.setAttribute("aria-pressed", "true");
                        } else {
                            removeClass(otherTab, "active");
                            otherTab.setAttribute("aria-pressed", "false");
                        }
                    }

                    renderFiles();
                });
            })(elements.categoryTabs[i]);
        }

        elements.btnCloseSettings.addEventListener("click", function () {
            addClass(elements.settingsModal, "hidden");
        });

        elements.previewModal.addEventListener("click", function (event) {
            if (event.target === elements.previewModal) {
                closePreview();
            }
        });

        elements.settingsModal.addEventListener("click", function (event) {
            if (event.target === elements.settingsModal) {
                addClass(elements.settingsModal, "hidden");
            }
        });

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                if (!elements.previewModal.classList.contains("hidden")) {
                    closePreview();
                } else if (!elements.settingsModal.classList.contains("hidden")) {
                    addClass(elements.settingsModal, "hidden");
                }
            }
        });
    }

    function getElements() {
        elements = {
            startupScreen: byId("startupScreen"),
            startupMessage: byId("startupMessage"),
            btnRetryStartup: byId("btnRetryStartup"),
            lockScreen: byId("lockScreen"),
            lockPinInput: byId("lockPinInput"),
            lockMessage: byId("lockMessage"),
            btnUnlock: byId("btnUnlock"),
            appShell: byId("appShell"),
            btnPickFolder: byId("btnPickFolder"),
            btnRefresh: byId("btnRefresh"),
            btnSettings: byId("btnSettings"),
            folderStatus: byId("folderStatus"),
            folderPathDisplay: byId("folderPathDisplay"),
            searchInput: byId("searchInput"),
            fileCount: byId("fileCount"),
            fileList: byId("fileList"),
            previewModal: byId("previewModal"),
            modalTitle: byId("modalTitle"),
            modalBody: byId("modalBody"),
            btnCloseModal: byId("btnCloseModal"),
            btnOpenExternal: byId("btnOpenExternal"),
            settingsModal: byId("settingsModal"),
            btnCloseSettings: byId("btnCloseSettings"),
            pinStatus: byId("pinStatus"),
            currentPinWrap: byId("currentPinWrap"),
            currentPinInput: byId("currentPinInput"),
            newPinInput: byId("newPinInput"),
            confirmPinInput: byId("confirmPinInput"),
            settingsMessage: byId("settingsMessage"),
            btnSavePin: byId("btnSavePin"),
            btnRemovePin: byId("btnRemovePin"),
            categoryTabs: document.querySelectorAll(".category-tab")
        };
    }

    function validateElements() {
        var required = [
            "startupScreen",
            "startupMessage",
            "btnRetryStartup",
            "lockScreen",
            "lockPinInput",
            "lockMessage",
            "btnUnlock",
            "appShell",
            "btnPickFolder",
            "btnRefresh",
            "btnSettings",
            "folderStatus",
            "folderPathDisplay",
            "searchInput",
            "fileCount",
            "fileList",
            "previewModal",
            "modalTitle",
            "modalBody",
            "btnCloseModal",
            "btnOpenExternal",
            "settingsModal",
            "btnCloseSettings",
            "pinStatus",
            "currentPinWrap",
            "currentPinInput",
            "newPinInput",
            "confirmPinInput",
            "settingsMessage",
            "btnSavePin",
            "btnRemovePin"
        ];

        for (var i = 0; i < required.length; i++) {
            if (!elements[required[i]]) {
                throw new Error("Elemen HTML tidak ditemukan: " + required[i]);
            }
        }

        if (!elements.categoryTabs ||
                typeof elements.categoryTabs.length !== "number" ||
                elements.categoryTabs.length === 0) {
            throw new Error("Tombol kategori tidak ditemukan.");
        }
    }

    function initialize() {
        if (initialized) {
            return;
        }
        initialized = true;

        try {
            getElements();
            validateElements();
            bindEvents();
            showStartup("Menghubungkan ke aplikasi...", false);
            checkStartup(0);
        } catch (error) {
            console.error("Inisialisasi Berangkas gagal:", error);

            if (elements.startupScreen &&
                    elements.startupMessage &&
                    elements.btnRetryStartup) {
                showStartup(
                    "Aplikasi gagal dimulai: " +
                        (error && error.message
                            ? error.message
                            : "kesalahan halaman."),
                    true
                );
            } else {
                document.body.textContent =
                    "Berangkas gagal dimulai. Periksa kembali index.html.";
            }
        }
    }

    window.onFolderChanged = function () {
        thumbnailCache = {};
        refreshFiles();
    };

    window.onNativeResumeAfterBackground = function () {
        var pinState = getPinState();

        if (pinState === true) {
            showLock("");
        } else if (pinState === false) {
            showApp();
        } else {
            showStartup(
                "Status PIN Android tidak dapat diperiksa. Tekan Coba lagi.",
                true
            );
        }
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize);
    } else {
        initialize();
    }
})();