package com.opentunes.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.Manifest;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
    name = "LocalLibrary",
    permissions = {
        @Permission(
            alias = "audio",
            strings = { Manifest.permission.READ_MEDIA_AUDIO }
        ),
        @Permission(
            alias = "storage",
            strings = { Manifest.permission.READ_EXTERNAL_STORAGE }
        )
    }
)
public class LocalLibraryPlugin extends Plugin {

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    /**
     * Open the system folder picker so the user can select a music directory.
     * Returns { path: string | null }.
     */
    @PluginMethod
    public void selectFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        startActivityForResult(call, intent, "selectFolderResult");
    }

    @ActivityCallback
    private void selectFolderResult(PluginCall call, ActivityResult result) {
        if (call == null) return;

        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            Uri treeUri = result.getData().getData();
            if (treeUri != null) {
                String path = treeUriToPath(treeUri);
                JSObject ret = new JSObject();
                ret.put("path", path);
                call.resolve(ret);
                return;
            }
        }

        // User cancelled or no data
        JSObject ret = new JSObject();
        ret.put("path", JSObject.NULL);
        call.resolve(ret);
    }

    /**
     * Convert a SAF tree URI to a filesystem path.
     * e.g. content://...documents/tree/primary%3AMusic -> /storage/emulated/0/Music
     */
    private String treeUriToPath(Uri treeUri) {
        String docId = DocumentsContract.getTreeDocumentId(treeUri);
        // docId is like "primary:Music" or "XXXX-XXXX:SomeFolder"
        String[] split = docId.split(":");
        String type = split[0];
        String subPath = split.length > 1 ? split[1] : "";

        if ("primary".equalsIgnoreCase(type)) {
            String base = Environment.getExternalStorageDirectory().getAbsolutePath();
            return subPath.isEmpty() ? base : base + "/" + subPath;
        } else {
            // SD card or other external storage
            return subPath.isEmpty() ? "/storage/" + type : "/storage/" + type + "/" + subPath;
        }
    }

    /**
     * Scan the device's music library via MediaStore.
     * Accepts an optional "paths" array to filter to specific directories.
     * Returns an array of song metadata objects.
     */
    @PluginMethod
    public void scanLibrary(PluginCall call) {
        // Check permission first
        if (Build.VERSION.SDK_INT >= 33) {
            if (getPermissionState("audio") != PermissionState.GRANTED) {
                requestPermissionForAlias("audio", call, "scanLibraryPermissionCallback");
                return;
            }
        } else {
            if (getPermissionState("storage") != PermissionState.GRANTED) {
                requestPermissionForAlias("storage", call, "scanLibraryPermissionCallback");
                return;
            }
        }

        doScanLibrary(call);
    }

    @PermissionCallback
    private void scanLibraryPermissionCallback(PluginCall call) {
        boolean granted = (Build.VERSION.SDK_INT >= 33)
            ? getPermissionState("audio") == PermissionState.GRANTED
            : getPermissionState("storage") == PermissionState.GRANTED;

        if (granted) {
            doScanLibrary(call);
        } else {
            call.reject("Audio file permission denied");
        }
    }

    private void doScanLibrary(PluginCall call) {
        // Parse optional paths filter
        List<String> filterPaths = new ArrayList<>();
        JSArray pathsArg = call.getArray("paths");
        if (pathsArg != null) {
            try {
                for (int i = 0; i < pathsArg.length(); i++) {
                    String p = pathsArg.getString(i);
                    if (p != null && !p.isEmpty()) {
                        // Ensure path ends with / for prefix matching
                        filterPaths.add(p.endsWith("/") ? p : p + "/");
                    }
                }
            } catch (Exception ignored) {}
        }

        // Run on background thread to avoid ANR
        executor.execute(() -> {
            ContentResolver resolver = getContext().getContentResolver();
            Uri uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;

            String[] projection = {
                MediaStore.Audio.Media.DATA,           // file path
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM,
                MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.TRACK,
                MediaStore.Audio.Media.MIME_TYPE,
                MediaStore.Audio.Media.SIZE,
            };

            // Build selection: must be music, optionally filtered by paths
            StringBuilder selectionBuilder = new StringBuilder();
            List<String> selectionArgs = new ArrayList<>();

            selectionBuilder.append(MediaStore.Audio.Media.IS_MUSIC).append(" != 0");

            if (!filterPaths.isEmpty()) {
                selectionBuilder.append(" AND (");
                for (int i = 0; i < filterPaths.size(); i++) {
                    if (i > 0) selectionBuilder.append(" OR ");
                    selectionBuilder.append(MediaStore.Audio.Media.DATA).append(" LIKE ?");
                    selectionArgs.add(filterPaths.get(i) + "%");
                }
                selectionBuilder.append(")");
            }

            String selection = selectionBuilder.toString();
            String[] argsArray = selectionArgs.isEmpty() ? null : selectionArgs.toArray(new String[0]);

            String sortOrder = MediaStore.Audio.Media.ARTIST + ", " +
                               MediaStore.Audio.Media.ALBUM + ", " +
                               MediaStore.Audio.Media.TRACK;

            JSArray songs = new JSArray();

            try (Cursor cursor = resolver.query(uri, projection, selection, argsArray, sortOrder)) {
                if (cursor != null) {
                    int colPath = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA);
                    int colTitle = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
                    int colArtist = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
                    int colAlbum = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
                    int colDuration = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);
                    int colTrack = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TRACK);
                    int colMime = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE);
                    int colSize = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE);

                    while (cursor.moveToNext()) {
                        String filePath = cursor.getString(colPath);
                        if (filePath == null || !(new File(filePath).exists())) continue;

                        JSObject song = new JSObject();
                        song.put("localPath", filePath);
                        song.put("title", cursor.getString(colTitle));

                        String artist = cursor.getString(colArtist);
                        song.put("artist", (artist != null && !artist.equals("<unknown>")) ? artist : "Unknown Artist");

                        String album = cursor.getString(colAlbum);
                        song.put("album", (album != null && !album.equals("<unknown>")) ? album : "Unknown Album");

                        long durationMs = cursor.getLong(colDuration);
                        song.put("duration", durationMs / 1000.0);

                        int track = cursor.getInt(colTrack);
                        // MediaStore sometimes encodes track as DTTT (disc*1000 + track)
                        song.put("trackNumber", track % 1000);

                        song.put("mimeType", cursor.getString(colMime));
                        song.put("fileSize", cursor.getLong(colSize));

                        // Art and hash are computed in a separate pass (computeHashes)
                        // to keep the scan fast. Default hasArt to true so the UI
                        // optimistically shows art slots; the art endpoint handles misses.
                        song.put("hasArt", true);
                        song.put("hash", "");

                        songs.put(song);
                    }
                }
            } catch (Exception e) {
                call.reject("Failed to scan library: " + e.getMessage());
                return;
            }

            JSObject result = new JSObject();
            result.put("songs", songs);
            call.resolve(result);
        });
    }

    /**
     * Read a local audio file and return it as base64 chunks.
     * Used for reverse streaming to the host.
     */
    @PluginMethod
    public void getFileBytes(PluginCall call) {
        String localPath = call.getString("localPath");
        if (localPath == null) {
            call.reject("Missing localPath");
            return;
        }

        executor.execute(() -> {
            File file = new File(localPath);
            if (!file.exists()) {
                call.reject("File not found: " + localPath);
                return;
            }

            try (FileInputStream fis = new FileInputStream(file)) {
                byte[] buffer = new byte[64 * 1024]; // 64KB chunks
                int bytesRead;
                JSArray chunks = new JSArray();

                while ((bytesRead = fis.read(buffer)) != -1) {
                    String chunk = Base64.encodeToString(buffer, 0, bytesRead, Base64.NO_WRAP);
                    chunks.put(chunk);
                }

                JSObject result = new JSObject();
                result.put("chunks", chunks);
                result.put("mimeType", getMimeType(localPath));
                result.put("fileSize", file.length());
                call.resolve(result);
            } catch (IOException e) {
                call.reject("Failed to read file: " + e.getMessage());
            }
        });
    }

    /**
     * Extract embedded album art from an audio file.
     * Returns base64-encoded image data or null.
     */
    @PluginMethod
    public void getEmbeddedArt(PluginCall call) {
        String localPath = call.getString("localPath");
        if (localPath == null) {
            call.reject("Missing localPath");
            return;
        }

        executor.execute(() -> {
            MediaMetadataRetriever retriever = new MediaMetadataRetriever();
            try {
                retriever.setDataSource(localPath);
                byte[] art = retriever.getEmbeddedPicture();
                JSObject result = new JSObject();
                if (art != null) {
                    result.put("data", Base64.encodeToString(art, Base64.NO_WRAP));
                } else {
                    result.put("data", JSObject.NULL);
                }
                call.resolve(result);
            } catch (Exception e) {
                JSObject result = new JSObject();
                result.put("data", JSObject.NULL);
                call.resolve(result);
            } finally {
                try { retriever.release(); } catch (Exception ignored) {}
            }
        });
    }

    /**
     * Compute SHA256 hashes and check album art for a batch of files.
     * Accepts a "paths" JSArray of file path strings.
     * Returns { results: [{ localPath, hash, hasArt }] } with all results at once.
     */
    @PluginMethod
    public void computeHashes(PluginCall call) {
        JSArray pathsArg = call.getArray("paths");
        if (pathsArg == null) {
            call.reject("Missing paths array");
            return;
        }

        executor.execute(() -> {
            JSArray results = new JSArray();

            try {
                for (int i = 0; i < pathsArg.length(); i++) {
                    String filePath = pathsArg.getString(i);
                    if (filePath == null) continue;

                    JSObject entry = new JSObject();
                    entry.put("localPath", filePath);
                    entry.put("hash", computeSha256(filePath));
                    entry.put("hasArt", hasEmbeddedArt(filePath));
                    results.put(entry);
                }
            } catch (Exception e) {
                call.reject("Failed to compute hashes: " + e.getMessage());
                return;
            }

            JSObject result = new JSObject();
            result.put("results", results);
            call.resolve(result);
        });
    }

    // --- Helpers ---

    /** Compute SHA256 hash of a file, returning hex string or empty on failure. */
    private String computeSha256(String filePath) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (FileInputStream fis = new FileInputStream(filePath)) {
                byte[] buffer = new byte[8192];
                int bytesRead;
                while ((bytesRead = fis.read(buffer)) != -1) {
                    digest.update(buffer, 0, bytesRead);
                }
            }
            byte[] hashBytes = digest.digest();
            StringBuilder sb = new StringBuilder();
            for (byte b : hashBytes) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException | IOException e) {
            return "";
        }
    }

    /** Check whether an audio file has embedded album art. */
    private boolean hasEmbeddedArt(String filePath) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        try {
            retriever.setDataSource(filePath);
            byte[] art = retriever.getEmbeddedPicture();
            return art != null;
        } catch (Exception e) {
            return false;
        } finally {
            try { retriever.release(); } catch (Exception ignored) {}
        }
    }

    private String getMimeType(String filePath) {
        String lower = filePath.toLowerCase();
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".flac")) return "audio/flac";
        if (lower.endsWith(".ogg")) return "audio/ogg";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".m4a") || lower.endsWith(".aac")) return "audio/mp4";
        if (lower.endsWith(".opus")) return "audio/opus";
        return "audio/mpeg";
    }
}
