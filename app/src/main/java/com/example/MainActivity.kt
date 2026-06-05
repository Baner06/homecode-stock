package com.example

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.example.ui.theme.MyApplicationTheme

class MainActivity : ComponentActivity() {

  private val requestPermissionLauncher = registerForActivityResult(
    ActivityResultContracts.RequestPermission()
  ) { _ ->
    // Done. Permission status will be queried by ZXing within WebView when camera opens.
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    
    // Check and request native Android CAMERA permission
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      requestPermissionLauncher.launch(Manifest.permission.CAMERA)
    }

    setContent {
      MyApplicationTheme {
        WarehouseWebView(modifier = Modifier.fillMaxSize())
      }
    }
  }
}

@Composable
fun WarehouseWebView(modifier: Modifier = Modifier) {
  var webViewRef by remember { mutableStateOf<WebView?>(null) }

  BackHandler(enabled = true) {
    webViewRef?.evaluateJavascript("javascript:if(window.onAndroidBackKey) { window.onAndroidBackKey(); }", null)
  }

  AndroidView(
    modifier = modifier,
    factory = { context ->
      WebView(context).apply {
        webViewRef = this
        layoutParams = android.view.ViewGroup.LayoutParams(
          android.view.ViewGroup.LayoutParams.MATCH_PARENT,
          android.view.ViewGroup.LayoutParams.MATCH_PARENT
        )
        
        webViewClient = object : WebViewClient() {
          @Deprecated("Deprecated in Java")
          override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
            return false // Direct navigation inside web intent
          }
        }
        
        webChromeClient = object : WebChromeClient() {
          override fun onPermissionRequest(request: PermissionRequest) {
            // Native bridge callback granting access to web-requested capture permissions (like Camera)
            request.grant(request.resources)
          }
        }
        
        settings.apply {
          javaScriptEnabled = true
          domStorageEnabled = true
          allowFileAccess = true
          allowContentAccess = true
          databaseEnabled = true
          loadWithOverviewMode = true
          useWideViewPort = true
          mediaPlaybackRequiresUserGesture = false
          mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }
        
        // Expose AndroidApp bridge to shutdown natively on confirmation
        addJavascriptInterface(object : Any() {
          @JavascriptInterface
          fun exitApp() {
            (context as? android.app.Activity)?.finishAffinity()
          }
        }, "AndroidApp")
        
        // Load the local packaged web files from assets
        loadUrl("file:///android_asset/www/index.html")
      }
    }
  )
}
