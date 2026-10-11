(function () {
    "use strict";

    var MAX_TEXT_PREVIEW_SIZE = 10 * 1024 * 1024;
    var files = [];
    var selectedFolderUri = "";
    var selectedCategory = "gambar";
    var currentFile = null;
    var thumbnailCache = Object.create(null);
    var elements = {};

    var IMAGE_EXTENSIONS = [
        "jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif"
    ];

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
        if (bridgeAvailable() &&
                typeof window.AndroidApp.showToast === "function") {
            try {
                window.AndroidApp.showToast(message);
                return;
            } catch (error) {
                console.warn("Gagal menampilkan notifikasi Android.", error);
            }
        }

        console.log(message);
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

    function normalizeFiles(raw) {
        var parsed = typeof raw === "string" ? JSON.parse(raw) : raw;

        if (!Array.isArray(parsed)) {
            throw new Error("Respons daftar file bukan array.");
        }

        return parsed.map(function (item) {
            return {
                name: item && item.name ? String(item.name) : "Tanpa nama",
                size: item && Number.isFinite(Number(item.size))
                    ? Number(item.size)
                    : 0,
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

    function displayFolderLocation(uri) {
        var location = uri;

        try {
            location = decodeURIComponent(uri);
        } catch (error) {
            // Gunakan URI aslinya jika tidak dapat didekode.
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
        elements.folderStatus.textContent = selected
            ? "Terhubung"
            : "Belum dipilih";
        elements.folderStatus.className =
            "badge " + (selected ? "selected" : "not-selected");
        elements.folderPathDisplay.textContent = text;
    }

    function imageMimeFor(file) {
        var mime = (file.type || "").toLowerCase();

        if (mime.indexOf("image/") === 0) {
            return mime;
        }

        var extension = extensionOf(file.name);
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

        return mimeByExtension[extension] || "image/jpeg";
    }

    function thumbnailFor(file) {
        if (!bridgeAvailable() || !file.uri) {
            return "";
        }

        if (Object.prototype.hasOwnProperty.call(thumbnailCache, file.uri)) {
            return thumbnailCache[file.uri];
        }

        var thumbnail = "";

        try {
            if (categoryOf(file) === "gambar" &&
                    typeof window.AndroidApp.getImageThumbnailBase64 === "function") {
                thumbnail =
                    window.AndroidApp.getImageThumbnailBase64(file.uri) || "";
            } else if (categoryOf(file) === "video" &&
                    typeof window.AndroidApp.getVideoThumbnailBase64 === "function") {
                thumbnail =
                    window.AndroidApp.getVideoThumbnailBase64(file.uri) || "";
            }
        } catch (error) {
            console.warn("Gagal membuat thumbnail.", error);
        }

        thumbnailCache[file.uri] = thumbnail;
        return thumbnail;
    }

    function makeThumbnail(file) {
        var base64 = thumbnailFor(file);

        if (categoryOf(file) === "video") {
            var wrapper = document.createElement("span");
            wrapper.className = "video-thumbnail";

            if (base64) {
                var videoImage = document.createElement("img");
                videoImage.alt = "";
                videoImage.src = "data:image/jpeg;base64," + base64;
                wrapper.appendChild(videoImage);
            } else {
                var videoFallback = document.createElement("span");
                videoFallback.className = "file-icon";
                videoFallback.textContent = "🎬";
                wrapper.appendChild(videoFallback);
            }

            var playIcon = document.createElement("span");
            playIcon.className = "video-play-icon";
            playIcon.textContent = "▶";
            wrapper.appendChild(playIcon);
            return wrapper;
        }

        if (base64) {
            var image = document.createElement("img");
            image.className = "thumbnail";
            image.alt = "";
            image.src = "data:" + imageMimeFor(file) + ";base64," + base64;
            return image;
        }

        var imageFallback = document.createElement("span");
        imageFallback.className = "file-icon";
        imageFallback.textContent = "🖼️";
        return imageFallback;
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
            : categoryFiles.length + " item";

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
                selectedCategory === "lainnya"
                    ? makeOtherIcon(file)
                    : makeThumbnail(file)
            );

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
        });
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

        for (var i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        if (typeof window.TextDecoder !== "undefined") {
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

    function openPreview(file) {
        if (file.isDirectory) {
            showToast("Navigasi subfolder belum tersedia.");
            return;
        }

        currentFile = file;
        elements.modalTitle.textContent = file.name;
        elements.previewModal.classList.remove("hidden");
        clearElement(elements.modalBody);

        if (!bridgeAvailable()) {
            showPreviewMessage("Fitur pratinjau hanya tersedia di aplikasi Android.");
            return;
        }

        if (categoryOf(file) === "video") {
            var videoThumbnail = thumbnailFor(file);

            if (videoThumbnail) {
                var cover = document.createElement("img");
                cover.alt = "Sampul " + file.name;
                cover.src = "data:image/jpeg;base64," + videoThumbnail;
                elements.modalBody.appendChild(cover);
            } else {
                showPreviewMessage(
                    "Sampul video tidak tersedia. Anda masih dapat mencoba membukanya di aplikasi lain."
                );
            }
            return;
        }

        if (categoryOf(file) === "gambar") {
            if (file.size > MAX_TEXT_PREVIEW_SIZE) {
                var imageThumbnail = thumbnailFor(file);

                if (imageThumbnail) {
                    var largeImage = document.createElement("img");
                    largeImage.alt = file.name;
                    largeImage.src =
                        "data:" + imageMimeFor(file) + ";base64," + imageThumbnail;
                    elements.modalBody.appendChild(largeImage);
                } else {
                    showPreviewMessage(
                        "Gambar terlalu besar untuk pratinjau penuh dan thumbnail gagal dibuat."
                    );
                }
                return;
            }

            try {
                var imageBase64 = window.AndroidApp.readFileBase64(file.uri);
                if (!imageBase64 && file.size > 0) {
                    showPreviewMessage(
                        "Gambar tidak dapat dibaca. Coba buka dengan aplikasi lain."
                    );
                    return;
                }

                var previewImage = document.createElement("img");
                previewImage.alt = file.name;
                previewImage.src =
                    "data:" + imageMimeFor(file) + ";base64," + imageBase64;
                elements.modalBody.appendChild(previewImage);
            } catch (error) {
                console.error("Gagal membaca gambar.", error);
                showPreviewMessage("Gagal membaca gambar.");
            }
            return;
        }

        if (isTextFile(file) && file.size <= MAX_TEXT_PREVIEW_SIZE) {
            try {
                var textBase64 = window.AndroidApp.readFileBase64(file.uri);
                if (!textBase64 && file.size > 0) {
                    showPreviewMessage(
                        "File tidak dapat dibaca. Coba buka dengan aplikasi lain."
                    );
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
            "Pratinjau tidak tersedia untuk file ini. Gunakan tombol untuk membukanya di aplikasi lain."
        );
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
                setFolderStatus(false, "Silakan pilih folder penyimpanan Anda.");
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

    function pinEnabled() {
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

    function showApp() {
        document.documentElement.classList.remove(
            "pin-required",
            "pin-check-failed"
        );

        elements.lockScreen.classList.add("is-hidden");
        elements.appShell.classList.remove("is-hidden");
        elements.lockPinInput.value = "";
        elements.lockMessage.textContent = "";
        refreshFiles();
    }

    function lockApp() {
        var enabled = pinEnabled();

        if (enabled === false) {
            showApp();
            return;
        }

        document.documentElement.classList.add("pin-required");
        document.documentElement.classList.remove("pin-check-failed");
        elements.appShell.classList.add("is-hidden");
        elements.lockScreen.classList.remove("is-hidden");
        elements.lockPinInput.value = "";

        if (enabled === null) {
            document.documentElement.classList.add("pin-check-failed");
            elements.lockMessage.textContent =
                "Status PIN tidak dapat diperiksa. Pastikan aplikasi dibuka dari APK, lalu buka kembali.";
        } else {
            elements.lockMessage.textContent = "";
        }

        closePreview();
        elements.settingsModal.classList.add("hidden");
    }

    function unlockApp() {
        if (!bridgeAvailable() ||
                typeof window.AndroidApp.verifyPin !== "function") {
            elements.lockMessage.textContent =
                "Bridge Android tidak tersedia. PIN tidak dapat diverifikasi.";
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
                    "PIN salah atau percobaan sementara dibatasi. Coba lagi nanti.";
                elements.lockPinInput.focus();
            }
        } catch (error) {
            console.error("Gagal memverifikasi PIN.", error);
            elements.lockMessage.textContent = "Verifikasi PIN gagal.";
        }
    }

    function updatePinSettings() {
        var enabled = pinEnabled();

        if (enabled === null) {
            elements.pinStatus.textContent =
                "Bridge Android tidak tersedia; pengaturan PIN tidak dapat digunakan.";
        } else if (enabled) {
            elements.pinStatus.textContent =
                "PIN aktif. PIN akan diminta saat aplikasi dibuka kembali.";
        } else {
            elements.pinStatus.textContent =
                "PIN belum aktif. Aplikasi dapat digunakan tanpa PIN sampai Anda mengaturnya.";
        }

        elements.currentPinWrap.classList.toggle("is-hidden", enabled !== true);
        elements.btnRemovePin.classList.toggle("is-hidden", enabled !== true);
        elements.currentPinInput.value = "";
        elements.newPinInput.value = "";
        elements.confirmPinInput.value = "";
        elements.settingsMessage.textContent = "";
        elements.settingsMessage.style.color = "";
    }

    function openSettings() {
        updatePinSettings();
        elements.settingsModal.classList.remove("hidden");
    }

    function savePin() {
        if (!bridgeAvailable() ||
                typeof window.AndroidApp.setPin !== "function") {
            elements.settingsMessage.textContent =
                "Bridge Android tidak tersedia; PIN tidak dapat disimpan.";
            return;
        }

        var enabled = pinEnabled();
        if (enabled === null) {
            elements.settingsMessage.textContent =
                "Status PIN gagal diperiksa. Coba buka ulang aplikasi.";
            return;
        }

        var currentPin = elements.currentPinInput.value;
        var newPin = elements.newPinInput.value;
        var confirmPin = elements.confirmPinInput.value;

        if (!/^[0-9]{4,8}$/.test(newPin)) {
            elements.settingsMessage.textContent =
                "PIN baru harus terdiri dari 4–8 angka.";
            return;
        }

        if (newPin !== confirmPin) {
            elements.settingsMessage.textContent =
                "Konfirmasi PIN tidak sama.";
            return;
        }

        if (enabled && !/^[0-9]{4,8}$/.test(currentPin)) {
            elements.settingsMessage.textContent =
                "Masukkan PIN saat ini.";
            return;
        }

        try {
            if (window.AndroidApp.setPin(currentPin, newPin)) {
                elements.settingsModal.classList.add("hidden");
                showToast("PIN berhasil disimpan. Masukkan PIN untuk melanjutkan.");
                lockApp();
            } else {
                elements.settingsMessage.textContent =
                    "PIN saat ini salah atau PIN baru gagal disimpan.";
            }
        } catch (error) {
            console.error("Gagal menyimpan PIN.", error);
            elements.settingsMessage.textContent = "Gagal menyimpan PIN.";
        }
    }

    function removePin() {
        if (!bridgeAvailable() ||
                typeof window.AndroidApp.removePin !== "function") {
            elements.settingsMessage.textContent =
                "Bridge Android tidak tersedia; PIN tidak dapat dihapus.";
            return;
        }

        var currentPin = elements.currentPinInput.value;
        if (!/^[0-9]{4,8}$/.test(currentPin)) {
            elements.settingsMessage.textContent =
                "Masukkan PIN saat ini untuk menghapus PIN aplikasi.";
            return;
        }

        try {
            if (window.AndroidApp.removePin(currentPin)) {
                updatePinSettings();
                elements.settingsMessage.style.color = "#6ee7b7";
                elements.settingsMessage.textContent =
                    "PIN aplikasi berhasil dihapus.";
            } else {
                elements.settingsMessage.textContent =
                    "PIN saat ini salah atau PIN gagal dihapus.";
            }
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
            console.error("Gagal membuka file melalui aplikasi lain.", error);
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
                console.error("Gagal membuka pemilih folder.", error);
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
        elements.btnOpenExternal.addEventListener("click", openCurrentFileExternally);

        elements.lockPinInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                unlockApp();
            }
        });

        elements.categoryTabs.forEach(function (tab) {
            tab.addEventListener("click", function () {
                selectedCategory = tab.getAttribute("data-category");

                elements.categoryTabs.forEach(function (otherTab) {
                    otherTab.classList.toggle("active", otherTab === tab);
                });

                renderFiles();
            });
        });

        elements.btnCloseSettings.addEventListener("click", function () {
            elements.settingsModal.classList.add("hidden");
        });

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
            btnRemovePin: byId("btnRemovePin"),
            categoryTabs: document.querySelectorAll(".category-tab")
        };

        var requiredElements = [
            "lockScreen",
            "lockPinInput",
            "lockMessage",
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

        for (var i = 0; i < requiredElements.length; i++) {
            if (!elements[requiredElements[i]]) {
                console.error(
                    "Elemen HTML tidak ditemukan:",
                    requiredElements[i]
                );
                document.documentElement.classList.remove("pin-required");
                document.documentElement.classList.add("pin-check-failed");
                return;
            }
        }

        try {
            bindEvents();

            var enabled = pinEnabled();
            if (enabled === true || enabled === null) {
                lockApp();
            } else {
                showApp();
            }
        } catch (error) {
            console.error("Gagal menginisialisasi aplikasi.", error);

            document.documentElement.classList.add("pin-check-failed");
            elements.appShell.classList.add("is-hidden");
            elements.lockScreen.classList.remove("is-hidden");
            elements.lockMessage.textContent =
                "Aplikasi gagal dimulai. Tutup lalu buka kembali aplikasi.";
        }
    }

    window.onFolderChanged = function () {
        thumbnailCache = Object.create(null);
        refreshFiles();
    };

    window.lockApp = lockApp;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize);
    } else {
        initialize();
    }
})();