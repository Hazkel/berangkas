
package com.berangkas;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.documentfile.provider.DocumentFile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

public class MainActivity extends Activity {

    private static final int REQUEST_CODE_PICK_FOLDER = 1001;

    private static final String PREFS_NAME = "BerangkasPrefs";
    private static final String KEY_FOLDER_URI = "folder_tree_uri";

    private static final int BUFFER_SIZE = 8192;
    private static final int MAX_PREVIEW_SIZE = 20 * 1024 * 1024;

    private WebView webView;
    private SharedPreferences prefs;

    private String lastBackendError = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        // Tidak mengizinkan navigasi ke halaman eksternal di WebView.
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(
                    WebView view,
                    WebResourceRequest request
            ) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();

                return !"file".equalsIgnoreCase(scheme)
                        || !uri.toString().startsWith(
                                "file:///android_asset/www/"
                        );
            }

            @Override
            public boolean shouldOverrideUrlLoading(
                    WebView view,
                    String url
            ) {
                return url == null
                        || !url.startsWith(
                                "file:///android_asset/www/"
                        );
            }
        });

        webView.addJavascriptInterface(
                new WebAppInterface(),
                "AndroidApp"
        );

        webView.loadUrl(
                "file:///android_asset/www/index.html"
        );
    }

    // =========================================================
    // PEMILIHAN FOLDER
    // =========================================================

    private void openFolderPickerInternal() {
        try {
            Intent intent = new Intent(
                    Intent.ACTION_OPEN_DOCUMENT_TREE
            );

            intent.addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                            | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
            );

            startActivityForResult(
                    intent,
                    REQUEST_CODE_PICK_FOLDER
            );

        } catch (Exception e) {
            showToast("Tidak dapat membuka pemilih folder.");
        }
    }

    @Override
    protected void onActivityResult(
            int requestCode,
            int resultCode,
            @Nullable Intent data
    ) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode != REQUEST_CODE_PICK_FOLDER) {
            return;
        }

        if (resultCode != RESULT_OK || data == null) {
            return;
        }

        Uri treeUri = data.getData();

        if (treeUri == null) {
            showToast("Folder tidak valid.");
            return;
        }

        int returnedFlags = data.getFlags();

        int permissionFlags = returnedFlags
                & Intent.FLAG_GRANT_READ_URI_PERMISSION;

        if (permissionFlags == 0) {
            showToast("Izin membaca folder tidak diberikan.");
            return;
        }

        try {
            getContentResolver().takePersistableUriPermission(
                    treeUri,
                    permissionFlags
            );

            // Simpan hanya setelah izin berhasil diperoleh.
            prefs.edit()
                    .putString(KEY_FOLDER_URI, treeUri.toString())
                    .apply();

            lastBackendError = "";

            notifyFolderChanged();

        } catch (SecurityException e) {
            showToast("Gagal menyimpan izin akses folder.");
        } catch (Exception e) {
            showToast("Gagal memilih folder.");
        }
    }

    private void notifyFolderChanged() {
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript(
                        "if (typeof window.onFolderChanged === 'function') {"
                                + "window.onFolderChanged();"
                                + "}",
                        null
                );
            }
        });
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidApp");
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }

        super.onDestroy();
    }

    private void showToast(String message) {
        runOnUiThread(() ->
                Toast.makeText(
                        MainActivity.this,
                        message,
                        Toast.LENGTH_SHORT
                ).show()
        );
    }

    private DocumentFile getSelectedFolder() {
        String uriString = prefs.getString(
                KEY_FOLDER_URI,
                ""
        );

        if (uriString == null || uriString.isEmpty()) {
            lastBackendError = "Belum ada folder yang dipilih.";
            return null;
        }

        try {
            Uri treeUri = Uri.parse(uriString);

            DocumentFile folder = DocumentFile.fromTreeUri(
                    MainActivity.this,
                    treeUri
            );

            if (folder == null || !folder.exists()) {
                lastBackendError = "Folder tidak tersedia.";
                return null;
            }

            if (!folder.isDirectory()) {
                lastBackendError = "Lokasi yang dipilih bukan folder.";
                return null;
            }

            lastBackendError = "";
            return folder;

        } catch (SecurityException e) {
            lastBackendError = "Izin folder telah dicabut.";
            return null;
        } catch (Exception e) {
            lastBackendError = "Gagal mengakses folder.";
            return null;
        }
    }

    // =========================================================
    // JAVASCRIPT BRIDGE
    // Nama dan method dipertahankan agar kompatibel dengan app.js.
    // =========================================================

    public class WebAppInterface {

        @JavascriptInterface
        public void openFolderPicker() {
            runOnUiThread(
                    () -> openFolderPickerInternal()
            );
        }

        @JavascriptInterface
        public String getSelectedFolderUri() {
            return prefs.getString(
                    KEY_FOLDER_URI,
                    ""
            );
        }

        @JavascriptInterface
        public String getLastError() {
            return lastBackendError;
        }

        // Mengembalikan daftar item dalam folder terpilih.
        @JavascriptInterface
        public String listFiles() {
            JSONArray jsonArray = new JSONArray();

            DocumentFile folder = getSelectedFolder();

            if (folder == null) {
                return jsonArray.toString();
            }

            try {
                DocumentFile[] files = folder.listFiles();

                if (files == null) {
                    lastBackendError = "Gagal membaca daftar file.";
                    return jsonArray.toString();
                }

                for (DocumentFile file : files) {
                    if (file == null || file.getName() == null) {
                        continue;
                    }

                    JSONObject obj = new JSONObject();

                    obj.put("name", file.getName());
                    obj.put("size", file.length());
                    obj.put("isDirectory", file.isDirectory());

                    String mimeType = file.getType();

                    obj.put(
                            "type",
                            mimeType != null ? mimeType : "unknown"
                    );

                    obj.put("lastModified", file.lastModified());
                    obj.put("uri", file.getUri().toString());

                    jsonArray.put(obj);
                }

                lastBackendError = "";

            } catch (SecurityException e) {
                lastBackendError = "Izin membaca folder ditolak.";
            } catch (Exception e) {
                lastBackendError = "Terjadi kesalahan saat membaca file.";
            }

            return jsonArray.toString();
        }

        // Membuka file menggunakan aplikasi Android yang sesuai.
        @JavascriptInterface
        public void openFileWithSystemViewer(String uriString) {
            if (uriString == null || uriString.trim().isEmpty()) {
                showToast("Lokasi file tidak valid.");
                return;
            }

            try {
                Uri fileUri = Uri.parse(uriString);

                DocumentFile docFile = DocumentFile.fromSingleUri(
                        MainActivity.this,
                        fileUri
                );

                if (docFile == null || !docFile.exists()) {
                    showToast("File tidak ditemukan.");
                    return;
                }

                String mimeType = docFile.getType();

                if (mimeType == null || mimeType.trim().isEmpty()) {
                    mimeType = "*/*";
                }

                Intent viewIntent = new Intent(Intent.ACTION_VIEW);
                viewIntent.setDataAndType(fileUri, mimeType);
                viewIntent.addFlags(
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                );

                Intent chooser = Intent.createChooser(
                        viewIntent,
                        "Buka file dengan"
                );

                startActivity(chooser);

            } catch (SecurityException e) {
                showToast("Tidak memiliki izin membaca file.");
            } catch (Exception e) {
                showToast(
                        "Tidak ada aplikasi yang dapat membuka file ini."
                );
            }
        }

        // Membaca file untuk fitur pratinjau berbasis Base64.
        // Ukuran pratinjau dibatasi untuk mengurangi risiko kehabisan memori.
        @JavascriptInterface
        public String readFileBase64(String uriString) {
            if (uriString == null || uriString.trim().isEmpty()) {
                lastBackendError = "Lokasi file tidak valid.";
                return "";
            }

            try {
                Uri fileUri = Uri.parse(uriString);

                DocumentFile docFile = DocumentFile.fromSingleUri(
                        MainActivity.this,
                        fileUri
                );

                if (docFile == null || !docFile.exists()) {
                    lastBackendError = "File tidak ditemukan.";
                    return "";
                }

                if (docFile.isDirectory()) {
                    lastBackendError = "Folder tidak dapat dipratinjau sebagai file.";
                    return "";
                }

                long fileSize = docFile.length();

                if (fileSize > MAX_PREVIEW_SIZE) {
                    lastBackendError =
                            "File terlalu besar untuk pratinjau (maksimal 20 MB).";
                    return "";
                }

                try (
                        InputStream input = getContentResolver()
                                .openInputStream(fileUri);
                        ByteArrayOutputStream output =
                                new ByteArrayOutputStream()
                ) {
                    if (input == null) {
                        lastBackendError = "File tidak dapat dibaca.";
                        return "";
                    }

                    byte[] buffer = new byte[BUFFER_SIZE];
                    int bytesRead;
                    int totalBytes = 0;

                    while ((bytesRead = input.read(buffer)) != -1) {
                        totalBytes += bytesRead;

                        if (totalBytes > MAX_PREVIEW_SIZE) {
                            lastBackendError =
                                    "File terlalu besar untuk pratinjau.";
                            return "";
                        }

                        output.write(buffer, 0, bytesRead);
                    }

                    lastBackendError = "";

                    return Base64.encodeToString(
                            output.toByteArray(),
                            Base64.NO_WRAP
                    );
                }

            } catch (SecurityException e) {
                lastBackendError = "Izin membaca file ditolak.";
                return "";
            } catch (IOException e) {
                lastBackendError = "Terjadi kesalahan saat membaca file.";
                return "";
            } catch (Exception e) {
                lastBackendError = "File gagal dibaca.";
                return "";
            }
        }

        @JavascriptInterface
        public void showToast(String msg) {
            if (msg == null || msg.trim().isEmpty()) {
                return;
            }

            // Batasi pesan dari JavaScript agar tidak terlalu panjang.
            String safeMessage = msg.length() > 200
                    ? msg.substring(0, 200)
                    : msg;

            showToast(safeMessage);
        }
    }
}