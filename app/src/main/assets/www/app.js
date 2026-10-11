(function () {
    "use strict";

    var MAX_PREVIEW_SIZE = 10 * 1024 * 1024;
    var files = [];
    var selectedFolderUri = "";
    var currentFile = null;
    var selectedCategory = "gambar";
    var thumbnailCache = Object.create(null);
    var elements = {};

    var VIDEO_EXTENSIONS = [
        "mp4", "m4v", "3gp", "webm", "mkv", "mov", "avi", "mpeg", "mpg"
    ];

    function byId(id) {
        return document.getElementById(id);
    }

    function bridgeAvailable() {
        return typeof window.AndroidApp !== "undefined";
    }

    function showToast(message) {
        if (bridgeAvailable() && typeof window.AndroidApp.showToast === "function") {
            window.AndroidApp.showToast(message);
        } else {
            console.log(message);
        }
    }

    function clearElement(element) {
        while (element.firstChild) {
            element.removeChild(element.firstChild);
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

        var type = (file.type || "").toLowerCase();
        var extension = extensionOf(file.name);

        if (type.indexOf("image/") === 0 ||
                ["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif"].indexOf(extension) !== -1) {
            return "gambar";
        }

        if (type.indexOf("video/") === 0 || VIDEO_EXTENSIONS.indexOf(extension) !== -1) {
            return "video";
        }

        return "lainnya";
    }

    function formatSize(size) {
        if (!Number.isFinite(size) || size < 0) {
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

    function setFolderStatus(isSelected, text) {
        elements.folderStatus.textContent = isSelected ? "Terhubung" : "Belum dipilih";
        elements.folderStatus.className = "badge " + (isSelected ? "selected" : "not-selected");
        elements.folderPathDisplay.textContent = text;
    }

    function displayFolderLocation(uri) {
        var location = uri;
        try {
            location = decodeURIComponent(uri);
        } catch (error) {
            // Pertahankan URI jika tidak dapat didekode.
        }

        var marker = location.indexOf("/tree/");
        if (marker !== -1) {
            location = location.substring(marker + 6);
        }
        location = location.replace(/^primary:/i, "Penyimpanan internal / ");
        location = location.replace(/^home:/i, "Folder Home / ");

        return location && location.indexOf("content://") !== 0
            ? "Lokasi: " + location
            : "Folder penyimpanan sudah dipilih.";
    }

    function normalizeFiles(raw) {
        var parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!Array.isArray(parsed)) {
            throw new Error("Daftar file tidak valid.");
        }

        return parsed.map(function (item) {
            return {
                name: item && item.name ? String(item.name) : "Tanpa nama",
                size: item && Number.isFinite(Number(item.size)) ? Number(item.size) : 0,
                isDirectory: Boolean(item && item.isDirectory),
                type: item && item.type ? String(item.type) : "unknown",
                uri: item && item.uri ? String(item.uri) : ""
            };
        }).filter(function (item) {
            return Boolean(item.uri);
        }).sort(function (a, b) {
            if (a.isDirectory !== b.isDirectory) {
                return a.isDirectory ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });
    }

    function thumbnailFor(file) {
        if (!bridgeAvailable() || !file.uri) {
            return "";
        }

        if (Object.prototype.hasOwnProperty.call(thumbnailCache, file.uri)) {
            return thumbnailCache[file.uri];
        }

        var result = "";
        try {
            if (categoryOf(file) === "gambar" &&
                    typeof window.AndroidApp.getImageThumbnailBase64 === "function") {
                result = window.AndroidApp.getImageThumbnailBase64(file.uri) || "";
            } else if (categoryOf(file) === "video" &&
                    typeof window.AndroidApp.getVideoThumbnailBase64 === "function") {
                result = window.AndroidApp.getVideoThumbnailBase64(file.uri) || "";
            }
        } catch (error) {
            result = "";
        }

        thumbnailCache[file.uri] = result;
        return result;
    }

    function makeThumbnail(file) {
        var thumbnail = thumbnailFor(file);

        if (categoryOf(file) === "video") {
            var wrapper = document.createElement("span");
            wrapper.className = "video-thumbnail";

            if (thumbnail) {
                var image = document.createElement("img");
                image.alt = "";
                image.src = "data:image/jpeg;base64," + thumbnail;
                wrapper.appendChild(image);
            } else {
                var icon = document.createElement("span");
                icon.className = "file-icon";
                icon.textContent = "🎬";
                wrapper.appendChild(icon);
            }

            var play = document.createElement("span");
            play.className = "video-play-icon";
            play.textContent = "▶";
            wrapper.appendChild(play);
            return wrapper;
        }

        if (thumbnail) {
            var imageElement = document.createElement("img");
            imageElement.className = "thumbnail";
            imageElement.alt = "";
            imageElement.src = "data:image/jpeg;base64," + thumbnail;
            return imageElement;
        }

        var fallback = document.createElement("span");
        fallback.className = "file-icon";
        fallback.textContent = file.isDirectory ? "📁" : "🖼️";
        return fallback;
    }

    function renderFiles() {
        clearElement(elements.fileList);

        if (!selectedFolderUri) {
            elements.fileCount.textContent = "0 item";
            appendEmpty("Pilih folder penyimpanan untuk melihat isinya.");
            return;
        }

        var query = elements.searchInput.value.trim().toLowerCase();
        var categoryFiles = files.filter(function (file) {
            return categoryOf(file) === selectedCategory;
        });
        var visibleFiles = categoryFiles.filter(function (file) {
            return file.name.toLowerCase().indexOf(query) !== -1;
        });

        elements.fileCount.textContent = query
            ? visibleFiles.length + " dari " + categoryFiles.length + " item"
            : categoryFiles.length + (categoryFiles.length === 1 ? " item" : " item");

        if (visibleFiles.length === 0) {
            appendEmpty(query
                ? "Tidak ada item yang cocok dengan pencarian di kategori ini."
                : "Belum ada item di kategori ini.");
            return;
        }

        visibleFiles.forEach(function (file) {
            var item = document.createElement("li");
            item.className = "file-item";
            item.tabIndex = 0;
            item.setAttribute("role", "button");

            var info = document.createElement("div");
            info.className = "file-info-col";
            info.appendChild(
                selectedCategory === "gambar" || selectedCategory === "video"
                    ? makeThumbnail(file)
                    : makeOtherIcon(file)
            );

            var texts = document.createElement("div");
            texts.className = "file-texts";

            var name = document.createElement("div");
            name.className = "file-name";
            name.textContent = file.name;

            var subtitle = document.createElement("div");
            subtitle.className = "file-sub";
            subtitle.textContent = file.isDirectory
                ? "Folder"
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
        });
    }

    function makeOtherIcon(file) {
        var icon = document.createElement("span");
        icon.className = "file-icon";
        icon.textContent = file.isDirectory ? "📁" : "📄";
        return icon;
    }

    function appendEmpty(message) {
        var item = document.createElement("li");
        item.className = "empty-state";
        item.textContent = message;
        elements.fileList.appendChild(item);
    }

    function decodeBase64Text(base64) {
        var binary = window.atob(base64);
        var bytes = new Uint8Array(binary.length);

        for (var i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        if (window.TextDecoder) {
            return new window.TextDecoder("utf-8").decode(bytes);
        }

        var encoded = "";
        for (var j = 0; j < bytes.length; j++) {
            encoded += "%" + bytes[j].toString(16).padStart(2, "0");
        }
        try {
            return decodeURIComponent(encoded);
        } catch (error) {
            return binary;
        }
    }

    function showPreviewMessage(message) {
        clearElement(elements.modalBody);
        var text = document.createElement("p");
        text.textContent = message;
        elements.modalBody.appendChild(text);
    }

    function isTextFile(file) {
        var mime = (file.type || "").toLowerCase();
        return mime.indexOf("text/") === 0 ||
            ["txt", "md", "csv", "json", "xml", "html", "htm", "js", "css", "log", "ini", "yaml", "yml", "java", "kt", "py", "sql"].indexOf(extensionOf(file.name)) !== -1;
    }

    function openPreview(file) {
        if (file.isDirectory) {
            showToast("Navigasi subfolder belum tersedia.");
            return;
        }

        currentFile = file;
        elements.modalTitle.textContent = file.name;
        elements.previewModal.classList.remove("hidden");
        clearElement(elements.modalBody);

        if (categoryOf(file) === "video" && file.size > MAX_PREVIEW_SIZE) {
            showPreviewMessage("Video terlalu besar untuk diputar di pratinjau. Gunakan tombol untuk membukanya di aplikasi lain.");
            return;
        }

        if (categoryOf(file) !== "gambar" &&
                categoryOf(file) !== "video" &&
                !isTextFile(file)) {
            showPreviewMessage("Pratinjau tidak tersedia untuk jenis file ini. Gunakan tombol untuk membukanya di aplikasi lain.");
            return;
        }

        if (file.size > MAX_PREVIEW_SIZE) {
            showPreviewMessage("File terlalu besar untuk dipratinjau. Gunakan tombol untuk membukanya di aplikasi lain.");
            return;
        }

        try {
            var base64 = window.AndroidApp.readFileBase64(file.uri);
            if (!base64 && file.size > 0) {
                showPreviewMessage("File tidak dapat dibaca. Coba buka dengan aplikasi lain.");
                return;
            }

            if (categoryOf(file) === "gambar") {
                var image = document.createElement("img");
                image.alt = file.name;
                image.src = "data:" + (file.type.indexOf("image/") === 0 ? file.type : "image/jpeg") + ";base64," + base64;
                elements.modalBody.appendChild(image);
            } else if (categoryOf(file) === "video") {
                var video = document.createElement("video");
                video.controls = true;
                video.playsInline = true;
                video.src = "data:" + (file.type.indexOf("video/") === 0 ? file.type : "video/mp4") + ";base64," + base64;
                elements.modalBody.appendChild(video);
            } else if (isTextFile(file)) {
                var pre = document.createElement("pre");
                pre.textContent = decodeBase64Text(base64);
                elements.modalBody.appendChild(pre);
            }
        } catch (error) {
            showPreviewMessage("Terjadi kesalahan saat membaca file.");
        }
    }

    function closePreview() {
        elements.previewModal.classList.add("hidden");
        clearElement(elements.modalBody);
        currentFile = null;
    }

    function refreshFiles() {
        if (!bridgeAvailable()) {
            selectedFolderUri = "";
            files = [];
            setFolderStatus(false, "Fitur penyimpanan hanya tersedia di aplikasi Android.");
            renderFiles();
            return;
        }

        try {
            selectedFolderUri = window.AndroidApp.getSelectedFolderUri() || "";
            if (!selectedFolderUri) {
                files = [];
                setFolderStatus(false, "Silakan pilih folder penyimpanan Anda.");
                renderFiles();
                return;
            }

            setFolderStatus(true, displayFolderLocation(selectedFolderUri));
            files = normalizeFiles(window.AndroidApp.listFiles());
            renderFiles();
        } catch (error) {
            files = [];
            setFolderStatus(true, "Daftar file gagal dimuat.");
            renderFiles();
            showToast("Gagal memuat isi folder.");
        }
    }

    function pinEnabled() {
        return bridgeAvailable() &&
            typeof window.AndroidApp.isPinEnabled === "function" &&
            window.AndroidApp.isPinEnabled();
    }

    function showApp() {
        elements.lockScreen.classList.add("is-hidden");
        elements.appShell.classList.remove("is-hidden");
        elements.lockPinInput.value = "";
        elements.lockMessage.textContent = "";
        refreshFiles();
    }

    function lockApp() {
        if (!pinEnabled()) {
            showApp();
            return;
        }

        closePreview();
        elements.settingsModal.classList.add("hidden");
        elements.appShell.classList.add("is-hidden");
        elements.lockScreen.classList.remove("is-hidden");
        elements.lockPinInput.value = "";
        elements.lockMessage.textContent = "";
    }

    function unlockApp() {
        var pin = elements.lockPinInput.value;

        if (!/^[0-9]{4,8}$/.test(pin)) {
            elements.lockMessage.textContent = "PIN harus terdiri dari 4–8 angka.";
            return;
        }

        try {
            if (window.AndroidApp.verifyPin(pin)) {
                showApp();
            } else {
                elements.lockPinInput.value = "";
                elements.lockMessage.textContent = "PIN salah atau sementara terkunci. Coba lagi sebentar.";
                elements.lockPinInput.focus();
            }
        } catch (error) {
            elements.lockMessage.textContent = "Verifikasi PIN gagal.";
        }
    }

    function updatePinSettings() {
        var enabled = pinEnabled();
        elements.pinStatus.textContent = enabled
            ? "PIN aktif. Aplikasi akan meminta PIN saat dibuka kembali."
            : "PIN belum diaktifkan. PIN hanya berupa angka, 4–8 digit.";
        elements.currentPinWrap.classList.toggle("is-hidden", !enabled);
        elements.btnRemovePin.classList.toggle("is-hidden", !enabled);
        elements.currentPinInput.value = "";
        elements.newPinInput.value = "";
        elements.confirmPinInput.value = "";
        elements.settingsMessage.textContent = "";
    }

    function openSettings() {
        updatePinSettings();
        elements.settingsModal.classList.remove("hidden");
    }

    function savePin() {
        var enabled = pinEnabled();
        var currentPin = elements.currentPinInput.value;
        var newPin = elements.newPinInput.value;
        var confirmPin = elements.confirmPinInput.value;

        if (!/^[0-9]{4,8}$/.test(newPin)) {
            elements.settingsMessage.textContent = "PIN baru harus terdiri dari 4–8 angka.";
            return;
        }
        if (newPin !== confirmPin) {
            elements.settingsMessage.textContent = "Konfirmasi PIN tidak sama.";
            return;
        }
        if (enabled && !/^[0-9]{4,8}$/.test(currentPin)) {
            elements.settingsMessage.textContent = "Masukkan PIN saat ini.";
            return;
        }

        try {
            if (window.AndroidApp.setPin(currentPin, newPin)) {
                updatePinSettings();
                elements.settingsMessage.textContent = "PIN aplikasi berhasil disimpan.";
                elements.settingsMessage.style.color = "#6ee7b7";
            } else {
                elements.settingsMessage.textContent = "PIN saat ini salah atau PIN baru tidak dapat disimpan.";
            }
        } catch (error) {
            elements.settingsMessage.textContent = "Gagal menyimpan PIN.";
        }
    }

    function removePin() {
        var currentPin = elements.currentPinInput.value;

        if (!/^[0-9]{4,8}$/.test(currentPin)) {
            elements.settingsMessage.textContent = "Masukkan PIN saat ini untuk menghapus PIN aplikasi.";
            return;
        }

        try {
            if (window.AndroidApp.removePin(currentPin)) {
                updatePinSettings();
                elements.settingsMessage.textContent = "PIN aplikasi berhasil dihapus.";
                elements.settingsMessage.style.color = "#6ee7b7";
            } else {
                elements.settingsMessage.textContent = "PIN saat ini salah atau PIN tidak dapat dihapus.";
            }
        } catch (error) {
            elements.settingsMessage.textContent = "Gagal menghapus PIN.";
        }
    }

    function bindEvents() {
        elements.btnPickFolder.addEventListener("click", function () {
            try {
                window.AndroidApp.openFolderPicker();
            } catch (error) {
                showToast("Pemilih folder tidak dapat dibuka.");
            }
        });

        elements.btnRefresh.addEventListener("click", refreshFiles);
        elements.searchInput.addEventListener("input", renderFiles);
        elements.btnSettings.addEventListener("click", openSettings);
        elements.btnUnlock.addEventListener("click", unlockApp);
        elements.lockPinInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                unlockApp();
            }
        });

        document.querySelectorAll(".category-tab").forEach(function (tab) {
            tab.addEventListener("click", function () {
                selectedCategory = tab.getAttribute("data-category");
                document.querySelectorAll(".category-tab").forEach(function (otherTab) {
                    otherTab.classList.toggle("active", otherTab === tab);
                });
                renderFiles();
            });
        });

        elements.btnCloseModal.addEventListener("click", closePreview);
        elements.btnOpenExternal.addEventListener("click", function () {
            if (currentFile && !currentFile.isDirectory) {
                window.AndroidApp.openFileWithSystemViewer(currentFile.uri);
            }
        });

        elements.btnCloseSettings.addEventListener("click", function () {
            elements.settingsModal.classList.add("hidden");
        });
        elements.btnSavePin.addEventListener("click", savePin);
        elements.btnRemovePin.addEventListener("click", removePin);

        elements.previewModal.addEventListener("click", function (event) {
            if (event.target === elements.previewModal) {
                closePreview();
            }
        });
        elements.settingsModal.addEventListener("click", function (event) {
            if (event.target === elements.settingsModal) {
                elements.settingsModal.classList.add("hidden");
            }
        });

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                if (!elements.previewModal.classList.contains("hidden")) {
                    closePreview();
                } else if (!elements.settingsModal.classList.contains("hidden")) {
                    elements.settingsModal.classList.add("hidden");
                }
            }
        });
    }

    function initialize() {
        elements = {
            lockScreen: byId("lockScreen"),
            lockPinInput: byId("lockPinInput"),
            lockMessage: byId("lockMessage"),
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
            btnRemovePin: byId("btnRemovePin")
        };

        bindEvents();

        if (pinEnabled()) {
            lockApp();
        } else {
            showApp();
        }
    }

    window.onFolderChanged = refreshFiles;
    window.lockApp = lockApp;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize);
    } else {
        initialize();
    }
})();