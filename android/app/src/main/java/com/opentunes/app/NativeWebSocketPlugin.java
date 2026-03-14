package com.opentunes.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor bridge between the WebView JS layer and the native WebSocket
 * managed by OpenTunesMediaService.
 *
 * Events emitted to JS:
 *   wsMessage       { data: string }           — JSON for messages not handled natively
 *   wsConnected     {}                         — native WS opened
 *   wsDisconnected  { code: int, reason: str } — native WS closed
 */
@CapacitorPlugin(name = "NativeWebSocket")
public class NativeWebSocketPlugin extends Plugin {

    @Override
    public void load() {
        OpenTunesMediaService service = OpenTunesMediaService.getInstance();
        if (service != null) {
            wireForwarder(service.getWebSocketManager());
        }
    }

    private void wireForwarder(NativeWebSocketManager manager) {
        manager.setForwarder(new NativeWebSocketManager.MessageForwarder() {
            @Override
            public void onMessage(String json) {
                JSObject data = new JSObject();
                data.put("data", json);
                notifyListeners("wsMessage", data);
            }

            @Override
            public void onConnected() {
                notifyListeners("wsConnected", new JSObject());
            }

            @Override
            public void onDisconnected(int code, String reason) {
                JSObject data = new JSObject();
                data.put("code", code);
                data.put("reason", reason != null ? reason : "");
                notifyListeners("wsDisconnected", data);
            }
        });
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String wsUrl = call.getString("wsUrl");
        String deviceId = call.getString("deviceId");
        String deviceName = call.getString("deviceName", "Android");
        String deviceType = call.getString("deviceType", "mobile");

        if (wsUrl == null || deviceId == null) {
            call.reject("Missing wsUrl or deviceId");
            return;
        }

        OpenTunesMediaService service = OpenTunesMediaService.getInstance();
        if (service != null) {
            NativeWebSocketManager manager = service.getWebSocketManager();
            // Re-wire the forwarder in case the plugin was loaded before the service
            wireForwarder(manager);
            manager.connect(wsUrl, deviceId, deviceName, deviceType);
        }
        call.resolve();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        OpenTunesMediaService service = OpenTunesMediaService.getInstance();
        if (service != null) {
            service.getWebSocketManager().disconnect();
        }
        call.resolve();
    }

    @PluginMethod
    public void sendMessage(PluginCall call) {
        String message = call.getString("message");
        if (message == null) {
            call.reject("Missing message");
            return;
        }

        OpenTunesMediaService service = OpenTunesMediaService.getInstance();
        if (service != null) {
            service.getWebSocketManager().sendMessage(message);
        }
        call.resolve();
    }

    @PluginMethod
    public void cacheEdgeLibrary(PluginCall call) {
        String json = call.getString("json");
        if (json == null) {
            call.reject("Missing json");
            return;
        }

        OpenTunesMediaService service = OpenTunesMediaService.getInstance();
        if (service != null) {
            service.getWebSocketManager().cacheEdgeLibrary(json);
        }
        call.resolve();
    }

    @PluginMethod
    public void getConnectionState(PluginCall call) {
        boolean connected = false;
        OpenTunesMediaService service = OpenTunesMediaService.getInstance();
        if (service != null) {
            connected = service.getWebSocketManager().isConnected();
        }

        JSObject result = new JSObject();
        result.put("connected", connected);
        call.resolve(result);
    }
}
