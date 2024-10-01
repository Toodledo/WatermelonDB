package com.nozbe.watermelondb.jsi;

import android.util.Log;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.JavaScriptContextHolder;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;

@ReactModule(name = JSIInstaller.NAME)
public class JSIInstaller extends ReactContextBaseJavaModule {
    public static final String NAME = "JSIInstaller";
    private static ReactApplicationContext reactContext;

    public JSIInstaller(ReactApplicationContext reactContext) {
        super(reactContext);
        JSIInstaller.reactContext = reactContext;
    }

    @NonNull
    @Override
    public String getName() {
        return NAME;
    }

    @ReactMethod(isBlockingSynchronousMethod = true)
    public boolean install() {
        try {
            System.loadLibrary("watermelondb-jsi");

            JavaScriptContextHolder jsContext = getReactApplicationContext().getJavaScriptContextHolder();

            Log.i(NAME, "Installing JSI Bindings for watermelondb-jsi...");
            installBinding(jsContext.get());
            Log.i(NAME, "Successfully installed JSI Bindings for watermelondb-jsi");

            return true;
        } catch (Exception exception) {
            Log.e(NAME, "Failed to install JSI Bindings for watermelondb-jsi!", exception);
            return false;
        }
    }
    // Helper method called from C++
    static String _resolveDatabasePath(String dbName) {
        // On some systems, there is some kind of lock on `/databases` folder ¯\_(ツ)_/¯
        return reactContext.getDatabasePath(dbName + ".db").getPath().replace("/databases", "");
    }

    private static native void installBinding(long javaScriptContextHolder);

    static native void provideSyncJson(int id, byte[] json);

    static native void destroy();
}