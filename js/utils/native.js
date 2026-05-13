/* ─── PHYSIQ ENGINE — Native Bridge ────────────────────────────────────── */
/* Thin platform-aware wrappers around Capacitor plugins. Every helper
   returns a resolved no-op on web so call sites can fire-and-forget
   without runtime branching. Native errors are swallowed — these are
   polish-layer features and must never break the app. */

import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Keyboard, KeyboardResize } from "@capacitor/keyboard";
import { SplashScreen } from "@capacitor/splash-screen";
import { Share } from "@capacitor/share";

export function isNative() {
  return Capacitor.isNativePlatform();
}

const IMPACT_BY_STYLE = {
  light: ImpactStyle.Light,
  medium: ImpactStyle.Medium,
  heavy: ImpactStyle.Heavy
};

export async function triggerHaptic(style) {
  if (!isNative()) return;
  try {
    await Haptics.impact({ style: IMPACT_BY_STYLE[style] || ImpactStyle.Light });
  } catch (e) {}
}

export async function configureStatusBar() {
  if (!isNative()) return;
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch (e) {}
}

export async function configureKeyboard() {
  if (!isNative()) return;
  try {
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
    await Keyboard.setAccessoryBarVisible({ isVisible: false });
  } catch (e) {}
}

export async function hideSplash() {
  if (!isNative()) return;
  try {
    await SplashScreen.hide();
  } catch (e) {}
}

export async function shareText(title, text) {
  if (!isNative()) {
    // Web fallback: use the Web Share API if available (mobile browsers
    // and some desktops). Silently no-op otherwise.
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ title, text }); } catch (e) {}
    }
    return;
  }
  try {
    await Share.share({ title, text, dialogTitle: title });
  } catch (e) {}
}
