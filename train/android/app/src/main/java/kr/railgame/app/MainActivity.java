package kr.railgame.app;

import android.app.Activity;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

/** 게임(HTML)을 앱 안에서 실행. 파일은 https://appassets.androidplatform.net/assets/www/ 주소로 열어 저장(localStorage)이 되게 함 */
public class MainActivity extends Activity {
    private WebView web;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        web = new WebView(this);
        setContentView(web);

        // 상태 표시줄·내비게이션 바에 가려지지 않게 여백
        web.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                v.setPadding(i.left, i.top, i.right, i.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // 진행 저장(localStorage)
        s.setSupportZoom(false);               // 확대·축소는 게임이 직접 처리
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);                    // 시스템 글자 크기에 화면이 깨지지 않게
        s.setMediaPlaybackRequiresUserGesture(true);

        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                return loader.shouldInterceptRequest(req.getUrl());
            }
        });
        web.setLongClickable(false);
        web.setOnLongClickListener(v -> true);   // 길게 눌러 글자 선택되는 것 막기

        if (saved != null) web.restoreState(saved);
        else web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");
    }

    // 뒤로 가기: 게임 안에서 열린 창부터 닫고, 닫을 게 없으면 앱 종료
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.__back ? window.__back() : false", r -> {
            if (!"true".equals(r)) MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onPause() {
        // 앱을 내리면 게임을 멈추고 저장
        web.evaluateJavascript("window.__pauseSave && window.__pauseSave()", null);
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }
}
