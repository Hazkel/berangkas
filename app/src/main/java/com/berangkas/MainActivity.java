package com.berangkas;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.documentfile.provider.DocumentFile;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

public class MainActivity extends Activity {

    private static final int REQUEST_CODE_PICK_FOLDER = 1001;

    private static final String PREFS_NAME = "BerangkasPrefs";
    private static final String KEY_FOLDER_URI = "folder_tree_uri";
    private static final String KEY_PIN_SALT = "app_pin_salt";
    private static final String KEY_PIN_HASH = "app_pin_hash";
    private static final String KEY_PIN_ATTEMPTS = "app_pin_failed_attempts";
    private static final String KEY_PIN_LOCKOUT = "app_pin_lockout_until";

    private static final int PIN_ITERATIONS = 120000;
    private static final int MAX_PIN_ATTEMPTS = 5;
    private static final long PIN_LOCKOUT_MILLIS = 30000L;

    private WebView webView;
    private SharedPreferences prefs;

    private boolean webPageReady;
    private boolean lockAfterBackground;
    private boolean folderPickerInProgress;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(18, 20, 23));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                webPageReady = true;
                notifyWebViewOfResume();
            }
        });

        webView.addJavascriptInterface(new WebAppInterface(), "AndroidApp");
        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    protected void onPause() {
        // Jangan mengunci di onPause: keyboard dan pemilih folder dapat
        // memause Activity sementara tanpa pengguna meninggalkan aplikasi.
        super.onPause();
    }

    @Override
    protected void onStop() {
        // Pemilih folder sengaja tidak menyebabkan aplikasi meminta PIN
        // kembali sesaat setelah pengguna memilih atau membatalkan folder.
        if (!folderPickerInProgress) {
            lockAfterBackground = true;
        }

        super.onStop();
    }

    @Override
    protected void onResume() {
        super.onResume();
        notifyWebViewOfResume();
    }

    private void notifyWebViewOfResume() {
        if (webView == null || !webPageReady || !lockAfterBackground) {
            return;
        }

        lockAfterBackground = false;

        webView.post(() -> webView.evaluateJavascript(
                "if (window.onNativeResumeAfterBackground) {" +
                        "window.onNativeResumeAfterBackground();" +
                        "}",
                null
        ));
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

        folderPickerInProgress = false;

        if (resultCode != RESULT_OK || data == null) {
            return;
        }

        Uri treeUri = data.getData();
        if (treeUri == null) {
            return;
        }

        try {
            getContentResolver().takePersistableUriPermission(
                    treeUri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
            );

            prefs.edit()
                    .putString(KEY_FOLDER_URI, treeUri.toString())
                    .apply();

            if (webView != null) {
                webView.post(() -> webView.evaluateJavascript(
                        "if (window.onFolderChanged) window.onFolderChanged();",
                        null
                ));
            }
        } catch (SecurityException e) {
            Toast.makeText(
                    this,
                    "Gagal mendapatkan izin folder: " + e.getMessage(),
                    Toast.LENGTH_LONG
            ).show();
        }
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
        webPageReady = false;

        if (webView != null) {
            webView.removeJavascriptInterface("AndroidApp");
            webView.destroy();
            webView = null;
        }

        super.onDestroy();
    }

    public class WebAppInterface {

        @JavascriptInterface
        public void openFolderPicker() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
                intent.addFlags(
                        Intent.FLAG_GRANT_READ_URI_PERMISSION |
                                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                );

                try {
                    folderPickerInProgress = true;
                    startActivityForResult(intent, REQUEST_CODE_PICK_FOLDER);
                } catch (Exception e) {
                    folderPickerInProgress = false;
                    Toast.makeText(
                            MainActivity.this,
                            "Pemilih folder tidak dapat dibuka.",
                            Toast.LENGTH_SHORT
                    ).show();
                }
            });
        }

        @JavascriptInterface
        public String getSelectedFolderUri() {
            return prefs.getString(KEY_FOLDER_URI, "");
        }

        @JavascriptInterface
        public String listFiles() {
            String uriString = prefs.getString(KEY_FOLDER_URI, "");

            if (uriString.isEmpty()) {
                return "[]";
            }

            try {
                DocumentFile folder = DocumentFile.fromTreeUri(
                        MainActivity.this,
                        Uri.parse(uriString)
                );

                if (folder == null || !folder.exists() || !folder.isDirectory()) {
                    return "[]";
                }

                DocumentFile[] children = folder.listFiles();
                JSONArray result = new JSONArray();

                if (children == null) {
                    return result.toString();
                }

                for (DocumentFile file : children) {
                    JSONObject item = new JSONObject();
                    item.put("name", file.getName() == null ? "" : file.getName());
                    item.put("size", file.length());
                    item.put("isDirectory", file.isDirectory());
                    item.put(
                            "type",
                            file.getType() == null ? "unknown" : file.getType()
                    );
                    item.put("lastModified", file.lastModified());
                    item.put("uri", file.getUri().toString());
                    result.put(item);
                }

                return result.toString();
            } catch (Exception e) {
                return "[]";
            }
        }

        @JavascriptInterface
        public String readFileBase64(String uriString) {
            try (InputStream input = getContentResolver().openInputStream(
                    Uri.parse(uriString)
            )) {
                if (input == null) {
                    return "";
                }

                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int count;

                while ((count = input.read(chunk)) != -1) {
                    output.write(chunk, 0, count);
                }

                return Base64.encodeToString(
                        output.toByteArray(),
                        Base64.NO_WRAP
                );
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public String getImageThumbnailBase64(String uriString) {
            Bitmap bitmap = null;

            try {
                Uri uri = Uri.parse(uriString);
                BitmapFactory.Options bounds = new BitmapFactory.Options();
                bounds.inJustDecodeBounds = true;

                try (InputStream input =
                             getContentResolver().openInputStream(uri)) {
                    if (input == null) {
                        return "";
                    }

                    BitmapFactory.decodeStream(input, null, bounds);
                }

                if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
                    return "";
                }

                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inSampleSize = calculateSampleSize(
                        bounds.outWidth,
                        bounds.outHeight,
                        480
                );

                try (InputStream input =
                             getContentResolver().openInputStream(uri)) {
                    if (input == null) {
                        return "";
                    }

                    bitmap = BitmapFactory.decodeStream(input, null, options);
                }

                return bitmapToBase64(bitmap);
            } catch (Exception e) {
                return "";
            } finally {
                recycle(bitmap);
            }
        }

        @JavascriptInterface
        public String getVideoThumbnailBase64(String uriString) {
            MediaMetadataRetriever retriever = new MediaMetadataRetriever();
            Bitmap bitmap = null;

            try {
                retriever.setDataSource(
                        MainActivity.this,
                        Uri.parse(uriString)
                );

                bitmap = retriever.getFrameAtTime(
                        1000000L,
                        MediaMetadataRetriever.OPTION_CLOSEST_SYNC
                );

                return bitmapToBase64(bitmap);
            } catch (Exception e) {
                return "";
            } finally {
                try {
                    retriever.release();
                } catch (Exception ignored) {
                    // Tidak ada tindakan lanjutan jika retriever gagal dilepas.
                }

                recycle(bitmap);
            }
        }

        @JavascriptInterface
        public void openFileWithSystemViewer(String uriString) {
            try {
                Uri fileUri = Uri.parse(uriString);
                DocumentFile file = DocumentFile.fromSingleUri(
                        MainActivity.this,
                        fileUri
                );

                String mime = file != null && file.getType() != null
                        ? file.getType()
                        : "*/*";

                Intent viewIntent = new Intent(Intent.ACTION_VIEW);
                viewIntent.setDataAndType(fileUri, mime);
                viewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                startActivity(
                        Intent.createChooser(viewIntent, "Buka file dengan")
                );
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(
                        MainActivity.this,
                        "Tidak ada aplikasi untuk membuka file ini",
                        Toast.LENGTH_SHORT
                ).show());
            }
        }

        @JavascriptInterface
        public boolean isPinEnabled() {
            return prefs.contains(KEY_PIN_SALT) &&
                    prefs.contains(KEY_PIN_HASH);
        }

        @JavascriptInterface
        public synchronized boolean verifyPin(String pin) {
            if (!isPinEnabled()) {
                return false;
            }

            long now = System.currentTimeMillis();
            long lockoutUntil = prefs.getLong(KEY_PIN_LOCKOUT, 0L);

            if (now < lockoutUntil) {
                return false;
            }

            try {
                if (matchesStoredPin(pin)) {
                    prefs.edit()
                            .remove(KEY_PIN_ATTEMPTS)
                            .remove(KEY_PIN_LOCKOUT)
                            .apply();
                    return true;
                }
            } catch (GeneralSecurityException | IllegalArgumentException e) {
                return false;
            }

            int attempts = prefs.getInt(KEY_PIN_ATTEMPTS, 0) + 1;
            SharedPreferences.Editor editor = prefs.edit()
                    .putInt(KEY_PIN_ATTEMPTS, attempts);

            if (attempts >= MAX_PIN_ATTEMPTS) {
                editor.putLong(
                        KEY_PIN_LOCKOUT,
                        now + PIN_LOCKOUT_MILLIS
                );
                editor.putInt(KEY_PIN_ATTEMPTS, 0);
            }

            editor.apply();
            return false;
        }

        @JavascriptInterface
        public synchronized boolean setPin(String currentPin, String newPin) {
            if (!isValidPin(newPin)) {
                return false;
            }

            if (isPinEnabled() && !verifyPin(currentPin)) {
                return false;
            }

            try {
                byte[] salt = new byte[16];
                new SecureRandom().nextBytes(salt);
                byte[] hash = derivePinHash(newPin, salt);

                prefs.edit()
                        .putString(
                                KEY_PIN_SALT,
                                Base64.encodeToString(salt, Base64.NO_WRAP)
                        )
                        .putString(
                                KEY_PIN_HASH,
                                Base64.encodeToString(hash, Base64.NO_WRAP)
                        )
                        .remove(KEY_PIN_ATTEMPTS)
                        .remove(KEY_PIN_LOCKOUT)
                        .apply();

                return true;
            } catch (GeneralSecurityException e) {
                return false;
            }
        }

        @JavascriptInterface
        public synchronized boolean removePin(String currentPin) {
            if (!isPinEnabled() || !verifyPin(currentPin)) {
                return false;
            }

            prefs.edit()
                    .remove(KEY_PIN_SALT)
                    .remove(KEY_PIN_HASH)
                    .remove(KEY_PIN_ATTEMPTS)
                    .remove(KEY_PIN_LOCKOUT)
                    .apply();

            return true;
        }

        @JavascriptInterface
        public void showToast(String message) {
            runOnUiThread(() -> Toast.makeText(
                    MainActivity.this,
                    message,
                    Toast.LENGTH_SHORT
            ).show());
        }

        private boolean matchesStoredPin(String pin)
                throws GeneralSecurityException {
            if (!isValidPin(pin)) {
                return false;
            }

            String saltValue = prefs.getString(KEY_PIN_SALT, "");
            String hashValue = prefs.getString(KEY_PIN_HASH, "");

            if (saltValue.isEmpty() || hashValue.isEmpty()) {
                return false;
            }

            byte[] salt = Base64.decode(saltValue, Base64.NO_WRAP);
            byte[] expectedHash = Base64.decode(hashValue, Base64.NO_WRAP);
            byte[] actualHash = derivePinHash(pin, salt);

            return MessageDigest.isEqual(expectedHash, actualHash);
        }

        private byte[] derivePinHash(String pin, byte[] salt)
                throws GeneralSecurityException {
            PBEKeySpec spec = new PBEKeySpec(
                    pin.toCharArray(),
                    salt,
                    PIN_ITERATIONS,
                    256
            );

            try {
                SecretKeyFactory factory = SecretKeyFactory.getInstance(
                        "PBKDF2WithHmacSHA1"
                );
                return factory.generateSecret(spec).getEncoded();
            } finally {
                spec.clearPassword();
            }
        }

        private boolean isValidPin(String pin) {
            return pin != null && pin.matches("[0-9]{4,8}");
        }

        private int calculateSampleSize(int width, int height, int maxSize) {
            int sampleSize = 1;

            while (width / sampleSize > maxSize ||
                    height / sampleSize > maxSize) {
                sampleSize *= 2;
            }

            return sampleSize;
        }

        private String bitmapToBase64(Bitmap bitmap) {
            if (bitmap == null) {
                return "";
            }

            Bitmap thumbnail = bitmap;
            int maxDimension = Math.max(
                    bitmap.getWidth(),
                    bitmap.getHeight()
            );

            if (maxDimension > 480) {
                float scale = 480f / maxDimension;
                thumbnail = Bitmap.createScaledBitmap(
                        bitmap,
                        Math.max(1, Math.round(bitmap.getWidth() * scale)),
                        Math.max(1, Math.round(bitmap.getHeight() * scale)),
                        true
                );
            }

            ByteArrayOutputStream output = new ByteArrayOutputStream();
            thumbnail.compress(Bitmap.CompressFormat.JPEG, 78, output);

            if (thumbnail != bitmap) {
                thumbnail.recycle();
            }

            return Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
        }

        private void recycle(Bitmap bitmap) {
            if (bitmap != null && !bitmap.isRecycled()) {
                bitmap.recycle();
            }
        }
    }
}