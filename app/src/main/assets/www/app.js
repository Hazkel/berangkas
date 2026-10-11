(function () {
    "use strict";

    var MAX_PREVIEW_SIZE = 10 * 1024 * 1024;
    var files = [];
    var selectedFolderUri = "";
    var currentFile = null;

    var elements = {};

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

    function setFolderStatus(isSelected, pathText) {
        elements.folderStatus.textContent = isSelected ? "Terhubung" : "Belum Dipilih";
        elements.folderStatus.className = "badge " + (isSelected ? "selected" : "not-selected");
        elements.folderPathDisplay.textContent = pathText;
    }

    function displayFolderLocation(uri) {
        var location = uri;

        try {
            location = decodeURIComponent(uri);
        } catch (error) {
            location = uri;
        }

        var treeMarker = location.indexOf("/tree/");
        if (treeMarker !== -1) {
            location = location.substring(treeMarker + 6);
        }

        location = location.replace(/^primary:/i, "Penyimpanan internal / ");
        location = location.replace(/^home:/i, "Folder Home / ");

        if (!location || location.indexOf("content://") === 0) {
            return "Folder penyimpanan sudah dipilih.";
        }

        return "Lokasi: " + location;
    }

    function formatFileSize(size) {
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

    function getExtension(name) {
        var dot = name.lastIndexOf(".");
        return dot === -1 ? "" : name.substring(dot + 1).toLowerCase();
    }

    function getImageMime(file) {
        var mime = (file.type || "").toLowerCase();

        if (mime === "image/png" ||
            mime === "image/jpeg" ||
            mime === "image/gif" ||
            mime === "image/webp" ||
            mime === "image/bmp") {
            return mime;
        }

        var extension = getExtension(file.name);
        var imageTypes = {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            bmp: "image/bmp"
        };

        return imageTypes[extension] || "";
    }

    function isTextFile(file) {
        var mime = (file.type || "").toLowerCase();

        if (mime.indexOf("text/") === 0 ||
            mime === "application/json" ||
            mime === "application/xml" ||
            mime === "application/javascript") {
            return true;
        }

        var textExtensions = [
            "txt", "md", "csv", "json", "xml", "html", "htm",
            "js", "css", "log", "ini", "yaml", "yml", "java",
            "kt", "py", "sql"
        ];

        return textExtensions.indexOf(getExtension(file.name)) !== -1;
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
        for (var start = 0; start < bytes.length; start += 8192) {
            var end = Math.min(start + 8192, bytes.length);
            for (var j = start; j < end; j++) {
                encoded += "%" + bytes[j].toString(16).padStart(2, "0");
            }
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
            showToast("Folder ditampilkan, tetapi isi subfolder belum dapat dibuka dari aplikasi ini.");
            return;
        }

        currentFile = file;
        elements.modalTitle.textContent = file.name || "Pratinjau";
        elements.previewModal.classList.remove("hidden");
        clearElement(elements.modalBody);

        if (file.size > MAX_PREVIEW_SIZE) {
            showPreviewMessage(
                "File terlalu besar untuk dipratinjau di aplikasi. Gunakan tombol di bawah untuk membukanya."
            );
            return;
        }

        var imageMime = getImageMime(file);
        var canPreviewImage = Boolean(imageMime);
        var canPreviewText = isTextFile(file);

        if (!canPreviewImage && !canPreviewText) {
            showPreviewMessage(
                "Pratinjau tidak tersedia untuk jenis file ini. Gunakan tombol di bawah untuk membukanya."
            );
            return;
        }

        if (file.size === 0 && canPreviewText) {
            showPreviewMessage("File ini kosong.");
            return;
        }

        if (!bridgeAvailable() || typeof window.AndroidApp.readFileBase64 !== "function") {
            showPreviewMessage("Fitur pratinjau hanya tersedia di aplikasi Android.");
            return;
        }

        try {
            var base64 = window.AndroidApp.readFileBase64(file.uri);

            if (!base64 && file.size > 0) {
                showPreviewMessage("File tidak dapat dibaca. Coba buka dengan aplikasi lain.");
                return;
            }

            if (canPreviewImage) {
                var image = document.createElement("img");
                image.alt = file.name || "Pratinjau gambar";
                image.src = "data:" + imageMime + ";base64," + base64;
                image.onerror = function () {
                    showPreviewMessage("Gambar tidak dapat ditampilkan. Coba buka dengan aplikasi lain.");
                };
                elements.modalBody.appendChild(image);
                return;
            }

            var pre = document.createElement("pre");
            pre.textContent = decodeBase64Text(base64);
            elements.modalBody.appendChild(pre);
        } catch (error) {
            showPreviewMessage("Terjadi kesalahan saat membaca file. Coba buka dengan aplikasi lain.");
        }
    }

    function renderFiles() {
        clearElement(elements.fileList);

        if (!selectedFolderUri) {
            elements.fileCount.textContent = "0 item";
            var notSelected = document.createElement("li");
            notSelected.className = "empty-state";
            notSelected.textContent = "Pilih folder penyimpanan untuk melihat isinya.";
            elements.fileList.appendChild(notSelected);
            return;
        }

        var query = elements.searchInput.value.trim().toLowerCase();
        var visibleFiles = files.filter(function (file) {
            return (file.name || "").toLowerCase().indexOf(query) !== -1;
        });

        if (query) {
            elements.fileCount.textContent = visibleFiles.length + " dari " + files.length + " item";
        } else {
            elements.fileCount.textContent = files.length + (files.length === 1 ? " item" : " item");
        }

        if (visibleFiles.length === 0) {
            var empty = document.createElement("li");
            empty.className = "empty-state";
            empty.textContent = query
                ? "Tidak ada file atau folder yang cocok dengan pencarian."
                : "Folder ini belum berisi file.";
            elements.fileList.appendChild(empty);
            return;
        }

        visibleFiles.forEach(function (file) {
            var item = document.createElement("li");
            item.className = "file-item";
            item.tabIndex = 0;
            item.setAttribute("role", "button");

            var infoColumn = document.createElement("div");
            infoColumn.className = "file-info-col";

            var icon = document.createElement("span");
            icon.className = "file-icon";
            icon.textContent = file.isDirectory
                ? "📁"
                : (getImageMime(file) ? "🖼️" : "📄");

            var texts = document.createElement("div");
            texts.className = "file-texts";

            var name = document.createElement("div");
            name.className = "file-name";
            name.textContent = file.name || "Tanpa nama";

            var subtitle = document.createElement("div");
            subtitle.className = "file-sub";
            subtitle.textContent = file.isDirectory
                ? "Folder"
                : formatFileSize(file.size);

            texts.appendChild(name);
            texts.appendChild(subtitle);
            infoColumn.appendChild(icon);
            infoColumn.appendChild(texts);
            item.appendChild(infoColumn);

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

    function normalizeFileList(raw) {
        var parsed = typeof raw === "string" ? JSON.parse(raw) : raw;

        if (!Array.isArray(parsed)) {
            throw new Error("Respons daftar file bukan array.");
        }

        return parsed.map(function (item) {
            return {
                name: item && item.name ? String(item.name) : "Tanpa nama",
                size: item && Number.isFinite(Number(item.size)) ? Number(item.size) : 0,
                isDirectory: Boolean(item && item.isDirectory),
                type: item && item.type ? String(item.type) : "unknown",
                lastModified: item && Number.isFinite(Number(item.lastModified))
                    ? Number(item.lastModified)
                    : 0,
                uri: item && item.uri ? String(item.uri) : ""
            };
        }).filter(function (item) {
            return item.isDirectory || Boolean(item.uri);
        }).sort(function (a, b) {
            if (a.isDirectory !== b.isDirectory) {
                return a.isDirectory ? -1 : 1;
            }

            return a.name.toLowerCase() < b.name.toLowerCase() ? -1 :
                (a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0);
        });
    }

    function refreshFiles() {
        if (!bridgeAvailable()) {
            selectedFolderUri = "";
            files = [];
            setFolderStatus(false, "Fitur penyimpanan tersedia di aplikasi Android.");
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
            files = normalizeFileList(window.AndroidApp.listFiles());
            renderFiles();
        } catch (error) {
            files = [];
            setFolderStatus(true, "Folder sudah dipilih, tetapi daftar file gagal dimuat.");
            renderFiles();
            showToast("Gagal memuat isi folder.");
        }
    }

    function closePreview() {
        elements.previewModal.classList.add("hidden");
        clearElement(elements.modalBody);
        currentFile = null;
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
            showToast("File tidak dapat dibuka dengan aplikasi lain.");
        }
    }

    function initialize() {
        elements = {
            btnRefresh: byId("btnRefresh"),
            btnPickFolder: byId("btnPickFolder"),
            folderStatus: byId("folderStatus"),
            folderPathDisplay: byId("folderPathDisplay"),
            searchInput: byId("searchInput"),
            fileCount: byId("fileCount"),
            fileList: byId("fileList"),
            previewModal: byId("previewModal"),
            modalTitle: byId("modalTitle"),
            modalBody: byId("modalBody"),
            btnCloseModal: byId("btnCloseModal"),
            btnOpenExternal: byId("btnOpenExternal")
        };

        elements.btnPickFolder.addEventListener("click", function () {
            if (!bridgeAvailable()) {
                showToast("Pemilihan folder hanya tersedia di aplikasi Android.");
                return;
            }

            try {
                window.AndroidApp.openFolderPicker();
            } catch (error) {
                showToast("Pemilih folder tidak dapat dibuka.");
            }
        });

        elements.btnRefresh.addEventListener("click", refreshFiles);
        elements.searchInput.addEventListener("input", renderFiles);
        elements.btnCloseModal.addEventListener("click", closePreview);
        elements.btnOpenExternal.addEventListener("click", openCurrentFileExternally);

        elements.previewModal.addEventListener("click", function (event) {
            if (event.target === elements.previewModal) {
                closePreview();
            }
        });

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && !elements.previewModal.classList.contains("hidden")) {
                closePreview();
            }
        });

        refreshFiles();
    }

    window.onFolderChanged = function () {
        refreshFiles();
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize);
    } else {
        initialize();
    }
})();